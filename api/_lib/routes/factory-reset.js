import { body, errorResponse, json, method } from '../http.js';
import { requireCapability } from '../permissions.js';
import { rpc } from '../supabase.js';
import { config } from '../config.js';

const CONFIRMATION='RESET_FACTORY_OPERATIONAL_DATA';
const clean=(value,max=500)=>String(value??'').trim().slice(0,max);

// This endpoint is deliberately separate from ordinary settings.  It never
// accepts a browser-only reset: the database reset is authoritative, audited,
// and available only to an authenticated administrator capability.
export async function factoryReset(req,res){
  if(!method(req,res,['POST']))return;
  try{
    const input=await body(req,16_384),identity=await requireCapability(req,'factory.reset');
    if(clean(input.confirmation,80)!==CONFIRMATION)throw Object.assign(new Error('تأكيد إعادة ضبط المصنع غير صحيح.'),{status:400,code:'FACTORY_RESET_CONFIRMATION_REQUIRED'});
    const result=await rpc('reset_factory_operational_data',{
      p_actor:identity.appUserId||identity.actor,
      p_reason:clean(input.reason,500)||'تهيئة بداية تشغيل جديدة',
      p_confirmation:CONFIRMATION,
      p_storage_bucket:config.storageBucket
    });
    json(res,200,{ok:true,result:Array.isArray(result)?result[0]:result});
  }catch(error){errorResponse(res,error);}
}
