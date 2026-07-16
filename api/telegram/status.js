import { requireAdmin } from '../_lib/auth.js';
import { json, method, errorResponse } from '../_lib/http.js';
import { telegram } from '../_lib/telegram.js';

export default async function handler(req,res){
  if(!method(req,res,['GET']))return;
  try{
    requireAdmin(req);
    const info=await telegram('getWebhookInfo');
    const url=String(info?.url||'');
    json(res,200,{
      ok:true,
      configured:Boolean(url),
      url,
      enterprise_v3:/\/api\/telegram\/webhook-v3$/.test(url),
      pending_update_count:Number(info?.pending_update_count||0),
      max_connections:Number(info?.max_connections||0),
      last_error_date:info?.last_error_date||null,
      last_error_message:info?.last_error_message||'',
      allowed_updates:info?.allowed_updates||[]
    });
  }catch(error){errorResponse(res,error);}
}
