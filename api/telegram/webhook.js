import * as XLSX from 'xlsx';
import { verifyTelegram } from '../_lib/auth.js';
import { config } from '../_lib/config.js';
import { json, method, body, errorResponse } from '../_lib/http.js';
import { select, insert, upsert, patch, rpc, uploadObject } from '../_lib/supabase.js';
import { sendMessage, answerCallback, downloadTelegramFile, keyboard, sendVoiceBuffer } from '../_lib/telegram.js';
import { transcribe, synthesize } from '../_lib/ai.js';
import { inferDepartment, classifyFile, sha256, extractPlate, isFaultMessage, allowed, reportSummary } from '../_lib/domain.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeFile = v => String(v || 'file').replace(/[^A-Za-z0-9._\-\u0600-\u06FF]/g,'_').slice(0,140);
const now = () => new Date().toISOString();

async function ensureGroup(chat) {
  if (!chat || !['group','supergroup'].includes(chat.type)) return { chat_id:String(chat?.id||''), department:'private', active:true, status:'private' };
  const id=String(chat.id), existing=(await select('telegram_groups',`chat_id=eq.${encodeURIComponent(id)}&select=*&limit=1`))?.[0];
  if (existing) {
    const rows=await patch('telegram_groups',`chat_id=eq.${encodeURIComponent(id)}`,{title:chat.title||existing.title,last_seen_at:now(),updated_at:now()});
    return rows?.[0]||existing;
  }
  const rows=await insert('telegram_groups',[{chat_id:id,title:chat.title||'مجموعة تيليجرام',department:inferDepartment(chat.title),active:false,status:'pending',last_seen_at:now()}]);
  return rows?.[0];
}
async function ensureIdentity(from) {
  const result=await rpc('register_telegram_identity',{p_external_id:String(from.id),p_username:String(from.username||''),p_full_name:[from.first_name,from.last_name].filter(Boolean).join(' ')||String(from.id),p_make_owner:Boolean(config.telegramOwnerId&&String(from.id)===config.telegramOwnerId)});
  return Array.isArray(result)?result[0]:result;
}
async function storeMessage(updateId,message,group,identity,overrides={}) {
  const type=message.voice?'voice':message.document?'document':message.photo?'photo':message.text?'text':'other';
  const row={update_id:String(updateId),chat_id:String(message.chat.id),message_id:String(message.message_id),group_id:group?.id||null,sender_user_id:identity?.user_id||null,sender_external_id:String(message.from?.id||''),message_type:type,text:message.text||message.caption||'',file_id:message.voice?.file_id||message.document?.file_id||message.photo?.at(-1)?.file_id||null,file_name:message.document?.file_name||null,mime_type:message.document?.mime_type||message.voice?.mime_type||null,raw:{message},created_at:new Date((message.date||Date.now()/1000)*1000).toISOString(),...overrides};
  const saved=await upsert('telegram_messages',[row],'update_id');return saved?.[0]||row;
}
async function getSession(chatId,userId){return (await select('bot_sessions',`channel=eq.telegram&chat_id=eq.${encodeURIComponent(String(chatId))}&external_user_id=eq.${encodeURIComponent(String(userId))}&select=*&limit=1`))?.[0]||null;}
async function setSession(chatId,userId,state,context={}){return upsert('bot_sessions',[{channel:'telegram',chat_id:String(chatId),external_user_id:String(userId),state,context,updated_at:now()}],'channel,chat_id,external_user_id');}
async function clearSession(chatId,userId){return patch('bot_sessions',`channel=eq.telegram&chat_id=eq.${encodeURIComponent(String(chatId))}&external_user_id=eq.${encodeURIComponent(String(userId))}`,{state:'idle',context:{},updated_at:now()});}
async function accessibleReply(chatId,text,voice=false,extra={}){const sent=await sendMessage(chatId,text,extra);if(voice&&config.openaiKey){try{const audio=await synthesize(text.replace(/<[^>]+>/g,''));if(audio)await sendVoiceBuffer(chatId,audio);}catch(e){console.error('tts',e.message);}}return sent;}
function reportKeyboard(){return keyboard([[{text:'ملخص اليوم',callback_data:'report:daily'},{text:'الديزل',callback_data:'report:fuel'}],[{text:'الورشة',callback_data:'report:workshop'},{text:'المبيعات والتحصيل',callback_data:'report:sales'}],[{text:'الفروقات المفتوحة',callback_data:'report:discrepancies'}]]);}

