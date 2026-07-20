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
import { handleMechanicTextCommand, continueMechanicSession, startMechanicAction, confirmSparePartsRequest, showMechanicMenu, handleWorkshopBotCallback } from './bot-mechanic.js';
import { sendExecutiveWorkshopStatus } from './bot-workshop-dashboard.js';
import { handleSalesTextCommand, continueSalesSession, startSalesAction, confirmSalesOrder, cancelSalesDraft, showSalesMenu } from './bot-sales.js';
import { startGuidedSales, continueGuidedSales, handleGuidedSalesCallback } from './bot-sales-guided.js';
import { handleProcurementTextCommand, continueProcurementSession, handleProcurementCallback, showProcurementMenu } from './bot-procurement.js';
import { handleEnterpriseTextCommand, continueEnterpriseSession, handleEnterpriseCallback, showRoleHome } from './bot-enterprise.js';
import { handleInvitationStart } from './bot-invitations.js';
import { ensureTelegramGroup, ensureTelegramIdentity, storeTelegramMessage } from './bot-webhook-core.js';
import { sendOperationalDocument } from './bot-documents.js';
import { sendGpsFleetStatus } from './bot-gps.js';
import { handleInsightCommand } from './bot-insights.js';
import { showAttendanceMenu, continueAttendanceSession, handleAttendanceLocation, handleAttendancePhoto, handleAttendanceCallback } from './bot-attendance.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const norm=value=>String(value||'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/[؟?!.,،؛:]+/g,'').replace(/\s+/g,' ').trim();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function handleText(message,group,identity,text,voicePath='',stored=null){
  const chatId=message.chat.id,role=identity.role||'pending',active=Boolean(identity.active),raw=String(text||'').trim(),normalized=norm(raw),name=displayName(identity,message.from);
  if(await handleInvitationStart(message,identity,raw))return;
  const builtIn=await handleBuiltInCommand({message,identity,text:raw});
  if(builtIn){if(/^\/start(?:@\w+)?(?:\s+\w+)?$/i.test(raw)&&active)await showRoleHome(message,identity);return;}
  if(!active)return sendMessage(chatId,`مرحبًا ${esc(name)}. فهمت رسالتك وسجلتها، لكن حسابك غير معتمد لتنفيذ الإجراءات. أرسل رقمك من /whoami إلى مدير النظام.`);
  if(['group','supergroup'].includes(message.chat.type)&&!group.active)return sendMessage(chatId,'فهمت الرسالة وسجلتها، لكن المجموعة لم تعتمد بعد. يجب تحديد قسمها قبل التوجيه النهائي.');
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
  if(session?.state?.startsWith('attendance_')||session?.state?.startsWith('driver_')){if(await continueAttendanceSession(message,identity,session,raw))return;}
  if(session?.state?.startsWith('enterprise_')){if(await continueEnterpriseSession(message,identity,session,raw))return;}
  if(session?.state?.startsWith('supplier_')||session?.state?.startsWith('rfq_')){if(await continueProcurementSession(message,identity,session,raw))return;}
  if(session?.state?.startsWith('guided_sales_')){if(await continueGuidedSales(message,identity,session,raw))return;}
  if(session?.state?.startsWith('sales_')){if(await continueSalesSession(message,identity,session,raw))return;}
  if(session?.state?.startsWith('mechanic_')||session?.state?.startsWith('workshop_')){if(await continueMechanicSession(message,identity,session,raw))return;}
  if(session?.state==='waiting_plate'){const waiting=await continueWaitingPlate(message,identity,session,raw,voicePath);if(waiting?.handled)return;}
  if(await handleEnterpriseTextCommand(message,identity,raw))return;
  if(await handleInsightCommand(message,identity,raw))return;
  if(await handleProcurementTextCommand(message,identity,raw))return;
  if(await handleSalesTextCommand(message,identity,raw))return;
  const mechanicActions=[
    {re:/^(بلاغ اصل بدون لوحه|اصل بدون لوحه|عطل معده بدون لوحه)$/,action:'general_fault'},
    {re:/^(فحص معده|فحص معدات|فحص اصل|بدء فحص معده)$/,action:'inspection'},
    {re:/^(طلب قطع غيار|عاوز قطع غيار|اريد قطع غيار)$/,action:'parts'},
    {re:/^(تقرير يومي للورشه|بدء التقرير اليومي|تقرير الميكانيكي اليومي)$/,action:'daily'},
    {re:/^(تحديث امر اصلاح|تحديث طلب اصلاح|تحديث صيانه)$/,action:'update'},
    {re:/^(تشخيص عطل|تسجيل تشخيص)$/,action:'diagnosis'},
    {re:/^(تسجيل ساعات|ساعات عمل)$/,action:'labor'},
    {re:/^(نتيجه اختبار|نتيجة اختبار|اختبار اصل)$/,action:'test'}
  ];
  const mechanicAction=mechanicActions.find(item=>item.re.test(normalized));
  if(mechanicAction)return startMechanicAction(message,identity,mechanicAction.action);
  if(await handleMechanicTextCommand(message,identity,raw))return;
  if(await handleStoredReportTextCommand(message,identity,raw))return;
  if(/^(تقارير|تقرير|ملخص)$/i.test(raw)||/اعرض.*تقارير/.test(raw)){
    if(!allowed(role,'report'))return sendMessage(chatId,'فهمت أنك تطلب التقارير، لكن الإجراء متاح لمدير المصنع ومدير النظام فقط.');
    return sendMessage(chatId,`حاضر ${esc(name)}. اختر التقرير المطلوب:`,reportKeyboard());
  }
  if((group.department==='workshop'||role==='mechanic'||role==='admin'||role==='manager')&&isFaultMessage(raw)){
    if(!allowed(role,'maintenance')&&!allowed(role,'approve'))return sendMessage(chatId,'فهمت أنها رسالة صيانة، لكن دورك لا يسمح بفتح بلاغات الورشة.');
    return createMaintenanceDraft({chatId,messageId:message.message_id,identity,text:raw,plate:extractPlate(raw),voicePath});
  }
  const smart=await interpretMessage({message,group,identity,text:raw,stored});
  if(smart.route.intent==='attendance')return showAttendanceMenu(message,identity);
  if(smart.route.intent==='report'&&allowed(role,'report'))return sendMessage(chatId,`${smart.response}\n\nاختر التقرير المطلوب:`,reportKeyboard());
  if(smart.route.intent==='maintenance'&&(allowed(role,'maintenance')||allowed(role,'approve')))return createMaintenanceDraft({chatId,messageId:message.message_id,identity,text:raw,plate:extractPlate(raw),voicePath});
  return sendMessage(chatId,smart.response);
}

