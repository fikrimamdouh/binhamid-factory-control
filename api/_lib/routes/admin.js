import { requireAdmin } from '../auth.js';
import { json, method, body, errorResponse } from '../http.js';
import { upsert, insert, rpc } from '../supabase.js';
import { DEPARTMENTS, ROLES } from '../domain.js';

export async function groups(req,res){
  if(!method(req,res,['POST']))return;
  try{
    requireAdmin(req);
    const input=await body(req),department=String(input.department||'');
    if(!DEPARTMENTS.includes(department))throw Object.assign(new Error('القسم غير صحيح'),{status:400});
    const rows=await upsert('telegram_groups',[{chat_id:String(input.chatId),department,active:input.active!==false,status:'approved',updated_at:new Date().toISOString()}],'chat_id');
    await insert('audit_log',[{actor_type:'web',actor_id:'web-admin',action:'approve_telegram_group',entity_type:'telegram_group',entity_id:String(input.chatId),details:{department}}],{prefer:'return=minimal'}).catch(()=>{});
    json(res,200,{ok:true,group:rows?.[0]});
  }catch(error){errorResponse(res,error);}
}

export async function users(req,res){
  if(!method(req,res,['POST']))return;
  try{
    requireAdmin(req);
    const input=await body(req),role=String(input.role||'');
    if(!ROLES.includes(role))throw Object.assign(new Error('الدور غير صحيح'),{status:400});
    const result=await rpc('approve_telegram_user',{p_external_id:String(input.externalId),p_full_name:String(input.fullName||'').slice(0,500),p_role:role,p_active:input.active!==false,p_employee_external_id:String(input.employeeExternalId||'').slice(0,200)||null});
    json(res,200,{ok:true,result});
  }catch(error){errorResponse(res,error);}
}