async function currentState(){return (await select('app_state','key=eq.primary&select=payload,revision,updated_at&limit=1'))?.[0]||null;}
async function sendReport(chatId,kind) {
  const row=await currentState();if(!row?.payload)return sendMessage(chatId,'لا توجد نسخة سحابية معتمدة من البرنامج حتى الآن. افتح البرنامج واضغط <b>مزامنة الآن</b>.');
  const s=reportSummary(row.payload);let text='';
  if(kind==='fuel') text=`<b>تقرير الديزل — اليوم</b>\n\nاللترات: <b>${s.fuelLitersToday.toLocaleString('en-US')}</b>\nالقيمة: <b>${s.fuelCostToday.toLocaleString('en-US',{maximumFractionDigits:2})} ر.س</b>`;
  else if(kind==='workshop') text=`<b>تقرير الورشة</b>\n\nأوامر الإصلاح المفتوحة: <b>${s.openMaintenance}</b>\nالمركبات المتوقفة: <b>${s.stoppedVehicles}</b>\nإجمالي المركبات المسجلة: <b>${s.vehicles}</b>`;
  else if(kind==='sales') text=`<b>المبيعات والتحصيل — اليوم</b>\n\nالمبيعات: <b>${s.salesToday.toLocaleString('en-US',{maximumFractionDigits:2})} ر.س</b>\nالتحصيل: <b>${s.collectionsToday.toLocaleString('en-US',{maximumFractionDigits:2})} ر.س</b>\nالفرق: <b>${(s.salesToday-s.collectionsToday).toLocaleString('en-US',{maximumFractionDigits:2})} ر.س</b>`;
  else if(kind==='discrepancies'){const rows=await select('discrepancies','status=in.(open,under_review)&select=severity,status&limit=1000');const critical=(rows||[]).filter(x=>x.severity==='critical').length;text=`<b>الفروقات الرقابية المفتوحة</b>\n\nالإجمالي: <b>${rows?.length||0}</b>\nحرجة: <b>${critical}</b>\nتحتاج مراجعة: <b>${(rows?.length||0)-critical}</b>`;}
  else text=`<b>ملخص مصنع بن حامد — اليوم</b>\n\nالموظفون: <b>${s.employees}</b>\nالمركبات: <b>${s.vehicles}</b>\nالعملاء: <b>${s.clients}</b>\nالمبيعات: <b>${s.salesToday.toLocaleString('en-US',{maximumFractionDigits:2})} ر.س</b>\nالتحصيل: <b>${s.collectionsToday.toLocaleString('en-US',{maximumFractionDigits:2})} ر.س</b>\nالديزل: <b>${s.fuelLitersToday.toLocaleString('en-US')} لتر</b>\nأوامر الورشة المفتوحة: <b>${s.openMaintenance}</b>`;
  await sendMessage(chatId,text);
}

