import { body, errorResponse, json, method } from '../http.js';
import { requireCapability } from '../permissions.js';
import { rpc } from '../supabase.js';

const clean=(value,max=1000)=>String(value??'').trim().slice(0,max);
function params(req){return new URL(req.url||'/api/router',`https://${String(req.headers.host||'localhost')}`).searchParams;}
function unwrap(result){return Array.isArray(result)?result[0]:result;}

export async function fifo(req,res){
  if(!method(req,res,['GET','POST']))return;
  try{
    const identity=await requireCapability(req,'daily_report.approve');
    if(req.method==='GET'){
      const customerCode=clean(params(req).get('customerCode'),120);if(!customerCode)throw Object.assign(new Error('كود العميل مطلوب'),{status:400});
      const preview=unwrap(await rpc('preview_customer_fifo_rebuild',{p_customer_external_id:customerCode}));
      return json(res,200,{ok:true,dryRun:true,preview});
    }
    const input=await body(req),customerCode=clean(input.customerCode,120),reason=clean(input.reason,1000);
    if(!customerCode||!reason)throw Object.assign(new Error('كود العميل وسبب إعادة البناء مطلوبان'),{status:400});
    if(input.confirm!==true)throw Object.assign(new Error('إعادة البناء تتطلب confirm=true بعد مراجعة Dry Run'),{status:409,code:'FIFO_CONFIRMATION_REQUIRED'});
    const actor=identity.appUserId||identity.actor,result=unwrap(await rpc('rebuild_customer_fifo',{p_customer_external_id:customerCode,p_actor:actor,p_reason:reason}));
    return json(res,200,{ok:true,dryRun:false,result});
  }catch(error){errorResponse(res,error);}
}
