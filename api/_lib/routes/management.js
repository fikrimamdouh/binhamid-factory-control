import { requireAdmin } from '../auth.js';
import { json, method, errorResponse } from '../http.js';
import { select } from '../supabase.js';

const label={received:'مستلم',ready:'جاهز للمراجعة',processing:'قيد الفحص',failed:'تعذر الفحص',opened_in_program:'فُتح في البرنامج',approved:'معتمد',rejected:'مرفوض'};
const clamp=(value,min,max,fallback)=>{const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.trunc(n))):fallback;};
const normalize=value=>String(value||'').trim().toLowerCase();
function params(req){return new URL(req.url||'/api/router',`https://${String(req.headers.host||'localhost')}`).searchParams;}

export async function dashboard(req,res){
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

function cleanMessage(row){
  return{id:row.id,chat_id:String(row.chat_id||''),message_id:String(row.message_id||''),direction:row.direction||((row.sender_external_id==='bot')?'outgoing':'incoming'),delivery_status:row.delivery_status||'received',sender_external_id:row.sender_external_id||'',sender_name:row.sender_name||row.app_users?.full_name||row.raw?.message?.from?.first_name||'',sender_role:row.app_users?.role||'',chat_type:row.chat_type||row.raw?.message?.chat?.type||'',message_type:row.message_type||'text',text:row.text||'',transcription:row.transcription||'',file_name:row.file_name||'',mime_type:row.mime_type||'',file_path:row.file_path||'',related_entity_type:row.related_entity_type||'',related_entity_id:row.related_entity_id||'',reply_to_message_id:row.reply_to_message_id||'',bot_method:row.bot_method||'',action_name:row.action_name||'',action_payload:row.action_payload||{},created_at:row.created_at};
}
async function fetchRows(query){
  const modern='id,chat_id,message_id,sender_external_id,message_type,text,transcription,file_name,mime_type,file_path,related_entity_type,related_entity_id,raw,created_at,direction,delivery_status,sender_name,chat_type,reply_to_message_id,bot_method,action_name,action_payload,app_users(full_name,role)';
  try{return await select('telegram_messages',`${query}&select=${modern}`);}catch(error){
    const legacy='id,chat_id,message_id,sender_external_id,message_type,text,transcription,file_name,mime_type,file_path,related_entity_type,related_entity_id,raw,created_at,app_users(full_name,role)';
    return select('telegram_messages',`${query}&select=${legacy}`);
  }
}
function buildThreads(messages){
  const map=new Map();
  for(const msg of messages){
    const key=msg.chat_id,old=map.get(key)||{chat_id:key,chat_type:msg.chat_type||'',display_name:'',external_user_id:'',role:'',last_message:'',last_message_type:'',last_at:'',message_count:0,incoming_count:0,outgoing_count:0};
    old.message_count++;if(msg.direction==='outgoing')old.outgoing_count++;else old.incoming_count++;
    if(!old.display_name&&msg.direction!=='outgoing')old.display_name=msg.sender_name||msg.sender_external_id||key;
    if(!old.external_user_id&&msg.direction!=='outgoing')old.external_user_id=msg.sender_external_id||'';
    if(!old.role&&msg.sender_role)old.role=msg.sender_role;
    if(!old.last_at||String(msg.created_at)>String(old.last_at)){old.last_at=msg.created_at;old.last_message=msg.text||msg.transcription||msg.file_name||`[${msg.message_type}]`;old.last_message_type=msg.message_type;old.chat_type=msg.chat_type||old.chat_type;}
    map.set(key,old);
  }
  return[...map.values()].sort((a,b)=>String(b.last_at).localeCompare(String(a.last_at)));
}
export async function conversations(req,res){
  if(!method(req,res,['GET']))return;
  try{
    requireAdmin(req);
    const p=params(req),chatId=String(p.get('chatId')||'').trim(),search=normalize(p.get('q')),limit=clamp(p.get('limit'),1,1000,300),before=String(p.get('before')||'').trim();
    if(chatId){
      let query=`chat_id=eq.${encodeURIComponent(chatId)}&order=created_at.desc&limit=${limit}`;if(before)query+=`&created_at=lt.${encodeURIComponent(before)}`;
      let rows=(await fetchRows(query)||[]).map(cleanMessage);if(search)rows=rows.filter(x=>normalize(`${x.text} ${x.transcription} ${x.file_name} ${x.sender_name}`).includes(search));rows.reverse();
      return json(res,200,{ok:true,chat_id:chatId,messages:rows,next_before:rows.length?rows[0].created_at:null});
    }
    const rows=(await fetchRows(`order=created_at.desc&limit=${limit}`)||[]).map(cleanMessage);let threads=buildThreads(rows);
    if(search)threads=threads.filter(x=>normalize(`${x.display_name} ${x.external_user_id} ${x.role} ${x.last_message}`).includes(search));
    return json(res,200,{ok:true,threads,total:threads.length,source_messages:rows.length});
  }catch(error){errorResponse(res,error);}
}

export async function operations(req,res){
  if(!method(req,res,['GET']))return;
  try{
    requireAdmin(req);
    const p=params(req),department=String(p.get('department')||''),status=String(p.get('status')||''),entityType=String(p.get('entityType')||''),limit=clamp(p.get('limit'),1,500,100),filters=[];
    if(department)filters.push(`department=eq.${encodeURIComponent(department)}`);if(status)filters.push(`status=eq.${encodeURIComponent(status)}`);if(entityType)filters.push(`entity_type=eq.${encodeURIComponent(entityType)}`);
    const query=[...filters,'select=id,reference_no,entity_type,department,status,title,summary,amount,payload,created_by,assigned_to,source_channel,source_chat_id,source_message_id,created_at,updated_at,closed_at','order=updated_at.desc',`limit=${limit}`].join('&');
    const records=await select('operational_records',query);
    const[sales,purchases,tasks,quality,collections]=await Promise.all([
      select('sales_orders','select=id,status,sales_type,total_amount,delivery_date&limit=2000'),select('purchase_requests','select=id,status,urgency&limit=2000'),select('operational_tasks','select=id,status,priority,due_at&limit=2000'),select('quality_cases','select=id,status,severity&limit=2000'),select('collection_events','select=id,status,amount,occurred_at&limit=2000')
    ]);
    const open=value=>!['closed','completed','cancelled','collected','rejected'].includes(String(value||''));
    json(res,200,{ok:true,counts:{sales_open:(sales||[]).filter(x=>open(x.status)).length,sales_overdue:(sales||[]).filter(x=>open(x.status)&&x.delivery_date&&x.delivery_date<new Date().toISOString().slice(0,10)).length,purchase_open:(purchases||[]).filter(x=>open(x.status)).length,purchase_urgent:(purchases||[]).filter(x=>open(x.status)&&['urgent','critical'].includes(x.urgency)).length,tasks_open:(tasks||[]).filter(x=>open(x.status)).length,tasks_overdue:(tasks||[]).filter(x=>open(x.status)&&x.due_at&&new Date(x.due_at)<new Date()).length,quality_open:(quality||[]).filter(x=>open(x.status)).length,collections_total:(collections||[]).reduce((sum,x)=>sum+Number(x.amount||0),0)},records:records||[]});
  }catch(error){errorResponse(res,error);}
}
