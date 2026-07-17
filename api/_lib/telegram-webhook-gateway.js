import { verifyTelegram } from './auth.js';
import { json, method, body, errorResponse } from './http.js';
import { sendMessage, answerCallback } from './telegram.js';
import { ensureTelegramGroup, ensureTelegramIdentity, storeTelegramMessage } from './bot-webhook-core.js';
import { getBotSession, clearMaintenanceSession } from './bot-maintenance.js';
import { showProcurementMenu, continueProcurementSession, handleProcurementCallback, handleProcurementTextCommand } from './bot-procurement-secure.js';
import { showSalesMenu, startSalesAction, continueSalesSession, confirmSalesOrder, cancelSalesDraft, handleSalesTextCommand, startGuidedSales, continueGuidedSales, handleGuidedSalesCallback } from './bot-sales-secure.js';
import { showMechanicMenu, startMechanicAction, continueMechanicSession, confirmSparePartsRequest, handleMechanicTextCommand } from './bot-mechanic-secure.js';
import { showAttendanceMenu, continueAttendanceSession, handleAttendanceLocation, handleAttendancePhoto, handleAttendanceCallback } from './bot-attendance-secure.js';
import { sendGpsFleetStatus } from './bot-gps.js';
import { continueRegistrationSession, handleRegistrationCallback, handleRegistrationTextCommand, isRegistrationCommand } from './bot-registration.js';
import enterpriseHandler from './telegram-webhook-handler.js';

