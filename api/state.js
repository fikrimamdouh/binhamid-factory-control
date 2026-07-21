import { requireAdminOrDevice } from './_lib/auth.js';
import { json, method, body, errorResponse } from './_lib/http.js';
import { select, rpc, upsert, insert } from './_lib/supabase.js';

function clean(v,max=500){return String(v??'').trim().slice(0,max);}
async function selectPages(table,query,maxRows=10000){const rows=[],pageSize=1000;for(let offset=0;offset<maxRows;offset+=pageSize){const page=await select(table,`${query}&offset=${offset}&limit=${pageSize}`);if(!Array.isArray(page)||!page.length)break;rows.push(...page);if(page.length<pageSize)break;}return rows;}
function appendMissing(current,masters,convert){const rows=Array.isArray(current)?current.map(row=>({...row})):[],known=new Set(rows.map(row=>clean(row?.id,120)).filter(Boolean));for(const master of masters||[]){const id=clean(master?.external_id,120);if(!id||known.has(id))continue;rows.push(convert(master));known.add(id);}return rows;}
async function enrichStatePayload(payload){if(!payload||typeof payload!=='object')return payload;const[employees,customers,vehicles]=await Promise.all([selectPages('employees','active=eq.true&select=external_id,employee_no,national_id,full_name,phone,role,salary,active&order=full_name.asc',5000).catch(()=>[]),selectPages('customers','active=eq.true&select=external_id,customer_code,customer_name,phone,segment,credit_limit,payment_days,active&order=customer_name.asc',10000).catch(()=>[]),selectPages('vehicles','active=eq.true&select=external_id,plate_no,asset_no,vehicle_type,make,model,driver_external_id,status,active&order=plate_no.asc',5000).catch(()=>[])]);const legacy={...(payload.legacy||{})};legacy.emp=appendMissing(legacy.emp,employees,row=>({id:row.external_id,no:row.employee_no||row.external_id,nid:row.national_id||'',name:row.full_name||row.external_id,tel:row.phone||'',role:row.role||'employee',salary:Number(row.salary||0),act:row.active!==false}));legacy.cli=appendMissing(legacy.cli,customers,row=>({id:row.external_id,code:row.customer_code||row.external_id,name:row.customer_name||row.external_id,tel:row.phone||'',seg:row.segment||'',cap:Number(row.credit_limit||0),days:Number(row.payment_days||0),act:row.active!==false}));legacy.veh=appendMissing(legacy.veh,vehicles,row=>({id:row.external_id,plate:row.plate_no||'',acct:row.asset_no||'',type:row.vehicle_type||'',make:row.make||'',model:row.model||'',drv:row.driver_external_id||'',status:row.status||'active',act:row.active!==false}));return{...payload,legacy};}

async function syncMasters(payload){
  const legacy=payload?.legacy||{},now=new Date().toISOString();
  const employees=(legacy.emp||[]).map(x=>({external_id:clean(x.id,120),employee_no:clean(x.no,120),national_id:clean(x.nid,120),full_name:clean(x.name),phone:clean(x.tel,80),role:clean(x.role,120),salary:Number(x.salary||x.sal||0),active:x.act!==false,source_updated_at:now})).filter(x=>x.external_id);
  const vehicles=(legacy.veh||[]).map(x=>({external_id:clean(x.id,120),plate_no:clean(x.plate,120),asset_no:clean(x.acct,120),vehicle_type:clean(x.type,180),make:clean(x.make,180),model:clean(x.model,120),driver_external_id:clean(x.drv,120),status:clean(x.status||'active',80),active:x.act!==false,source_updated_at:now})).filter(x=>x.external_id);
  const customers=(legacy.cli||[]).map(x=>({external_id:clean(x.id,120),customer_code:clean(x.code||x.no,120),customer_name:clean(x.name),phone:clean(x.tel,80),segment:clean(x.seg,80),credit_limit:Number(x.cap||x.credit||0),payment_days:Number(x.days||0),active:x.act!==false,source_updated_at:now})).filter(x=>x.external_id);
  const jobs=[];for(const[table,rows]of[['employees',employees],['vehicles',vehicles],['customers',customers]])for(let i=0;i<rows.length;i+=200){const slice=rows.slice(i,i+200);jobs.push({table,count:slice.length,run:()=>upsert(table,slice,'external_id')});}
  const totalChunks=jobs.length,totalRows=employees.length+vehicles.length+customers.length,deadline=Date.now()+8_000;let completedChunks=0,completedRows=0,deferredChunks=0,failedChunks=0;
  async function worker(){while(jobs.length){if(Date.now()>deadline){deferredChunks+=jobs.length;jobs.length=0;return;}const job=jobs.shift();try{await job.run();completedChunks++;completedRows+=job.count;}catch(error){failedChunks++;console.warn('[state master chunk]',job.table,String(error?.message||'').slice(0,200));}}}
  await Promise.all([worker(),worker(),worker(),worker()]);
  if(deferredChunks)console.warn('[state master sync] deferred chunks:',deferredChunks);
  return{status:deferredChunks||failedChunks?'delayed':'complete',totalChunks,completedChunks,deferredChunks,failedChunks,totalRows,completedRows};
}

