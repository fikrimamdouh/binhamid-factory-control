import { select, insert, patch, rpc } from './supabase.js';
import { sendMessage, keyboard } from './telegram.js';
import { allowed } from './domain.js';
import { displayName } from './bot-profile.js';
import { clearMaintenanceSession, createGenericMaintenanceDraft } from './bot-maintenance.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const now=()=>new Date().toISOString();
const normalize=value=>String(value||'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/[؟?!.,،؛:]+/g,'').replace(/\s+/g,' ').trim();
const openStatuses='draft,reported,inspection,quotation_required,approval_pending,approved,in_repair,testing';

function isWorkshopOperator(role){return role==='admin'||role==='manager'||role==='mechanic';}
function canViewWorkshop(role){return role==='admin'||role==='manager'||role==='mechanic'||role==='accountant';}
function referenceFrom(result){return String(Array.isArray(result)?result[0]?.next_document_no||result[0]||'':result||'');}
async function nextReference(prefix){return referenceFrom(await rpc('next_document_no',{p_prefix:prefix}));}

async function setSession(chatId,userId,state,context={}){
  const old=(await select('bot_sessions',`channel=eq.telegram&chat_id=eq.${encodeURIComponent(String(chatId))}&external_user_id=eq.${encodeURIComponent(String(userId))}&select=context&limit=1`))?.[0];
  const aiHistory=old?.context?.aiHistory||[];
  const rows=await insert('bot_sessions',[{channel:'telegram',chat_id:String(chatId),external_user_id:String(userId),state,context:{aiHistory,...context},updated_at:now()}],{query:'on_conflict=channel,chat_id,external_user_id',prefer:'resolution=merge-duplicates,return=representation'});
  return rows?.[0];
}

async function writeWorkshopLog({identity,message,action,entityType='workshop',entityId='',details={}}){
  const name=displayName(identity,message.from);
  return insert('audit_log',[{
    actor_type:'telegram',
    actor_id:String(identity?.user_id||identity?.external_id||message.from.id),
    action,
    entity_type:entityType,
    entity_id:String(entityId||''),
    details:{mechanic_name:name,mechanic_role:identity?.role||'mechanic',telegram_user_id:String(message.from.id),chat_id:String(message.chat.id),source_message_id:String(message.message_id),...details},
    created_at:now()
  }]);
}

export function mechanicMenu(){
  return keyboard([
    [{text:'📝 التقرير اليومي',callback_data:'mech:daily'},{text:'🔍 فحص معدة أو أصل',callback_data:'mech:inspection'}],
    [{text:'🧰 طلب قطع غيار',callback_data:'mech:parts'},{text:'🔧 بلاغ أصل بدون لوحة',callback_data:'mech:general_fault'}],
    [{text:'📌 تحديث أمر إصلاح',callback_data:'mech:update'},{text:'📋 المهام المفتوحة',callback_data:'mech:tasks'}],
    [{text:'📊 سجل الورشة اليوم',callback_data:'mech:summary'},{text:'💰 طلبات التسعير',callback_data:'mech:price_requests'}]
  ]);
}

export async function showMechanicMenu(message,identity){
  const role=identity?.role||'pending';
  if(!canViewWorkshop(role))return sendMessage(message.chat.id,'هذه القائمة مخصصة لمسؤول الورشة ومدير المصنع والمحاسب ومدير النظام.');
  const name=displayName(identity,message.from);
  const intro=isWorkshopOperator(role)
    ?`مرحبًا ${esc(name)}. اختر العملية التي تريد تسجيلها في سجل الورشة:`
    :`مرحبًا ${esc(name)}. يمكنك عرض سجل الورشة والمهام وطلبات التسعير:`;
  return sendMessage(message.chat.id,intro,mechanicMenu());
}

export async function startMechanicAction(message,identity,action){
  const role=identity?.role||'pending',chatId=message.chat.id,userId=identity?.external_id||message.from.id;
  if(['tasks','summary','price_requests'].includes(action)){
    if(!canViewWorkshop(role))return sendMessage(chatId,'ليست لديك صلاحية عرض سجل الورشة.');
    if(action==='tasks')return sendOpenWorkshopTasks(chatId);
    if(action==='summary')return sendWorkshopSummary(chatId);
    // زر «💰 طلبات تسعير الورشة» كان موجودًا في القائمة بلا معالج، فكان الضغط
    // عليه لا يفعل شيئًا لأي دور. الدالة نفسها كانت متاحة بالأمر النصي فقط.
    if(action==='price_requests')return sendPriceRequests(chatId);
    return sendPriceRequests(chatId);
  }
  if(!isWorkshopOperator(role))return sendMessage(chatId,'تسجيل أعمال الورشة متاح لمسؤول الورشة ومدير المصنع ومدير النظام فقط.');
  if(action==='daily'){
    await setSession(chatId,userId,'mechanic_daily_report',{startedAt:now()});
    return sendMessage(chatId,'أرسل التقرير اليومي في رسالة واحدة بهذا الترتيب:\n\nالسيارات والمعدات التي فحصتها:\nالأعمال التي نفذتها:\nالإجراءات الوقائية المطلوبة:\nالأعطال المفتوحة:\nقطع الغيار المطلوبة:\nملاحظات السلامة أو التوقف:\n\nاكتب «إلغاء» للخروج.');
  }
  if(action==='inspection'){
    await setSession(chatId,userId,'mechanic_inspection',{startedAt:now()});
    return sendMessage(chatId,'أرسل نتيجة الفحص في رسالة واحدة، واذكر اسم أو رقم الأصل حتى لو لا توجد لوحة. مثال:\nمضخة الخرسانة رقم 3 — تم فحص الزيت والسيور، يوجد صوت في الرولمان بلي وتحتاج تغيير خلال أسبوع.');
  }
  if(action==='parts'){
    await setSession(chatId,userId,'mechanic_spare_parts',{startedAt:now()});
    return sendMessage(chatId,'اكتب طلب قطع الغيار كاملًا في رسالة واحدة:\n• اسم القطعة والكمية\n• الأصل أو الاستخدام إن وجد\n• درجة الاستعجال\n• سبب الطلب\n\nيمكن أن يكون الطلب عامًا للمخزن بدون سيارة أو رقم لوحة.');
  }
  if(action==='general_fault'){
    await setSession(chatId,userId,'mechanic_general_fault',{startedAt:now()});
    return sendMessage(chatId,'اكتب اسم المعدة أو الأصل ووصف العطل. مثال:\nكمبروسر الورشة — يفصل بعد التشغيل بعشر دقائق ويوجد ارتفاع حرارة.\nلا يلزم رقم لوحة.');
  }
  if(action==='update'){
    await setSession(chatId,userId,'mechanic_order_update',{startedAt:now()});
    return sendMessage(chatId,'أرسل رقم أمر الإصلاح ثم التحديث. مثال:\nBH-RO-2026-00015 تم تغيير الزيت والفلتر، وجارٍ اختبار المركبة.');
  }
}

function statusFromUpdate(text=''){
  const t=normalize(text);
  if(/تم الانتهاء|تم الاصلاح|اكتمل|جاهز للتسليم/.test(t))return'completed';
  if(/اختبار|تجربه|تجربة/.test(t))return'testing';
  if(/جاري الاصلاح|جار الاصلاح|بدانا الاصلاح|بدأنا الاصلاح/.test(t))return'in_repair';
  if(/عرض سعر|تسعير|قطع غيار مطلوبه|قطع غيار مطلوبة/.test(t))return'quotation_required';
  if(/فحص|تشخيص/.test(t))return'inspection';
  return null;
}

async function saveDailyReport(message,identity,text){
  const reference=await nextReference('WDR');
  await writeWorkshopLog({identity,message,action:'mechanic_daily_report',entityType:'workshop_daily_report',entityId:reference,details:{reference_no:reference,report_date:now().slice(0,10),report_text:text}});
  await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id);
  return sendMessage(message.chat.id,`تم حفظ التقرير اليومي في سجل الورشة.\nالمرجع: <b>${esc(reference)}</b>\nالحالة: متاح لمدير المصنع والمحاسب للمراجعة.`);
}