async function findVehicle(plate) {
  const rows=await select('vehicles','active=eq.true&select=external_id,plate_no,asset_no,vehicle_type,make,driver_external_id&limit=1000');
  const p=String(plate||'').replace(/\s+/g,'').toLowerCase();
  const matches=(rows||[]).filter(v=>[v.plate_no,v.asset_no].some(x=>String(x||'').replace(/\s+/g,'').toLowerCase().includes(p)||p.includes(String(x||'').replace(/\s+/g,'').toLowerCase())));
  return matches;
}
async function createMaintenanceDraft({chatId,messageId,identity,text,plate,voicePath}) {
  const matches=plate?await findVehicle(plate):[];
  if(plate&&matches.length>1){await setSession(chatId,identity.external_id,'choose_vehicle',{problem:text,plate,vehicleIds:matches.map(x=>x.external_id),voicePath});const buttons=matches.slice(0,8).map(v=>[{text:`${v.plate_no||v.asset_no} — ${v.vehicle_type||v.make||'مركبة'}`,callback_data:`vehicle:${v.external_id}`}]);await accessibleReply(chatId,'وجدت أكثر من مركبة مطابقة. اختر المركبة الصحيحة:',true,keyboard(buttons));return;}
  if(!plate||!matches.length){await setSession(chatId,identity.external_id,'waiting_plate',{problem:text,plate,voicePath});await accessibleReply(chatId,plate?'لم أجد اللوحة في سجل المركبات. قل رقم اللوحة الصحيح أو أرسل صورة واضحة لها.':'تم فهم بلاغ العطل، لكن رقم اللوحة غير واضح. قل رقم اللوحة أو آخر أربعة أرقام منها.',true);return;}
  const vehicle=matches[0];const ref=await rpc('next_document_no',{p_prefix:'RO'});const reference=Array.isArray(ref)?ref[0]?.next_document_no||ref[0]:ref;
  const rows=await insert('maintenance_orders',[{reference_no:String(reference),vehicle_external_id:vehicle.external_id,plate_snapshot:vehicle.plate_no||vehicle.asset_no,problem:text,status:'draft',priority:/حرج|خطر|فرامل|متوقف/.test(text)?'urgent':'normal',vehicle_stopped:/متوقف|واقفة|مش هتشتغل|لا تعمل/.test(text),reported_by:identity.user_id,source_channel:'telegram',source_chat_id:String(chatId),source_message_id:String(messageId),voice_path:voicePath||null,reported_at:now()}]);
  const order=rows?.[0];await setSession(chatId,identity.external_id,'confirm_maintenance',{maintenanceId:order.id});
  await accessibleReply(chatId,`<b>تأكيد بلاغ عطل</b>\n\nأمر مؤقت: <b>${esc(order.reference_no)}</b>\nالمركبة: <b>${esc(vehicle.plate_no||vehicle.asset_no)}</b>\nالعطل: ${esc(text)}\nالحالة: لم يُفتح رسميًا بعد.`,true,keyboard([[{text:'تأكيد فتح أمر إصلاح',callback_data:`maint_confirm:${order.id}`}],[{text:'إلغاء البلاغ',callback_data:`maint_cancel:${order.id}`}]]));
}

