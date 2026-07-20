import { requireAdmin } from '../auth.js';
import { json, method, body, errorResponse } from '../http.js';
import { select, insert, patch, rpc, downloadObject } from '../supabase.js';
import { sendMessage } from '../telegram.js';

const label={received:'مستلم',ready:'جاهز للمراجعة',processing:'قيد الفحص',failed:'تعذر الفحص',opened_in_program:'فُتح في البرنامج',approved:'معتمد',rejected:'مرفوض'};
const clamp=(value,min,max,fallback)=>{const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.trunc(n))):fallback;};
const normalize=value=>String(value||'').trim().toLowerCase();
const clean=(value,max=500)=>String(value??'').trim().slice(0,max);
const telegramText=value=>String(value??'').replace(/[&<>]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[char]));
const CLOSED=new Set(['closed','completed','cancelled','collected','rejected']);
const OPERATION_STATUSES=new Set(['registered','requested','pending','open','assigned','in_progress','processing','waiting','under_review','approved','rejected','completed','closed','cancelled','delivered','collected','overdue']);
function params(req){return new URL(req.url||'/api/router',`https://${String(req.headers.host||'localhost')}`).searchParams;}
function isoDate(value,fallback){const text=clean(value,10);return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:fallback;}
async function safeSelect(table,query){try{return await select(table,query)||[];}catch(error){return[];}}

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
      select('user_channels','select=external_id,external_username,active,user_id,last_seen_at,app_users(full_name,nickname,role,active)&channel=eq.telegram&order=last_seen_at.desc&limit=1000'),
      select('telegram_messages',`select=id&created_at=gte.${today}T00:00:00Z&limit=1000`)
    ]);
    const normalizedUsers=(users||[]).filter(x=>String(x.external_id)!==TEST_IDENTITY).map(x=>({external_id:x.external_id,external_username:x.external_username,active:Boolean(x.active&&x.app_users?.active),full_name:x.app_users?.full_name||'',nickname:x.app_users?.nickname||'',role:x.app_users?.role||'pending',last_seen_at:x.last_seen_at||null}));
    json(res,200,{ok:true,counts:{pendingImports:(imports||[]).filter(x=>!['approved','rejected','opened_in_program'].includes(x.status)).length,openApprovals:(approvals||[]).filter(x=>x.status==='pending').length,openDiscrepancies:(discrepancies||[]).length,messagesToday:(messages||[]).length,telegramUsers:normalizedUsers.length,activeTelegramUsers:normalizedUsers.filter(x=>x.active).length},imports:(imports||[]).map(x=>({...x,status_label:label[x.status]||x.status})),approvals:approvals||[],groups:groups||[],users:normalizedUsers});
  }catch(error){errorResponse(res,error);}
}