export default async function handler(req,res){
  if(!method(req,res,['GET','PUT']))return;
  try{
    const actor=requireAdminOrDevice(req,req.method==='GET'?'state.read':'state.write');
    if(req.method==='GET'){const rows=await select('app_state','key=eq.primary&select=key,revision,updated_at,updated_by,device_id,payload&limit=1'),row=rows?.[0];if(!row)return json(res,200,{revision:0,payload:null});const payload=await enrichStatePayload(row.payload);return json(res,200,{revision:row.revision,updatedAt:row.updated_at,updatedBy:row.updated_by,deviceId:row.device_id,payload});}
    const startedAt=Date.now(),input=await body(req),deviceId=clean(input.deviceId,160),payloadBytes=JSON.stringify(input.payload||{}).length;
    const incomingClients=(input.payload?.legacy?.cli||[]).length,incomingOpening=(input.payload?.ops?.customerOpeningBalances||[]).length;
    console.log('[state save] bytes',payloadBytes,'| clients',incomingClients,'| opening',incomingOpening);
    if(!input.payload||typeof input.payload!=='object')throw Object.assign(new Error('حالة البرنامج غير موجودة'),{status:400});
    if(!input.payload.legacy||!input.payload.ops)throw Object.assign(new Error('الحالة المرسلة ناقصة'),{status:400});
    if(actor.kind==='device'&&deviceId!==actor.deviceId)throw Object.assign(new Error('معرف الجهاز لا يطابق جلسة الربط'),{status:403,code:'DEVICE_ID_MISMATCH'});

    const incomingEmptyGroup=!(input.payload?.legacy?.cli||[]).length||!(input.payload?.ops?.customerOpeningBalances||[]).length;
    if(input.force!==true&&incomingEmptyGroup){let current=null,checkFailed=false;try{const rows=await select('app_state','key=eq.primary&select=clients:payload->legacy->cli,opening:payload->ops->customerOpeningBalances&limit=1'),row=rows?.[0]||{};current={legacy:{cli:row.clients},ops:{customerOpeningBalances:row.opening}};}catch(error){checkFailed=true;console.warn('[state guard]',String(error?.message||error).slice(0,140));}if(checkFailed)current=null;const groups=[['legacy.cli','بيانات العملاء',payload=>payload?.legacy?.cli],['ops.customerOpeningBalances','الأرصدة الافتتاحية للعملاء',payload=>payload?.ops?.customerOpeningBalances]];for(const[,label,pick]of(current?groups:[])){const stored=pick(current),incoming=pick(input.payload),storedCount=Array.isArray(stored)?stored.length:0,incomingCount=Array.isArray(incoming)?incoming.length:0;if(storedCount>0&&incomingCount===0)throw Object.assign(new Error(`الحفظ متوقف لحمايتك: الجهاز الحالي لا يحتوي ${label} بينما النسخة السحابية تحتوي ${storedCount} سجلًا. اسحب النسخة الحديثة أولًا.`),{status:409,code:'EMPTY_STATE_BLOCKED'});}}

    const requestedRevision=input.baseRevision===null||input.baseRevision===undefined?null:Number(input.baseRevision);
    if(requestedRevision===null){const existing=(await select('app_state','key=eq.primary&select=revision&limit=1').catch(()=>[]))?.[0];if(existing&&Number(existing.revision||0)>0)throw Object.assign(new Error('توجد نسخة سحابية قائمة. يجب سحبها ودمج التغييرات قبل الحفظ.'),{status:409,code:'REVISION_REQUIRED',remoteRevision:Number(existing.revision||0)});}
    const saveStartedAt=Date.now(),result=await rpc('save_app_state',{p_payload:input.payload,p_base_revision:requestedRevision,p_updated_by:actor.actor,p_device_id:deviceId,p_reason:clean(input.reason||'مزامنة',300)}),saved=Array.isArray(result)?result[0]:result;
    console.log('[state save] rpc ms',Date.now()-saveStartedAt);
    const masterSync=await syncMasters(input.payload).catch(error=>({status:'delayed',totalChunks:0,completedChunks:0,deferredChunks:0,failedChunks:1,totalRows:0,completedRows:0,error:String(error?.message||'').slice(0,160)}));
    await insert('audit_log',[{actor_type:actor.kind==='device'?'device':'web',actor_id:actor.actor,action:'state_sync',entity_type:'app_state',entity_id:'primary',details:{reason:clean(input.reason,300),deviceId,revision:saved?.revision,masterSync}}],{prefer:'return=minimal'}).catch(()=>{});
    json(res,200,{ok:true,revision:Number(saved?.revision||0),updatedAt:saved?.updated_at||new Date().toISOString(),elapsedMs:Date.now()-startedAt,masterSync});
  }catch(error){if(/revision conflict/i.test(error.message||'')||error.data?.code==='40001'){error.status=409;error.code='REVISION_CONFLICT';error.message='توجد نسخة سحابية أحدث. يجب سحبها ودمج التغييرات قبل الحفظ.';}errorResponse(res,error);}
}
