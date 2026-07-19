import { config } from './config.js';
import { insert, select } from './supabase.js';
import { sendMessage, keyboard } from './telegram.js';
import { displayName, roleLabel } from './bot-profile.js';
import { clearMaintenanceSession } from './bot-maintenance.js';
import { SIMPLE_DEFS, optionsKeyboard, statusKeyboard } from './bot-enterprise-defs.js';
import { canFinance, esc, getEnterpriseSession, nextEnterpriseReference, numberFrom, setEnterpriseSession, STATUS_LABEL } from './bot-enterprise-store.js';
import { dispatchOperationNotifications, executeOperation } from './operation-engine.js';

const ACTIVE_ROLES=new Set(['admin','manager','accountant','mechanic','block_sales','concrete_sales','collector','driver','employee','warehouse','fuel_operator','hr','procurement','quality']);
const COLLECTION_ROLES=new Set(['admin','manager','accountant','collector','block_sales','concrete_sales']);
const INVENTORY_ROLES=new Set(['admin','manager','accountant','mechanic','warehouse','procurement','fuel_operator']);
const PURCHASE_ROLES=new Set(['admin','manager','accountant','mechanic','warehouse','procurement','fuel_operator','quality']);
const FUEL_ROLES=new Set(['admin','manager','accountant','mechanic','driver','fuel_operator']);
const TRIP_ROLES=new Set(['admin','manager','mechanic','driver','fuel_operator','block_sales','concrete_sales','collector']);
const CUSTOMER_ROLES=new Set(['admin','manager','accountant','block_sales','concrete_sales','collector']);
const HR_ADMIN_ACTIONS=new Set(['hr_expiry','hr_payroll']);
const HR_ADMIN_ROLES=new Set(['admin','manager','accountant','hr']);
const HR_SELF_ROLES=new Set([...ACTIVE_ROLES]);
const QUALITY_ADMIN_ACTIONS=new Set(['quality_check','quality_corrective']);
const QUALITY_ROLES=new Set(['admin','manager','mechanic','quality']);
const TASK_CREATE_ROLES=new Set(['admin','manager','accountant','hr']);
const MANAGEMENT_FEEDBACK_ACTIONS=new Set(['management_suggestion','management_problem']);
const PRODUCTION_REPORT_ACTIONS=new Set(['concrete_pre_report','concrete_daily_report','block_pre_report','block_daily_report']);
const CONCRETE_REPORT_ROLES=new Set(['admin','manager','concrete_sales']);
const BLOCK_REPORT_ROLES=new Set(['admin','manager','block_sales']);
const FINANCIAL_CONTROL_ACTIONS=new Set(['finance_budget_request','finance_supplier_commitment','finance_expense_claim','finance_custody_request']);
const ADMINISTRATION_ACTIONS=new Set(['admin_decision','admin_meeting','admin_policy']);
const ADMINISTRATION_ROLES=new Set(['admin','manager','hr']);
const GOVERNANCE_ACTIONS=new Set(['contract_renewal','risk_register']);
const GOVERNANCE_ROLES=new Set(['admin','manager','accountant','hr','procurement','quality']);

