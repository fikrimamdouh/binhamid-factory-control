import { requireAdmin } from './_lib/auth.js';
import { json, method, errorResponse } from './_lib/http.js';
import { select } from './_lib/supabase.js';
const label = { received:'مستلم',ready:'جاهز للمراجعة',processing:'قيد الفحص',failed:'تعذر الفحص',opened_in_program:'فُتح في البرنامج',approved:'معتمد',rejected:'مرفوض' };
export default async function handler(req,res){
  if(!method(req,res,['GET']))return;
  try{
    requireAdmin(req);
    const today=new Date().toISOString().slice(0,10);
    const [imports,approvals,discrepancies,groups,users,messages]=await Promise.all([
      select('imports','select=id,created_at,department,report_type,status,original_name,row_count,error_count,warning_count,summary&order=created_at.desc&limit=30'),
      select('approvals','select=id,created_at,reference_no,entity_type,entity_id,summary,amount,status,requested_by,decided_by&order=created_at.desc&limit=30'),
      select('discrepancies','select=id,severity,status&status=in.(open,under_review)&limit=1000'),
      select('telegram_groups','select=id,chat_id,title,department,active,status,last_seen_at&order=last_seen_at.desc&limit=50'),
      select('user_channels','select=external_id,external_username,active,user_id,app_users(full_name,role,active)&channel=eq.telegram&order=last_seen_at.desc&limit=100'),
      select('telegram_messages',`select=id&created_at=gte.${today}T00:00:00Z&limit=1000`)
    ]);
    const normalizedUsers=(users||[]).map(x=>({external_id:x.external_id,external_username:x.external_username,active:Boolean(x.active&&x.app_users?.active),full_name:x.app_users?.full_name||'',role:x.app_users?.role||'pending'}));
    json(res,200,{ok:true,counts:{pendingImports:(imports||[]).filter(x=>!['approved','rejected','opened_in_program'].includes(x.status)).length,openApprovals:(approvals||[]).filter(x=>x.status==='pending').length,openDiscrepancies:(discrepancies||[]).length,messagesToday:(messages||[]).length},imports:(imports||[]).map(x=>({...x,status_label:label[x.status]||x.status})),approvals:approvals||[],groups:groups||[],users:normalizedUsers});
  }catch(error){errorResponse(res,error);}
}
