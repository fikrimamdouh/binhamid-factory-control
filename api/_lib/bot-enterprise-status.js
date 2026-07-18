import { select } from './supabase.js';
import { sendMessage, keyboard } from './telegram.js';
import { ACTIVE_STATUS, canFinance, canManage, enterpriseEvents, esc, formatAmount, logEnterpriseEvent, norm, operationLine, reduceEnterpriseOperations, STATUS_LABEL } from './bot-enterprise-store.js';

const TEAM_ROLES=new Set(['admin','manager','hr']);
const OPERATIONS_ROLES=new Set(['admin','manager','accountant']);
const ALERT_ROLES=new Set(['admin','manager']);
const DAILY_REPORT_ROLES=new Set(['admin','manager','hr']);
const CATEGORY_ROLES={
  finance:new Set(['admin','manager','accountant']),
  collection:new Set(['admin','manager','accountant','collector']),
  inventory:new Set(['admin','manager','accountant','warehouse','procurement','mechanic']),
  fuel:new Set(['admin','manager','accountant','fuel_operator','mechanic']),
  hr:new Set(['admin','manager','accountant','hr']),
  quality:new Set(['admin','manager','quality']),
  production:new Set(['admin','manager','accountant','block_sales','concrete_sales']),
  administration:new Set(['admin','manager','hr']),
  governance:new Set(['admin','manager','accountant','hr','procurement','quality'])
};
function allowed(identity,set){return Boolean(identity?.active&&set.has(identity.role));}
function todayRiyadh(){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),get=type=>parts.find(item=>item.type===type)?.value||'';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export async function setEnterpriseOperationStatus(message,from,identity,payload){
  const [reference,status]=String(payload||'').split('|');
  if(!reference||!status)return sendMessage(message.chat.id,'بيانات الحالة غير صحيحة.');
  const ops=reduceEnterpriseOperations(await enterpriseEvents()),op=ops.find(item=>item.reference_no===reference);
  if(!op)return sendMessage(message.chat.id,'لم أجد العملية المطلوبة.');
  const own=String(op.created_by_user_id||'')===String(identity.user_id||'');
  if(!own&&!canManage(identity.role)&&identity.role!=='accountant')return sendMessage(message.chat.id,'لا تملك صلاحية تحديث هذه العملية.');
  await logEnterpriseEvent({identity,message:{...message,from},action:'enterprise_operation_status',entityType:op.category||'operation',entityId:reference,details:{reference_no:reference,status,note:`تحديث من ${identity.full_name||from.first_name||'المستخدم'}`}});
  return sendMessage(message.chat.id,`تم تحديث <b>${esc(reference)}</b> إلى: <b>${esc(STATUS_LABEL[status]||status)}</b>.`);
}
export async function sendEnterpriseTasks(chatId,identity,scope='mine'){
  const ops=reduceEnterpriseOperations(await enterpriseEvents()).filter(item=>item.category==='task'&&ACTIVE_STATUS.has(item.status));
  const name=String(identity.full_name||'').trim(),id=String(identity.user_id||''),teamAccess=TEAM_ROLES.has(identity.role);
  const filtered=scope==='team'&&teamAccess?ops:ops.filter(item=>String(item.created_by_user_id||'')===id||norm(item.assigned_to||'')===norm(name)||norm(item.assigned_to||'')==='نفسي');
  if(!filtered.length)return sendMessage(chatId,scope==='team'&&teamAccess?'لا توجد مهام فريق مفتوحة.':'لا توجد مهام مفتوحة مرتبطة بك.');
  return sendMessage(chatId,`<b>${scope==='team'&&teamAccess?'مهام الفريق':'مهامي المفتوحة'}</b>\n\n${filtered.slice(0,20).map(operationLine).join('\n\n')}`.slice(0,3900));
}
export async function sendEnterpriseApprovals(chatId,identity){
  if(!canFinance(identity.role)&&!canManage(identity.role))return sendMessage(chatId,'ليست لديك صلاحية عرض الاعتمادات.');
  const rows=await select('approvals','status=eq.pending&select=id,reference_no,entity_type,summary,amount,created_at&order=created_at.asc&limit=30');
  if(!rows?.length)return sendMessage(chatId,'لا توجد اعتمادات معلقة.');
  for(const row of rows.slice(0,10))await sendMessage(chatId,`<b>${esc(row.reference_no)}</b> — ${esc(row.entity_type)}\n${esc(row.summary||'بدون ملخص')}\nالمبلغ: <b>${formatAmount(row.amount)} ر.س</b>`,keyboard([[{text:'اعتماد',callback_data:`approve:${row.id}`},{text:'رفض',callback_data:`reject:${row.id}`}]]));
}
export async function sendEnterpriseCategorySummary(chatId,identity,category,title){
  const roles=CATEGORY_ROLES[category]||OPERATIONS_ROLES;if(!allowed(identity,roles))return sendMessage(chatId,'ليست لديك صلاحية عرض هذا الملخص.');
  const ops=reduceEnterpriseOperations(await enterpriseEvents()).filter(item=>item.category===category),open=ops.filter(item=>ACTIVE_STATUS.has(item.status)),today=new Date().toISOString().slice(0,10),todayOps=ops.filter(item=>String(item.created_at||'').slice(0,10)===today),total=todayOps.reduce((sum,item)=>sum+Number(item.amount||0),0);
  let text=`<b>${esc(title)}</b>\n\nمسجل اليوم: <b>${todayOps.length}</b>\nمفتوح حاليًا: <b>${open.length}</b>${total?`\nإجمالي مبالغ اليوم: <b>${formatAmount(total)} ر.س</b>`:''}`;
  if(open.length)text+=`\n\n<b>أهم العمليات المفتوحة</b>\n${open.slice(0,8).map(operationLine).join('\n\n')}`;
  return sendMessage(chatId,text.slice(0,3900));
}
export async function sendEnterpriseProductionReports(chatId,identity,product=''){
  const allowedRoles=new Set(['admin','manager','accountant','block_sales','concrete_sales']);
  if(!allowed(identity,allowedRoles))return sendMessage(chatId,'تقارير الإنتاج متاحة للإدارة والمحاسب وموظفي مبيعات القسم.');
  const ownProduct=identity.role==='concrete_sales'?'concrete':identity.role==='block_sales'?'block':'';
  const requested=product||ownProduct;
  if(ownProduct&&requested&&ownProduct!==requested)return sendMessage(chatId,'لا تملك صلاحية عرض تقارير القسم الآخر.');
  const ops=reduceEnterpriseOperations(await enterpriseEvents(1200)).filter(item=>item.category==='production'&&(!requested||String(item.subtype||'').startsWith(`${requested}_`)));
  const today=todayRiyadh(),daily=ops.filter(item=>item.subtype?.includes('_daily_')&&item.report_date===today),upcoming=ops.filter(item=>item.subtype?.includes('_pre_')&&String(item.report_date||'')>=today&&ACTIVE_STATUS.has(item.status));
  const sum=(rows,key)=>rows.reduce((total,item)=>total+Number(item[key]||0),0),label=requested==='concrete'?'الخرسانة':requested==='block'?'البلوك':'الإنتاج';
  let text=`<b>تشغيل ${label}</b>\n\n<b>تقرير اليوم</b>\n• تقارير مسجلة: <b>${daily.length}</b>\n• المخطط: <b>${formatAmount(sum(daily,'quantity'))}</b>\n• المنتج فعليًا: <b>${formatAmount(sum(daily,'produced'))}</b>\n• المورد فعليًا: <b>${formatAmount(sum(daily,'delivered'))}</b>\n• الهالك/المرفوض: <b>${formatAmount(sum(daily,'waste'))}</b>\n\n<b>التجهيز المسبق</b>\n• تقارير قادمة مفتوحة: <b>${upcoming.length}</b>`;
  if(upcoming.length)text+=`\n\n${upcoming.slice(0,12).map(item=>`• <b>${esc(item.reference_no)}</b> — ${esc(item.report_date||'')}\n  ${esc(item.party||item.item||label)} | مخطط ${formatAmount(item.quantity)}\n  المتطلبات: ${esc(item.requirements||'لم تُذكر').slice(0,220)}`).join('\n\n')}`;
  if(daily.some(item=>item.delays&&norm(item.delays)!=='لا يوجد'))text+=`\n\n<b>تأخيرات اليوم</b>\n${daily.filter(item=>item.delays&&norm(item.delays)!=='لا يوجد').slice(0,8).map(item=>`• ${esc(item.delays).slice(0,220)}`).join('\n')}`;
  return sendMessage(chatId,text.slice(0,3900));
}
export async function sendEnterpriseOperations(chatId,identity){
  if(!allowed(identity,OPERATIONS_ROLES))return sendMessage(chatId,'لوحة التشغيل المركزية متاحة للإدارة والمحاسب.');
  const ops=reduceEnterpriseOperations(await enterpriseEvents()),counts={};
  for(const item of ops.filter(row=>ACTIVE_STATUS.has(row.status)))counts[item.category]=(counts[item.category]||0)+1;
  const lines=Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([key,value])=>`• ${esc(key)}: <b>${value}</b>`);
  return sendMessage(chatId,`<b>لوحة التشغيل المركزية</b>\n\n${lines.length?lines.join('\n'):'لا توجد عمليات تشغيلية مفتوحة.'}\n\nاستخدم «بحث شامل» للوصول إلى مرجع أو عميل أو مركبة.`);
}
export async function sendEnterpriseAlerts(chatId,identity){
  if(!allowed(identity,ALERT_ROLES))return sendMessage(chatId,'التنبيهات المركزية متاحة للإدارة فقط.');
  const ops=reduceEnterpriseOperations(await enterpriseEvents()),alerts=ops.filter(item=>ACTIVE_STATUS.has(item.status)&&(item.priority==='critical'||item.priority==='urgent'||(item.due_date&&new Date(item.due_date)<new Date())));
  if(!alerts.length)return sendMessage(chatId,'لا توجد تنبيهات تشغيلية عاجلة حاليًا.');
  return sendMessage(chatId,`<b>التنبيهات التشغيلية</b>\n\n${alerts.slice(0,20).map(operationLine).join('\n\n')}`.slice(0,3900));
}
export async function sendEnterpriseDailyReports(chatId,identity){
  if(!allowed(identity,DAILY_REPORT_ROLES))return sendMessage(chatId,'تقارير الموظفين متاحة للإدارة والموارد البشرية.');
  let reports=[];
  try{reports=await select('employee_daily_reports',`report_date=eq.${new Date().toISOString().slice(0,10)}&select=reference_no,employee_name,department,report_text,created_at&order=created_at.desc&limit=100`);}catch{
    const ops=reduceEnterpriseOperations(await enterpriseEvents()),today=new Date().toISOString().slice(0,10);reports=ops.filter(item=>item.subtype==='daily_report'&&String(item.created_at||'').slice(0,10)===today).map(item=>({employee_name:item.created_by_name,report_text:item.note}));
  }
  if(!reports?.length)return sendMessage(chatId,'لم يسجل أي موظف تقريرًا يوميًا حتى الآن.');
  return sendMessage(chatId,`<b>تقارير الموظفين اليوم</b>\n\n${reports.slice(0,20).map(item=>`• <b>${esc(item.employee_name||'موظف')}</b>${item.department?` — ${esc(item.department)}`:''}\n  ${esc(String(item.report_text||'').slice(0,220))}`).join('\n\n')}`.slice(0,3900));
}