async function handleCallback(update){
  const query=update.callback_query,message=query.message,identity=await ensureTelegramIdentity(query.from),role=identity.role||'pending';
  await answerCallback(query.id);
  if(!identity.active)return sendMessage(message.chat.id,'حسابك غير معتمد لتنفيذ هذا الإجراء.');
  const[action,value]=String(query.data||'').split(':');
  if(action==='home'){
    if(value==='workshop')return showMechanicMenu({...message,from:query.from},identity);
    if(value==='sales')return showSalesMenu({...message,from:query.from},identity);
    if(value==='suppliers')return showProcurementMenu({...message,from:query.from},identity);
    if(value==='attendance')return showAttendanceMenu({...message,from:query.from},identity);
    return showRoleHome({...message,from:query.from},identity);
  }
  if(['att','fuelconfirm','fuelcancel'].includes(action))return handleAttendanceCallback(message,query.from,identity,action,value);
  if(['ent','entopt','entconfirm','entcancel','entstatus'].includes(action))return handleEnterpriseCallback(message,query.from,identity,action,value);
  if(action==='doc')return sendOperationalDocument({...message,from:query.from},identity,value);
  if(action==='gps')return sendGpsFleetStatus(message.chat.id,value==='fleet'?'':value);
  if(action==='reportfile'){const[kind,id]=String(value||'').split('|');return sendStoredReportFile(message.chat.id,id,identity,kind||'daily');}
  if(action==='report'){
    if(value==='concrete_file')return sendStoredReportRequest(message.chat.id,identity,'concrete');
    if(value==='block_file')return sendStoredReportRequest(message.chat.id,identity,'block');
    if(value==='daily_file')return sendStoredReportRequest(message.chat.id,identity,'daily');
    if(!allowed(role,'report'))return sendMessage(message.chat.id,'ليست لديك صلاحية طلب التقرير.');
    return sendReport(message.chat.id,value);
  }
  if(action==='sales'){
    if(value==='new_block')return startGuidedSales({...message,from:query.from},identity,'block');
    if(value==='new_concrete')return startGuidedSales({...message,from:query.from},identity,'concrete');
    return startSalesAction({...message,from:query.from},identity,value);
  }
  if(['gs_item','gs_qty','gs_price','gs_date','gs_pay'].includes(action))return handleGuidedSalesCallback(message,query.from,identity,action,value);
  if(['proc','supplier_city','supplier_rfq','rfq_qty','rfq_urgency'].includes(action))return handleProcurementCallback(message,query.from,identity,action,value);
  if(action==='sales_confirm')return confirmSalesOrder({...message,from:query.from},value,identity);
  if(action==='sales_cancel')return cancelSalesDraft({...message,from:query.from},identity);
  if(action==='mech')return startMechanicAction({...message,from:query.from},identity,value);
  if(['wsselect','wst','wstest','wshandover'].includes(action))return handleWorkshopBotCallback(message,query.from,identity,action,value);
  if(action==='parts_confirm')return confirmSparePartsRequest({...message,from:query.from},value,identity,role);
  if(action==='maint_confirm')return confirmMaintenance({...message,from:query.from},value,identity,role);
  if(action==='maint_cancel')return cancelMaintenance({...message,from:query.from},value,identity);
  if(action==='vehicle')return chooseVehicle(message,value,query.from,identity);
  if(action==='approve'){
    if(!allowed(role,'approve'))return sendMessage(message.chat.id,'الاعتماد متاح للمدير ومدير النظام فقط.');
    const result=await rpc('decide_approval',{p_approval_id:value,p_decision:'approved',p_decided_by:identity.user_id,p_note:'اعتماد من Telegram'});
    return sendMessage(message.chat.id,`تم تسجيل الاعتماد الرسمي.\nالمرجع: <b>${esc(Array.isArray(result)?result[0]?.reference_no||value:value)}</b>`);
  }
  if(action==='reject'){
    if(!allowed(role,'approve'))return sendMessage(message.chat.id,'الرفض متاح للمدير ومدير النظام فقط.');
    await rpc('decide_approval',{p_approval_id:value,p_decision:'rejected',p_decided_by:identity.user_id,p_note:'رفض من Telegram'});
    return sendMessage(message.chat.id,'تم تسجيل الرفض الرسمي.');
  }
}