function cleanMessage(row){
  return{id:row.id,chat_id:String(row.chat_id||''),message_id:String(row.message_id||''),direction:row.direction||((row.sender_external_id==='bot')?'outgoing':'incoming'),delivery_status:row.delivery_status||'received',sender_external_id:row.sender_external_id||'',sender_username:String(row.raw?.message?.from?.username||''),sender_name:row.sender_name||row.app_users?.full_name||row.raw?.message?.from?.first_name||'',sender_role:row.app_users?.role||'',chat_type:row.chat_type||row.raw?.message?.chat?.type||'',message_type:row.message_type||'text',text:row.text||'',transcription:row.transcription||'',file_name:row.file_name||'',mime_type:row.mime_type||'',file_path:row.file_path||'',related_entity_type:row.related_entity_type||'',related_entity_id:row.related_entity_id||'',reply_to_message_id:row.reply_to_message_id||'',bot_method:row.bot_method||'',action_name:row.action_name||'',action_payload:row.action_payload||{},created_at:row.created_at};
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
    const key=msg.chat_id,old=map.get(key)||{chat_id:key,chat_type:msg.chat_type||'',display_name:'',external_user_id:'',username:'',role:'',last_message:'',last_message_type:'',last_direction:'',last_status:'',last_related_type:'',last_related_id:'',last_at:'',message_count:0,incoming_count:0,outgoing_count:0,file_count:0};
    old.message_count++;if(msg.direction==='outgoing')old.outgoing_count++;else old.incoming_count++;
    if(msg.file_path||msg.file_name||['photo','voice','document'].includes(msg.message_type))old.file_count++;
    if(!old.display_name&&msg.direction!=='outgoing')old.display_name=msg.sender_name||msg.sender_external_id||key;
    if(!old.external_user_id&&msg.direction!=='outgoing')old.external_user_id=msg.sender_external_id||'';
    if(!old.username&&msg.direction!=='outgoing')old.username=msg.sender_username||'';
    if(!old.role&&msg.sender_role)old.role=msg.sender_role;
    if(!old.last_at||String(msg.created_at)>String(old.last_at)){old.last_at=msg.created_at;old.last_message=msg.text||msg.transcription||msg.file_name||`[${msg.message_type}]`;old.last_message_type=msg.message_type;old.last_direction=msg.direction;old.chat_type=msg.chat_type||old.chat_type;}
    if(msg.direction!=='outgoing'&&(!old.last_incoming_at||String(msg.created_at)>String(old.last_incoming_at))){old.last_incoming_at=msg.created_at;old.last_status=msg.delivery_status||'received';old.last_related_type=msg.related_entity_type||'';old.last_related_id=msg.related_entity_id||'';}
    map.set(key,old);
  }
  return[...map.values()].sort((a,b)=>String(b.last_at).localeCompare(String(a.last_at)));
}
// هوية اختبار قديمة (workflow فحص تجريبي) — تُستبعد من كل عروض التفاعلات
// والمستخدمين حتى لا تظهر إلا البيانات الحقيقية.
const TEST_IDENTITY='9900000001';
function messageQuery({chatId='',before='',direction='',messageType='',status='',from='',to='',limit=300}={}){
  const filters=[`chat_id=neq.${TEST_IDENTITY}`];
  if(chatId)filters.push(`chat_id=eq.${encodeURIComponent(chatId)}`);
  if(before)filters.push(`created_at=lt.${encodeURIComponent(before)}`);
  if(direction)filters.push(`direction=eq.${encodeURIComponent(direction)}`);
  if(messageType)filters.push(`message_type=eq.${encodeURIComponent(messageType)}`);
  if(status)filters.push(`delivery_status=eq.${encodeURIComponent(status)}`);
  if(from)filters.push(`created_at=gte.${encodeURIComponent(`${from}T00:00:00Z`)}`);
  if(to)filters.push(`created_at=lte.${encodeURIComponent(`${to}T23:59:59.999Z`)}`);
  return[...filters,'order=created_at.desc',`limit=${limit}`].join('&');
}
async function downloadConversationFile(res,messageId){
  const rows=await select('telegram_messages',`id=eq.${encodeURIComponent(messageId)}&select=id,file_path,file_name,mime_type,message_type&limit=1`),row=rows?.[0];
  if(!row?.file_path)throw Object.assign(new Error('المرفق غير موجود في التخزين'),{status:404});
  const filePath=String(row.file_path);
  if(!filePath.startsWith('telegram/')||filePath.includes('..'))throw Object.assign(new Error('مسار المرفق غير مسموح'),{status:403});
  const file=await downloadObject(filePath),name=clean(row.file_name,240)||`${row.message_type||'telegram-file'}-${row.id}`;
  res.statusCode=200;res.setHeader('Content-Type',row.mime_type||file.contentType||'application/octet-stream');res.setHeader('Content-Disposition',`inline; filename*=UTF-8''${encodeURIComponent(name)}`);res.setHeader('Cache-Control','private, no-store');res.end(file.buffer);
}
async function sendAdminReply(req,res){
  const actor=requireAdmin(req),input=await body(req),chatId=clean(input.chatId,100),text=clean(input.text,12000);
  if(!chatId)throw Object.assign(new Error('رقم المحادثة مطلوب'),{status:400});
  if(!text)throw Object.assign(new Error('نص الرد مطلوب'),{status:400});
  const parts=[];for(let offset=0;offset<text.length;offset+=3500)parts.push(text.slice(offset,offset+3500));
  const sent=[];for(const part of parts){const result=await sendMessage(chatId,telegramText(part),{action_name:'admin_reply',action_payload:{actor:actor.actor,source:'conversation_center'}});sent.push(String(result.message_id));}
  await insert('audit_log',[{actor_type:'web',actor_id:actor.actor,action:'telegram_admin_reply',entity_type:'telegram_chat',entity_id:chatId,details:{message_ids:sent,parts:parts.length,text_length:text.length}}],{prefer:'return=minimal'}).catch(()=>{});
  return json(res,200,{ok:true,chat_id:chatId,message_ids:sent,parts:parts.length});
}
export async function conversations(req,res){
  if(!method(req,res,['GET','POST']))return;
  try{
    if(req.method==='POST')return await sendAdminReply(req,res);
    requireAdmin(req);const p=params(req),downloadId=clean(p.get('download'),100);
    if(downloadId)return await downloadConversationFile(res,downloadId);
    const chatId=clean(p.get('chatId'),100),search=normalize(p.get('q')),limit=clamp(p.get('limit'),1,1000,300),before=clean(p.get('before'),100),direction=clean(p.get('direction'),20),messageType=clean(p.get('messageType'),30),status=clean(p.get('status'),20),role=clean(p.get('role'),80),chatType=clean(p.get('chatType'),30),from=clean(p.get('from'),10),to=clean(p.get('to'),10);
    if(direction&&!['incoming','outgoing','system'].includes(direction))throw Object.assign(new Error('اتجاه الرسالة غير صحيح'),{status:400});
    if(status&&!['received','processing','sent','delivered','failed'].includes(status))throw Object.assign(new Error('حالة المعالجة غير صحيحة'),{status:400});
    if(chatId){const raw=await fetchRows(messageQuery({chatId,before,direction,messageType,status,from,to,limit})),hasMore=(raw||[]).length===limit;let rows=(raw||[]).map(cleanMessage);if(search)rows=rows.filter(x=>normalize(`${x.text} ${x.transcription} ${x.file_name} ${x.sender_name}`).includes(search));rows.reverse();return json(res,200,{ok:true,chat_id:chatId,messages:rows,next_before:hasMore&&rows.length?rows[0].created_at:null,has_more:hasMore});}
    const rows=(await fetchRows(messageQuery({direction,messageType,status,from,to,limit}))||[]).map(cleanMessage);let threads=buildThreads(rows);if(search)threads=threads.filter(x=>normalize(`${x.display_name} ${x.external_user_id} ${x.username} ${x.role} ${x.last_message}`).includes(search));if(role)threads=threads.filter(x=>x.role===role);if(chatType)threads=threads.filter(x=>x.chat_type===chatType);return json(res,200,{ok:true,threads,total:threads.length,source_messages:rows.length,filters:{role,chatType,direction,messageType,status,from,to}});
  }catch(error){if(!res.headersSent)errorResponse(res,error);else res.end();}
}