const GPS_ROLES=new Set(['admin','manager','mechanic','driver','fuel_operator']);
const PROCUREMENT_CREATE=new Set(['admin','manager','mechanic','procurement','warehouse']);
const SALES_CREATE=new Set(['admin','block_sales','concrete_sales']);
const SALES_UPDATE=new Set(['admin','manager','block_sales','concrete_sales']);
const WORKSHOP_OPERATE=new Set(['admin','mechanic']);
const ATTENDANCE_ROLES=new Set(['admin','manager','hr','driver','employee','mechanic','accountant','block_sales','concrete_sales','collector','warehouse','fuel_operator','procurement','quality']);
const DRIVER_ROLES=new Set(['admin','manager','driver','mechanic','fuel_operator']);
const norm=value=>String(value||'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/[؟?!.,،؛:]+/g,'').replace(/\s+/g,' ').trim();
const procurementActions=new Set(['proc','supplier_city','supplier_rfq','rfq_qty','rfq_urgency']);
const guidedSalesActions=new Set(['gs_item','gs_qty','gs_price','gs_date','gs_pay']);
const procurementText=/^(بحث مورد|بحث عن مورد|بحث عن قطعه|بحث عن قطعة|ابحث عن قطعه|ابحث عن قطعة|قائمه الموردين|قائمة الموردين|طلب عرض سعر|طلب اسعار|طلب أسعار|طلبات الاسعار المفتوحه|طلبات الأسعار المفتوحة)$/;
const salesText=/^(قائمه المبيعات|قائمة المبيعات|اوامر البيع|أوامر البيع|امر بيع جديد|أمر بيع جديد|تحديث امر بيع|تحديث أمر بيع|طلبات البيع المفتوحه|طلبات البيع المفتوحة|حاله المبيعات|حالة المبيعات)$/;
const mechanicText=/^(قائمه الورشه|قائمة الورشة|تقرير يومي للورشه|تقرير يومي للورشة|فحص معده|فحص معدات|طلب قطع غيار|اصل بدون لوحه|أصل بدون لوحة|تحديث امر اصلاح|تحديث أمر إصلاح|سجل الورشه|سجل الورشة|مهام الورشه|مهام الورشة|طلبات التسعير)$/;
const attendanceText=/^(الحضور والمواقع|تسجيل حضور|تسجيل انصراف|قائمه الحضور|قائمة الحضور|لوحه السائق|لوحة السائق)$/;
const gpsText=/^(حاله gps|حالة gps|حاله الاسطول|حالة الأسطول|موقع السيارات|السيارات الان|السيارات الآن)$/;
const roleType=role=>role==='block_sales'?'block':role==='concrete_sales'?'concrete':'';

function sensitiveSession(session){const state=String(session?.state||'');return /^(supplier_|rfq_|sales_|guided_sales_|mechanic_|driver_|attendance_)/.test(state);}
function sessionAllowed(identity,session){
  if(!identity?.active)return false;
  const state=String(session?.state||''),role=identity.role||'';
  if(state.startsWith('supplier_')||state.startsWith('rfq_'))return PROCUREMENT_CREATE.has(role);
  if(state==='sales_update_order')return SALES_UPDATE.has(role);
  if(state.startsWith('sales_')||state.startsWith('guided_sales_')){const own=roleType(role),type=session?.context?.salesType||session?.context?.draft?.sales_type||'';return SALES_CREATE.has(role)&&(!own||!type||own===type);}
  if(state.startsWith('mechanic_'))return WORKSHOP_OPERATE.has(role);
  if(state.startsWith('driver_'))return DRIVER_ROLES.has(role);
  if(state.startsWith('attendance_'))return ATTENDANCE_ROLES.has(role);
  return true;
}
async function rejectSession(message,identity){await clearMaintenanceSession(message.chat.id,identity?.external_id||message.from?.id).catch(()=>{});await sendMessage(message.chat.id,'تم إيقاف الجلسة لأن صلاحيتك الحالية لا تسمح بإكمال العملية.');return true;}
async function logIntercepted(update,message,identity){const group=await ensureTelegramGroup(message.chat);await storeTelegramMessage(update.update_id,message,group,identity);if(['group','supergroup'].includes(message.chat.type)&&!group.active){await sendMessage(message.chat.id,'المجموعة لم تعتمد بعد.');return false;}return true;}

async function interceptCallback(update){
  const query=update.callback_query,message=query?.message;if(!query||!message)return false;
  const [action,value]=String(query.data||'').split(':'),home=action==='home';
  if(action==='reg'){
    const identity=await ensureTelegramIdentity(query.from);await answerCallback(query.id);
    if(message.chat.type!=='private'){await sendMessage(message.chat.id,'تسجيل الموظف يتم من المحادثة الخاصة مع البوت.');return true;}
    await handleRegistrationCallback(message,query.from,identity,value);return true;
  }
  const handledHome=home&&['suppliers','sales','workshop','attendance'].includes(value);
  const handled=handledHome||procurementActions.has(action)||action==='gps'||action==='sales'||guidedSalesActions.has(action)||['sales_confirm','sales_cancel','mech','parts_confirm','att','fuelconfirm','fuelcancel'].includes(action);
  if(!handled)return false;
  const identity=await ensureTelegramIdentity(query.from),role=identity.role||'pending';await answerCallback(query.id);
  if(!identity.active){await sendMessage(message.chat.id,'حسابك غير معتمد لتنفيذ هذا الإجراء.');return true;}
  const callbackMessage={...message,from:query.from};
  if(home&&value==='suppliers'){await showProcurementMenu(callbackMessage,identity);return true;}
  if(home&&value==='sales'){await showSalesMenu(callbackMessage,identity);return true;}
  if(home&&value==='workshop'){await showMechanicMenu(callbackMessage,identity);return true;}
  if(home&&value==='attendance'){await showAttendanceMenu(callbackMessage,identity);return true;}
  if(procurementActions.has(action)){await handleProcurementCallback(message,query.from,identity,action,value);return true;}
  if(action==='gps'){if(!GPS_ROLES.has(role))await sendMessage(message.chat.id,'ليست لديك صلاحية عرض GPS.');else await sendGpsFleetStatus(message.chat.id,value==='fleet'?'':value,identity);return true;}
  if(action==='sales'){
    if(value==='new_block')await startGuidedSales(callbackMessage,identity,'block');else if(value==='new_concrete')await startGuidedSales(callbackMessage,identity,'concrete');else await startSalesAction(callbackMessage,identity,value);return true;
  }
  if(guidedSalesActions.has(action)){await handleGuidedSalesCallback(message,query.from,identity,action,value);return true;}
  if(action==='sales_confirm'){await confirmSalesOrder(callbackMessage,value,identity);return true;}
  if(action==='sales_cancel'){await cancelSalesDraft(callbackMessage,identity);return true;}
  if(action==='mech'){await startMechanicAction(callbackMessage,identity,value);return true;}
  if(action==='parts_confirm'){await confirmSparePartsRequest(callbackMessage,value,identity,role);return true;}
  if(['att','fuelconfirm','fuelcancel'].includes(action)){await handleAttendanceCallback(message,query.from,identity,action,value);return true;}
  return false;
}

async function interceptMessage(update){
  const message=update.message||update.edited_message;if(!message?.from||message.from.is_bot)return false;
  const identity=await ensureTelegramIdentity(message.from),session=await getBotSession(message.chat.id,message.from.id),state=String(session?.state||'');
  if(sensitiveSession(session)&&!sessionAllowed(identity,session)){if(!await logIntercepted(update,message,identity))return true;return rejectSession(message,identity);}
  if(message.location&&(state.startsWith('driver_')||state.startsWith('attendance_')||message.location.live_period||message.edit_date)){if(!await logIntercepted(update,message,identity))return true;await handleAttendanceLocation(message,identity,session);return true;}
  if(message.photo?.length&&state==='driver_fuel_photo'){if(!await logIntercepted(update,message,identity))return true;await handleAttendancePhoto(message,identity,session);return true;}
  if(message.voice||message.document||message.photo?.length)return false;
  const raw=String(message.text||message.caption||'').trim(),normalized=norm(raw),registrationSession=state.startsWith('registration_')&&state!=='registration_submitted',registrationCommand=isRegistrationCommand(raw)||/^(الوظائف|الوظائف المتاحه|الوظائف المتاحة|حاله التسجيل|حالة التسجيل|حاله طلبي|حالة طلبي)$/.test(normalized);
  if(registrationSession||registrationCommand){
    if(message.chat.type!=='private'){await sendMessage(message.chat.id,'تسجيل الموظف يتم من المحادثة الخاصة مع البوت.');return true;}
    if(!await logIntercepted(update,message,identity))return true;
    if(registrationSession&&await continueRegistrationSession(message,identity,session,raw))return true;
    if(await handleRegistrationTextCommand(message,identity,raw))return true;
  }
  const procurementSession=state.startsWith('supplier_')||state.startsWith('rfq_'),salesSession=state.startsWith('sales_')||state.startsWith('guided_sales_'),mechanicSession=state.startsWith('mechanic_'),attendanceSession=state.startsWith('driver_')||state.startsWith('attendance_');
  const procurementCommand=/^\/suppliers(?:@\w+)?$/i.test(raw)||procurementText.test(normalized),salesCommand=/^\/sales(?:@\w+)?$/i.test(raw)||salesText.test(normalized),mechanicCommand=/^\/workshop(?:@\w+)?$/i.test(raw)||mechanicText.test(normalized),attendanceCommand=/^\/attendance(?:@\w+)?$/i.test(raw)||attendanceText.test(normalized),gpsCommand=/^\/gps(?:@\w+)?$/i.test(raw)||gpsText.test(normalized);
  if(!procurementSession&&!salesSession&&!mechanicSession&&!attendanceSession&&!procurementCommand&&!salesCommand&&!mechanicCommand&&!attendanceCommand&&!gpsCommand)return false;
  if(!await logIntercepted(update,message,identity))return true;
  if(!identity.active){await sendMessage(message.chat.id,'حسابك غير معتمد لتنفيذ هذا الإجراء.');return true;}
  if(gpsCommand){await sendGpsFleetStatus(message.chat.id,'',identity);return true;}
  if(attendanceSession){if(await continueAttendanceSession(message,identity,session,raw))return true;}
  if(salesSession){if(state.startsWith('guided_sales_')){if(await continueGuidedSales(message,identity,session,raw))return true;}else if(await continueSalesSession(message,identity,session,raw))return true;}
  if(mechanicSession){if(await continueMechanicSession(message,identity,session,raw))return true;}
  if(procurementSession){if(await continueProcurementSession(message,identity,session,raw))return true;}
  if(attendanceCommand){await showAttendanceMenu(message,identity);return true;}
  if(/^\/sales(?:@\w+)?$/i.test(raw)){await showSalesMenu(message,identity);return true;}
  if(/^\/workshop(?:@\w+)?$/i.test(raw)){await showMechanicMenu(message,identity);return true;}
  if(/^\/suppliers(?:@\w+)?$/i.test(raw)){await showProcurementMenu(message,identity);return true;}
  if(await handleSalesTextCommand(message,identity,raw))return true;
  if(await handleMechanicTextCommand(message,identity,raw))return true;
  if(await handleProcurementTextCommand(message,identity,raw))return true;
  return false;
}

export default async function handler(req,res){
  if(!method(req,res,['POST']))return;
  let update;try{verifyTelegram(req);update=await body(req,2_000_000);}catch(error){return errorResponse(res,error);}
  try{
    if(update.callback_query&&await interceptCallback(update))return json(res,200,{ok:true,gateway:true});
    if((update.message||update.edited_message)&&await interceptMessage(update))return json(res,200,{ok:true,gateway:true});
    req.body=update;return enterpriseHandler(req,res);
  }catch(error){console.error('[telegram webhook gateway]',error);return json(res,200,{ok:true,error_logged:true});}
}