async function handleMessage(update){
  const message=update.message||update.edited_message;
  if(!message?.from||message.from.is_bot)return;
  const[group,identity]=await Promise.all([ensureTelegramGroup(message.chat),ensureTelegramIdentity(message.from)]),stored=await storeTelegramMessage(update.update_id,message,group,identity),session=await getBotSession(message.chat.id,message.from.id);
  if(message.location){if(await handleAttendanceLocation(message,identity,session))return;return handleText(message,group,identity,`الموقع ${message.location.latitude},${message.location.longitude}`,'',stored);}
  if(message.document){const name=message.document.file_name||'';return /\.(xlsx|xls)$/i.test(name)||/spreadsheet|excel/i.test(message.document.mime_type||'')?handleExcel(message,group,identity,stored):handleAttachment(message,group,identity,stored);}
  if(message.photo?.length){if(await handleAttendancePhoto(message,identity,session))return;return handleAttachment(message,group,identity,stored);}
  if(message.voice){
    await sendMessage(message.chat.id,'تم استلام رسالتك الصوتية، جارٍ فهمها وتنفيذ طلبك...').catch(error=>console.warn('[telegram voice acknowledgement]',{message:String(error?.message||'').slice(0,200)}));
    let downloaded;
    try{downloaded=await downloadTelegramFile(message.voice.file_id);}
    catch(error){console.warn('[telegram voice download]',{message:String(error?.message||'').slice(0,220)});return sendMessage(message.chat.id,'تم استلام الرسالة الصوتية، لكن تعذر تنزيلها من Telegram. أعد إرسال التسجيل مرة واحدة.');}
    const hash=sha256(downloaded.buffer),path=`telegram/${group.department||'unassigned'}/${new Date().toISOString().slice(0,10)}/voice-${hash.slice(0,16)}.ogg`,contentType=message.voice.mime_type||downloaded.contentType;
    const uploadTask=uploadObject(path,downloaded.buffer,contentType).then(()=>true).catch(error=>{console.warn('[telegram voice upload]',{message:String(error?.message||'').slice(0,220)});return false;});
    const [result,uploaded]=await Promise.all([transcribeTelegramVoice(downloaded.buffer,contentType),Promise.race([uploadTask,delay(1200).then(()=>false)])]);
    if(stored?.id){
      const values={transcription:result.text||null,related_entity_type:result.text?'voice_transcribed':`voice_${result.reason||'failed'}`};
      if(uploaded)values.file_path=path;
      await patch('telegram_messages',`id=eq.${stored.id}`,values).catch(error=>console.warn('[telegram voice message patch]',{message:String(error?.message||'').slice(0,220)}));
    }
    if(result.text)await sendMessage(message.chat.id,`تم فهم التسجيل: <b>${esc(result.text).slice(0,500)}</b>\nجارٍ تنفيذ الطلب...`).catch(()=>{});
    return result.text?handleText(message,group,identity,result.text,uploaded?path:'',stored):sendMessage(message.chat.id,voiceFailureMessage(result));
  }
  const text=String(message.text||message.caption||'').trim();
  return handleText(message,group,identity,text,'',stored);
}

export default async function handler(req,res){
  if(!method(req,res,['POST']))return;
  let update;
  if(req.telegramGatewayManaged&&req.body)update=req.body;
  else{
    try{verifyTelegram(req);update=await body(req,2_000_000);}catch(error){return errorResponse(res,error);}
  }
  try{
    if(update.callback_query)await handleCallback(update);
    else if(update.message||update.edited_message)await handleMessage(update);
  }catch(error){
    if(req.telegramGatewayManaged)throw error;
    console.error('[telegram webhook enterprise]',{code:String(error?.code||'PROCESSING_FAILED').slice(0,120),status:Number(error?.status||error?.upstreamStatus||0),message:String(error?.message||'').slice(0,300)});
    return json(res,503,{ok:false,retryable:true,error:'تعذر إكمال معالجة تحديث Telegram مؤقتًا.'});
  }
  if(req.telegramGatewayManaged)return;
  if(!res.headersSent)json(res,200,{ok:true});
}