async function operationByReference(reference){return(await select('operational_records',`reference_no=eq.${encodeURIComponent(reference)}&select=*&order=updated_at.desc&limit=1`))?.[0]||null;}
async function notifyOperationSource(record,text){if(!record?.source_chat_id||String(record.source_chat_id).startsWith('webapp:'))return;await sendMessage(record.source_chat_id,telegramText(text),{action_name:'operation_admin_update',action_payload:{reference:record.reference_no}}).catch(()=>{});}
async function setOperationStatus(input,actor){
  const reference=clean(input.reference,100),status=clean(input.status,40),note=clean(input.note,2000);
  if(!reference)throw Object.assign(new Error('مرجع العملية مطلوب'),{status:400});
  if(!OPERATION_STATUSES.has(status))throw Object.assign(new Error('حالة العملية غير صحيحة'),{status:400});
  const record=await operationByReference(reference);if(!record)throw Object.assign(new Error('لم يتم العثور على العملية'),{status:404});
  const details={reference_no:reference,category:record.payload?.category||record.department||record.entity_type,status,note,updated_by_name:'إدارة البرنامج',chat_id:record.source_chat_id,source_message_id:record.source_message_id};
  await insert('audit_log',[{actor_type:'web',actor_id:actor.actor,action:'enterprise_operation_status',entity_type:record.entity_type,entity_id:reference,details}]);
  if(input.notify!==false)await notifyOperationSource(record,`تم تحديث العملية ${reference}\nالحالة: ${status}${note?`\nالملاحظة: ${note}`:''}`);
  return{reference,status};
}
async function createManagementTask(input,actor){
  const title=clean(input.title,500),description=clean(input.description,4000),priority=clean(input.priority,30)||'normal',department=clean(input.department,80)||'general',assignedTo=clean(input.assignedTo,500),dueDate=clean(input.dueDate,40);
  if(!title)throw Object.assign(new Error('عنوان المهمة مطلوب'),{status:400});
  if(!['normal','urgent','critical'].includes(priority))throw Object.assign(new Error('أولوية المهمة غير صحيحة'),{status:400});
  const result=await rpc('next_document_no',{p_prefix:'TSK'}),reference=String(Array.isArray(result)?result[0]?.next_document_no||result[0]:result);
  const details={reference_no:reference,category:'task',subtype:'task',title,status:'assigned',priority,department,party:assignedTo||'غير محدد',due_date:dueDate||null,note:description,created_by_name:'إدارة البرنامج',chat_id:null,source_message_id:null};
  await insert('audit_log',[{actor_type:'web',actor_id:actor.actor,action:'enterprise_operation_created',entity_type:'task',entity_id:reference,details}]);
  return{reference,status:'assigned'};
}
async function approvalDecision(input,actor){
  const id=clean(input.id,100),decision=clean(input.decision,20),note=clean(input.note,2000);
  if(!id||!['approved','rejected'].includes(decision))throw Object.assign(new Error('بيانات قرار الاعتماد غير صحيحة'),{status:400});
  const approval=(await select('approvals',`id=eq.${encodeURIComponent(id)}&select=*&limit=1`))?.[0];if(!approval)throw Object.assign(new Error('طلب الاعتماد غير موجود'),{status:404});
  if(approval.status!=='pending')throw Object.assign(new Error('تم اتخاذ قرار على هذا الطلب سابقًا'),{status:409});
  await patch('approvals',`id=eq.${encodeURIComponent(id)}`,{status:decision,decision_note:note||null,decided_at:new Date().toISOString()});
  const tableByType={purchase_request:'purchase_requests',finance_event:'finance_events',maintenance_order:'maintenance_orders',quotation:'quotations',invoice:'invoices'};
  const table=tableByType[approval.entity_type];if(table)await patch(table,`id=eq.${encodeURIComponent(approval.entity_id)}`,{status:decision,updated_at:new Date().toISOString()}).catch(()=>{});
  await insert('audit_log',[{actor_type:'web',actor_id:actor.actor,action:`approval_${decision}`,entity_type:approval.entity_type,entity_id:String(approval.entity_id),details:{approval_id:id,reference_no:approval.reference_no,status:decision,note}}]);
  if(approval.source_chat_id)await sendMessage(approval.source_chat_id,telegramText(`قرار الاعتماد ${approval.reference_no}: ${decision}${note?`\n${note}`:''}`),{action_name:'approval_decision'}).catch(()=>{});
  return{id,decision,reference:approval.reference_no};
}
async function enqueueNotification(input,actor){
  const chatId=clean(input.chatId,100),message=clean(input.message,4000),title=clean(input.title,300)||'رسالة إدارية';
  if(!chatId||!message)throw Object.assign(new Error('المستلم والرسالة مطلوبان'),{status:400});
  const dedupe=`manual:${Date.now()}:${chatId}`;
  await insert('notification_outbox',[{notification_type:'manual',recipient_chat_id:chatId,title,message,payload:{actor:actor.actor},status:'pending',scheduled_at:new Date().toISOString(),dedupe_key:dedupe}]);
  return{queued:true,dedupe};
}
export async function operations(req,res){
  if(!method(req,res,['GET','POST']))return;
  try{
    const actor=requireAdmin(req);
    if(req.method==='POST'){
      const input=await body(req),action=clean(input.action,50);let result;
      if(action==='set_status')result=await setOperationStatus(input,actor);
      else if(action==='create_task')result=await createManagementTask(input,actor);
      else if(action==='approval_decision')result=await approvalDecision(input,actor);
      else if(action==='enqueue_notification')result=await enqueueNotification(input,actor);
      else throw Object.assign(new Error('إجراء العمليات غير معروف'),{status:400});
      return json(res,200,{ok:true,action,...result});
    }
    const p=params(req),department=clean(p.get('department'),80),status=clean(p.get('status'),50),entityType=clean(p.get('entityType'),100),limit=clamp(p.get('limit'),1,1000,200),filters=[];
    if(department)filters.push(`department=eq.${encodeURIComponent(department)}`);if(status)filters.push(`status=eq.${encodeURIComponent(status)}`);if(entityType)filters.push(`entity_type=eq.${encodeURIComponent(entityType)}`);
    const query=[...filters,'select=id,reference_no,entity_type,department,status,title,summary,amount,payload,created_by,assigned_to,source_channel,source_chat_id,source_message_id,created_at,updated_at,closed_at','order=updated_at.desc',`limit=${limit}`].join('&');
    const [records,sales,purchases,tasks,quality,collections,approvals]=await Promise.all([
      select('operational_records',query),safeSelect('sales_orders','select=id,status,sales_type,total_amount,delivery_date&limit=3000'),safeSelect('purchase_requests','select=id,status,urgency&limit=3000'),safeSelect('operational_tasks','select=id,status,priority,due_at&limit=3000'),safeSelect('quality_cases','select=id,status,severity&limit=3000'),safeSelect('collection_events','select=id,status,amount,occurred_at&limit=3000'),safeSelect('approvals','status=eq.pending&select=id,reference_no,entity_type,entity_id,summary,amount,status,created_at&order=created_at.asc&limit=200')
    ]);
    const open=value=>!CLOSED.has(String(value||''));
    json(res,200,{ok:true,counts:{sales_open:sales.filter(x=>open(x.status)).length,sales_overdue:sales.filter(x=>open(x.status)&&x.delivery_date&&x.delivery_date<new Date().toISOString().slice(0,10)).length,purchase_open:purchases.filter(x=>open(x.status)).length,purchase_urgent:purchases.filter(x=>open(x.status)&&['urgent','critical'].includes(x.urgency)).length,tasks_open:tasks.filter(x=>open(x.status)).length,tasks_overdue:tasks.filter(x=>open(x.status)&&x.due_at&&new Date(x.due_at)<new Date()).length,quality_open:quality.filter(x=>open(x.status)).length,collections_total:collections.reduce((sum,x)=>sum+Number(x.amount||0),0),approvals_pending:approvals.length},records:records||[],approvals});
  }catch(error){errorResponse(res,error);}
}