async function saveInspection(message,identity,text){
  const reference=await nextReference('INS');
  const issue=/عطل|تسريب|صوت|كسر|حرار|متوقف|تغيير|يحتاج|مطلوب|خطر/.test(normalize(text));
  await writeWorkshopLog({identity,message,action:'mechanic_inspection',entityType:'equipment_inspection',entityId:reference,details:{reference_no:reference,inspection_text:text,issue_found:issue}});
  await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id);
  if(issue){
    return createGenericMaintenanceDraft({chatId:message.chat.id,messageId:message.message_id,identity,text,voicePath:'',target:'معدة أو أصل بدون لوحة',kind:'inspection_issue',inspectionReference:reference});
  }
  return sendMessage(message.chat.id,`تم حفظ نتيجة الفحص في سجل الورشة.\nالمرجع: <b>${esc(reference)}</b>\nالنتيجة: لم يكتشف النص عطلًا يحتاج أمر إصلاح.`);
}

async function savePartsRequest(message,identity,text){
  await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id);
  return createGenericMaintenanceDraft({chatId:message.chat.id,messageId:message.message_id,identity,text,voicePath:'',target:'طلب قطع غيار عام بدون لوحة',kind:'spare_parts'});
}

async function saveGeneralFault(message,identity,text){
  await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id);
  return createGenericMaintenanceDraft({chatId:message.chat.id,messageId:message.message_id,identity,text,voicePath:'',target:'معدة أو أصل بدون لوحة',kind:'general_asset'});
}

