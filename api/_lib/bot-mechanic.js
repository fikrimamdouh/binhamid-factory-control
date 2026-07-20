import { insert, select } from './supabase.js';
import { sendMessage, keyboard } from './telegram.js';
import { displayName } from './bot-profile.js';
import { clearMaintenanceSession, createGenericMaintenanceDraft } from './bot-maintenance.js';
import { allowedWorkshopTransitions, workshopStatusLabel } from './workshop-state-machine.js';
import {
  addTelegramDiagnostic,addTelegramLabor,addTelegramPartRequest,addTelegramWorkshopNote,getWorkshopOrder,
  listTelegramPartRequests,listTelegramWorkshopOrders,submitTelegramWorkshopDailyReport,telegramWorkshopSummary,
  transitionWorkshopOrder
} from './workshop-telegram-service.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const now=()=>new Date().toISOString();
const normalize=value=>String(value||'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/[؟?!.,،؛:]+/g,'').replace(/\s+/g,' ').trim();
const OPEN_STATUSES=['reported','triage','inspection','diagnosed','quotation_required','parts_waiting','approval_pending','approved','in_repair','testing','ready_for_handover','completed','on_hold','external_repair'];
const MANAGE_ROLES=new Set(['admin','manager']);
const OPERATE_ROLES=new Set(['admin','manager','mechanic']);
const VIEW_ROLES=new Set(['admin','manager','mechanic','accountant','procurement','warehouse']);
const ACTION_LABELS={update:'إضافة تحديث',diagnosis:'تسجيل تشخيص',labor:'تسجيل ساعات',parts:'طلب قطعة',test:'نتيجة اختبار',handover:'استلام الأصل',transition:'تغيير الحالة'};

function externalUserId(identity,message){return identity?.external_id||message?.from?.id;}
function requestId(kind,message,id=''){return`tg:${kind}:${message.chat.id}:${message.message_id}:${id}`.slice(0,180);}
async function setSession(chatId,userId,state,context={}){
  const old=(await select('bot_sessions',`channel=eq.telegram&chat_id=eq.${encodeURIComponent(String(chatId))}&external_user_id=eq.${encodeURIComponent(String(userId))}&select=context&limit=1`))?.[0],aiHistory=old?.context?.aiHistory||[];
  const rows=await insert('bot_sessions',[{channel:'telegram',chat_id:String(chatId),external_user_id:String(userId),state,context:{aiHistory,...context},updated_at:now()}],{query:'on_conflict=channel,chat_id,external_user_id',prefer:'resolution=merge-duplicates,return=representation'});
  return rows?.[0];
}
function orderText(order){return`${order.reference_no} — ${order.plate_snapshot||order.asset_external_id||'أصل'} — ${workshopStatusLabel(order.status)}`;}
function orderRows(action,orders){return orders.slice(0,12).map(order=>[{text:orderText(order).slice(0,60),callback_data:`wsselect:${action}|${order.id}`}]);}
function transitionRows(order,role){
  let targets=allowedWorkshopTransitions(order.status);
  if(!MANAGE_ROLES.has(role))targets=targets.filter(status=>!['approved','closed'].includes(status)&&!(order.status==='closed'&&status==='in_repair'));
  return targets.map(status=>[{text:workshopStatusLabel(status),callback_data:`wst:${status}|${order.id}`}]);
}
function parseHours(text){
  const raw=String(text||'').trim(),match=raw.match(/[0-9٠-٩]+(?:[.,][0-9٠-٩]+)?/),hours=Number(String(match?.[0]||'0').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(',','.'))||0,rest=raw.replace(match?.[0]||'','').replace(/^[\s|،,:-]+/,'').trim();
  const [workType,...notes]=rest.split(/[|]/).map(item=>item.trim());
  return{hours,workType:workType||'عمل صيانة',notes:notes.join(' | ')};
}
function parsePart(text){
  const raw=String(text||'').trim(),match=raw.match(/[0-9٠-٩]+(?:[.,][0-9٠-٩]+)?/),quantity=Number(String(match?.[0]||'0').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(',','.'))||0,rest=raw.replace(match?.[0]||'','').replace(/^[\s|،,:-]+/,'').trim(),segments=rest.split('|').map(item=>item.trim()).filter(Boolean),urgency=/حرج|فوري/.test(normalize(raw))?'critical':/عاجل|ضروري/.test(normalize(raw))?'urgent':'normal';
  return{quantity,itemName:segments[0]||rest,unit:segments[1]||'',urgency};
}

export function mechanicMenu(role='mechanic'){
  const rows=[
    [{text:'📝 التقرير اليومي',callback_data:'mech:daily'},{text:'🔍 فحص أصل',callback_data:'mech:inspection'}],
    [{text:'🩺 تسجيل تشخيص',callback_data:'mech:diagnosis'},{text:'⏱ تسجيل ساعات',callback_data:'mech:labor'}],
    [{text:'🧰 طلب قطع غيار',callback_data:'mech:parts'},{text:'📌 إضافة تحديث',callback_data:'mech:update'}],
    [{text:'🧪 نتيجة اختبار',callback_data:'mech:test'},{text:'📋 المهام المفتوحة',callback_data:'mech:tasks'}],
    [{text:'📊 ملخص الورشة',callback_data:'mech:summary'},{text:'💰 طلبات القطع',callback_data:'mech:price_requests'}]
  ];
  if(MANAGE_ROLES.has(role))rows.splice(4,0,[{text:'🤝 استلام وإغلاق',callback_data:'mech:handover'},{text:'🔄 تغيير الحالة',callback_data:'mech:transition'}]);
  return keyboard(rows);
}

export async function showMechanicMenu(message,identity){
  const role=identity?.role||'pending';
  if(!VIEW_ROLES.has(role))return sendMessage(message.chat.id,'هذه القائمة مخصصة للورشة والإدارة والمحاسب والمخزن والمشتريات.');
  const name=displayName(identity,message.from),intro=OPERATE_ROLES.has(role)?`مرحبًا ${esc(name)}. اختر عملية الورشة:`:`مرحبًا ${esc(name)}. صلاحيتك الحالية للعرض والمتابعة:`;
  return sendMessage(message.chat.id,intro,mechanicMenu(role));
}

async function chooseOpenOrder(message,identity,action){
  const role=identity?.role||'pending';
  if(!OPERATE_ROLES.has(role)&&!['tasks','price_requests'].includes(action))return sendMessage(message.chat.id,'ليست لديك صلاحية تنفيذ عمليات الورشة.');
  let orders=await listTelegramWorkshopOrders(identity,{limit:30,mine:role==='mechanic'});
  orders=orders.filter(order=>OPEN_STATUSES.includes(order.status));
  if(action==='test')orders=orders.filter(order=>order.status==='testing');
  if(action==='handover')orders=orders.filter(order=>['ready_for_handover','completed'].includes(order.status));
  if(action==='diagnosis')orders=orders.filter(order=>['reported','triage','inspection','on_hold'].includes(order.status));
  if(!orders.length)return sendMessage(message.chat.id,`لا توجد أوامر مناسبة لعملية «${esc(ACTION_LABELS[action]||action)}».`);
  return sendMessage(message.chat.id,`اختر أمر الصيانة لتنفيذ «${esc(ACTION_LABELS[action]||action)}»:`,keyboard(orderRows(action,orders)));
}

export async function startMechanicAction(message,identity,action){
  const role=identity?.role||'pending',chatId=message.chat.id,userId=externalUserId(identity,message);
  if(action==='tasks')return sendOpenWorkshopTasks(chatId,identity);
  if(action==='summary')return sendWorkshopSummary(chatId);
  if(action==='price_requests')return sendPriceRequests(chatId);
  if(!OPERATE_ROLES.has(role))return sendMessage(chatId,'تسجيل أعمال الورشة متاح للميكانيكي والمشرف ومدير النظام فقط.');
  if(action==='daily'){
    await setSession(chatId,userId,'workshop_daily_report',{startedAt:now()});
    return sendMessage(chatId,'أرسل التقرير اليومي بهذا الترتيب:\n\nالأصول التي تم العمل عليها:\nالأعمال التي تم تنفيذها:\nساعات العمل:\nالأوامر التي اكتملت:\nالأوامر المفتوحة:\nقطع الغيار المطلوبة:\nالأعمال الوقائية:\nمخاطر السلامة:\nخطة الغد:\n\nسيُحفظ كتقرير منظم، وليس نصًا داخل سجل التدقيق.');
  }
  if(action==='inspection'){
    await setSession(chatId,userId,'workshop_inspection',{startedAt:now()});
    return sendMessage(chatId,'اكتب اسم أو رقم الأصل ثم نتيجة الفحص. عند وجود عطل ستظهر لك قائمة الأصول لتأكيد الأصل قبل فتح مسودة أمر.');
  }
  if(action==='general_fault'){
    await setSession(chatId,userId,'workshop_general_fault',{startedAt:now()});
    return sendMessage(chatId,'اكتب اسم الأصل المسجل ووصف العطل. لن يُفتح أمر لأصل نصي غير موجود في سجل الأصول.');
  }
  return chooseOpenOrder(message,identity,action);
}

async function saveDailyReport(message,identity,text){
  const report=await submitTelegramWorkshopDailyReport({message,identity,text});
  await clearMaintenanceSession(message.chat.id,externalUserId(identity,message));
  return sendMessage(message.chat.id,`تم حفظ التقرير اليومي المنظم.\nالمرجع: <b>${esc(report?.reference_no||'محفوظ')}</b>\nساعات العمل: <b>${Number(report?.total_hours||0)}</b>`);
}
async function saveInspection(message,identity,text){
  const issue=/عطل|تسريب|صوت|كسر|حرار|متوقف|تغيير|يحتاج|مطلوب|خطر/.test(normalize(text));
  await clearMaintenanceSession(message.chat.id,externalUserId(identity,message));
  if(issue)return createGenericMaintenanceDraft({chatId:message.chat.id,messageId:message.message_id,identity,text,voicePath:'',target:String(text).split(/[—\-:\n]/)[0],kind:'inspection_issue'});
  return sendMessage(message.chat.id,'لم يكتشف النص عطلًا يحتاج أمر إصلاح. لم يتم تغيير حالة أي أمر. استخدم نموذج قائمة الفحص عند تفعيله لتسجيل الفحص الدوري.');
}
async function saveGeneralFault(message,identity,text){
  await clearMaintenanceSession(message.chat.id,externalUserId(identity,message));
  return createGenericMaintenanceDraft({chatId:message.chat.id,messageId:message.message_id,identity,text,voicePath:'',target:String(text).split(/[—\-:\n]/)[0],kind:'general_asset'});
}
async function saveNote(message,identity,session,text){
  const result=await addTelegramWorkshopNote({message,identity,maintenanceId:session.context.maintenanceId,note:text}),order=await getWorkshopOrder(session.context.maintenanceId);
  await clearMaintenanceSession(message.chat.id,externalUserId(identity,message));
  const rows=transitionRows(order,identity.role||'pending');
  return sendMessage(message.chat.id,`تم حفظ التحديث على <b>${esc(result.referenceNo)}</b> دون تغيير الحالة تلقائيًا.\nالحالة الحالية: <b>${esc(workshopStatusLabel(order.status))}</b>${rows.length?'\nاختر انتقالًا رسميًا عند الحاجة:':''}`,rows.length?keyboard(rows):{});
}
async function saveDiagnosis(message,identity,session,text){
  await addTelegramDiagnostic({message,identity,maintenanceId:session.context.maintenanceId,text});
  const order=await getWorkshopOrder(session.context.maintenanceId);await clearMaintenanceSession(message.chat.id,externalUserId(identity,message));
  const button=allowedWorkshopTransitions(order.status).includes('diagnosed')?keyboard([[{text:'تأكيد: تم التشخيص',callback_data:`wst:diagnosed|${order.id}`}]]):{};
  return sendMessage(message.chat.id,`تم حفظ التشخيص على <b>${esc(order.reference_no)}</b>. لم تتغير الحالة قبل التأكيد.`,button);
}
async function saveLabor(message,identity,session,text){
  const parsed=parseHours(text);if(parsed.hours<=0)return sendMessage(message.chat.id,'اكتب عدد الساعات ثم نوع العمل. مثال: 2 | تغيير طرمبة المياه | تم الاختبار');
  await addTelegramLabor({message,identity,maintenanceId:session.context.maintenanceId,...parsed});
  await clearMaintenanceSession(message.chat.id,externalUserId(identity,message));
  return sendMessage(message.chat.id,`تم تسجيل <b>${parsed.hours}</b> ساعة عمل دون تغيير حالة الأمر.`);
}
async function savePart(message,identity,session,text){
  const parsed=parsePart(text);if(parsed.quantity<=0||!parsed.itemName)return sendMessage(message.chat.id,'اكتب الكمية ثم اسم القطعة. مثال: 2 | فلتر زيت | حبة | عاجل');
  const row=await addTelegramPartRequest({message,identity,maintenanceId:session.context.maintenanceId,...parsed});
  await clearMaintenanceSession(message.chat.id,externalUserId(identity,message));
  return sendMessage(message.chat.id,`تم تسجيل طلب القطعة: <b>${esc(row?.item_name||parsed.itemName)}</b> — الكمية <b>${parsed.quantity}</b>. الطلب مرتبط بأمر الإصلاح.`);
}
async function saveTestText(message,identity,session,text){
  await setSession(message.chat.id,externalUserId(identity,message),'workshop_test_confirm',{...session.context,testResult:String(text).slice(0,2000),startedAt:now()});
  return sendMessage(message.chat.id,'اختر نتيجة الاختبار. النص اقتراح وتوثيق فقط، والزر هو الذي يغيّر الحالة:',keyboard([[{text:'الاختبار ناجح',callback_data:`wstest:pass|${session.context.maintenanceId}`},{text:'الاختبار فشل',callback_data:`wstest:fail|${session.context.maintenanceId}`}]]));
}

export async function continueMechanicSession(message,identity,session,text){
  const userId=externalUserId(identity,message),t=String(text||'').trim();
  if(/^(الغاء|إلغاء|الغي|الغى|تراجع|cancel)$/i.test(t)){await clearMaintenanceSession(message.chat.id,userId);await sendMessage(message.chat.id,'تم إلغاء العملية الحالية.');return true;}
  if(session.state==='workshop_daily_report'||session.state==='mechanic_daily_report'){await saveDailyReport(message,identity,t);return true;}
  if(session.state==='workshop_inspection'||session.state==='mechanic_inspection'){await saveInspection(message,identity,t);return true;}
  if(session.state==='workshop_general_fault'||session.state==='mechanic_general_fault'){await saveGeneralFault(message,identity,t);return true;}
  if(session.state==='workshop_note'||session.state==='mechanic_order_update'){await saveNote(message,identity,session,t);return true;}
  if(session.state==='workshop_diagnosis'){await saveDiagnosis(message,identity,session,t);return true;}
  if(session.state==='workshop_labor'){await saveLabor(message,identity,session,t);return true;}
  if(session.state==='workshop_part'||session.state==='mechanic_spare_parts'){await savePart(message,identity,session,t);return true;}
  if(session.state==='workshop_test'){await saveTestText(message,identity,session,t);return true;}
  return false;
}

export async function handleWorkshopBotCallback(message,from,identity,action,value){
  const role=identity.role||'pending',chatId=message.chat.id,userId=identity.external_id||from.id;
  if(action==='wsselect'){
    const[operation,id]=String(value||'').split('|'),order=await getWorkshopOrder(id);
    if(!order)return sendMessage(chatId,'أمر الصيانة غير موجود.');
    if(operation==='handover')return sendMessage(chatId,`اختر إجراء الاستلام للأمر <b>${esc(order.reference_no)}</b>:`,keyboard([[{text:'تأكيد استلام الأصل',callback_data:`wshandover:accept|${id}`}]]));
    if(operation==='transition')return sendMessage(chatId,`الحالة الحالية: <b>${esc(workshopStatusLabel(order.status))}</b>\nاختر الحالة الجديدة:`,keyboard(transitionRows(order,role)));
    const state={update:'workshop_note',diagnosis:'workshop_diagnosis',labor:'workshop_labor',parts:'workshop_part',test:'workshop_test'}[operation];
    if(!state)return sendMessage(chatId,'العملية غير معروفة.');
    await setSession(chatId,userId,state,{maintenanceId:id,referenceNo:order.reference_no,startedAt:now()});
    const prompt={update:'اكتب التحديث. لن تتغير الحالة من النص.',diagnosis:'اكتب التشخيص والسبب والإجراء المقترح.',labor:'اكتب: عدد الساعات | نوع العمل | الملاحظات',parts:'اكتب: الكمية | اسم القطعة | الوحدة | درجة الاستعجال',test:'اكتب نتيجة الاختبار وملاحظاته، ثم أكد النجاح أو الفشل من الأزرار.'}[operation];
    return sendMessage(chatId,`الأمر: <b>${esc(order.reference_no)}</b>\n${prompt}`);
  }
  if(action==='wst'){
    const[targetStatus,id]=String(value||'').split('|'),session=(await select('bot_sessions',`channel=eq.telegram&chat_id=eq.${encodeURIComponent(String(chatId))}&external_user_id=eq.${encodeURIComponent(String(userId))}&select=context&limit=1`))?.[0],note=session?.context?.lastNote||`تغيير الحالة من Telegram إلى ${targetStatus}`;
    try{
      const order=await transitionWorkshopOrder({maintenanceId:id,targetStatus,sourceChannel:'telegram',note,reason:'telegram_button',requestId:requestId(`transition-${targetStatus}`,message,id)},identity);
      await clearMaintenanceSession(chatId,userId);
      return sendMessage(chatId,`تم تحديث <b>${esc(order.reference_no)}</b> إلى <b>${esc(workshopStatusLabel(order.status))}</b>.`);
    }catch(error){return sendMessage(chatId,`تعذر تغيير الحالة: ${esc(error.message||'انتقال غير مسموح')}`);}
  }
  if(action==='wstest'){
    const[decision,id]=String(value||'').split('|'),session=(await select('bot_sessions',`channel=eq.telegram&chat_id=eq.${encodeURIComponent(String(chatId))}&external_user_id=eq.${encodeURIComponent(String(userId))}&select=context&limit=1`))?.[0],passed=decision==='pass',targetStatus=passed?'ready_for_handover':'in_repair';
    try{
      const order=await transitionWorkshopOrder({maintenanceId:id,targetStatus,sourceChannel:'telegram',note:session?.context?.testResult||'نتيجة اختبار من Telegram',reason:passed?'test_passed':'test_failed',requestId:requestId(`test-${decision}`,message,id),patch:{testPassed:passed,testResult:session?.context?.testResult||decision}},identity);
      await clearMaintenanceSession(chatId,userId);
      return sendMessage(chatId,passed?`تم تسجيل نجاح الاختبار. الأمر <b>${esc(order.reference_no)}</b> جاهز للتسليم.`:`تم تسجيل فشل الاختبار وإعادة الأمر <b>${esc(order.reference_no)}</b> للإصلاح.`);
    }catch(error){return sendMessage(chatId,`تعذر تسجيل نتيجة الاختبار: ${esc(error.message)}`);}
  }
  if(action==='wshandover'){
    if(!MANAGE_ROLES.has(role))return sendMessage(chatId,'تأكيد الاستلام والإغلاق مخصص للمدير أو المشرف.');
    const[decision,id]=String(value||'').split('|');if(decision!=='accept')return sendMessage(chatId,'قرار الاستلام غير صحيح.');
    try{
      let order=await getWorkshopOrder(id);
      if(order.status==='ready_for_handover')order=await transitionWorkshopOrder({maintenanceId:id,targetStatus:'completed',sourceChannel:'telegram',note:'تم قبول استلام الأصل',reason:'handover_accepted',requestId:requestId('handover-completed',message,id),patch:{handoverStatus:'accepted'}},identity);
      if(order.status==='completed')return sendMessage(chatId,`تم تسجيل استلام الأصل للأمر <b>${esc(order.reference_no)}</b>. الإغلاق النهائي يحتاج تأكيدًا مستقلًا:`,keyboard([[{text:'إغلاق الأمر نهائيًا',callback_data:`wst:closed|${id}`}]]));
      return sendMessage(chatId,`الحالة الحالية لا تسمح بالاستلام: ${esc(workshopStatusLabel(order.status))}`);
    }catch(error){return sendMessage(chatId,`تعذر تسجيل الاستلام: ${esc(error.message)}`);}
  }
  return false;
}

export async function handleMechanicTextCommand(message,identity,text){
  const raw=String(text||'').trim(),t=normalize(raw),role=identity?.role||'pending';
  if(/^\/workshop(?:@\w+)?$/i.test(raw)||/^(قائمه الورشه|قائمة الورشة|موظف الورشه|موظف الورشة|مهام الميكانيكي|الورشه|الورشة)$/.test(t)){await showMechanicMenu(message,identity);return true;}
  if(/^(سجل الورشه اليوم|سجل الورشة اليوم|تقرير الميكانيكي اليوم|ملخص الورشه اليوم|ملخص الورشة اليوم)$/.test(t)){if(!VIEW_ROLES.has(role))return sendMessage(message.chat.id,'ليست لديك صلاحية عرض سجل الورشة.').then(()=>true);await sendWorkshopSummary(message.chat.id);return true;}
  if(/^(طلبات قطع الغيار|طلبات التسعير|قطع الغيار المطلوبه|قطع الغيار المطلوبة)$/.test(t)){if(!VIEW_ROLES.has(role))return sendMessage(message.chat.id,'ليست لديك صلاحية عرض طلبات القطع.').then(()=>true);await sendPriceRequests(message.chat.id);return true;}
  if(OPERATE_ROLES.has(role)&&/^(طلب قطع غيار|عاوز قطع غيار|اريد قطع غيار|أريد قطع غيار)$/.test(t)){await startMechanicAction(message,identity,'parts');return true;}
  if(OPERATE_ROLES.has(role)&&/^(تقرير يومي للورشه|تقرير يومي للورشة|بدء التقرير اليومي)$/.test(t)){await startMechanicAction(message,identity,'daily');return true;}
  return false;
}

export async function sendOpenWorkshopTasks(chatId,identity={}){
  const rows=(await listTelegramWorkshopOrders(identity,{limit:20,mine:identity.role==='mechanic'})).filter(row=>OPEN_STATUSES.includes(row.status));
  if(!rows.length)return sendMessage(chatId,'لا توجد مهام ورشة مفتوحة حاليًا.');
  const body=rows.map((row,index)=>`${index+1}. <b>${esc(row.reference_no)}</b> — ${esc(row.plate_snapshot||row.asset_external_id)}\nالحالة: ${esc(workshopStatusLabel(row.status))} | الأولوية: ${esc(row.priority)}\n${esc(String(row.problem||'').slice(0,140))}`).join('\n\n');
  return sendMessage(chatId,`<b>مهام الورشة المفتوحة</b>\n\n${body}`);
}
export async function sendPriceRequests(chatId){
  const rows=await listTelegramPartRequests(20);if(!rows.length)return sendMessage(chatId,'لا توجد طلبات قطع غيار مفتوحة.');
  const body=rows.map((row,index)=>`${index+1}. <b>${esc(row.item_name)}</b> — ${Number(row.quantity_requested||0)} ${esc(row.unit||'')}\nالحالة: ${esc(row.status)} | الاستعجال: ${esc(row.urgency)}\nأمر الصيانة: <code>${esc(row.maintenance_id)}</code>`).join('\n\n');
  return sendMessage(chatId,`<b>طلبات قطع الغيار المرتبطة بأوامر الصيانة</b>\n\n${body}`);
}
export async function sendWorkshopSummary(chatId){
  const data=await telegramWorkshopSummary();
  return sendMessage(chatId,`<b>ملخص الورشة اليوم</b>\n\nالتقارير المنظمة: <b>${data.dailyReports}</b>\nساعات العمل المسجلة: <b>${data.totalHours}</b>\nأوامر اليوم: <b>${data.ordersToday}</b>\nالأصول المتوقفة: <b>${data.stopped}</b>\nالحالات العاجلة: <b>${data.urgent}</b>\nالأوامر المفتوحة: <b>${data.open}</b>\nدون تحديث أكثر من 24 ساعة: <b>${data.stale}</b>\nطلبات قطع مفتوحة: <b>${data.partsWaiting}</b>`);
}
export async function confirmSparePartsRequest(message){return sendMessage(message.chat.id,'انتهى مسار طلب القطع العام. طلب القطعة يجب أن يكون مرتبطًا بأمر إصلاح من قائمة الورشة.');}
