import { requireAdmin } from '../_lib/auth.js';
import { json, method, body, errorResponse } from '../_lib/http.js';
import { rpc } from '../_lib/supabase.js';
import { ROLES } from '../_lib/domain.js';
export default async function handler(req,res){
  if(!method(req,res,['POST']))return;
  try{requireAdmin(req);const input=await body(req);const role=String(input.role||'');if(!ROLES.includes(role))throw Object.assign(new Error('الدور غير صحيح'),{status:400});const result=await rpc('approve_telegram_user',{p_external_id:String(input.externalId),p_full_name:String(input.fullName||'').slice(0,500),p_role:role,p_active:input.active!==false});json(res,200,{ok:true,result});}catch(error){errorResponse(res,error);}
}