async function saveOrderUpdate(message,identity,text){
  const match=String(text||'').match(/BH-[A-Z]+-\d{4}-\d{5}/i);
  if(!match)return sendMessage(message.chat.id,'لم أجد رقم أمر صحيح. أرسله بالشكل BH-RO-2026-00015 أو اكتب «إلغاء».');
  const reference=match[0].toUpperCase(),order=(await select('maintenance_orders',`reference_no=eq.${encodeURIComponent(reference)}&select=id,reference_no,status&limit=1`))?.[0];
  if(!order)return sendMessage(message.chat.id,`لم أجد أمر الإصلاح ${esc(reference)}.`);
  const note=String(text).replace(match[0],'').trim()||'تحديث من مسؤول الورشة';
  const nextStatus=statusFromUpdate(note);
  await insert('maintenance_updates',[{maintenance_id:order.id,status:nextStatus||order.status,note,created_by:identity.user_id,source_channel:'telegram',source_chat_id:String(message.chat.id),source_message_id:String(message.message_id)}]);
  if(nextStatus)await patch('maintenance_orders',`id=eq.${encodeURIComponent(order.id)}`,{status:nextStatus,updated_at:now(),...(nextStatus==='completed'?{closed_at:now()}: {})});
  await writeWorkshopLog({identity,message,action:'mechanic_order_update',entityType:'maintenance_order',entityId:order.id,details:{reference_no:reference,note,status_before:order.status,status_after:nextStatus||order.status}});
  await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id);
  return sendMessage(message.chat.id,`تم تسجيل تحديث أمر الإصلاح <b>${esc(reference)}</b>.\nالحالة: <b>${esc(nextStatus||order.status)}</b>\nالتحديث: ${esc(note)}`);
}

export async function continueMechanicSession(message,identity,session,text){
  const userId=identity.external_id||message.from.id,t=String(text||'').trim();
  if(/^(الغاء|إلغاء|الغي|الغى|تراجع|cancel)$/i.test(t)){
    await clearMaintenanceSession(message.chat.id,userId);
    await sendMessage(message.chat.id,'تم إلغاء العملية الحالية.');
    return true;
  }
  if(session.state==='mechanic_daily_report'){await saveDailyReport(message,identity,t);return true;}
  if(session.state==='mechanic_inspection'){await saveInspection(message,identity,t);return true;}
  if(session.state==='mechanic_spare_parts'){await savePartsRequest(message,identity,t);return true;}
  if(session.state==='mechanic_general_fault'){await saveGeneralFault(message,identity,t);return true;}
  if(session.state==='mechanic_order_update'){await saveOrderUpdate(message,identity,t);return true;}
  return false;
}

export async function handleMechanicTextCommand(message,identity,text){
  const role=identity?.role||'pending',t=normalize(text),raw=String(text||'').trim();
  if(/^\/workshop(?:@\w+)?$/i.test(raw)||/^(قائمه الورشه|قائمة الورشة|موظف الورشه|موظف الورشة|مهام الميكانيكي|الورشه|الورشة)$/.test(t)){
    await showMechanicMenu(message,identity);return true;
  }
  if(/^(سجل الورشه اليوم|سجل الورشة اليوم|تقرير الميكانيكي اليوم|ملخص الورشه اليوم|ملخص الورشة اليوم)$/.test(t)){
    if(!canViewWorkshop(role))return sendMessage(message.chat.id,'ليست لديك صلاحية عرض سجل الورشة.').then(()=>true);
    await sendWorkshopSummary(message.chat.id);return true;
  }
  if(/^(طلبات قطع الغيار|طلبات التسعير|قطع الغيار المطلوبه|قطع الغيار المطلوبة)$/.test(t)){
    if(!canViewWorkshop(role))return sendMessage(message.chat.id,'ليست لديك صلاحية عرض طلبات قطع الغيار.').then(()=>true);
    await sendPriceRequests(message.chat.id);return true;
  }
  if(isWorkshopOperator(role)&&/^(طلب قطع غيار|عاوز قطع غيار|اريد قطع غيار|أريد قطع غيار)$/.test(t)){
    await startMechanicAction(message,identity,'parts');return true;
  }
  if(isWorkshopOperator(role)&&/^(تقرير يومي للورشه|تقرير يومي للورشة|بدء التقرير اليومي)$/.test(t)){
    await startMechanicAction(message,identity,'daily');return true;
  }
  return false;
}