async function managementFeedbackChats(excludeChatId=''){
  const excluded=String(excludeChatId||''),chats=new Set();
  if(config.telegramOwnerId&&String(config.telegramOwnerId)!==excluded)chats.add(String(config.telegramOwnerId));
  try{
    const users=await select('app_users','active=eq.true&role=in.(admin,manager)&select=id&limit=500'),userIds=(users||[]).map(user=>String(user.id||'')).filter(Boolean);
    if(userIds.length){
      const channels=await select('user_channels',`active=eq.true&channel=eq.telegram&user_id=in.(${userIds.join(',')})&select=external_id&limit=1000`);
      for(const row of channels||[]){const chatId=String(row.external_id||'');if(chatId&&chatId!==excluded)chats.add(chatId);}
    }
  }catch(error){console.warn('[telegram management feedback recipients]',{message:String(error?.message||'').slice(0,300)});}
  return[...chats];
}
function managementFeedbackKeyboard(reference){return keyboard([
  [{text:'تم الاطلاع',callback_data:`entstatus:${reference}|under_review`},{text:'بدأت المعالجة',callback_data:`entstatus:${reference}|in_progress`}],
  [{text:'تم الرد والإغلاق',callback_data:`entstatus:${reference}|completed`},{text:'رفض الاقتراح/البلاغ',callback_data:`entstatus:${reference}|rejected`}]
]);}
async function financialControlNotifications(details,message,identity){
  const chats=await managementFeedbackChats(message.chat.id);if(!chats.length)return[];
  const employee=details.created_by_name||displayName(identity,message.from),role=roleLabel(identity?.role||'pending');
  const fields=[['الطرف',details.party],['البند/مركز التكلفة',details.item],['المبلغ',details.amount?`${details.amount} ر.س`:''],['الاستحقاق',details.due_date],['الأولوية',details.priority],['البيان',details.note]].filter(([,value])=>value!==undefined&&value!=='');
  const text=`<b>رقابة مالية جديدة — ${esc(details.title)}</b>\n\nالمرجع: <b>${esc(details.reference_no)}</b>\nالمسجل: <b>${esc(employee)}</b> — ${esc(role)}\n\n${fields.map(([label,value])=>`• ${label}: <b>${esc(value)}</b>`).join('\n')}\n\nراجع التغطية والمستندات ومركز التكلفة قبل التنفيذ.`;
  return chats.map((chatId,index)=>({type:'financial_control',chatId,title:details.title,message:text,dedupeKey:`${details.reference_no}:financial:${chatId}:${index}`,payload:{telegram_options:{...statusKeyboard(details.reference_no),action_name:'financial_control_received',action_payload:{reference_no:details.reference_no,subtype:details.subtype,created_by_user_id:details.created_by_user_id}}}}));
}
async function productionReportNotifications(details,message,identity){
  const chats=await managementFeedbackChats(message.chat.id);if(!chats.length)return[];
  const product=details.subtype?.startsWith('concrete_')?'الخرسانة':'البلوك',kind=details.subtype?.includes('_pre_')?'تقرير تجهيز مسبق':'تقرير اليوم',employee=details.created_by_name||displayName(identity,message.from),role=roleLabel(identity?.role||'pending');
  const fields=[['التاريخ',details.report_date],['العميل/الموقع',details.party],['الصنف أو الخلطة',details.item],['المخطط',details.quantity],['المنتج فعليًا',details.produced],['المورد فعليًا',details.delivered],['الهالك/المرفوض',details.waste],['موعد التشغيل',details.delivery_time],['المضخات',details.pumps],['التأخيرات',details.delays],['المتطلبات',details.requirements]].filter(([,value])=>value!==undefined&&value!=='');
  const text=`<b>${esc(kind)} — ${esc(product)}</b>\n\nالمرجع: <b>${esc(details.reference_no)}</b>\nالموظف: <b>${esc(employee)}</b> — ${esc(role)}\n\n${fields.map(([label,value])=>`• ${label}: <b>${esc(value)}</b>`).join('\n')}\n\n<b>إجراء الإدارة:</b> راجع المتطلبات وجهّز المواد والمضخات والسيارات والعمالة قبل موعد التشغيل.`;
  return chats.map((chatId,index)=>({type:'production_report',chatId,title:`${kind} — ${product}`,message:text,dedupeKey:`${details.reference_no}:production:${chatId}:${index}`,payload:{telegram_options:{...statusKeyboard(details.reference_no),action_name:'production_report_received',action_payload:{reference_no:details.reference_no,subtype:details.subtype,created_by_user_id:details.created_by_user_id}}}}));
}
async function managementFeedbackNotifications(details,message,identity){
  const chats=await managementFeedbackChats(message.chat.id);if(!chats.length)return[];
  const type=details.subtype==='management_problem'?'مشكلة':'اقتراح',employee=details.created_by_name||displayName(identity,message.from),role=roleLabel(identity?.role||'pending'),source=message.chat.title||'محادثة خاصة';
  const text=`<b>${esc(type)} جديد من موظف</b>\n\nالمرجع: <b>${esc(details.reference_no)}</b>\nالموظف: <b>${esc(employee)}</b>\nالدور: <b>${esc(role)}</b>\nTelegram: <code>${esc(message.from.id)}</code>\nالمصدر: <b>${esc(source)}</b>${details.priority&&details.priority!=='normal'?`\nدرجة التأثير: <b>${esc(details.priority==='critical'?'حرجة':'تحتاج تدخل')}</b>`:''}\n\n<b>التفاصيل:</b>\n${esc(details.note||'').slice(0,2200)}\n\nاضغط «تم الاطلاع» ليصل للموظف إثبات باسمك ووقت الاطلاع.`;
  return chats.map((chatId,index)=>({type:'management_feedback',chatId,title:`${type} ${details.reference_no}`,message:text,dedupeKey:`${details.reference_no}:feedback:${chatId}:${index}`,payload:{telegram_options:{...managementFeedbackKeyboard(details.reference_no),action_name:'management_feedback_received',action_payload:{reference_no:details.reference_no,subtype:details.subtype,created_by_user_id:details.created_by_user_id}}}}));
}
function permission(identity,action,def){
  const role=identity?.role||'';
  if(!identity?.active||!ACTIVE_ROLES.has(role))return'حسابك غير معتمد أو غير نشط.';
  if(def.category==='finance'&&!canFinance(role))return'هذه العملية متاحة للمدير والمحاسب ومدير النظام.';
  if(def.category==='collection'&&!COLLECTION_ROLES.has(role))return'لا تملك صلاحية تسجيل عمليات التحصيل.';
  if(def.category==='inventory'&&!INVENTORY_ROLES.has(role))return'حركات المخزون متاحة للمخزن والمشتريات والورشة والإدارة.';
  if(def.category==='purchase'&&!PURCHASE_ROLES.has(role))return'طلبات الشراء متاحة للأقسام التشغيلية المخولة.';
  if(def.category==='fuel'&&!FUEL_ROLES.has(role))return'تسجيل الديزل والعداد متاح للسائق ومسؤول الديزل والورشة والإدارة.';
  if(def.category==='trip'&&!TRIP_ROLES.has(role))return'تسجيل الرحلات متاح للسائق والأقسام المرتبطة بالتوريد.';
  if(def.category==='customer'&&!CUSTOMER_ROLES.has(role))return'إضافة العملاء متاحة للمبيعات والتحصيل والإدارة.';
  if(def.category==='hr'){
    if(HR_ADMIN_ACTIONS.has(action)&&!HR_ADMIN_ROLES.has(role))return'هذه المعاملة من اختصاص الموارد البشرية والإدارة والمحاسب.';
    if(!HR_SELF_ROLES.has(role))return'لا تملك صلاحية خدمة الموظفين.';
  }
  if(def.category==='quality'){
    if(action==='quality_issue'&&!ACTIVE_ROLES.has(role))return'لا تملك صلاحية تسجيل البلاغ.';
    if(QUALITY_ADMIN_ACTIONS.has(action)&&!QUALITY_ROLES.has(role))return'الفحص والإجراء التصحيحي متاحان لمسؤول الجودة والورشة والإدارة.';
  }
  if(def.category==='task'&&!TASK_CREATE_ROLES.has(role))return'إنشاء المهام متاح للإدارة والموارد البشرية والمحاسب.';
  if(def.category==='production'){
    if(action.startsWith('concrete_')&&!CONCRETE_REPORT_ROLES.has(role))return'تقارير الخرسانة متاحة لموظف الخرسانة والإدارة فقط.';
    if(action.startsWith('block_')&&!BLOCK_REPORT_ROLES.has(role))return'تقارير البلوك متاحة لموظف البلوك والإدارة فقط.';
  }
  if(def.category==='administration'){
    if(!ADMINISTRATION_ACTIONS.has(action)||!ADMINISTRATION_ROLES.has(role))return'العمليات الإدارية متاحة للإدارة والموارد البشرية حسب الاختصاص.';
    if(action==='admin_decision'&&!['admin','manager'].includes(role))return'إصدار القرار الإداري متاح لمدير المصنع ومدير النظام.';
  }
  if(def.category==='governance'){
    if(!GOVERNANCE_ACTIONS.has(action))return'نوع عملية الحوكمة غير مسموح.';
    if(action!=='risk_register'&&!GOVERNANCE_ROLES.has(role))return'العقود والتجديدات متاحة للإدارة والمحاسبة والموارد البشرية والمشتريات.';
  }
  if(def.category==='incident'&&!new Set(['daily_report',...MANAGEMENT_FEEDBACK_ACTIONS]).has(action))return'نوع التقرير غير مسموح.';
  return'';
}
function mapMethod(value){return({cash:'نقدي',transfer:'تحويل',cheque:'شيك'}[value]||value);}
function mapPriority(value){return({normal:'عادي',urgent:'عاجل',critical:'حرج'}[value]||value);}
function summaryLine(key,value){
  const labels={party:'الطرف/المسؤول',amount:'المبلغ',method:'الطريقة',note:'البيان',item:'الصنف/الخدمة',quantity:'الكمية',priority:'الأولوية',asset:'المركبة/الأصل',odometer:'قراءة العداد',expected:'الاستهلاك المتوقع',location:'الموقع',employee:'الموظف',document:'المستند',expiry:'تاريخ الانتهاء',result:'النتيجة',action:'الإجراء',from:'من',to:'إلى',start:'وقت البداية',end:'وقت النهاية',title:'العنوان',due_date:'تاريخ الاستحقاق',report_date:'تاريخ التقرير',delivery_time:'موعد التشغيل',produced:'المنتج فعليًا',delivered:'المورد فعليًا',waste:'الهالك/المرفوض',pumps:'المضخات',delays:'التأخيرات',requirements:'المتطلبات',attendees:'الحضور',decisions:'القرارات',owner:'المسؤول',renewal_date:'موعد التجديد',risk:'الخطر',impact:'الأثر',mitigation:'الإجراء الوقائي'};
  let shown=value;if(key==='method')shown=mapMethod(value);if(key==='priority')shown=mapPriority(value);
  return `${labels[key]||key}: <b>${esc(shown)}</b>`;
}
export async function startEnterpriseForm(message,identity,action){
  const def=SIMPLE_DEFS[action];if(!def)return false;
  const denied=permission(identity,action,def);if(denied)return sendMessage(message.chat.id,denied);
  await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,`enterprise_form:${action}:0`,{action,data:{},startedAt:new Date().toISOString(),roleAtStart:identity.role});
  const field=def.fields[0];
  if(field[2])return sendMessage(message.chat.id,field[1],optionsKeyboard(action,field[2]));
  return sendMessage(message.chat.id,`${def.title}\n\n${field[1]}\n\nاكتب «إلغاء» للخروج.`);
}
export async function advanceEnterpriseForm(message,identity,session,value){
  const action=session.context?.action||String(session.state||'').split(':')[1],def=SIMPLE_DEFS[action];if(!def)return false;
  const denied=permission(identity,action,def);if(denied){await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id);return sendMessage(message.chat.id,denied).then(()=>true);}
  const index=Number(String(session.state).split(':')[2]||0),field=def.fields[index],key=field?.[0];if(!key)return false;
  let normalized=String(value||'').trim();
  if(['amount','quantity','expected','odometer','pumps','produced','delivered','waste'].includes(key)){const n=numberFrom(normalized);if(!n&&normalized!=='0')return sendMessage(message.chat.id,'اكتب قيمة رقمية صحيحة.').then(()=>true);normalized=n;}
  const data={...(session.context?.data||{}),[key]:normalized},nextIndex=index+1;
  if(nextIndex<def.fields.length){
    const nextField=def.fields[nextIndex];
    await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,`enterprise_form:${action}:${nextIndex}`,{action,data,startedAt:session.context?.startedAt||new Date().toISOString(),roleAtStart:session.context?.roleAtStart||identity.role});
    if(nextField[2])await sendMessage(message.chat.id,nextField[1],optionsKeyboard(action,nextField[2]));else await sendMessage(message.chat.id,nextField[1]);
    return true;
  }
  const reference=await nextEnterpriseReference(def.prefix),managementFeedback=MANAGEMENT_FEEDBACK_ACTIONS.has(action),financialControl=FINANCIAL_CONTROL_ACTIONS.has(action),status=def.category==='task'?'assigned':financialControl?'under_review':def.category==='quality'&&data.priority==='critical'?'under_review':'open';
  const details={reference_no:reference,category:def.category,subtype:def.subtype,title:def.title,status,priority:data.priority||'normal',created_by_user_id:String(identity.user_id||''),created_by_name:displayName(identity,message.from),assigned_to:managementFeedback?'الإدارة':data.party||displayName(identity,message.from),...data};
  await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,'enterprise_confirm',{action,reference,details,startedAt:new Date().toISOString(),roleAtStart:session.context?.roleAtStart||identity.role});
  const lines=Object.entries(data).map(([keyName,fieldValue])=>summaryLine(keyName,fieldValue)).join('\n');
  await sendMessage(message.chat.id,`<b>مراجعة ${esc(def.title)}</b>\n\nالمرجع: <b>${esc(reference)}</b>\n${lines}\n\nلم يتم الحفظ النهائي بعد.`,keyboard([[{text:'تأكيد وحفظ',callback_data:`entconfirm:${reference}`},{text:'إلغاء',callback_data:`entcancel:${reference}`}]]));
  return true;
}
export async function confirmEnterpriseForm(message,from,identity,reference){
  const session=await getEnterpriseSession(message.chat.id,identity.external_id||from.id),details=session?.context?.details,action=session?.context?.action,def=SIMPLE_DEFS[action];
  if(session?.state!=='enterprise_confirm'||!details||!def||String(details.reference_no)!==String(reference))return sendMessage(message.chat.id,'انتهت جلسة التأكيد. ابدأ العملية من جديد.');
  const denied=permission(identity,action,def);if(denied){await clearMaintenanceSession(message.chat.id,identity.external_id||from.id);return sendMessage(message.chat.id,denied);}
  const managementFeedback=MANAGEMENT_FEEDBACK_ACTIONS.has(action),productionReport=PRODUCTION_REPORT_ACTIONS.has(action),financialControl=FINANCIAL_CONTROL_ACTIONS.has(action);
  const notifications=managementFeedback?await managementFeedbackNotifications(details,{...message,from},identity):productionReport?await productionReportNotifications(details,{...message,from},identity):financialControl?await financialControlNotifications(details,{...message,from},identity):[];
  const domainRecord=details.category==='task'?{kind:'operational_task',title:details.title,description:details.note||'',department:details.department||'general',priority:details.priority||'normal',dueAt:details.due_date||null,relatedEntityType:'assigned_to_name',relatedEntityId:details.assigned_to||''}:{};
  const operation=await executeOperation({operationType:action,entityType:details.category,referenceNo:reference,department:details.category,status:details.status,title:details.title,summary:details.note||details.item||details.party||'',amount:details.amount||0,payload:details,domainRecord,source:'telegram',sourceReference:`telegram:${message.chat.id}:${message.message_id}:${reference}`,sourceChatId:message.chat.id,sourceMessageId:message.message_id,actorId:identity.user_id||identity.external_id||from.id,actorRole:identity.role,createdByUserId:identity.user_id||null,afterData:details,notifications});
  if(!operation.duplicate&&details.category==='quality'&&details.priority==='critical')await insert('discrepancies',[{reference_no:reference,source_type:'telegram_quality',discrepancy_type:details.subtype,severity:'critical',title:details.title,actual_value:details,status:'open',reason:details.note||'',assigned_to:null}]).catch(error=>{if(Number(error?.upstreamStatus)!==409)throw error;});
  const delivery=await dispatchOperationNotifications(operation.outboxIds||[]);
  await clearMaintenanceSession(message.chat.id,identity.external_id||from.id);
  if(operation.duplicate)return sendMessage(message.chat.id,`العملية <b>${esc(reference)}</b> محفوظة مسبقًا، ولم يتم إنشاء نسخة مكررة.`);
  const notified=managementFeedback||productionReport||financialControl;
  const deliveryText=notified?(delivery.sent?(managementFeedback?`\nوصل التنبيه إلى <b>${delivery.sent}</b> حساب إداري. هذا إثبات تسليم فقط، وليس إثبات مشاهدة. سيصلك إشعار باسم المدير ووقت الاطلاع عند تغيير الحالة.`:`\nتم إرساله إلى الإدارة: <b>${delivery.sent}</b> مستلم.`):`\nتم حفظ العملية، وتعذر إرسال ${delivery.failed+delivery.deadLetter} إشعار. بقيت العملية محفوظة في الـOutbox لإعادة المحاولة.`):'';
  return sendMessage(message.chat.id,`تم حفظ ${esc(details.title)} رسميًا.\nالمرجع: <b>${esc(reference)}</b>\nالحالة: <b>${esc(STATUS_LABEL[details.status]||details.status)}</b>.${deliveryText}`,managementFeedback?{}:statusKeyboard(reference));
}
export async function cancelEnterpriseForm(message,from,identity){await clearMaintenanceSession(message.chat.id,identity.external_id||from.id);return sendMessage(message.chat.id,'تم إلغاء العملية المؤقتة.');}