export async function reports(req,res){
  if(!method(req,res,['GET']))return;
  try{
    requireAdmin(req);const p=params(req),today=new Date().toISOString().slice(0,10),from=isoDate(p.get('from'),today),to=isoDate(p.get('to'),today),start=`${from}T00:00:00Z`,end=`${to}T23:59:59.999Z`;
    const [sales,maintenance,inventory,collections,quality,attendance,fleet,dailyReports,finance,purchases,tasks]=await Promise.all([
      safeSelect('sales_orders',`created_at=gte.${encodeURIComponent(start)}&created_at=lte.${encodeURIComponent(end)}&select=reference_no,sales_type,customer_name,item,quantity,total_amount,delivery_date,status,sales_person_name,created_at&order=created_at.desc&limit=5000`),
      safeSelect('maintenance_orders',`reported_at=gte.${encodeURIComponent(start)}&reported_at=lte.${encodeURIComponent(end)}&select=reference_no,plate_snapshot,problem,status,priority,vehicle_stopped,estimated_cost,actual_cost,reported_at&order=reported_at.desc&limit=3000`),
      safeSelect('inventory_movements',`occurred_at=gte.${encodeURIComponent(start)}&occurred_at=lte.${encodeURIComponent(end)}&select=reference_no,movement_type,quantity,unit_cost,note,occurred_at,inventory_items(item_name,sku,unit)&order=occurred_at.desc&limit=5000`),
      safeSelect('collection_events',`occurred_at=gte.${encodeURIComponent(start)}&occurred_at=lte.${encodeURIComponent(end)}&select=reference_no,customer_name,amount,payment_method,promise_date,status,note,occurred_at&order=occurred_at.desc&limit=5000`),
      safeSelect('quality_cases',`created_at=gte.${encodeURIComponent(start)}&created_at=lte.${encodeURIComponent(end)}&select=reference_no,case_type,product_name,result,severity,status,description,created_at&order=created_at.desc&limit=3000`),
      safeSelect('daily_attendance_summary',`work_date=gte.${from}&work_date=lte.${to}&select=*&order=work_date.desc&limit=5000`),
      safeSelect('driver_daily_summary',`work_date=gte.${from}&work_date=lte.${to}&select=*&order=work_date.desc&limit=5000`),
      safeSelect('employee_daily_reports',`report_date=gte.${from}&report_date=lte.${to}&select=reference_no,employee_name,department,report_text,report_date,status,created_at&order=created_at.desc&limit=3000`),
      safeSelect('finance_events',`occurred_at=gte.${encodeURIComponent(start)}&occurred_at=lte.${encodeURIComponent(end)}&select=reference_no,event_type,party_name,amount,payment_method,note,status,occurred_at&order=occurred_at.desc&limit=5000`),
      safeSelect('purchase_requests',`created_at=gte.${encodeURIComponent(start)}&created_at=lte.${encodeURIComponent(end)}&select=reference_no,item_description,quantity,urgency,status,requested_at,approved_at&order=created_at.desc&limit=3000`),
      safeSelect('operational_tasks',`created_at=gte.${encodeURIComponent(start)}&created_at=lte.${encodeURIComponent(end)}&select=reference_no,title,department,priority,status,due_at,assigned_to_name,created_at,completed_at&order=created_at.desc&limit=3000`)
    ]);
    const sum=(rows,key)=>rows.reduce((total,row)=>total+Number(row[key]||0),0),closed=value=>CLOSED.has(String(value||''));
    const summary={sales_count:sales.length,sales_total:sum(sales,'total_amount'),sales_open:sales.filter(x=>!closed(x.status)).length,maintenance_count:maintenance.length,maintenance_open:maintenance.filter(x=>!closed(x.status)).length,maintenance_stopped:maintenance.filter(x=>x.vehicle_stopped).length,collections_total:sum(collections,'amount'),finance_total:sum(finance,'amount'),quality_open:quality.filter(x=>!closed(x.status)).length,attendance_employees:new Set(attendance.map(x=>x.app_user_id)).size,attendance_outside:sum(attendance,'outside_events'),fleet_distance:sum(fleet,'distance_km'),fleet_fuel_liters:sum(fleet,'fuel_liters'),purchase_open:purchases.filter(x=>!closed(x.status)).length,tasks_open:tasks.filter(x=>!closed(x.status)).length,daily_reports:dailyReports.length};
    json(res,200,{ok:true,from,to,summary,data:{sales,maintenance,inventory,collections,quality,attendance,fleet,dailyReports,finance,purchases,tasks}});
  }catch(error){errorResponse(res,error);}
}

export async function documentVerification(req,res){
  if(!method(req,res,['GET']))return;
  try{
    const code=clean(params(req).get('code'),80).toUpperCase();if(!code)throw Object.assign(new Error('رمز التحقق مطلوب'),{status:400});
    const row=(await select('document_registry',`verification_code=eq.${encodeURIComponent(code)}&select=verification_code,document_type,title,content_hash,requested_by_name,status,metadata,created_at,revoked_at,revoke_reason&limit=1`))?.[0];
    if(!row)throw Object.assign(new Error('لم يتم العثور على مستند بهذا الرمز'),{status:404});
    json(res,200,{ok:true,valid:row.status==='valid',document:row});
  }catch(error){errorResponse(res,error);}
}