export async function sendOpenWorkshopTasks(chatId){
  const rows=await select('maintenance_orders',`status=in.(${openStatuses})&select=reference_no,plate_snapshot,problem,status,priority,reported_at&order=reported_at.desc&limit=15`);
  if(!rows?.length)return sendMessage(chatId,'لا توجد مهام ورشة مفتوحة حاليًا.');
  const body=rows.map((row,index)=>`${index+1}. <b>${esc(row.reference_no)}</b> — ${esc(row.plate_snapshot||'أصل/طلب عام')}\nالحالة: ${esc(row.status)} | الأولوية: ${esc(row.priority)}\n${esc(String(row.problem||'').slice(0,140))}`).join('\n\n');
  return sendMessage(chatId,`<b>مهام الورشة المفتوحة</b>\n\n${body}`);
}

export async function sendPriceRequests(chatId){
  const rows=await select('maintenance_orders','status=eq.quotation_required&select=reference_no,plate_snapshot,problem,priority,reported_at&order=reported_at.desc&limit=20');
  if(!rows?.length)return sendMessage(chatId,'لا توجد طلبات قطع غيار أو تسعير مفتوحة.');
  const body=rows.map((row,index)=>`${index+1}. <b>${esc(row.reference_no)}</b> — ${esc(row.plate_snapshot||'طلب عام')}\n${esc(String(row.problem||'').slice(0,220))}\nالأولوية: ${esc(row.priority)}`).join('\n\n');
  return sendMessage(chatId,`<b>طلبات قطع الغيار والتسعير المفتوحة</b>\n\n${body}`);
}

export async function sendWorkshopSummary(chatId){
  const start=new Date();start.setHours(0,0,0,0);const startIso=start.toISOString();
  const [logs,orders,parts]=await Promise.all([
    select('audit_log',`created_at=gte.${encodeURIComponent(startIso)}&action=in.(mechanic_daily_report,mechanic_inspection,mechanic_order_update,spare_parts_request)&select=action,entity_id,details,created_at&order=created_at.desc&limit=100`),
    select('maintenance_orders',`reported_at=gte.${encodeURIComponent(startIso)}&select=reference_no,status,plate_snapshot,problem&order=reported_at.desc&limit=100`),
    select('maintenance_orders','status=eq.quotation_required&select=id&limit=1000')
  ]);
  const daily=(logs||[]).filter(x=>x.action==='mechanic_daily_report').length,inspections=(logs||[]).filter(x=>x.action==='mechanic_inspection').length,updates=(logs||[]).filter(x=>x.action==='mechanic_order_update').length;
  const stopped=(orders||[]).filter(x=>/متوقف|واقفه|واقفة|لا تعمل/.test(String(x.problem||''))).length;
  let text=`<b>سجل الورشة اليوم</b>\n\nالتقارير اليومية: <b>${daily}</b>\nفحوصات المعدات: <b>${inspections}</b>\nتحديثات أوامر الإصلاح: <b>${updates}</b>\nأوامر مسجلة اليوم: <b>${orders?.length||0}</b>\nمؤشرات توقف في بلاغات اليوم: <b>${stopped}</b>\nطلبات تسعير مفتوحة: <b>${parts?.length||0}</b>`;
  const latest=(logs||[]).slice(0,5);
  if(latest.length)text+=`\n\n<b>آخر نشاط:</b>\n${latest.map(x=>`• ${esc(x.details?.mechanic_name||'مسؤول الورشة')}: ${esc(String(x.details?.report_text||x.details?.inspection_text||x.details?.note||x.entity_id||'').slice(0,170))}`).join('\n')}`;
  return sendMessage(chatId,text);
}

export async function confirmSparePartsRequest(message,id,identity,role){
  if(!isWorkshopOperator(role)&&role!=='manager')return sendMessage(message.chat.id,'ليست لديك صلاحية تأكيد طلب قطع الغيار.');
  const rows=await patch('maintenance_orders',`id=eq.${encodeURIComponent(id)}&status=eq.draft`,{status:'quotation_required',confirmed_at:now(),confirmed_by:identity.user_id,updated_at:now()}),order=rows?.[0];
  if(!order)return sendMessage(message.chat.id,'تم التعامل مع الطلب من قبل أو لم يعد متاحًا.');
  await insert('maintenance_updates',[{maintenance_id:id,status:'quotation_required',note:'تم تأكيد طلب قطع الغيار وإحالته لطلب الأسعار',created_by:identity.user_id,source_channel:'telegram',source_chat_id:String(message.chat.id),source_message_id:String(message.message_id)}]);
  await writeWorkshopLog({identity,message,action:'spare_parts_request',entityType:'maintenance_order',entityId:id,details:{reference_no:order.reference_no,request_text:order.problem,target:order.plate_snapshot||'طلب عام'}});
  await clearMaintenanceSession(message.chat.id,identity.external_id||message.from?.id);
  return sendMessage(message.chat.id,`تم اعتماد طلب قطع الغيار وإحالته لطلب الأسعار.\nالمرجع: <b>${esc(order.reference_no)}</b>\nالحالة: <b>بانتظار عروض الأسعار</b>.`);
}