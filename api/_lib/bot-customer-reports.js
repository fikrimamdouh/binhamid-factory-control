import crypto from 'node:crypto';
import { sendMessage, keyboard } from './telegram.js';
import { clearMaintenanceSession } from './bot-maintenance.js';
import { esc, formatAmount, norm, setEnterpriseSession } from './bot-enterprise-store.js';
import { findCustomers, loadCustomerAnalytics } from './bot-customer-report-data.js';
import { insert, select } from './supabase.js';

const REPORT_ROLES=new Set(['admin','manager','accountant','block_sales','concrete_sales','collector']);
const CREATE_ROLES=new Set(['admin','manager','accountant']);
const decisionLabel={normal:'طبيعي',watch:'مراجعة قبل زيادة الائتمان',stop:'إيقاف البيع الآجل حتى المراجعة'};
const salesTypeLabel={block:'بلوك',concrete:'خرسانة'};
const canView=identity=>Boolean(identity?.active&&REPORT_ROLES.has(identity.role));
const canCreate=identity=>Boolean(identity?.active&&CREATE_ROLES.has(identity.role));
const money=value=>`${formatAmount(value)} ر.س`;
const pct=value=>value===null?'غير محدد':`${formatAmount(value*100)}%`;
const latinDigits=value=>String(value??'').replace(/[٠-٩]/g,char=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(char)));
const parseMoney=value=>Number(latinDigits(value).replace(/[٬،,\s]/g,'').replace(/٫/g,'.').replace(/[^0-9.\-]/g,''));
const currentBalance=row=>Number(row.netBalance??row.balance??0)||0;
const PAGE_SIZE=15;
// ترقيم صفحات عام للتقارير الطويلة: يعرض 15 نتيجة ويضيف زرار "التالي/السابق"
// بدل ما يقصّ القائمة بصمت — أي تقرير عملاء طويل يستخدمها بدل حد أقصى ثابت.
function paginationButtons(kind,page,totalPages,extra=''){
  const row=[];
  if(page>0)row.push({text:'◀️ السابق',callback_data:`ent:customer_page|${kind}|${page-1}|${extra}`});
  if(page<totalPages-1)row.push({text:'التالي ▶️',callback_data:`ent:customer_page|${kind}|${page+1}|${extra}`});
  return row.length?keyboard([row]):undefined;
}
function sendPage(chatId,title,rows,formatRow,page,extraHeaderLine=''){
  const totalPages=Math.max(1,Math.ceil(rows.length/PAGE_SIZE)),clampedPage=Math.min(Math.max(0,page),totalPages-1),startIndex=clampedPage*PAGE_SIZE,slice=rows.slice(startIndex,startIndex+PAGE_SIZE);
  const pageLine=totalPages>1?`الصفحة <b>${clampedPage+1}</b> من <b>${totalPages}</b> — إجمالي النتائج: <b>${rows.length}</b>`:`إجمالي النتائج: <b>${rows.length}</b>`;
  return{text:`<b>${title}</b>\n${pageLine}${extraHeaderLine?`\n${extraHeaderLine}`:''}\n\n${slice.map((row,i)=>formatRow(row,startIndex+i)).join('\n\n')}`.slice(0,3900),page:clampedPage,totalPages,slice};
}

