import { requireAdmin } from '../_lib/auth.js';
import { json, method, body, errorResponse } from '../_lib/http.js';
import { upsert, insert } from '../_lib/supabase.js';
import { DEPARTMENTS } from '../_lib/domain.js';
export default async function handler(req,res){
  if(!method(req,res,['POST']))return;
  try{requireAdmin(req);const input=await body(req);const department=String(input.department||'');if(!DEPARTMENTS.includes(department))throw Object.assign(new Error('القسم غير صحيح'),{status:400});const rows=await upsert('telegram_groups',[{chat_id:String(input.chatId),department,active:input.active!==false,status:'approved',updated_at:new Date().toISOString()}],'chat_id');await insert('audit_log',[{actor_type:'web',actor_id:'web-admin',action:'approve_telegram_group',entity_type:'telegram_group',entity_id:String(input.chatId),details:{department}}],{prefer:'return=minimal'}).catch(()=>{});json(res,200,{ok:true,group:rows?.[0]});}catch(error){errorResponse(res,error);}
}
