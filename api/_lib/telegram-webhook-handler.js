import { verifyTelegram } from './auth.js';
import { json, method, body, errorResponse } from './http.js';
import { patch, rpc, uploadObject } from './supabase.js';
import { sendMessage, answerCallback, downloadTelegramFile } from './telegram.js';
import { sha256, extractPlate, isFaultMessage, allowed } from './domain.js';
import { displayName } from './bot-profile.js';
import { interpretMessage } from './bot-routing.js';
import { reportKeyboard, sendReport } from './bot-reports.js';
import { handleStoredReportTextCommand, sendStoredReportRequest, sendStoredReportFile } from './bot-report-files.js';
import { handleExcel, handleAttachment } from './bot-files.js';
import { getBotSession, createMaintenanceDraft, continueWaitingPlate, confirmMaintenance, cancelMaintenance, chooseVehicle } from './bot-maintenance.js';
import { handleBuiltInCommand } from './bot-commands.js';
import { transcribeTelegramVoice, voiceFailureMessage } from './bot-voice.js';
import { handleMechanicTextCommand, continueMechanicSession, startMechanicAction, confirmSparePartsRequest, showMechanicMenu } from './bot-mechanic.js';
import { sendExecutiveWorkshopStatus } from './bot-workshop-dashboard.js';
import { handleSalesTextCommand, continueSalesSession, startSalesAction, confirmSalesOrder, cancelSalesDraft, showSalesMenu } from './bot-sales-accounting-guard.js';
import { startGuidedSales, continueGuidedSales, handleGuidedSalesCallback } from './bot-sales-guided.js';
import { handleFuelTextCommand, handleFuelCallback, showFuelMenu } from './bot-fuel-reports.js';
import { directBusinessSearchRequested, handleDirectBusinessSearchCommand, handleProcurementTextCommand, continueProcurementSession, handleProcurementCallback, showProcurementMenu } from './bot-procurement-secure.js';
import { handleEnterpriseTextCommand, continueEnterpriseSession, handleEnterpriseCallback, showRoleHome } from './bot-enterprise.js';
import { handleInvitationStart } from './bot-invitations.js';
import { ensureTelegramGroup, ensureTelegramIdentity, storeTelegramMessage } from './bot-webhook-core.js';
import { sendOperationalDocument } from './bot-documents.js';
import { sendGpsFleetStatus } from './bot-gps.js';
import { handleInsightCommand } from './bot-insights.js';
import { showAttendanceMenu, continueAttendanceSession, handleAttendanceLocation, handleAttendancePhoto, handleAttendanceCallback } from './bot-attendance.js';
import { botMenuItem, botModuleAllowed, moduleForCallback, moduleForSession, moduleForText } from './bot-menu-permissions.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[char]));
const norm=value=>String(value||'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/[؟?!.,،؛:]+/g,'').replace(/\s+/g,' ').trim();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function denyBotModule(chatId,identity,moduleId){if(!moduleId||botMenuItem(moduleId)?.ownerOnly||await botModuleAllowed(identity,moduleId))return false;await sendMessage(chatId,'هذه الوحدة مخفية وموقوفة لحسابك من إعدادات صلاحيات البوت.');return true;}
function reportCommandKind(value=''){
  if(/^(تقرير البلوك|فواتير البلوك|مبيعات البلوك اليوم|تقرير مبيعات البلوك)$/.test(value))return'block';
  if(/^(تقرير الخرسانه|تقرير الخرسانة|فواتير الخرسانه|فواتير الخرسانة|مبيعات الخرسانه اليوم|مبيعات الخرسانة اليوم|تقرير مبيعات الخرسانه|تقرير مبيعات الخرسانة)$/.test(value))return'concrete';
  if(/^(فواتير اليوم|كل فواتير اليوم|مبيعات اليوم|تفاصيل فواتير اليوم)$/.test(value))return'invoices';
  if(/^(تحصيلات اليوم|تقرير التحصيلات|تحصيل اليوم)$/.test(value))return'collections';
  if(/^(حركه الخزائن|حركة الخزائن|الخزائن اليوم|تقرير الخزائن)$/.test(value))return'cash';
  if(/^(ارصده الخزائن|أرصدة الخزائن|رصيد الخزائن)$/.test(value))return'treasuries';
  if(/^(مخزون اليوم|حركه المخزون|حركة المخزون|تقرير المخزون)$/.test(value))return'inventory';
  if(/^(تحليلات اليوم|تحليل اليوم|تحليل تقرير اليوم|مؤشرات اليوم)$/.test(value))return'analysis';
  if(/^(تقرير اليوم|التقرير اليومي|ملخص اليوم|الحركه اليوميه|الحركة اليومية|تقرير اليوم الكامل)$/.test(value))return'daily';
  return'';
}
function canReadDailyReport(role,kind='daily'){
  if(['admin','manager','accountant'].includes(role))return true;
  if(role==='block_sales')return kind==='block';
  if(role==='concrete_sales')return kind==='concrete';
  if(role==='collector')return kind==='collections';
  if(role==='warehouse')return kind==='inventory';
  return false;
}

export function splitCallbackData(value){
  const raw=String(value||''),separator=raw.indexOf(':');
  return separator<0?[raw,'']:[raw.slice(0,separator),raw.slice(separator+1)];
}

async function handleText(message,group,identity,text,voicePath='',stored=null){
  const chatId=message.chat.id,role=identity.role||'pending',active=Boolean(identity.active),raw=String(text||'').trim(),normalized=norm(raw),name=displayName(identity,message.from);
  if(await handleInvitationStart(message,identity,raw))return;
  if(active&&await denyBotModule(chatId,identity,moduleForText(raw)))return;
  const builtIn=await handleBuiltInCommand({message,identity,text:raw});
  if(builtIn){if(/^\/start(?:@\w+)?(?:\s+\w+)?$/i.test(raw)&&active)await showRoleHome(message,identity);return;}
  if(!active)return sendMessage(chatId,`مرحبًا ${esc(name)}. فهمت رسالتك وسجلتها، لكن حسابك غير معتمد لتنفيذ الإجراءات. أرسل رقمك من /whoami إلى مدير النظام.`);
  if(['group','supergroup'].includes(message.chat.type)&&!group.active)return sendMessage(chatId,'فهمت الرسالة وسجلتها، لكن المجموعة لم تعتمد بعد. يجب تحديد قسمها قبل التوجيه النهائي.');

  // طلب البحث الصريح أمر مستقل وعالي الأولوية. لا يُسمح لأي جلسة مفتوحة
  // (صيانة، تقرير، مورد، مبيعات أو مساعد عام) بابتلاعه أو إعادة تفسيره كسؤال توجيهي.
  if(directBusinessSearchRequested(raw)){
    if(await denyBotModule(chatId,identity,'procurement'))return;
    if(await handleDirectBusinessSearchCommand(message,identity,raw))return;
  }

  if(/^\/attendance(?:@\w+)?$/i.test(raw)||/^(الحضور والمواقع|تسجيل حضور|تسجيل انصراف|قائمه الحضور|قائمة الحضور|لوحه السائق|لوحة السائق)$/.test(normalized))return showAttendanceMenu(message,identity);
  if(/^(حاله الورشه|وضع الورشه|وضع الميكانيكي|ملخص اعمال الميكانيكي|تقرير تنفيذي للورشه)$/.test(normalized)){
    if(!['admin','manager','mechanic','accountant'].includes(role))return sendMessage(chatId,'عرض الحالة التنفيذية للورشة متاح لمدير النظام ومدير المصنع والمحاسب ومسؤول الورشة.');
    return sendExecutiveWorkshopStatus(chatId);
  }
  if(/^\/suppliers(?:@\w+)?$/i.test(raw))return showProcurementMenu(message,identity);
  if(/^\/sales(?:@\w+)?$/i.test(raw))return showSalesMenu(message,identity);
  if(/^\/workshop(?:@\w+)?$/i.test(raw))return showMechanicMenu(message,identity);
  if(/^\/gps(?:@\w+)?$/i.test(raw)||/^(حاله gps|حالة gps|حاله الاسطول|حالة الأسطول|موقع السيارات|السيارات الان|السيارات الآن)$/.test(normalized)){
    if(!['admin','manager','mechanic','driver','fuel_operator'].includes(role))return sendMessage(chatId,'عرض GPS متاح للإدارة والسائق ومسؤول الأسطول والورشة.');
    return sendGpsFleetStatus(chatId);
  }
  const session=await getBotSession(chatId,message.from.id);
  if(await denyBotModule(chatId,identity,moduleForSession(session?.state)))return;
  if(session?.state?.startsWith('attendance_')||session?.state?.startsWith('driver_')){if(await continueAttendanceSession(message,identity,session,raw))return;}
  if(session?.state?.startsWith('enterprise_')){if(await continueEnterpriseSession(message,identity,session,raw))return;}
  if(session?.state?.startsWith('supplier_')||session?.state?.startsWith('rfq_')||session?.state?.startsWith('business_search_')){if(await continueProcurementSession(message,identity,session,raw))return;}
  if(session?.state?.startsWith('guided_sales_')){if(await continueGuidedSales(message,identity,session,raw))return;}
  if(session?.state?.startsWith('sales_')){if(await continueSalesSession(message,identity,session,raw))return;}
  if(session?.state?.startsWith('mechanic_')){if(await continueMechanicSession(message,identity,session,raw))return;}
  if(session?.state==='waiting_plate'){const waiting=await continueWaitingPlate(message,identity,session,raw,voicePath);if(waiting?.handled)return;}
  const directReport=reportCommandKind(normalized);
  if(directReport){
    if(!canReadDailyReport(role,directReport))return sendMessage(chatId,'ليست لديك صلاحية عرض هذا الجزء من التقرير اليومي.');
    return sendReport(chatId,directReport);
  }
  if(await handleEnterpriseTextCommand(message,identity,raw))return;
  if(await handleInsightCommand(message,identity,raw))return;
  if(await handleFuelTextCommand(message,identity,raw))return;
  if(/ديزل/.test(normalized))return showFuelMenu(message,identity);
  if(await handleProcurementTextCommand(message,identity,raw))return;
  if(await handleSalesTextCommand(message,identity,raw))return;
  const mechanicActions=[
    {re:/^(بلاغ اصل بدون لوحه|اصل بدون لوحه|عطل معده بدون لوحه)$/,action:'general_fault'},
    {re:/^(فحص معده|فحص معدات|فحص اصل|بدء فحص معده)$/,action:'inspection'},
    {re:/^(طلب قطع غيار|عاوز قطع غيار|اريد قطع غيار)$/,action:'parts'},
    {re:/^(تقرير يومي للورشه|بدء التقرير اليومي|تقرير الميكانيكي اليومي)$/,action:'daily'},
    {re:/^(تحديث امر اصلاح|تحديث طلب اصلاح|تحديث صيانه)$/,action:'update'}
  ];
  const mechanicAction=mechanicActions.find(item=>item.re.test(normalized));
  if(mechanicAction)return startMechanicAction(message,identity,mechanicAction.action);
  if(await handleMechanicTextCommand(message,identity,raw))return;
  if(await handleStoredReportTextCommand(message,identity,raw))return;
  if(/^(تقارير|تقرير|ملخص)$/i.test(raw)||/اعرض.*تقارير/.test(raw)){
    if(await denyBotModule(chatId,identity,'reports'))return;
    if(!canReadDailyReport(role,'daily'))return sendMessage(chatId,'قائمة التقرير الكامل متاحة للإدارة والمحاسب.');
    return sendMessage(chatId,`حاضر ${esc(name)}. اختر التقرير المطلوب:`,reportKeyboard());
  }
  if((group.department==='workshop'||role==='mechanic'||role==='admin')&&isFaultMessage(raw)){
    if(await denyBotModule(chatId,identity,'workshop'))return;
    if(!allowed(role,'maintenance')&&!allowed(role,'approve'))return sendMessage(chatId,'فهمت أنها رسالة صيانة، لكن دورك لا يسمح بفتح بلاغات الورشة.');
    return createMaintenanceDraft({chatId,messageId:message.message_id,identity,text:raw,plate:extractPlate(raw),voicePath});
  }
  const smart=await interpretMessage({message,group,identity,text:raw,stored});
  if(smart.route.intent==='attendance'){if(await denyBotModule(chatId,identity,'attendance'))return;return showAttendanceMenu(message,identity);}
  if(smart.route.intent==='report'&&canReadDailyReport(role,'daily')){if(await denyBotModule(chatId,identity,'reports'))return;return sendMessage(chatId,`${smart.response}\n\nاختر التقرير المطلوب:`,reportKeyboard());}
  if(smart.route.intent==='maintenance'&&(allowed(role,'maintenance')||allowed(role,'approve'))){if(await denyBotModule(chatId,identity,'workshop'))return;return createMaintenanceDraft({chatId,messageId:message.message_id,identity,text:raw,plate:extractPlate(raw),voicePath});}
  return sendMessage(chatId,smart.response);
}

async function handleCallback(update){
  const query=update.callback_query,message=query.message,identity=await ensureTelegramIdentity(query.from),role=identity.role||'pending';
  const group=await ensureTelegramGroup(message.chat),[action,value]=splitCallbackData(query.data);
  if(await denyBotModule(message.chat.id,identity,moduleForCallback(action,value))){await answerCallback(query.id,'غير مسموح');return;}
  if(await handleAttendanceCallback(message,query.from,identity,action,value)){await answerCallback(query.id,'تم');return;}
  if(await handleGuidedSalesCallback(message,query.from,identity,action,value)){await answerCallback(query.id,'تم');return;}
  if(await handleFuelCallback(message,query.from,identity,action,value)){await answerCallback(query.id,'تم');return;}
  if(await handleProcurementCallback(message,query.from,identity,action,value)){await answerCallback(query.id,'تم');return;}
  if(await handleEnterpriseCallback(message,query.from,identity,action,value)){await answerCallback(query.id,'تم');return;}
  if(action==='report'){await answerCallback(query.id,'جارٍ تجهيز التقرير');return sendReport(message.chat.id,value);}
  if(action==='stored_report'){await answerCallback(query.id,'جارٍ تجهيز الملف');return sendStoredReportFile(message.chat.id,value,identity);}
  if(action==='stored_report_request'){await answerCallback(query.id,'جارٍ تجهيز التقرير');return sendStoredReportRequest(message.chat.id,value,identity);}
  if(action==='mechanic'){await answerCallback(query.id,'تم');return startMechanicAction({...message,from:query.from},identity,value);}
  if(action==='sales'){await answerCallback(query.id,'تم');return startSalesAction({...message,from:query.from},identity,value);}
  if(action==='guided_sales_confirm'){await answerCallback(query.id,'تم');return confirmSalesOrder(message,identity,value);}
  if(action==='guided_sales_cancel'){await answerCallback(query.id,'تم');return cancelSalesDraft(message,identity,value);}
  if(action==='maintenance_confirm'){await answerCallback(query.id,'تم');return confirmMaintenance(message,identity,value);}
  if(action==='maintenance_cancel'){await answerCallback(query.id,'تم');return cancelMaintenance(message,identity,value);}
  if(action==='maintenance_vehicle'){await answerCallback(query.id,'تم');return chooseVehicle(message,identity,value);}
  if(action==='spare_parts_confirm'){await answerCallback(query.id,'تم');return confirmSparePartsRequest(message,identity,value);}
  await answerCallback(query.id,'تم');
}

async function handleMessage(update){
  const message=update.message||update.edited_message;if(!message)return;
  const identity=await ensureTelegramIdentity(message.from),group=await ensureTelegramGroup(message.chat);
  let stored=await storeTelegramMessage(update,message,identity,'incoming'),text=String(message.text||message.caption||'').trim(),voicePath='';
  if(message.voice||message.audio){
    const media=message.voice||message.audio,fileId=media.file_id;
    try{
      const downloaded=await downloadTelegramFile(fileId,{expectedSize:media.file_size,maxBytes:20*1024*1024});
      voicePath=`telegram/${message.chat.id}/${message.message_id}-${sha256(downloaded.buffer).slice(0,16)}.ogg`;
      await uploadObject(voicePath,downloaded.buffer,downloaded.contentType);
      const transcription=await transcribeTelegramVoice(downloaded.buffer,downloaded.contentType);
      if(transcription.text){text=transcription.text;stored=(await patch('telegram_messages',`chat_id=eq.${message.chat.id}&message_id=eq.${message.message_id}`,{transcription:text,file_path:voicePath}))?.[0]||stored;}
      else await sendMessage(message.chat.id,voiceFailureMessage(transcription));
    }catch(error){await sendMessage(message.chat.id,`تعذر معالجة الرسالة الصوتية: ${esc(error?.message||'خطأ غير معروف')}`);return;}
  }
  if(message.document){if(await handleExcel(message,identity,group))return;if(await handleAttachment(message,identity,group))return;}
  if(message.photo){if(await handleAttendancePhoto(message,identity))return;if(await handleAttachment(message,identity,group))return;}
  if(message.location){if(await handleAttendanceLocation(message,identity))return;}
  if(text)await handleText(message,group,identity,text,voicePath,stored);
}

export default async function handler(req,res){
  if(!method(req,res,['POST']))return;
  try{
    if(!verifyTelegram(req))return json(res,401,{ok:false,error:'unauthorized'});
    const update=body(req);
    if(update.callback_query)await handleCallback(update);else await handleMessage(update);
    return json(res,200,{ok:true});
  }catch(error){errorResponse(res,error);}
}
