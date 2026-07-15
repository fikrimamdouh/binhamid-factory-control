import { select } from './supabase.js';
import { sendMessage, keyboard } from './telegram.js';
import { ACTIVE_STATUS, canFinance, canManage, enterpriseEvents, esc, formatAmount, logEnterpriseEvent, norm, operationLine, reduceEnterpriseOperations, STATUS_LABEL } from './bot-enterprise-store.js';

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
  const name=String(identity.full_name||'').trim(),id=String(identity.user_id||'');
  const filtered=scope==='team'&&canManage(identity.role)?ops:ops.filter(item=>String(item.created_by_user_id||'')===id||norm(item.assigned_to||'')===norm(name)||norm(item.assigned_to||'')==='نفسي');
  if(!filtered.length)return sendMessage(chatId,scope==='team'?'لا توجد مهام فريق مفتوحة.':'لا توجد مهام مفتوحة مرتبطة بك.');
  return sendMessage(chatId,`<b>${scope==='team'?'مهام الفريق':'مهامي المفتوحة'}</b>\n\n${filtered.slice(0,20).map(operationLine).join('\n\n')}`.slice(0,3900));
}
export async function sendEnterpriseApprovals(chatId,identity){
  if(!canFinance(identity.role)&&!canManage(identity.role))return sendMessage(chatId,'ليست لديك صلاحية عرض الاعتمادات.');
  const rows=await select('approvals','status=eq.pending&select=id,reference_no,entity_type,summary,amount,created_at&order=created_at.asc&limit=30');
  if(!rows?.length)return sendMessage(chatId,'لا توجد اعتمادات معلقة.');
  for(const row of rows.slice(0,10))await sendMessage(chatId,`<b>${esc(row.reference_no)}</b> — ${esc(row.entity_type)}\n${esc(row.summary||'بدون ملخص')}\nالمبلغ: <b>${formatAmount(row.amount)} ر.س</b>`,keyboard([[{text:'اعتماد',callback_data:`approve:${row.id}`},{text:'رفض',callback_data:`reject:${row.id}`}]]));
}
export async function sendEnterpriseCategorySummary(chatId,category,title){
  const ops=reduceEnterpriseOperations(await enterpriseEvents()).filter(item=>item.category===category),open=ops.filter(item=>ACTIVE_STATUS.has(item.status)),today=new Date().toISOString().slice(0,10),todayOps=ops.filter(item=>String(item.created_at||'').slice(0,10)===today),total=todayOps.reduce((sum,item)=>sum+Number(item.amount||0),0);
  let text=`<b>${esc(title)}</b>\n\nمسجل اليوم: <b>${todayOps.length}</b>\nمفتوح حاليًا: <b>${open.length}</b>${total?`\nإجمالي مبالغ اليوم: <b>${formatAmount(total)} ر.س</b>`:''}`;
  if(open.length)text+=`\n\n<b>أهم العمليات المفتوحة</b>\n${open.slice(0,8).map(operationLine).join('\n\n')}`;
  return sendMessage(chatId,text.slice(0,3900));
}
export async function sendEnterpriseOperations(chatId){
  const ops=reduceEnterpriseOperations(await enterpriseEvents()),counts={};
  for(const item of ops.filter(row=>ACTIVE_STATUS.has(row.status)))counts[item.category]=(counts[item.category]||0)+1;
  const lines=Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([key,value])=>`• ${esc(key)}: <b>${value}</b>`);
  return sendMessage(chatId,`<b>لوحة التشغيل المركزية</b>\n\n${lines.length?lines.join('\n'):'لا توجد عمليات تشغيلية مفتوحة.'}\n\nاستخدم «بحث شامل» للوصول إلى مرجع أو عميل أو مركبة.`);
}
export async function sendEnterpriseAlerts(chatId){
  const ops=reduceEnterpriseOperations(await enterpriseEvents()),alerts=ops.filter(item=>ACTIVE_STATUS.has(item.status)&&(item.priority==='critical'||item.priority==='urgent'||(item.due_date&&new Date(item.due_date)<new Date())));
  if(!alerts.length)return sendMessage(chatId,'لا توجد تنبيهات تشغيلية عاجلة حاليًا.');
  return sendMessage(chatId,`<b>التنبيهات التشغيلية</b>\n\n${alerts.slice(0,20).map(operationLine).join('\n\n')}`.slice(0,3900));
}
export async function sendEnterpriseDailyReports(chatId){
  const ops=reduceEnterpriseOperations(await enterpriseEvents()),today=new Date().toISOString().slice(0,10),reports=ops.filter(item=>item.subtype==='daily_report'&&String(item.created_at||'').slice(0,10)===today);
  if(!reports.length)return sendMessage(chatId,'لم يسجل أي موظف تقريرًا يوميًا حتى الآن.');
  return sendMessage(chatId,`<b>تقارير الموظفين اليوم</b>\n\n${reports.slice(0,20).map(item=>`• <b>${esc(item.created_by_name||'موظف')}</b>\n  ${esc(String(item.note||'').slice(0,220))}`).join('\n\n')}`.slice(0,3900));
}