async function handleExcel(message,group,identity,stored) {
  const document=message.document;const downloaded=await downloadTelegramFile(document.file_id);const hash=sha256(downloaded.buffer);const duplicate=(await select('imports',`file_hash=eq.${hash}&select=id,status,original_name&limit=1`))?.[0];
  if(duplicate){await sendMessage(message.chat.id,`هذا الملف سبق استلامه.\nالملف: <b>${esc(duplicate.original_name)}</b>\nالحالة: <b>${esc(duplicate.status)}</b>`);return;}
  const name=document.file_name||'report.xlsx';let sheetNames=[],rowCount=0,summary={},status='ready',errorCount=0;
  try{const workbook=XLSX.read(downloaded.buffer,{type:'buffer',cellDates:true});sheetNames=workbook.SheetNames;for(const sn of sheetNames){const rows=XLSX.utils.sheet_to_json(workbook.Sheets[sn],{defval:'',raw:false});rowCount+=rows.length;}summary={sheetNames};}catch(error){status='failed';errorCount=1;summary={error:error.message};}
  const reportType=classifyFile(name,group.department,sheetNames),path=`telegram/${group.department||'unassigned'}/${new Date().toISOString().slice(0,10)}/${hash.slice(0,16)}-${safeFile(name)}`;
  await uploadObject(path,downloaded.buffer,document.mime_type||downloaded.contentType);
  const rows=await insert('imports',[{source:'telegram',department:group.department||'unassigned',report_type:reportType,status,original_name:name,mime_type:document.mime_type||downloaded.contentType,file_path:path,file_hash:hash,row_count:rowCount,error_count:errorCount,warning_count:reportType==='unknown_excel'?1:0,summary,submitted_by:identity.user_id,source_chat_id:String(message.chat.id),source_message_id:String(message.message_id)}]);
  const imp=rows?.[0];await patch('telegram_messages',`id=eq.${stored.id}`,{file_path:path,related_entity_type:'import',related_entity_id:imp.id,transcription:null});
  await sendMessage(message.chat.id,`<b>تم استلام ملف Excel</b>\n\nالاسم: ${esc(name)}\nالنوع: <b>${esc(reportType)}</b>\nالأوراق: ${esc(sheetNames.join('، ')||'تعذر القراءة')}\nالصفوف: <b>${rowCount}</b>\nالحالة: <b>${status==='ready'?'جاهز للمراجعة داخل البرنامج':'تعذر الفحص الآلي'}</b>\n\nلم تُرحّل البيانات نهائيًا. افتح مركز الاتصال في البرنامج لمراجعتها.`);
}
async function handleAttachment(message,group,identity,stored) {
  const file=message.document||message.photo?.at(-1);const downloaded=await downloadTelegramFile(file.file_id);const hash=sha256(downloaded.buffer);const name=message.document?.file_name||`photo-${message.message_id}.jpg`;const path=`telegram/${group.department||'unassigned'}/${new Date().toISOString().slice(0,10)}/${hash.slice(0,16)}-${safeFile(name)}`;await uploadObject(path,downloaded.buffer,message.document?.mime_type||downloaded.contentType);
  const caption=message.caption||'';const reportType=/عرض سعر/.test(caption+name)?'quotation':/فاتور/.test(caption+name)?'invoice':'unclassified_document';const rows=await insert('imports',[{source:'telegram',department:group.department||'unassigned',report_type:reportType,status:'received',original_name:name,mime_type:message.document?.mime_type||downloaded.contentType,file_path:path,file_hash:hash,row_count:0,error_count:0,warning_count:reportType==='unclassified_document'?1:0,summary:{caption},submitted_by:identity.user_id,source_chat_id:String(message.chat.id),source_message_id:String(message.message_id)}]);await patch('telegram_messages',`id=eq.${stored.id}`,{file_path:path,related_entity_type:'import',related_entity_id:rows?.[0]?.id});await sendMessage(message.chat.id,`تم حفظ المستند الأصلي.\nالتصنيف المبدئي: <b>${esc(reportType)}</b>\nإذا تعذر استخراج بياناته سيطلب النظام من المحاسب إدخال الحقول يدويًا داخل مركز الاتصال.`);
}

async function handleText(message,group,identity,text,voicePath='') {
  const chatId=message.chat.id, role=identity.role||'pending', active=Boolean(identity.active);
  if(/^\/whoami|من انا|مين انا/i.test(text)){return sendMessage(chatId,`رقم Telegram: <code>${esc(message.from.id)}</code>\nالدور: <b>${esc(role)}</b>\nالحالة: <b>${active?'معتمد':'ينتظر اعتماد مدير النظام'}</b>\nالمجموعة: <code>${esc(message.chat.id)}</code>`);}
  if(!active){return sendMessage(chatId,'تم تسجيل رسالتك، لكن حسابك غير معتمد لتنفيذ إجراءات. أرسل رقمك الظاهر من /whoami إلى مدير النظام لاعتماد الدور.');}
  if(['group','supergroup'].includes(message.chat.type)&&!group.active){return sendMessage(chatId,'هذه المجموعة ظهرت في مركز الاتصال لكنها لم تعتمد بعد. مدير النظام يحدد هل هي الورشة أو المالية أو البلوك أو الخرسانة.');}
  const session=await getSession(chatId,message.from.id);
  if(session?.state==='waiting_plate'){const plate=extractPlate(text)||text.trim();return createMaintenanceDraft({chatId,messageId:message.message_id,identity,text:session.context?.problem||'بلاغ عطل',plate,voicePath:session.context?.voicePath||voicePath});}
  if(/^(تقارير|تقرير|ملخص)$/i.test(text.trim())||/اعرض.*تقارير/.test(text)){if(!allowed(role,'report'))return sendMessage(chatId,'طلب التقارير متاح للمدير ومدير النظام فقط.');return sendMessage(chatId,'اختر التقرير المطلوب:',reportKeyboard());}
  if((group.department==='workshop'||role==='mechanic'||role==='admin')&&isFaultMessage(text)){if(!allowed(role,'maintenance')&&!allowed(role,'approve'))return sendMessage(chatId,'ليس لديك صلاحية فتح بلاغات الورشة.');return createMaintenanceDraft({chatId,messageId:message.message_id,identity,text,plate:extractPlate(text),voicePath});}
  return sendMessage(chatId,'تم تسجيل الرسالة في سجل المجموعة. لتنفيذ إجراء اكتب طلبًا واضحًا مثل: <b>عطل في المركبة 2345</b> أو <b>تقارير</b>، أو ارفع ملف Excel بالاسم والتنسيق المعتمد.');
}