export function customerReportsMenu(){return keyboard([
  [{text:'➕ تسجيل عميل جديد',callback_data:'ent:customer_create'},{text:'🔍 رصيد أو كشف عميل',callback_data:'ent:customer_lookup'}],
  [{text:'📊 الملخص التنفيذي',callback_data:'ent:customer_summary'},{text:'💰 أكبر المديونيات',callback_data:'ent:customer_debt'}],
  [{text:'💵 أكبر الأرصدة الدائنة',callback_data:'ent:customer_credit'},{text:'🎯 تركيز المديونية',callback_data:'ent:customer_concentration'}],
  [{text:'📅 أعمار الديون',callback_data:'ent:customer_aging'},{text:'⚠️ العملاء المتأخرون',callback_data:'ent:customer_overdue'}],
  [{text:'😴 بدون حركة',callback_data:'ent:customer_no_movement'},{text:'⚪ الحسابات الصفرية',callback_data:'ent:customer_zero'}],
  [{text:'🧮 أوامر فلترة الأرصدة',callback_data:'ent:customer_filter_help'}]
]);}
async function deny(chatId){return sendMessage(chatId,'تقارير العملاء متاحة للإدارة والمحاسب والمبيعات والتحصيل وفق نطاق كل دور.');}
export async function sendCustomerReportsMenu(chatId,identity){
  if(!canView(identity))return deny(chatId);
  const scope=identity.role==='block_sales'?'عملاء البلوك فقط':identity.role==='concrete_sales'?'عملاء الخرسانة فقط':'جميع العملاء';
  return sendMessage(chatId,`🧾 <b>تقارير العملاء — مصنع بن حامد</b>\nالنطاق: <b>${esc(scope)}</b>\n\nالتقارير تجمع الرصيد الافتتاحي القادم من البرنامج القديم مع المبيعات والتحصيلات اللاحقة. الرصيد الافتتاحي يظهر منفصلًا عن أعمار الديون لأنه غير موزع على فواتير مؤرخة.`,customerReportsMenu());
}
function summaryText(data){
  const t=data.totals;
  return `📊 <b>الملخص التنفيذي للعملاء — مصنع بن حامد</b>\nحتى: <b>${esc(data.asOf)}</b>\n━━━━━━━━━━━━━━\n👥 <b>قاعدة العملاء</b>\n• إجمالي العملاء ذوي الرصيد أو الحركة: <b>${t.customers}</b>\n• عملاء لهم رصيد افتتاحي: <b>${t.openingCustomers}</b>\n• بدون حركة بعد الافتتاح: <b>${t.noMovement}</b>\n• حسابات صفرية: <b>${t.zeroBalances}</b>\n━━━━━━━━━━━━━━\n📋 <b>الأرصدة الافتتاحية</b>\n• مدينة على العملاء: <b>${money(t.openingDebit)}</b>\n• دائنة للعملاء: <b>${money(t.openingCredit)}</b>\n• صافي الافتتاحي: <b>${money(t.openingNet)}</b>\n• شيكات: <b>${money(t.openingCheques)}</b>\n━━━━━━━━━━━━━━\n🔄 <b>الحركة اللاحقة</b>\n• المبيعات: <b>${money(t.grossSales)}</b>\n• المسدد الموزع: <b>${money(t.paidApplied)}</b>\n• التحصيلات المسجلة: <b>${money(t.collections)}</b>\n• أرصدة دائنة غير موزعة: <b>${money(t.unallocatedCredit)}</b>\n━━━━━━━━━━━━━━\n📌 <b>الموقف الحالي</b>\n• إجمالي المديونية المدينة: <b>${money(t.debitBalance)}</b>\n• إجمالي الأرصدة الدائنة: <b>${money(t.creditBalance)}</b>\n• صافي رصيد العملاء: <b>${money(t.netBalance)}</b>\n• المتأخر المؤرخ: <b>${money(t.overdue)}</b>\n• ⛔ إيقاف بيع آجل: <b>${t.stopped}</b>\n• ⚠️ يحتاج مراجعة: <b>${t.watch}</b>`;
}
async function sendSummary(chatId,identity){return sendMessage(chatId,summaryText(await loadCustomerAnalytics(identity)));}
async function sendTopDebt(chatId,identity,limit=null,page=0){
  const data=await loadCustomerAnalytics(identity),allRows=[...data.rows].filter(x=>x.debitBalance>0.009).sort((a,b)=>b.debitBalance-a.debitBalance),rows=limit?allRows.slice(0,Math.max(1,Math.min(50,Number(limit)||15))):allRows;
  if(!rows.length)return sendMessage(chatId,'لا توجد مديونيات قائمة ضمن نطاق صلاحيتك.');
  const total=data.totals.debitBalance||rows.reduce((sum,row)=>sum+row.debitBalance,0);
  const formatRow=(row,index)=>`${index+1}. <b>${esc(row.name)}</b>${row.code?` — <code>${esc(row.code)}</code>`:''}\nالرصيد: <b>${money(row.debitBalance)}</b> | من الإجمالي: <b>${pct(total?row.debitBalance/total:0)}</b>\nافتتاحي: ${money(row.openingBalance)} | متأخر مؤرخ: ${money(row.overdue)}\nالحد: ${row.creditLimit?money(row.creditLimit):'غير مضبوط'} | القرار: <b>${esc(decisionLabel[row.decision])}</b>`;
  const built=sendPage(chatId,limit?`💰 أكبر ${rows.length} مديونية للعملاء`:'💰 كل مديونيات العملاء',rows,formatRow,page,`إجمالي المديونية: <b>${money(total)}</b>`);
  return sendMessage(chatId,built.text,paginationButtons('topdebt',built.page,built.totalPages,limit?String(limit):''));
}
async function sendTopCredits(chatId,identity){
  const data=await loadCustomerAnalytics(identity),rows=[...data.rows].filter(x=>x.creditBalance>0.009).sort((a,b)=>b.creditBalance-a.creditBalance).slice(0,20);
  if(!rows.length)return sendMessage(chatId,'لا توجد أرصدة دائنة للعملاء ضمن نطاق صلاحيتك.');
  const total=data.totals.creditBalance||rows.reduce((sum,row)=>sum+row.creditBalance,0),body=rows.map((row,index)=>`${index+1}. <b>${esc(row.name)}</b>${row.code?` — <code>${esc(row.code)}</code>`:''}\nالرصيد الدائن: <b>${money(row.creditBalance)}</b> | من الإجمالي: <b>${pct(total?row.creditBalance/total:0)}</b>\nافتتاحي: ${money(row.openingBalance)} | تحصيل غير موزع: ${money(row.unallocatedCredit)}`).join('\n\n');
  return sendMessage(chatId,`💵 <b>أكبر الأرصدة الدائنة للعملاء</b>\nإجمالي الأرصدة الدائنة: <b>${money(total)}</b>\n\n${body}`.slice(0,3900));
}
async function sendConcentration(chatId,identity){
  const data=await loadCustomerAnalytics(identity),rows=[...data.rows].filter(x=>x.debitBalance>0.009).sort((a,b)=>b.debitBalance-a.debitBalance),total=data.totals.debitBalance;
  if(!rows.length)return sendMessage(chatId,'لا توجد مديونية مدينة لحساب تركّز العملاء.');
  const sum=count=>rows.slice(0,count).reduce((out,row)=>out+row.debitBalance,0),top5=sum(5),top10=sum(10),largest=rows[0],level=top5/total>=0.7?'مرتفع جدًا':top5/total>=0.5?'مرتفع':top5/total>=0.35?'متوسط':'موزع';
  return sendMessage(chatId,`🎯 <b>تحليل تركيز المديونية</b>\n\nإجمالي المديونية: <b>${money(total)}</b>\nأكبر عميل: <b>${esc(largest.name)}</b> — ${money(largest.debitBalance)} — ${pct(largest.debitBalance/total)}\nأكبر 5 عملاء: <b>${money(top5)}</b> — ${pct(top5/total)}\nأكبر 10 عملاء: <b>${money(top10)}</b> — ${pct(top10/total)}\nدرجة التركّز: <b>${esc(level)}</b>\n\n${top5/total>=0.5?'تنبيه رقابي: أكثر من نصف المديونية متركز في خمسة عملاء؛ راجع حدود الائتمان وخطة التحصيل.':'التوزيع لا يظهر تركّزًا حادًا في أكبر خمسة عملاء.'}`);
}
async function sendAging(chatId,identity){
  const data=await loadCustomerAnalytics(identity),a=data.totals.aging;
  return sendMessage(chatId,`📅 <b>أعمار ديون العملاء</b>\n\nرصيد افتتاحي موجب غير موزع زمنيًا: <b>${money(data.totals.openingDebit)}</b>\nغير مستحق/حالي من الفواتير: <b>${money(a.current)}</b>\nمن 1 إلى 30 يومًا: <b>${money(a.days1to30)}</b>\nمن 31 إلى 60 يومًا: <b>${money(a.days31to60)}</b>\nمن 61 إلى 90 يومًا: <b>${money(a.days61to90)}</b>\nأكثر من 90 يومًا: <b>${money(a.days90plus)}</b>\n\nلا يُوضع الرصيد الافتتاحي داخل شريحة عمرية دون تواريخ الفواتير الأصلية. الفواتير الجديدة تُصنف حسب تاريخ التسليم ومدة السداد.`);
}
async function sendOverdue(chatId,identity,page=0){
  const data=await loadCustomerAnalytics(identity),rows=data.rows.filter(x=>x.overdue>0).sort((a,b)=>b.aging.days90plus-a.aging.days90plus||b.overdue-a.overdue);
  if(!rows.length)return sendMessage(chatId,'لا توجد أرصدة متأخرة مؤرخة ضمن نطاق صلاحيتك.');
  const formatRow=(row,index)=>`${index+1}. <b>${esc(row.name)}</b>${row.code?` — <code>${esc(row.code)}</code>`:''}\nالمتأخر: <b>${money(row.overdue)}</b> | فوق 90 يومًا: <b>${money(row.aging.days90plus)}</b>\nالرصيد الحالي: ${money(row.debitBalance)} | آخر تحصيل: ${esc(row.lastCollection||'لا يوجد')}`;
  const built=sendPage(chatId,'⚠️ العملاء المتأخرون',rows,formatRow,page);
  return sendMessage(chatId,built.text,paginationButtons('overdue',built.page,built.totalPages));
}
async function sendNoMovement(chatId,identity,page=0){
  const data=await loadCustomerAnalytics(identity),rows=data.rows.filter(x=>x.openingCount&&!x.invoiceCount&&!x.collectionCount).sort((a,b)=>Math.abs(b.netBalance)-Math.abs(a.netBalance));
  if(!rows.length)return sendMessage(chatId,'لا يوجد عملاء برصيد افتتاحي دون حركة لاحقة.');
  const formatRow=(row,index)=>`${index+1}. <b>${esc(row.name)}</b>${row.code?` — <code>${esc(row.code)}</code>`:''} — ${money(row.netBalance)}\nتاريخ الافتتاح: ${esc(row.openingDate||'غير محدد')}`;
  const built=sendPage(chatId,'😴 عملاء بدون حركة بعد الرصيد الافتتاحي',rows,formatRow,page);
  return sendMessage(chatId,built.text,paginationButtons('nomovement',built.page,built.totalPages));
}
async function sendZeroBalances(chatId,identity,page=0){
  const data=await loadCustomerAnalytics(identity),rows=data.rows.filter(x=>Math.abs(currentBalance(x))<0.01).sort((a,b)=>a.name.localeCompare(b.name,'ar'));
  if(!rows.length)return sendMessage(chatId,'لا توجد حسابات صفرية ضمن نطاق صلاحيتك.');
  const formatRow=(row,index)=>`${index+1}. <b>${esc(row.name)}</b>${row.code?` — <code>${esc(row.code)}</code>`:''}`;
  const built=sendPage(chatId,'⚪ الحسابات الصفرية',rows,formatRow,page,'تُعامل الفروق الأقل من هللة كصفر.');
  return sendMessage(chatId,built.text,paginationButtons('zerobal',built.page,built.totalPages));
}
// "أصغر 100 عميل تحت 200 ريال" / "أصغر 30 عميل فوق 500" — عدد محدد مع حد
// مبلغ اختياري معًا. الترتيب دائمًا تصاعدي (الأصغر أولًا)؛ حد المبلغ (تحت/فوق)
// مستقل عن الترتيب.
async function sendSmallestOrLargest(chatId,identity,count,thresholdValue,filterMode,page=0){
  const data=await loadCustomerAnalytics(identity);let rows=data.rows.filter(row=>row.debitBalance>0.009);
  if(filterMode==='lt'&&thresholdValue!==null)rows=rows.filter(row=>row.debitBalance<thresholdValue);
  else if(filterMode==='gt'&&thresholdValue!==null)rows=rows.filter(row=>row.debitBalance>thresholdValue);
  if(!rows.length)return sendMessage(chatId,'لا يوجد عملاء يطابقون الشرط.');
  rows.sort((a,b)=>a.debitBalance-b.debitBalance);
  rows=rows.slice(0,count);
  const total=rows.reduce((sum,row)=>sum+row.debitBalance,0);
  const title=`🔎 أصغر ${rows.length} عميل${thresholdValue!==null?` ${filterMode==='gt'?'فوق':'تحت'} ${money(thresholdValue)}`:''}`;
  const formatRow=(row,index)=>`${index+1}. <b>${esc(row.name)}</b>${row.code?` — <code>${esc(row.code)}</code>`:''} — ${money(row.debitBalance)}`;
  const built=sendPage(chatId,title,rows,formatRow,page,`إجمالي أرصدتهم مجتمعة: <b>${money(total)} ر.س</b>`);
  return sendMessage(chatId,built.text,paginationButtons('smallest',built.page,built.totalPages,`${count}:${filterMode||''}:${thresholdValue??''}`));
}
async function sendBalanceFilter(chatId,identity,mode,min,max=null,page=0){
  const data=await loadCustomerAnalytics(identity);let rows=data.rows.filter(row=>row.debitBalance>0.009);
  if(mode==='gt')rows=rows.filter(row=>row.debitBalance>min);else if(mode==='lt')rows=rows.filter(row=>row.debitBalance<min);else rows=rows.filter(row=>row.debitBalance>=Math.min(min,max)&&row.debitBalance<=Math.max(min,max));
  rows.sort((a,b)=>b.debitBalance-a.debitBalance);if(!rows.length)return sendMessage(chatId,'لا يوجد عملاء يطابقون شرط الرصيد.');
  const total=rows.reduce((sum,row)=>sum+row.debitBalance,0);
  const label=mode==='gt'?`أكبر من ${money(min)}`:mode==='lt'?`أقل من ${money(min)}`:`بين ${money(Math.min(min,max))} و${money(Math.max(min,max))}`;
  const formatRow=(row,index)=>`${index+1}. <b>${esc(row.name)}</b>${row.code?` — <code>${esc(row.code)}</code>`:''} — ${money(row.debitBalance)}`;
  const built=sendPage(chatId,`🧮 عملاء برصيد ${label}`,rows,formatRow,page,`إجمالي أرصدتهم مجتمعة: <b>${money(total)} ر.س</b>`);
  return sendMessage(chatId,built.text,paginationButtons('balance',built.page,built.totalPages,`${mode}:${min}:${max??''}`));
}
function invoiceLine(row){const type=salesTypeLabel[row.sales_type]||row.sales_type||'';return `• <b>${esc(row.reference_no||'فاتورة')}</b> — ${esc(type)}\n  الإجمالي ${money(row.total)} | المتبقي ${money(row.outstanding)}${row.daysLate?` | تأخير ${row.daysLate} يوم`:''}`;}
function collectionLine(row){return `• <b>${esc(row.reference_no||'تحصيل')}</b> — ${money(row.amount)}${row.unallocated?` | غير موزع ${money(row.unallocated)}`:''}\n  ${esc(String(row.occurred_at||row.created_at||'').slice(0,10)||'بدون تاريخ')}`;}
async function sendCustomerStatement(chatId,identity,query){
  const data=await loadCustomerAnalytics(identity),matches=findCustomers(data,query);
  if(!matches.length)return sendMessage(chatId,`لم أجد عميلًا مطابقًا لـ <b>${esc(query)}</b> ضمن نطاق صلاحيتك. استخدم كود العميل أو جزءًا أوضح من الاسم.`);
  if(matches.length>1&&norm(matches[0].name)!==norm(query)&&norm(matches[0].code)!==norm(query)){
    const list=matches.slice(0,8).map((row,index)=>`${index+1}. <b>${esc(row.name)}</b>${row.code?` — <code>${esc(row.code)}</code>`:''} — ${money(currentBalance(row))}`).join('\n');return sendMessage(chatId,`وجدت أكثر من عميل. أرسل الكود أو الاسم الكامل:\n\n${list}`);
  }
  const row=matches[0],recentSales=row.sales.slice(0,6),recentCollections=row.collectionRows.slice(0,5),header=`<b>كشف حساب العميل</b>\nالعميل: <b>${esc(row.name)}</b>${row.code?`\nالكود: <code>${esc(row.code)}</code>`:''}${row.phone?`\nالجوال: ${esc(row.phone)}`:''}\n\n<b>الرصيد الافتتاحي</b>\nالرصيد: <b>${money(row.openingBalance)}</b>\nالتاريخ: <b>${esc(row.openingDate||'غير مسجل')}</b>\nالشيكات: <b>${money(row.openingCheques)}</b>\n\n<b>الحركة بعد الافتتاح</b>\nالمبيعات: <b>${money(row.grossSales)}</b>\nالمسدد الموزع: <b>${money(row.paidApplied)}</b>\nالتحصيلات: <b>${money(row.collections)}</b>\nتحصيل دائن غير موزع: <b>${money(row.unallocatedCredit)}</b>\n\n<b>الموقف الحالي</b>\nالرصيد النهائي: <b>${money(row.netBalance)}</b>\nمديونية مدينة: <b>${money(row.debitBalance)}</b>\nرصيد دائن: <b>${money(row.creditBalance)}</b>\nمتأخر مؤرخ: <b>${money(row.overdue)}</b>\nالحد الائتماني: <b>${row.creditLimit?money(row.creditLimit):'غير مضبوط'}</b>\nاستخدام الحد: <b>${pct(row.utilization)}</b>\nالقرار: <b>${esc(decisionLabel[row.decision])}</b>`;
  const invoices=recentSales.length?`\n\n<b>أحدث الفواتير</b>\n${recentSales.map(invoiceLine).join('\n')}`:'\n\nلا توجد فواتير بعد الرصيد الافتتاحي.',receipts=recentCollections.length?`\n\n<b>أحدث التحصيلات</b>\n${recentCollections.map(collectionLine).join('\n')}`:'\n\nلا توجد تحصيلات بعد الرصيد الافتتاحي.';
  return sendMessage(chatId,`${header}${invoices}${receipts}`.slice(0,3900));
}
function field(text,label){const match=String(text||'').match(new RegExp(`(?:^|\\n)\\s*${label}\\s*[:：-]\\s*(.+)`,'i'));return match?.[1]?.trim()||'';}
function parseCustomer(text){const name=field(text,'(?:الاسم|اسم العميل)'),code=field(text,'(?:الكود|كود العميل|رقم العميل)'),phone=field(text,'(?:الجوال|الهاتف|رقم الجوال)'),limit=Number(String(field(text,'(?:حد الائتمان|الحد الائتماني)')||'0').replace(/[^0-9.]/g,''))||0,days=Math.round(Number(String(field(text,'(?:أيام السداد|مدة السداد)')||'0').replace(/[^0-9.]/g,''))||0);return{name,code,phone,creditLimit:limit,paymentDays:days};}
async function startCustomerCreate(message,identity){if(!canCreate(identity))return sendMessage(message.chat.id,'تسجيل عميل جديد متاح للإدارة والمحاسب.');await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,'enterprise_customer_create',{startedAt:new Date().toISOString()});return sendMessage(message.chat.id,'أرسل بيانات العميل في رسالة واحدة:\n\nالاسم: مؤسسة المثال\nالكود: 10021\nالجوال: 05xxxxxxxx\nحد الائتمان: 50000\nأيام السداد: 30\n\nلن يُحفظ العميل قبل المراجعة والتأكيد.');}
async function createCustomer(message,identity,draft){
  const duplicate=(await select('customers',`customer_code=eq.${encodeURIComponent(draft.code)}&select=id,customer_name&limit=1`).catch(()=>[]))?.[0];if(duplicate)return sendMessage(message.chat.id,`كود العميل مستخدم بالفعل للعميل <b>${esc(duplicate.customer_name)}</b>.`);
  const externalId=`TG-${draft.code}-${crypto.randomUUID().slice(0,8)}`,rows=await insert('customers',[{external_id:externalId,customer_code:draft.code,customer_name:draft.name,phone:draft.phone||null,credit_limit:draft.creditLimit,payment_days:draft.paymentDays,active:true,created_at:new Date().toISOString(),updated_at:new Date().toISOString()}]),customer=rows?.[0];
  await insert('audit_log',[{actor_type:'telegram',actor_id:String(identity.user_id||identity.external_id),action:'customer_created',entity_type:'customer',entity_id:String(customer?.id||externalId),details:{customer_code:draft.code,customer_name:draft.name,phone:draft.phone||null,credit_limit:draft.creditLimit,payment_days:draft.paymentDays,source_chat_id:String(message.chat.id),source_message_id:String(message.message_id)}}],{prefer:'return=minimal'}).catch(()=>{});await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id).catch(()=>{});
  return sendMessage(message.chat.id,`تم إنشاء العميل في سجل الموقع.\nالاسم: <b>${esc(draft.name)}</b>\nالكود: <code>${esc(draft.code)}</code>\nحد الائتمان: <b>${money(draft.creditLimit)}</b>\nأيام السداد: <b>${draft.paymentDays}</b>`);
}
export async function startCustomerLookup(message,identity){if(!canView(identity))return deny(message.chat.id);await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,'enterprise_customer_lookup',{startedAt:new Date().toISOString()});return sendMessage(message.chat.id,'اكتب كود العميل أو اسمه. مثال: 10021 أو مؤسسة بن حامد. سيظهر الرصيد الافتتاحي والحركة والرصيد النهائي.');}
export async function continueCustomerReportSession(message,identity,session,text){
  if(session?.state==='enterprise_customer_create'){
    const draft=parseCustomer(text),missing=[];if(!draft.name)missing.push('الاسم');if(!draft.code)missing.push('الكود');if(draft.paymentDays<0||draft.paymentDays>3650)missing.push('أيام السداد الصحيحة');if(missing.length){await sendMessage(message.chat.id,`البيانات الناقصة أو غير الصحيحة: ${missing.join('، ')}. أعد إرسال النموذج كاملًا.`);return true;}
    await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,'enterprise_customer_create_confirm',{draft,startedAt:new Date().toISOString()});await sendMessage(message.chat.id,`<b>مراجعة العميل</b>\n\nالاسم: <b>${esc(draft.name)}</b>\nالكود: <code>${esc(draft.code)}</code>\nالجوال: ${esc(draft.phone||'غير مسجل')}\nحد الائتمان: <b>${money(draft.creditLimit)}</b>\nأيام السداد: <b>${draft.paymentDays}</b>`,keyboard([[{text:'تأكيد إنشاء العميل',callback_data:'ent:customer_create_confirm'}],[{text:'إلغاء',callback_data:'ent:customer_create_cancel'}]]));return true;
  }
  if(session?.state==='enterprise_customer_create_confirm'){await sendMessage(message.chat.id,'استخدم زر تأكيد إنشاء العميل أو الإلغاء.');return true;}
  if(session?.state!=='enterprise_customer_lookup')return false;const query=String(text||'').trim();if(query.length<2){await sendMessage(message.chat.id,'اكتب كودًا أو اسمًا أوضح.');return true;}await sendCustomerStatement(message.chat.id,identity,query);await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id).catch(()=>{});return true;
}
export async function handleCustomerReportCallback(message,from,identity,value){
  if(value==='customer_create')return startCustomerCreate({...message,from},identity);
  if(value==='customer_create_cancel'){await clearMaintenanceSession(message.chat.id,identity.external_id||from.id).catch(()=>{});return sendMessage(message.chat.id,'تم إلغاء تسجيل العميل.');}
  if(value==='customer_create_confirm'){
    if(!canCreate(identity))return sendMessage(message.chat.id,'ليست لديك صلاحية إنشاء العملاء.');const session=(await select('bot_sessions',`channel=eq.telegram&chat_id=eq.${encodeURIComponent(String(message.chat.id))}&external_user_id=eq.${encodeURIComponent(String(identity.external_id||from.id))}&select=*&limit=1`))?.[0];if(session?.state!=='enterprise_customer_create_confirm'||!session.context?.draft)return sendMessage(message.chat.id,'انتهت جلسة إنشاء العميل. ابدأ من جديد.');return createCustomer({...message,from},identity,session.context.draft);
  }
  if(!canView(identity))return deny(message.chat.id);
  if(value.startsWith('customer_page|')){
    const[,kind,pageRaw,extra='']=value.split('|'),page=Math.max(0,Number(pageRaw)||0),expired=()=>sendMessage(message.chat.id,'انتهت صلاحية هذه الصفحة (ربما بسبب تحديث النظام). أعد كتابة نفس الطلب من جديد.');
    if(kind==='topdebt')return sendTopDebt(message.chat.id,identity,extra?Number(extra):null,page);
    if(kind==='overdue')return sendOverdue(message.chat.id,identity,page);
    if(kind==='nomovement')return sendNoMovement(message.chat.id,identity,page);
    if(kind==='zerobal')return sendZeroBalances(message.chat.id,identity,page);
    if(kind==='balance'){const[mode,minRaw,maxRaw='']=extra.split(':');if(!['gt','lt','between'].includes(mode)||!Number.isFinite(Number(minRaw)))return expired();return sendBalanceFilter(message.chat.id,identity,mode,Number(minRaw),maxRaw?Number(maxRaw):null,page);}
    if(kind==='smallest'){const[countRaw,filterMode,thresholdRaw='']=extra.split(':');if(!Number.isFinite(Number(countRaw)))return expired();return sendSmallestOrLargest(message.chat.id,identity,Number(countRaw)||100,thresholdRaw?Number(thresholdRaw):null,filterMode||null,page);}
    return sendMessage(message.chat.id,'انتهت صلاحية هذه الصفحة. أعد طلب التقرير من جديد.');
  }
  if(value==='customer_menu')return sendCustomerReportsMenu(message.chat.id,identity);if(value==='customer_summary')return sendSummary(message.chat.id,identity);if(value==='customer_debt')return sendTopDebt(message.chat.id,identity);if(value==='customer_credit')return sendTopCredits(message.chat.id,identity);if(value==='customer_concentration')return sendConcentration(message.chat.id,identity);if(value==='customer_aging')return sendAging(message.chat.id,identity);if(value==='customer_overdue')return sendOverdue(message.chat.id,identity);if(value==='customer_no_movement')return sendNoMovement(message.chat.id,identity);if(value==='customer_zero')return sendZeroBalances(message.chat.id,identity);if(value==='customer_filter_help')return sendMessage(message.chat.id,'🧮 <b>أوامر الفلترة</b>\n• عملاء أكبر من 50000\n• عملاء أقل من 1000\n• عملاء بين 1000 و 5000\n• أكبر 20 عميل\n• أصغر 100 عميل تحت 200\n• رصيد 10001\n• كشف حساب مؤسسة بن حامد');if(value==='customer_lookup')return startCustomerLookup({...message,from},identity);return false;
}
export async function handleCustomerReportTextCommand(message,identity,text){
  const raw=String(text||'').trim(),value=norm(raw);
  if(/^(تسجيل عميل|اضافه عميل|إضافة عميل|عميل جديد)$/.test(value)){await startCustomerCreate(message,identity);return true;}
  if(/^\/(customers|clients)(?:@\w+)?$/i.test(raw)||/^(تقارير العملاء|تقرير العملاء|عملاء المصنع|العملاء|عملاء)$/.test(value)){await sendCustomerReportsMenu(message.chat.id,identity);return true;}
  if(/^(ملخص العملاء|اجمالي العملاء|إجمالي العملاء|الملخص التنفيذي للعملاء)$/.test(value)){if(!canView(identity))await deny(message.chat.id);else await sendSummary(message.chat.id,identity);return true;}
  const top=latinDigits(raw).match(/^(?:اكبر|أكبر)\s+(10|20|50)\s+(?:عميل|عملاء)(?:\s+مديونيه|\s+مديونية)?$/i);if(top){if(!canView(identity))await deny(message.chat.id);else await sendTopDebt(message.chat.id,identity,Number(top[1]));return true;}
  if(/^(اكبر المديونيات|أكبر المديونيات|مديونيات العملاء|اكبر العملاء|أكبر العملاء)$/.test(value)){if(!canView(identity))await deny(message.chat.id);else await sendTopDebt(message.chat.id,identity);return true;}
  if(/^(اكبر الارصده الدائنه|أكبر الأرصدة الدائنة|ارصده العملاء الدائنه|أرصدة العملاء الدائنة|دفعات العملاء المقدمه|دفعات العملاء المقدمة)$/.test(value)){if(!canView(identity))await deny(message.chat.id);else await sendTopCredits(message.chat.id,identity);return true;}
  if(/^(تركيز المديونيه|تركيز المديونية|تحليل تركيز المديونيه|تحليل تركيز المديونية)$/.test(value)){if(!canView(identity))await deny(message.chat.id);else await sendConcentration(message.chat.id,identity);return true;}
  if(/^(اعمار الديون|أعمار الديون|تحليل اعمار الديون|تحليل أعمار الديون)$/.test(value)){if(!canView(identity))await deny(message.chat.id);else await sendAging(message.chat.id,identity);return true;}
  if(/^(العملاء المتاخرون|العملاء المتأخرون|مديونيات متاخره|مديونيات متأخرة)$/.test(value)){if(!canView(identity))await deny(message.chat.id);else await sendOverdue(message.chat.id,identity);return true;}
  if(/^(عملاء بدون حركه|عملاء بدون حركة|بدون حركه|بدون حركة)$/.test(value)){if(!canView(identity))await deny(message.chat.id);else await sendNoMovement(message.chat.id,identity);return true;}
  if(/^(الحسابات الصفريه|الحسابات الصفرية|عملاء رصيد صفر|ارصده صفريه|أرصدة صفرية)$/.test(value)){if(!canView(identity))await deny(message.chat.id);else await sendZeroBalances(message.chat.id,identity);return true;}
  const smallest=latinDigits(raw).match(/^(?:ال)?(اصغر|أصغر)\s+(\d+)\s+(?:عميل|عملاء)(?:\s+(تحت|فوق|اقل من|أقل من|اكبر من|أكبر من))?\s*([\d.,٬،٫-]+)?\s*(?:ريال|ر\.س|رس)?$/i);
  if(smallest){
    if(!canView(identity)){await deny(message.chat.id);return true;}
    const count=Math.max(1,Math.min(500,Number(smallest[2])||100)),thresholdWord=smallest[3]||'',thresholdValue=smallest[4]?parseMoney(smallest[4]):null;
    const filterMode=thresholdValue===null?null:(/فوق|اكبر من|أكبر من/.test(thresholdWord)?'gt':'lt');
    await sendSmallestOrLargest(message.chat.id,identity,count,thresholdValue,filterMode);
    return true;
  }
  const between=latinDigits(raw).match(/^(?:ال)?عملاء\s+بين\s+([\d.,٬،٫-]+)\s+(?:و|الى|إلى)\s+([\d.,٬،٫-]+)$/i);if(between){if(!canView(identity))await deny(message.chat.id);else await sendBalanceFilter(message.chat.id,identity,'between',parseMoney(between[1]),parseMoney(between[2]));return true;}
  const compare=latinDigits(raw).match(/^(?:ال)?عملاء\s+(اكبر|أكبر|اكتر|أكتر|اقل|أقل)(?:\s+من)?(?:\s+([\d.,٬،٫-]+))?$/i);
  if(compare){
    if(!canView(identity)){await deny(message.chat.id);return true;}
    if(!compare[2]){await sendMessage(message.chat.id,'اكتب الرقم كمان، مثال: «عملاء اقل من 50» أو «عملاء اكبر من 1000».');return true;}
    await sendBalanceFilter(message.chat.id,identity,/اكبر|أكبر|اكتر|أكتر/.test(compare[1])?'gt':'lt',parseMoney(compare[2]));return true;
  }
  const direct=raw.match(/^(?:\/client(?:@\w+)?|كشف حساب(?: عميل)?|كشف عميل|تقرير عميل|مديونيه عميل|مديونية عميل|حساب عميل|رصيد(?: العميل)?|رصيد عميل)\s+(.{2,})$/i);
  if(direct){if(!canView(identity))await deny(message.chat.id);else await sendCustomerStatement(message.chat.id,identity,direct[1]);return true;}
  return false;
}
