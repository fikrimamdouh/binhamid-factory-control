import { requireAdmin } from '../auth.js';
import { json, method, body, errorResponse } from '../http.js';
import { patch } from '../supabase.js';

const allowed=['received','processing','ready','failed','opened_in_program','approved','rejected'];
export async function status(req,res){
  if(!method(req,res,['POST']))return;
  try{
    requireAdmin(req);
    const input=await body(req);
    if(!allowed.includes(input.status))throw Object.assign(new Error('الحالة غير صحيحة'),{status:400});
    const rows=await patch('imports',`id=eq.${encodeURIComponent(input.id)}`,{status:input.status,updated_at:new Date().toISOString()});
    json(res,200,{ok:true,import:rows?.[0]});
  }catch(error){errorResponse(res,error);}
}