async function handleCallback(update) {
  const q=update.callback_query,message=q.message,identity=await ensureIdentity(q.from),role=identity.role||'pending';await answerCallback(q.id);
  if(!identity.active)return sendMessage(message.chat.id,'حسابك غير معتمد لتنفيذ هذا الإجراء.');
  const [action,id]=String(q.data||'').split(':');
  if(action==='report'){if(!allowed(role,'report'))return sendMessage(message.chat.id,'ليست لديك صلاحية طلب التقرير.');return sendReport(message.chat.id,id);}
  if(action==='maint_confirm'){if(!allowed(role,'maintenance')&&!allowed(role,'approve'))return sendMessage(message.chat.id,'ليست لديك صلاحية تأكيد أمر الإصلاح.');const rows=await patch('maintenance_orders',`id=eq.${encodeURIComponent(id)}&status=eq.draft`,{status:'reported',confirmed_at:now(),confirmed_by:identity.user_id});const order=rows?.[0];if(!order)return sendMessage(message.chat.id,'تم التعامل مع البلاغ من قبل أو لم يعد متاحًا.');await insert('maintenance_updates',[{maintenance_id:id,status:'reported',note:'تم تأكيد فتح أمر الإصلاح من Telegram',created_by:identity.user_id,source_channel:'telegram',source_chat_id:String(message.chat.id),source_message_id:String(message.message_id)}]);await clearSession(message.chat.id,q.from.id);return accessibleReply(message.chat.id,`تم فتح أمر الإصلاح رسميًا: <b>${esc(order.reference_no)}</b>\nالحالة: بانتظار الفحص والتشخيص.`,role==='mechanic');}
  if(action==='maint_cancel'){const rows=await patch('maintenance_orders',`id=eq.${encodeURIComponent(id)}&status=eq.draft`,{status:'cancelled',cancelled_at:now(),cancelled_by:identity.user_id});await clearSession(message.chat.id,q.from.id);return sendMessage(message.chat.id,rows?.length?'تم إلغاء البلاغ المؤقت.':'تعذر الإلغاء لأن حالة البلاغ تغيرت.');}
  if(action==='vehicle'){const session=await getSession(message.chat.id,q.from.id);if(session?.state!=='choose_vehicle')return sendMessage(message.chat.id,'انتهت جلسة اختيار المركبة. أرسل البلاغ مرة أخرى.');const vehicles=await select('vehicles',`external_id=eq.${encodeURIComponent(id)}&select=plate_no,asset_no&limit=1`);return createMaintenanceDraft({chatId:message.chat.id,messageId:message.message_id,identity,text:session.context?.problem||'بلاغ عطل',plate:vehicles?.[0]?.plate_no||vehicles?.[0]?.asset_no,voicePath:session.context?.voicePath||''});}
  if(action==='approve'){if(!allowed(role,'approve'))return sendMessage(message.chat.id,'الاعتماد متاح للمدير ومدير النظام فقط.');const result=await rpc('decide_approval',{p_approval_id:id,p_decision:'approved',p_decided_by:identity.user_id,p_note:'اعتماد من Telegram'});return sendMessage(message.chat.id,`تم تسجيل الاعتماد الرسمي.\nالمرجع: <b>${esc(Array.isArray(result)?result[0]?.reference_no||id:id)}</b>`);}
  if(action==='reject'){if(!allowed(role,'approve'))return sendMessage(message.chat.id,'الرفض متاح للمدير ومدير النظام فقط.');await rpc('decide_approval',{p_approval_id:id,p_decision:'rejected',p_decided_by:identity.user_id,p_note:'رفض من Telegram'});return sendMessage(message.chat.id,'تم تسجيل الرفض الرسمي.');}
}

