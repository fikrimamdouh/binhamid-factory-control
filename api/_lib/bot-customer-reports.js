import { sendMessage, keyboard } from './telegram.js';
import { clearMaintenanceSession } from './bot-maintenance.js';
import { esc, formatAmount, norm, setEnterpriseSession } from './bot-enterprise-store.js';
import { findCustomers, loadCustomerAnalytics } from './bot-customer-report-data.js';

const REPORT_ROLES=new Set(['admin','manager','accountant','block_sales','concrete_sales','collector']);
const decisionLabel={normal:'طبيعي',watch:'مراجعة قبل زيادة الائتمان',stop:'إيقاف البيع الآجل حتى المراجعة'};
const salesTypeLabel={block:'بلوك',concrete:'خرسانة'};
const canView=identity=>Boolean(identity?.active&&REPORT_ROLES.has(identity.role));
const money=value=>`${formatAmount(value)} ر.س`;
const pct=value=>value===null?'غير محدد':`${formatAmount(value*100)}%`;

export function customerReportsMenu(){return keyboard([
  [{text:'ملخص العملاء',callback_data:'ent:customer_summary'},{text:'أكبر المديونيات',callback_data:'ent:customer_debt'}],
  [{text:'أعمار الديون',callback_data:'ent:customer_aging'},{text:'العملاء المتأخرون',callback_data:'ent:customer_overdue'}],
  [{text:'كشف عميل بالاسم أو الكود',callback_data:'ent:customer_lookup'}]
]);}
async function deny(chatId){return sendMessage(chatId,'تقارير العملاء متاحة للإدارة والمحاسب والمبيعات والتحصيل وفق نطاق كل دور.');}
export async function sendCustomerReportsMenu(chatId,identity){
  if(!canView(identity))return deny(chatId);
  const scope=identity.role==='block_sales'?'عملاء البلوك فقط':identity.role==='concrete_sales'?'عملاء الخرسانة فقط':'جميع العملاء';
  return sendMessage(chatId,`<b>تقارير العملاء</b>\nالنطاق: <b>${esc(scope)}</b>\n\nاختر التقرير المطلوب. الأرصدة مبنية على أوامر البيع والتحصيلات المعتمدة في قاعدة النظام.`,customerReportsMenu());
}
function summaryText(data){
  const t=data.totals;
  return `<b>ملخص العملاء</b>\nحتى: <b>${esc(data.asOf)}</b>\n\nعدد العملاء ذوي الحركة: <b>${t.customers}</b>\nإجمالي المبيعات: <b>${money(t.grossSales)}</b>\nالمسدد الموزع على الفواتير: <b>${money(t.paidApplied)}</b>\nالرصيد القائم: <b>${money(t.balance)}</b>\nالمتأخر: <b>${money(t.overdue)}</b>\nأرصدة دائنة غير موزعة: <b>${money(t.unallocatedCredit)}</b>\n\nيحتاج إيقاف بيع آجل: <b>${t.stopped}</b>\nيحتاج مراجعة: <b>${t.watch}</b>`;
}
async function sendSummary(chatId,identity){return sendMessage(chatId,summaryText(await loadCustomerAnalytics(identity)));}
async function sendTopDebt(chatId,identity){
  const data=await loadCustomerAnalytics(identity),rows=[...data.rows].filter(x=>x.balance>0).sort((a,b)=>b.balance-a.balance).slice(0,15);
  if(!rows.length)return sendMessage(chatId,'لا توجد مديونيات قائمة ضمن نطاق صلاحيتك.');
  const body=rows.map((row,index)=>`${index+1}. <b>${esc(row.name)}</b>${row.code?` — <code>${esc(row.code)}</code>`:''}\nالرصيد: <b>${money(row.balance)}</b> | المتأخر: <b>${money(row.overdue)}</b>\nالحد: ${row.creditLimit?money(row.creditLimit):'غير مضبوط'} | القرار: <b>${esc(decisionLabel[row.decision])}</b>`).join('\n\n');
  return sendMessage(chatId,`<b>أكبر مديونيات العملاء</b>\n\n${body}`.slice(0,3900));
}
async function sendAging(chatId,identity){
  const a=(await loadCustomerAnalytics(identity)).totals.aging;
  return sendMessage(chatId,`<b>أعمار ديون العملاء</b>\n\nغير مستحق/حالي: <b>${money(a.current)}</b>\nمن 1 إلى 30 يومًا: <b>${money(a.days1to30)}</b>\nمن 31 إلى 60 يومًا: <b>${money(a.days31to60)}</b>\nمن 61 إلى 90 يومًا: <b>${money(a.days61to90)}</b>\nأكثر من 90 يومًا: <b>${money(a.days90plus)}</b>\n\nالتصنيف يعتمد على تاريخ التسليم أو التسجيل زائد مدة السداد المضبوطة للعميل.`);
}
async function sendOverdue(chatId,identity){
  const data=await loadCustomerAnalytics(identity),rows=data.rows.filter(x=>x.overdue>0).sort((a,b)=>b.aging.days90plus-a.aging.days90plus||b.overdue-a.overdue).slice(0,15);
  if(!rows.length)return sendMessage(chatId,'لا توجد أرصدة متأخرة ضمن نطاق صلاحيتك.');
  const body=rows.map((row,index)=>`${index+1}. <b>${esc(row.name)}</b>${row.code?` — <code>${esc(row.code)}</code>`:''}\nالمتأخر: <b>${money(row.overdue)}</b> | فوق 90 يومًا: <b>${money(row.aging.days90plus)}</b>\nآخر تحصيل: ${esc(row.lastCollection||'لا يوجد')}`).join('\n\n');
  return sendMessage(chatId,`<b>العملاء المتأخرون</b>\n\n${body}`.slice(0,3900));
}
function invoiceLine(row){
  const type=salesTypeLabel[row.sales_type]||row.sales_type||'';
  return `• <b>${esc(row.reference_no||'فاتورة')}</b> — ${esc(type)}\n  الإجمالي ${money(row.total)} | المتبقي ${money(row.outstanding)}${row.daysLate?` | تأخير ${row.daysLate} يوم`:''}`;
}
function collectionLine(row){return `• <b>${esc(row.reference_no||'تحصيل')}</b> — ${money(row.amount)}${row.unallocated?` | غير موزع ${money(row.unallocated)}`:''}\n  ${esc(String(row.occurred_at||row.created_at||'').slice(0,10)||'بدون تاريخ')}`;}
async function sendCustomerStatement(chatId,identity,query){
  const data=await loadCustomerAnalytics(identity),matches=findCustomers(data,query);
  if(!matches.length)return sendMessage(chatId,`لم أجد عميلًا مطابقًا لـ <b>${esc(query)}</b> ضمن نطاق صلاحيتك. استخدم كود العميل أو جزءًا أوضح من الاسم.`);
  if(matches.length>1&&norm(matches[0].name)!==norm(query)&&norm(matches[0].code)!==norm(query)){
    const list=matches.slice(0,8).map((row,index)=>`${index+1}. <b>${esc(row.name)}</b>${row.code?` — <code>${esc(row.code)}</code>`:''} — ${money(row.balance)}`).join('\n');
    return sendMessage(chatId,`وجدت أكثر من عميل. أرسل الكود أو الاسم الكامل:\n\n${list}`);
  }
  const row=matches[0],recentSales=row.sales.slice(0,6),recentCollections=row.collectionRows.slice(0,5);
  const header=`<b>كشف العميل</b>\nالعميل: <b>${esc(row.name)}</b>${row.code?`\nالكود: <code>${esc(row.code)}</code>`:''}${row.phone?`\nالجوال: ${esc(row.phone)}`:''}\n\nالمبيعات: <b>${money(row.grossSales)}</b>\nالمسدد الموزع: <b>${money(row.paidApplied)}</b>\nالرصيد: <b>${money(row.balance)}</b>\nالمتأخر: <b>${money(row.overdue)}</b>\nرصيد دائن غير موزع: <b>${money(row.unallocatedCredit)}</b>\nالحد الائتماني: <b>${row.creditLimit?money(row.creditLimit):'غير مضبوط'}</b>\nاستخدام الحد: <b>${pct(row.utilization)}</b>\nالقرار: <b>${esc(decisionLabel[row.decision])}</b>`;
  const invoices=recentSales.length?`\n\n<b>أحدث الفواتير</b>\n${recentSales.map(invoiceLine).join('\n')}`:'\n\nلا توجد فواتير مسجلة.';
  const receipts=recentCollections.length?`\n\n<b>أحدث التحصيلات</b>\n${recentCollections.map(collectionLine).join('\n')}`:'\n\nلا توجد تحصيلات مسجلة.';
  return sendMessage(chatId,`${header}${invoices}${receipts}`.slice(0,3900));
}
export async function startCustomerLookup(message,identity){
  if(!canView(identity))return deny(message.chat.id);
  await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,'enterprise_customer_lookup',{startedAt:new Date().toISOString()});
  return sendMessage(message.chat.id,'اكتب كود العميل أو اسمه. مثال: 10021 أو مصنع الأمل.');
}
export async function continueCustomerReportSession(message,identity,session,text){
  if(session?.state!=='enterprise_customer_lookup')return false;
  const query=String(text||'').trim();if(query.length<2){await sendMessage(message.chat.id,'اكتب كودًا أو اسمًا أوضح.');return true;}
  await sendCustomerStatement(message.chat.id,identity,query);await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id).catch(()=>{});return true;
}
export async function handleCustomerReportCallback(message,from,identity,value){
  if(!canView(identity))return deny(message.chat.id);
  if(value==='customer_menu')return sendCustomerReportsMenu(message.chat.id,identity);
  if(value==='customer_summary')return sendSummary(message.chat.id,identity);
  if(value==='customer_debt')return sendTopDebt(message.chat.id,identity);
  if(value==='customer_aging')return sendAging(message.chat.id,identity);
  if(value==='customer_overdue')return sendOverdue(message.chat.id,identity);
  if(value==='customer_lookup')return startCustomerLookup({...message,from},identity);
  return false;
}
export async function handleCustomerReportTextCommand(message,identity,text){
  const raw=String(text||'').trim(),value=norm(raw);
  if(/^\/(customers|clients)(?:@\w+)?$/i.test(raw)||/^(تقارير العملاء|تقرير العملاء|عملاء المصنع)$/.test(value)){await sendCustomerReportsMenu(message.chat.id,identity);return true;}
  if(/^(ملخص العملاء|اجمالي العملاء|إجمالي العملاء)$/.test(value)){if(!canView(identity))await deny(message.chat.id);else await sendSummary(message.chat.id,identity);return true;}
  if(/^(اكبر المديونيات|أكبر المديونيات|مديونيات العملاء)$/.test(value)){if(!canView(identity))await deny(message.chat.id);else await sendTopDebt(message.chat.id,identity);return true;}
  if(/^(اعمار الديون|أعمار الديون|تحليل اعمار الديون|تحليل أعمار الديون)$/.test(value)){if(!canView(identity))await deny(message.chat.id);else await sendAging(message.chat.id,identity);return true;}
  const direct=raw.match(/^(?:\/client(?:@\w+)?|كشف عميل|تقرير عميل|مديونية عميل|حساب عميل)\s+(.{2,})$/i);
  if(direct){if(!canView(identity))await deny(message.chat.id);else await sendCustomerStatement(message.chat.id,identity,direct[1]);return true;}
  return false;
}
