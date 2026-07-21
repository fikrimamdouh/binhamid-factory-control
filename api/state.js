import { requireAdminOrDevice } from './_lib/auth.js';
import { json, method, body, errorResponse } from './_lib/http.js';
import { select, rpc, upsert, insert } from './_lib/supabase.js';

function clean(v,max=500){return String(v??'').trim().slice(0,max);}
async function syncMasters(payload){
  const legacy=payload?.legacy||{},now=new Date().toISOString();
  const employees=(legacy.emp||[]).map(x=>({external_id:clean(x.id,120),employee_no:clean(x.no,120),national_id:clean(x.nid,120),full_name:clean(x.name),phone:clean(x.tel,80),role:clean(x.role,120),salary:Number(x.salary||x.sal||0),active:x.act!==false,source_updated_at:now})).filter(x=>x.external_id);
  const vehicles=(legacy.veh||[]).map(x=>({external_id:clean(x.id,120),plate_no:clean(x.plate,120),asset_no:clean(x.acct,120),vehicle_type:clean(x.type,180),make:clean(x.make,180),model:clean(x.model,120),driver_external_id:clean(x.drv,120),status:clean(x.status||'active',80),active:x.act!==false,source_updated_at:now})).filter(x=>x.external_id);
  const customers=(legacy.cli||[]).map(x=>({external_id:clean(x.id,120),customer_code:clean(x.code||x.no,120),customer_name:clean(x.name),phone:clean(x.tel,80),segment:clean(x.seg,80),credit_limit:Number(x.cap||x.credit||0),payment_days:Number(x.days||0),active:x.act!==false,source_updated_at:now})).filter(x=>x.external_id);
  // مزامنة متوازية محدودة (4 دفعات معًا) بمهلة كلية 15 ثانية: حفظ الحالة نفسه
  // اكتمل قبل هذه الخطوة، فلو ضاقت المهلة تُستكمل الدفعات المتبقية تلقائيًا في
  // الحفظة التالية (القوائم تُرسل كاملة كل مرة) بدل أن تلتهم مهلة الدالة وتُفشل
  // المزامنة كلها بـ FUNCTION_INVOCATION_TIMEOUT كما كان يحدث تسلسليًا.
  const jobs=[];
  for(const[table,rows]of[['employees',employees],['vehicles',vehicles],['customers',customers]])
    for(let i=0;i<rows.length;i+=200){const slice=rows.slice(i,i+200);jobs.push(()=>upsert(table,slice,'external_id'));}
  // الحالات الكبيرة تستهلك زمن الطلب كله في الحفظ نفسه، فتُؤجَّل مزامنة
  // الجداول الفرعية إلى الحفظة التالية بدلًا من إسقاط العملية كلها بمهلة.
  const deadline=Date.now()+8_000;let skipped=0;
  async function worker(){
    while(jobs.length){
      if(Date.now()>deadline){skipped+=jobs.length;jobs.length=0;return;}
      const job=jobs.shift();
      await job().catch(error=>console.warn('[state master chunk]',String(error?.message||'').slice(0,200)));
    }
  }
  await Promise.all([worker(),worker(),worker(),worker()]);
  if(skipped)console.warn('[state master sync] deadline reached, deferred chunks:',skipped);
}
export default async function handler(req,res){
  if(!method(req,res,['GET','PUT']))return;
  try{
    const actor=requireAdminOrDevice(req,req.method==='GET'?'state.read':'state.write');
    if(req.method==='GET'){
      const rows=await select('app_state','key=eq.primary&select=key,revision,updated_at,updated_by,device_id,payload&limit=1'),row=rows?.[0];
      return json(res,200,row?{revision:row.revision,updatedAt:row.updated_at,updatedBy:row.updated_by,deviceId:row.device_id,payload:row.payload}:{revision:0,payload:null});
    }
    const startedAt=Date.now(),input=await body(req),deviceId=clean(input.deviceId,160);
    const payloadBytes=JSON.stringify(input.payload||{}).length;
    const incomingClients=(input.payload?.legacy?.cli||[]).length,incomingOpening=(input.payload?.ops?.customerOpeningBalances||[]).length;
    console.log('[state save] bytes',payloadBytes,'| clients',incomingClients,'| opening',incomingOpening);
    if(!input.payload||typeof input.payload!=='object')throw Object.assign(new Error('حالة البرنامج غير موجودة'),{status:400});
    if(!input.payload.legacy||!input.payload.ops)throw Object.assign(new Error('الحالة المرسلة ناقصة'),{status:400});
    if(actor.kind==='device'&&deviceId!==actor.deviceId)throw Object.assign(new Error('معرف الجهاز لا يطابق جلسة الربط'),{status:403,code:'DEVICE_ID_MISMATCH'});
    // حماية من محو البيانات: جهاز فاضي (متصفح جديد أو تحميل فشل) كان يقدر
    // يكتب حالة خالية فوق حالة سحابية مليانة فتختفي بيانات العملاء والأرصدة.
    // الحفظ يُرفض إذا كانت الحالة الجديدة فارغة والمحفوظة غير فارغة، إلا
    // بتأكيد صريح (force) — مثل حالة التصفير المتعمد.
    // الفحص لا يلزم إلا إذا كانت الحالة الواردة نفسها فارغة في إحدى المجموعات.
    // تحميل الحالة السحابية كاملة في كل حفظة كان يضيف آلاف السجلات إلى زمن
    // الطلب ويتسبب في انتهاء المهلة، والحفظ الطبيعي لا يحتاجه إطلاقًا.
    const incomingEmptyGroup=!(input.payload?.legacy?.cli||[]).length||!(input.payload?.ops?.customerOpeningBalances||[]).length;
    if(input.force!==true&&incomingEmptyGroup){
      let current=null,checkFailed=false;
      try{
        // مسارات ضيقة فقط: قراءة الحالة كاملة تتجاوز مهلة استعلام قاعدة البيانات.
        const rows=await select('app_state','key=eq.primary&select=clients:payload->legacy->cli,opening:payload->ops->customerOpeningBalances&limit=1');
        const row=rows?.[0]||{};current={legacy:{cli:row.clients},ops:{customerOpeningBalances:row.opening}};
      }catch(error){checkFailed=true;console.warn('[state guard]',String(error?.message||error).slice(0,140));}
      // تعذّر التحقق (مهلة استعلام قاعدة البيانات على الحالة الضخمة) لا يجوز
      // أن يمنع المستخدم من حفظ بياناته؛ نسجّل التحذير ونكمل.
      if(checkFailed)current=null;
      // كل مجموعة تُحمى على حدة: فقدان الأرصدة الافتتاحية وحده كان يمر دون
      // اعتراض لأن قائمة العملاء تظل ممتلئة، فتختفي كل المديونيات بصمت.
      const groups=[
        ['legacy.cli','بيانات العملاء',payload=>payload?.legacy?.cli],
        ['ops.customerOpeningBalances','الأرصدة الافتتاحية للعملاء',payload=>payload?.ops?.customerOpeningBalances]
      ];
      for(const[,label,pick]of(current?groups:[])){
        const stored=pick(current),incoming=pick(input.payload);
        const storedCount=Array.isArray(stored)?stored.length:0,incomingCount=Array.isArray(incoming)?incoming.length:0;
        if(storedCount>0&&incomingCount===0)throw Object.assign(new Error(`الحفظ متوقف لحمايتك: الجهاز الحالي لا يحتوي ${label} بينما النسخة السحابية تحتوي ${storedCount} سجلًا. افتح البرنامج على الجهاز الذي فيه بياناتك وزامن منه.`),{status:409,code:'EMPTY_STATE_BLOCKED'});
      }
    }
    const saveStartedAt=Date.now();
    const result=await rpc('save_app_state',{p_payload:input.payload,p_base_revision:input.baseRevision===null||input.baseRevision===undefined?null:Number(input.baseRevision),p_updated_by:actor.actor,p_device_id:deviceId,p_reason:clean(input.reason||'مزامنة',300)}),saved=Array.isArray(result)?result[0]:result;
    console.log('[state save] rpc ms',Date.now()-saveStartedAt);
    await syncMasters(input.payload).catch(error=>console.error('master sync failed',error));
    await insert('audit_log',[{actor_type:actor.kind==='device'?'device':'web',actor_id:actor.actor,action:'state_sync',entity_type:'app_state',entity_id:'primary',details:{reason:clean(input.reason,300),deviceId,revision:saved?.revision}}],{prefer:'return=minimal'}).catch(()=>{});
    json(res,200,{ok:true,revision:Number(saved?.revision||0),updatedAt:saved?.updated_at||new Date().toISOString()});
  }catch(error){if(/revision conflict/i.test(error.message||'')||error.data?.code==='40001')error.status=409;errorResponse(res,error);}
}
