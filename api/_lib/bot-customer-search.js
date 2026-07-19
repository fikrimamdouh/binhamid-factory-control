import { sendMessage, keyboard } from './telegram.js';
import { clearMaintenanceSession } from './bot-maintenance.js';
import { esc, formatAmount, norm, setEnterpriseSession } from './bot-enterprise-store.js';
import { findCustomers, loadCustomerAnalytics } from './bot-customer-report-data.js';

const REPORT_ROLES=new Set(['admin','manager','accountant','block_sales','concrete_sales','collector']);
const canView=identity=>Boolean(identity?.active&&REPORT_ROLES.has(identity.role));
const money=value=>`${formatAmount(value)} ر.س`;
const currentBalance=row=>Number(row.netBalance??row.balance??0)||0;
const decisionLabel={normal:'طبيعي',watch:'مراجعة قبل زيادة الائتمان',stop:'إيقاف البيع الآجل حتى المراجعة'};
const salesTypeLabel={block:'بلوك',concrete:'خرسانة'};

function invoiceLine(row){const type=salesTypeLabel[row.sales_type]||row.sales_type||'';return `• ${esc(String(row.delivery_date||row.created_at||'').slice(0,10)||'بدون تاريخ')} | <b>${esc(row.reference_no||'فاتورة')}</b> | ${esc(type)}\n  مدين ${money(row.total)} | مسدد ${money(row.paid)} | متبقي ${money(row.outstanding)}`;}
function collectionLine(row){return `• ${esc(String(row.occurred_at||row.created_at||'').slice(0,10)||'بدون تاريخ')} | <b>${esc(row.reference_no||'تحصيل')}</b>\n  دائن ${money(row.amount)}${row.unallocated?` | غير موزع ${money(row.unallocated)}`:''}`;}

async function sendStatement(chatId,identity,row){
  const recentSales=row.sales.slice(0,10),recentCollections=row.collectionRows.slice(0,10),movementCount=row.invoiceCount+row.collectionCount;
  const text=`<b>كشف حساب عميل — مصنع بن حامد</b>\n━━━━━━━━━━━━━━\n<b>${esc(row.name)}</b>${row.code?`\nرقم الحساب: <code>${esc(row.code)}</code>`:''}${row.phone?`\nالجوال: ${esc(row.phone)}`:''}\nحتى تاريخ: <b>${esc(new Date().toISOString().slice(0,10))}</b>\n━━━━━━━━━━━━━━\n<b>ملخص الحساب</b>\nالرصيد الافتتاحي: <b>${money(row.openingBalance)}</b>\nإجمالي المبيعات بعد الافتتاح: <b>${money(row.grossSales)}</b>\nإجمالي التحصيلات: <b>${money(row.collections)}</b>\nالرصيد الحالي: <b>${money(currentBalance(row))}</b>\nمديونية على العميل: <b>${money(row.debitBalance)}</b>\nرصيد دائن للعميل: <b>${money(row.creditBalance)}</b>\nالمتأخر المؤرخ: <b>${money(row.overdue)}</b>\nعدد الحركات الجديدة: <b>${movementCount}</b>\nالحالة الائتمانية: <b>${esc(decisionLabel[row.decision]||row.decision)}</b>${recentSales.length?`\n\n<b>أحدث الفواتير</b>\n${recentSales.map(invoiceLine).join('\n')}`:'\n\nلا توجد فواتير بعد الرصيد الافتتاحي.'}${recentCollections.length?`\n\n<b>أحدث التحصيلات</b>\n${recentCollections.map(collectionLine).join('\n')}`:'\n\nلا توجد تحصيلات بعد الرصيد الافتتاحي.'}\n\n<i>الحركات المعتمدة من التقرير اليومي تظهر تلقائيًا في هذا الكشف.</i>`;
  return sendMessage(chatId,text.slice(0,3900));
}

async function searchAndChoose(message,identity,query){
  if(!canView(identity))return sendMessage(message.chat.id,'ليست لديك صلاحية عرض حسابات العملاء.');
  const data=await loadCustomerAnalytics(identity),matches=findCustomers(data,query);
  if(!matches.length)return sendMessage(message.chat.id,`لم أجد عميلًا مطابقًا لـ <b>${esc(query)}</b>. جرّب رقم الحساب أو جزءًا آخر من الاسم.`);
  const exact=matches.find(row=>norm(row.code)===norm(query));if(exact)return sendStatement(message.chat.id,identity,exact);
  if(matches.length===1)return sendStatement(message.chat.id,identity,matches[0]);
  const choices=matches.slice(0,10).map((row,index)=>({code:row.code,name:row.name,balance:currentBalance(row),index}));
  await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,'enterprise_customer_choose',{query,choices,startedAt:new Date().toISOString()});
  const rows=choices.map(item=>[{text:`${item.name} — ${item.code||'بدون رقم'} — ${formatAmount(item.balance)}`,callback_data:`ent:customer_pick|${item.index}`}]);
  return sendMessage(message.chat.id,`<b>نتائج البحث عن: ${esc(query)}</b>\nوجدت <b>${matches.length}</b> نتائج. اختر العميل المطلوب حسب الاسم ورقم الحساب:`,keyboard(rows));
}

export async function continueSelectableCustomerSession(message,identity,session,text){
  if(session?.state!=='enterprise_customer_lookup')return false;
  const query=String(text||'').trim();if(query.length<2){await sendMessage(message.chat.id,'اكتب رقم الحساب أو حرفين على الأقل من اسم العميل.');return true;}
  await searchAndChoose(message,identity,query);return true;
}

export async function handleSelectableCustomerCallback(message,from,identity,value){
  if(!String(value||'').startsWith('customer_pick|'))return false;
  const index=Number(String(value).split('|')[1]);
  const { select }=await import('./supabase.js');
  const session=(await select('bot_sessions',`channel=eq.telegram&chat_id=eq.${encodeURIComponent(String(message.chat.id))}&external_user_id=eq.${encodeURIComponent(String(identity.external_id||from.id))}&select=*&limit=1`).catch(()=>[]))?.[0];
  const choice=session?.state==='enterprise_customer_choose'?session.context?.choices?.[index]:null;
  if(!choice)return sendMessage(message.chat.id,'انتهت نتائج البحث. ابدأ البحث من جديد.');
  const data=await loadCustomerAnalytics(identity),row=findCustomers(data,choice.code||choice.name).find(item=>String(item.code||'')===String(choice.code||''))||findCustomers(data,choice.name)[0];
  if(!row)return sendMessage(message.chat.id,'تعذر تحميل حساب العميل. أعد البحث.');
  await clearMaintenanceSession(message.chat.id,identity.external_id||from.id).catch(()=>{});return sendStatement(message.chat.id,identity,row);
}

export async function handleSelectableCustomerTextCommand(message,identity,text){
  const raw=String(text||'').trim();
  const direct=raw.match(/^(?:بحث عميل|ابحث عن عميل|كشف حساب(?: عميل)?|كشف عميل|رصيد(?: العميل)?|رصيد عميل)\s+(.{2,})$/i);
  if(!direct)return false;await searchAndChoose(message,identity,direct[1]);return true;
}