async function handleMessage(update) {
  const message=update.message||update.edited_message;if(!message?.from||message.from.is_bot)return;
  const [group,identity]=await Promise.all([ensureGroup(message.chat),ensureIdentity(message.from)]);const stored=await storeMessage(update.update_id,message,group,identity);
  if(message.document){const name=message.document.file_name||'';if(/\.(xlsx|xls)$/i.test(name)||/spreadsheet|excel/i.test(message.document.mime_type||''))return handleExcel(message,group,identity,stored);return handleAttachment(message,group,identity,stored);}
  if(message.photo?.length)return handleAttachment(message,group,identity,stored);
  if(message.voice){const downloaded=await downloadTelegramFile(message.voice.file_id);const hash=sha256(downloaded.buffer);const path=`telegram/${group.department||'unassigned'}/${new Date().toISOString().slice(0,10)}/voice-${hash.slice(0,16)}.ogg`;await uploadObject(path,downloaded.buffer,message.voice.mime_type||downloaded.contentType);let text='';try{text=await transcribe(downloaded.buffer,'voice.ogg',message.voice.mime_type||downloaded.contentType)||'';}catch(error){console.error('transcription',error.message);}await patch('telegram_messages',`id=eq.${stored.id}`,{file_path:path,transcription:text||null});if(!text)return accessibleReply(message.chat.id,'تم حفظ الرسالة الصوتية، لكن خدمة تحويل الصوت إلى نص غير مفعلة أو تعذر فهم التسجيل. قل رقم اللوحة في رسالة صوتية أو نصية أقصر.',true);return handleText(message,group,identity,text,path);}
  return handleText(message,group,identity,String(message.text||message.caption||'').trim());
}

export default async function handler(req,res){
  if(!method(req,res,['POST']))return;
  let update;
  try{verifyTelegram(req);update=await body(req,2_000_000);}
  catch(error){return errorResponse(res,error);}
  try{if(update.callback_query)await handleCallback(update);else if(update.message||update.edited_message)await handleMessage(update);}
  catch(error){console.error('[telegram webhook]',error);}
  json(res,200,{ok:true});
}
async function handleMessage(update) {
  const message=update.message||update.edited_message;if(!message?.from||message.from.is_bot)return;
  const [group,identity]=await Promise.all([ensureGroup(message.chat),ensureIdentity(message.from)]);const stored=await storeMessage(update.update_id,message,group,identity);
  if(message.document){const name=message.document.file_name||'';if(/\.(xlsx|xls)$/i.test(name)||/spreadsheet|excel/i.test(message.document.mime_type||''))return handleExcel(message,group,identity,stored);return handleAttachment(message,group,identity,stored);}
  if(message.photo?.length)return handleAttachment(message,group,identity,stored);
  if(message.voice){const downloaded=await downloadTelegramFile(message.voice.file_id);const hash=sha256(downloaded.buffer);const path=`telegram/${group.department||'unassigned'}/${new Date().toISOString().slice(0,10)}/voice-${hash.slice(0,16)}.ogg`;await uploadObject(path,downloaded.buffer,message.voice.mime_type||downloaded.contentType);let text='';try{text=await transcribe(downloaded.buffer,'voice.ogg',message.voice.mime_type||downloaded.contentType)||'';}catch(error){console.error('transcription',error.message);}await patch('telegram_messages',`id=eq.${stored.id}`,{file_path:path,transcription:text||null});if(!text)return accessibleReply(message.chat.id,'تم حفظ الرسالة الصوتية، لكن خدمة تحويل الصوت إلى نص غير مفعلة أو تعذر فهم التسجيل. قل رقم اللوحة في رسالة صوتية أو نصية أقصر.',true);return handleText(message,group,identity,text,path);}
  return handleText(message,group,identity,String(message.text||message.caption||'').trim());
}

export default async function handler(req,res){
  if(!method(req,res,['POST']))return;
  try{verifyTelegram(req);const update=await body(req,2_000_000);json(res,200,{ok:true});if(update.callback_query)await handleCallback(update);else if(update.message||update.edited_message)await handleMessage(update);}
  catch(error){if(!res.headersSent)errorResponse(res,error);else console.error('[telegram webhook]',error);}
}
