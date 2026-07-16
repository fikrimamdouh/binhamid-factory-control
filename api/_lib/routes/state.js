import { requireAdmin } from '../auth.js';
import { json, method, body, errorResponse } from '../http.js';
import { select, rpc, upsert, insert } from '../supabase.js';

function clean(value,max=500){return String(value??'').trim().slice(0,max);}

async function syncMasters(payload){
  const legacy=payload?.legacy||{};
  const now=new Date().toISOString();
  const employees=(legacy.emp||[]).map(x=>({
    external_id:clean(x.id,120),
    employee_no:clean(x.no,120),
    national_id:clean(x.nid,120),
    full_name:clean(x.name),
    phone:clean(x.tel,80),
    role:clean(x.role,120),
    salary:Number(x.totalSalary??x.actualSalary??x.baseSalary??x.salary??x.sal??0),
    active:x.act!==false,
    source_updated_at:now
  })).filter(x=>x.external_id);
  const vehicles=(legacy.veh||[]).map(x=>({external_id:clean(x.id,120),plate_no:clean(x.plate,120),asset_no:clean(x.acct,120),vehicle_type:clean(x.type,180),make:clean(x.make,180),model:clean(x.model,120),driver_external_id:clean(x.drv,120),status:clean(x.status||'active',80),active:x.act!==false,source_updated_at:now})).filter(x=>x.external_id);
  const customers=(legacy.cli||[]).map(x=>({external_id:clean(x.id,120),customer_code:clean(x.code||x.no,120),customer_name:clean(x.name),phone:clean(x.tel,80),segment:clean(x.seg,80),credit_limit:Number(x.cap||x.credit||0),payment_days:Number(x.days||0),active:x.act!==false,source_updated_at:now})).filter(x=>x.external_id);
  for(const [table,rows] of [['employees',employees],['vehicles',vehicles],['customers',customers]]){
    for(let index=0;index<rows.length;index+=200)await upsert(table,rows.slice(index,index+200),'external_id');
  }
}

export async function state(req,res){
  if(!method(req,res,['GET','PUT']))return;
  try{
    const actor=requireAdmin(req);
    if(req.method==='GET'){
      const rows=await select('app_state','key=eq.primary&select=key,revision,updated_at,updated_by,device_id,payload&limit=1');
      const row=rows?.[0];
      return json(res,200,row?{revision:row.revision,updatedAt:row.updated_at,updatedBy:row.updated_by,deviceId:row.device_id,payload:row.payload}:{revision:0,payload:null});
    }
    const input=await body(req);
    if(!input.payload||typeof input.payload!=='object')throw Object.assign(new Error('حالة البرنامج غير موجودة'),{status:400});
    if(!input.payload.legacy||!input.payload.ops)throw Object.assign(new Error('الحالة المرسلة ناقصة'),{status:400});
    const result=await rpc('save_app_state',{
      p_payload:input.payload,
      p_base_revision:input.baseRevision===null||input.baseRevision===undefined?null:Number(input.baseRevision),
      p_updated_by:actor.actor,
      p_device_id:clean(input.deviceId,160),
      p_reason:clean(input.reason||'مزامنة',300)
    });
    const saved=Array.isArray(result)?result[0]:result;
    await syncMasters(input.payload).catch(error=>console.error('master sync failed',error));
    await insert('audit_log',[{actor_type:'web',actor_id:actor.actor,action:'state_sync',entity_type:'app_state',entity_id:'primary',details:{reason:clean(input.reason,300),deviceId:clean(input.deviceId,160),revision:saved?.revision}}],{prefer:'return=minimal'}).catch(()=>{});
    json(res,200,{ok:true,revision:Number(saved?.revision||0),updatedAt:saved?.updated_at||new Date().toISOString()});
  }catch(error){
    if(/revision conflict/i.test(error.message||'')||error.data?.code==='40001')error.status=409;
    errorResponse(res,error);
  }
}
