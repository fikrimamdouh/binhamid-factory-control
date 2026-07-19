import crypto from 'node:crypto';
import { sendMessage, keyboard } from './telegram.js';
import { clearMaintenanceSession } from './bot-maintenance.js';
import { esc, formatAmount, norm, setEnterpriseSession } from './bot-enterprise-store.js';
import { findCustomers, loadCustomerAnalytics } from './bot-customer-report-data.js';
import { insert, select } from './supabase.js';

const REPORT_ROLES=new Set(['admin','manager','accountant','block_sales','concrete_sales','collector']);
const CREATE_ROLES=new Set(['admin','manager','accountant']);
const decisionLabel={normal:'طبيعي',watch:'مراجعة ومتابعة',stop:'إيقاف البيع الآجل حتى المراجعة'};
const salesTypeLabel={block:'بلوك',concrete:'خرسانة'};
const canView=identity=>Boolean(identity?.active&&REPORT_ROLES.has(identity.role));
const canCreate=identity=>Boolean(identity?.active&&CREATE_ROLES.has(identity.role));
const money=value=>`${formatAmount(value)} ر.س`;
const pct=value=>value===null||value===undefined?'غير محدد':`${formatAmount(value*100)}%`;
async function sendPaged(chatId,heading,items=[]){
  let page=heading,last=null;
  for(const item of items){
    const next=`${page}\n\n${item}`;
    if(next.length>3900&&page!==heading){last=await sendMessage(chatId,page);page=`${heading}\n\n${item}`;}else page=next;
  }
  return sendMessage(chatId,page);
}

export function customerReportsMenu(){return keyboard([
  [{text:'كشف حساب عميل',callback_data:'ent:customer_lookup'},{text:'أرصدة العملاء',callback_data:'ent:customer_balances'}],
  [{text:'الملخص التنفيذي',callback_data:'ent:customer_summary'},{text:'أكبر المديونيات',callback_data:'ent:customer_debt'}],
  [{text:'أكبر العملاء مبيعات',callback_data:'ent:customer_sales'},{text:'أعمار الديون',callback_data:'ent:customer_aging'}],
  [{text:'العملاء المتأخرون',callback_data:'ent:customer_overdue'},{text:'تسجيل عميل جديد',callback_data:'ent:customer_create'}]
]);}
async function deny(chatId){return sendMessage(chatId,'تقارير العملاء متاحة للإدارة والمحاسب والمبيعات والتحصيل وفق نطاق كل دور.');}
export async function sendCustomerReportsMenu(chatId,identity){
  if(!canView(identity))return deny(chatId);
  const scope=identity.role==='block_sales'?'عملاء البلوك فقط':identity.role==='concrete_sales'?'عملاء الخرسانة فقط':'جميع العملاء';
  return sendMessage(chatId,`<b>مركز تقارير العملاء</b>\nالنطاق: <b>${esc(scope)}</b>\n\nالأرصدة موحدة من الرصيد الافتتاحي، أوامر البيع، التحصيلات والدفعات المقدمة المحفوظة في النظام.`,customerReportsMenu());
}
function summaryText(data){
  const t=data.totals,netLabel=t.netBalance>=0?'صافي مديونية على العملاء':'صافي أرصدة دائنة للعملاء';
  return `<b>الملخص التنفيذي للعملاء</b>\nحتى: <b>${esc(data.asOf)}</b>\n\n<b>قاعدة الرصيد</b>\nأرصدة افتتاحية مدينة: <b>${money(t.openingDebit)}</b>\nأرصدة افتتاحية دائنة: <b>${money(t.openingCredit)}</b>\nمبيعات مسجلة: <b>${money(t.grossSales)}</b>\nمسدد موزع على الفواتير: <b>${money(t.paidApplied)}</b>\nتحصيلات مسجلة: <b>${money(t.collections)}</b>\nدفعات مقدمة غير موزعة: <b>${money(t.unallocatedCredit)}</b>\n\n<b>الموقف الحالي</b>\nإجمالي المديونية: <b>${money(t.balance)}</b>\nأرصدة دائنة للعملاء: <b>${money(t.creditBalance)}</b>\n${netLabel}: <b>${money(Math.abs(t.netBalance))}</b>\nالمتأخر: <b>${money(t.overdue)}</b> — ${pct(t.overdueRatio)} من المديونية\nنسبة تغطية المبيعات بالمسدد: <b>${pct(t.collectionRatio)}</b>\n\n<b>الرقابة</b>\nعملاء ذوو حركة: <b>${t.customers}</b>\nإيقاف بيع آجل: <b>${t.stopped}</b>\nمراجعة ومتابعة: <b>${t.watch}</b>`;
}
async function sendSummary(chatId,identity){return sendMessage(chatId,summaryText(await loadCustomerAnalytics(identity)));}
function debtLine(row,index){
  return `${index+1}. <b>${esc(row.name)}</b>${row.code?` — <code>${esc(row.code)}</code>`:''}\nالرصيد: <b>${money(row.balance)}</b> | المتأخر: <b>${money(row.overdue)}</b>\nافتتاحي: ${money(row.openingBalance)} | آخر تحصيل: ${esc(row.lastCollection||'لا يوجد')}\nالحد: ${row.creditLimit?money(row.creditLimit):'غير مضبوط'} | القرار: <b>${esc(decisionLabel[row.decision])}</b>`;
}
async function sendTopDebt(chatId,identity){
  const data=await loadCustomerAnalytics(identity),rows=[...data.rows].filter(row=>row.balance>0).sort((a,b)=>b.balance-a.balance).slice(0,15);
  if(!rows.length)return sendMessage(chatId,'لا توجد مديونيات قائمة ضمن نطاق صلاحيتك.');
  return sendPaged(chatId,`<b>أكبر مديونيات العملاء</b>\nحتى: <b>${esc(data.asOf)}</b>\nإجمالي المديونية: <b>${money(data.totals.balance)}</b>`,rows.map(debtLine));
}
async function sendBalances(chatId,identity){
  const data=await loadCustomerAnalytics(identity),debtors=[...data.rows].filter(row=>row.balance>0).sort((a,b)=>b.balance-a.balance).slice(0,20),creditors=[...data.rows].filter(row=>row.creditBalance>0).sort((a,b)=>b.creditBalance-a.creditBalance).slice(0,10);
  if(!debtors.length&&!creditors.length)return sendMessage(chatId,'لا توجد أرصدة عملاء مسجلة ضمن نطاق صلاحيتك.');
  const debts=debtors.length?`<b>أرصدة مدينة على العملاء</b>\n${debtors.map((row,index)=>`${index+1}. ${esc(row.name)}${row.code?` — <code>${esc(row.code)}</code>`:''}: <b>${money(row.balance)}</b>`).join('\n')}`:'لا توجد أرصدة مدينة.';
  const credits=creditors.length?`<b>دفعات مقدمة وأرصدة دائنة</b>\n${creditors.map((row,index)=>`${index+1}. ${esc(row.name)}${row.code?` — <code>${esc(row.code)}</code>`:''}: <b>${money(row.creditBalance)}</b>`).join('\n')}`:'لا توجد أرصدة دائنة.';
  return sendMessage(chatId,`<b>تقرير أرصدة العملاء</b>\nحتى: <b>${esc(data.asOf)}</b>\n\nإجمالي المدين: <b>${money(data.totals.balance)}</b>\nإجمالي الدائن: <b>${money(data.totals.creditBalance)}</b>\nالصافي: <b>${money(data.totals.netBalance)}</b>\n\n${debts}\n\n${credits}`);
}
async function sendTopSales(chatId,identity){
  const data=await loadCustomerAnalytics(identity),rows=[...data.rows].filter(row=>row.grossSales>0).sort((a,b)=>b.grossSales-a.grossSales).slice(0,15);
  if(!rows.length)return sendMessage(chatId,'لا توجد مبيعات عملاء مسجلة ضمن نطاق صلاحيتك.');
  const body=rows.map((row,index)=>`${index+1}. <b>${esc(row.name)}</b>${row.code?` — <code>${esc(row.code)}</code>`:''}\nالمبيعات: <b>${money(row.grossSales)}</b> | المسدد: <b>${money(row.paidApplied)}</b>\nالمتبقي من المبيعات: <b>${money(row.salesOutstanding)}</b> | الفواتير: <b>${row.invoiceCount}</b>`).join('\n\n');
  return sendPaged(chatId,`<b>أكبر العملاء حسب المبيعات</b>\nحتى: <b>${esc(data.asOf)}</b>`,body.split('\n\n'));
}
async function sendAging(chatId,identity){
  const data=await loadCustomerAnalytics(identity),a=data.totals.aging,total=data.totals.balance||1;
  return sendMessage(chatId,`<b>تحليل أعمار ديون العملاء</b>\nحتى: <b>${esc(data.asOf)}</b>\n\nحالي/غير مستحق: <b>${money(a.current)}</b> — ${pct(a.current/total)}\n1–30 يومًا: <b>${money(a.days1to30)}</b> — ${pct(a.days1to30/total)}\n31–60 يومًا: <b>${money(a.days31to60)}</b> — ${pct(a.days31to60/total)}\n61–90 يومًا: <b>${money(a.days61to90)}</b> — ${pct(a.days61to90/total)}\nأكثر من 90 يومًا: <b>${money(a.days90plus)}</b> — ${pct(a.days90plus/total)}\n\nإجمالي المتأخر: <b>${money(data.totals.overdue)}</b> — ${pct(data.totals.overdueRatio)} من المديونية.`);
}
async function sendOverdue(chatId,identity){
  const data=await loadCustomerAnalytics(identity),rows=data.rows.filter(row=>row.overdue>0).sort((a,b)=>b.aging.days90plus-a.aging.days90plus||b.overdue-a.overdue).slice(0,15);
  if(!rows.length)return sendMessage(chatId,'لا توجد أرصدة متأخرة ضمن نطاق صلاحيتك.');
  const body=rows.map((row,index)=>`${index+1}. <b>${esc(row.name)}</b>${row.code?` — <code>${esc(row.code)}</code>`:''}\nالمتأخر: <b>${money(row.overdue)}</b> | فوق 90 يومًا: <b>${money(row.aging.days90plus)}</b>\nالرصيد الكلي: <b>${money(row.balance)}</b> | آخر تحصيل: ${esc(row.lastCollection||'لا يوجد')}`).join('\n\n');
  return sendPaged(chatId,`<b>العملاء المتأخرون</b>\nحتى: <b>${esc(data.asOf)}</b>`,body.split('\n\n'));
}
function invoiceLine(row){const type=salesTypeLabel[row.sales_type]||row.sales_type||'';return `• <b>${esc(row.reference_no||'فاتورة')}</b> — ${esc(type)}\n  الإجمالي ${money(row.total)} | المسدد ${money(row.paid)} | المتبقي ${money(row.outstanding)}${row.daysLate?` | تأخير ${row.daysLate} يوم`:''}`;}
function collectionLine(row){return `• <b>${esc(row.reference_no||'تحصيل')}</b> — ${money(row.amount)}${row.unallocated?` | دفعة مقدمة ${money(row.unallocated)}`:''}\n  ${esc(String(row.occurred_at||row.created_at||'').slice(0,10)||'بدون تاريخ')}`;}
async function sendCustomerStatement(chatId,identity,query){
  const data=await loadCustomerAnalytics(identity),matches=findCustomers(data,query);
  if(!matches.length)return sendMessage(chatId,`لم أجد عميلًا مطابقًا لـ <b>${esc(query)}</b> ضمن نطاق صلاحيتك. استخدم كود العميل أو جزءًا أوضح من الاسم.`);
  if(matches.length>1&&norm(matches[0].name)!==norm(query)&&norm(matches[0].code)!==norm(query)){
    const list=matches.slice(0,8).map((row,index)=>`${index+1}. <b>${esc(row.name)}</b>${row.code?` — <code>${esc(row.code)}</code>`:''} — ${row.balance?money(row.balance):`دائن ${money(row.creditBalance)}`}`).join('\n');
    return sendMessage(chatId,`وجدت أكثر من عميل. أرسل الكود أو الاسم الكامل:\n\n${list}`);
  }
  const row=matches[0],recentSales=row.sales.slice(0,10),recentCollections=row.collectionRows.slice(0,10),position=row.balance>0?`مديونية على العميل: <b>${money(row.balance)}</b>`:row.creditBalance>0?`رصيد دائن/دفعة مقدمة للعميل: <b>${money(row.creditBalance)}</b>`:'الرصيد الحالي: <b>صفر</b>';
  const header=`<b>كشف حساب العميل</b>\nحتى: <b>${esc(data.asOf)}</b>\n\nالعميل: <b>${esc(row.name)}</b>${row.code?`\nالكود: <code>${esc(row.code)}</code>`:''}${row.phone?`\nالجوال: ${esc(row.phone)}`:''}\n\n<b>ملخص الحساب</b>\nالرصيد الافتتاحي: <b>${money(row.openingBalance)}</b>${row.openingDate?` — ${esc(row.openingDate)}`:''}\nالمبيعات: <b>${money(row.grossSales)}</b>\nالمسدد الموزع: <b>${money(row.paidApplied)}</b>\nإجمالي التحصيلات: <b>${money(row.collections)}</b>\nدفعات مقدمة غير موزعة: <b>${money(row.unallocatedCredit)}</b>\n${position}\nالمتأخر: <b>${money(row.overdue)}</b>\nالحد الائتماني: <b>${row.creditLimit?money(row.creditLimit):'غير مضبوط'}</b>\nاستخدام الحد: <b>${pct(row.utilization)}</b>\nآخر بيع: <b>${esc(row.lastSale||'لا يوجد')}</b>\nآخر تحصيل: <b>${esc(row.lastCollection||'لا يوجد')}</b>\nقرار المتابعة: <b>${esc(decisionLabel[row.decision])}</b>`;
  const invoices=recentSales.length?`\n\n<b>أحدث الفواتير</b>\n${recentSales.map(invoiceLine).join('\n')}`:'\n\nلا توجد فواتير مسجلة.';
  const receipts=recentCollections.length?`\n\n<b>أحدث التحصيلات</b>\n${recentCollections.map(collectionLine).join('\n')}`:'\n\nلا توجد تحصيلات مسجلة.';
  const full=`${header}${invoices}${receipts}`;
  if(full.length<=4000)return sendMessage(chatId,full);
  await sendMessage(chatId,header);return sendMessage(chatId,`${invoices}${receipts}`);
}
function field(text,label){const match=String(text||'').match(new RegExp(`(?:^|\\n)\\s*${label}\\s*[:：-]\\s*(.+)`,'i'));return match?.[1]?.trim()||'';}
function parseCustomer(text){
  const name=field(text,'(?:الاسم|اسم العميل)'),code=field(text,'(?:الكود|كود العميل|رقم العميل)'),phone=field(text,'(?:الجوال|الهاتف|رقم الجوال)'),limit=Number(String(field(text,'(?:حد الائتمان|الحد الائتماني)')||'0').replace(/[^0-9.]/g,''))||0,days=Math.round(Number(String(field(text,'(?:أيام السداد|مدة السداد)')||'0').replace(/[^0-9.]/g,''))||0);
  return{name,code,phone,creditLimit:limit,paymentDays:days};
}
async function startCustomerCreate(message,identity){
  if(!canCreate(identity))return sendMessage(message.chat.id,'تسجيل عميل جديد متاح للإدارة والمحاسب.');
  await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,'enterprise_customer_create',{startedAt:new Date().toISOString()});
  return sendMessage(message.chat.id,'أرسل بيانات العميل في رسالة واحدة:\n\nالاسم: مؤسسة المثال\nالكود: 10021\nالجوال: 05xxxxxxxx\nحد الائتمان: 50000\nأيام السداد: 30\n\nلن يُحفظ العميل قبل المراجعة والتأكيد.');
}
async function createCustomer(message,identity,draft){
  const duplicate=(await select('customers',`customer_code=eq.${encodeURIComponent(draft.code)}&select=id,customer_name&limit=1`).catch(()=>[]))?.[0];
  if(duplicate)return sendMessage(message.chat.id,`كود العميل مستخدم بالفعل للعميل <b>${esc(duplicate.customer_name)}</b>.`);
  const externalId=`TG-${draft.code}-${crypto.randomUUID().slice(0,8)}`,rows=await insert('customers',[{external_id:externalId,customer_code:draft.code,customer_name:draft.name,phone:draft.phone||null,credit_limit:draft.creditLimit,payment_days:draft.paymentDays,active:true,created_at:new Date().toISOString(),updated_at:new Date().toISOString()}]),customer=rows?.[0];
  await insert('audit_log',[{actor_type:'telegram',actor_id:String(identity.user_id||identity.external_id),action:'customer_created',entity_type:'customer',entity_id:String(customer?.id||externalId),details:{customer_code:draft.code,customer_name:draft.name,phone:draft.phone||null,credit_limit:draft.creditLimit,payment_days:draft.paymentDays,source_chat_id:String(message.chat.id),source_message_id:String(message.message_id)}}],{prefer:'return=minimal'}).catch(()=>{});
  await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id).catch(()=>{});
  return sendMessage(message.chat.id,`تم إنشاء العميل في سجل الموقع.\nالاسم: <b>${esc(draft.name)}</b>\nالكود: <code>${esc(draft.code)}</code>\nحد الائتمان: <b>${money(draft.creditLimit)}</b>\nأيام السداد: <b>${draft.paymentDays}</b>`);
}
export async function startCustomerLookup(message,identity){
  if(!canView(identity))return deny(message.chat.id);
  await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,'enterprise_customer_lookup',{startedAt:new Date().toISOString()});
  return sendMessage(message.chat.id,'اكتب كود العميل أو اسمه. مثال: 10021 أو مصنع الأمل.');
}
export async function continueCustomerReportSession(message,identity,session,text){
  if(session?.state==='enterprise_customer_create'){
    const draft=parseCustomer(text),missing=[];if(!draft.name)missing.push('الاسم');if(!draft.code)missing.push('الكود');if(draft.paymentDays<0||draft.paymentDays>3650)missing.push('أيام السداد الصحيحة');if(missing.length){await sendMessage(message.chat.id,`البيانات الناقصة أو غير الصحيحة: ${missing.join('، ')}. أعد إرسال النموذج كاملًا.`);return true;}
    await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,'enterprise_customer_create_confirm',{draft,startedAt:new Date().toISOString()});
    await sendMessage(message.chat.id,`<b>مراجعة العميل</b>\n\nالاسم: <b>${esc(draft.name)}</b>\nالكود: <code>${esc(draft.code)}</code>\nالجوال: ${esc(draft.phone||'غير مسجل')}\nحد الائتمان: <b>${money(draft.creditLimit)}</b>\nأيام السداد: <b>${draft.paymentDays}</b>`,keyboard([[{text:'تأكيد إنشاء العميل',callback_data:'ent:customer_create_confirm'}],[{text:'إلغاء',callback_data:'ent:customer_create_cancel'}]]));return true;
  }
  if(session?.state==='enterprise_customer_create_confirm'){await sendMessage(message.chat.id,'استخدم زر تأكيد إنشاء العميل أو الإلغاء.');return true;}
  if(session?.state!=='enterprise_customer_lookup')return false;
  const query=String(text||'').trim();if(query.length<2){await sendMessage(message.chat.id,'اكتب كودًا أو اسمًا أوضح.');return true;}
  await sendCustomerStatement(message.chat.id,identity,query);await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id).catch(()=>{});return true;
}
export async function handleCustomerReportCallback(message,from,identity,value){
  if(value==='customer_create')return startCustomerCreate({...message,from},identity);
  if(value==='customer_create_cancel'){await clearMaintenanceSession(message.chat.id,identity.external_id||from.id).catch(()=>{});return sendMessage(message.chat.id,'تم إلغاء تسجيل العميل.');}
  if(value==='customer_create_confirm'){
    if(!canCreate(identity))return sendMessage(message.chat.id,'ليست لديك صلاحية إنشاء العملاء.');
    const session=(await select('bot_sessions',`channel=eq.telegram&chat_id=eq.${encodeURIComponent(String(message.chat.id))}&external_user_id=eq.${encodeURIComponent(String(identity.external_id||from.id))}&select=*&limit=1`))?.[0];
    if(session?.state!=='enterprise_customer_create_confirm'||!session.context?.draft)return sendMessage(message.chat.id,'انتهت جلسة إنشاء العميل. ابدأ من جديد.');
    return createCustomer({...message,from},identity,session.context.draft);
  }
  if(!canView(identity))return deny(message.chat.id);
  if(value==='customer_menu')return sendCustomerReportsMenu(message.chat.id,identity);
  if(value==='customer_summary')return sendSummary(message.chat.id,identity);
  if(value==='customer_balances')return sendBalances(message.chat.id,identity);
  if(value==='customer_debt')return sendTopDebt(message.chat.id,identity);
  if(value==='customer_sales')return sendTopSales(message.chat.id,identity);
  if(value==='customer_aging')return sendAging(message.chat.id,identity);
  if(value==='customer_overdue')return sendOverdue(message.chat.id,identity);
  if(value==='customer_lookup')return startCustomerLookup({...message,from},identity);
  return false;
}
export async function handleCustomerReportTextCommand(message,identity,text){
  const raw=String(text||'').trim(),value=norm(raw);
  if(/^(تسجيل عميل|اضافه عميل|إضافة عميل|عميل جديد)$/.test(value)){await startCustomerCreate(message,identity);return true;}
  if(/^\/(customers|clients)(?:@\w+)?$/i.test(raw)||/^(تقارير العملاء|تقرير العملاء|عملاء المصنع|مركز تقارير العملاء)$/.test(value)){await sendCustomerReportsMenu(message.chat.id,identity);return true;}
  if(/^(ملخص العملاء|اجمالي العملاء|إجمالي العملاء|الملخص التنفيذي للعملاء)$/.test(value)){if(!canView(identity))await deny(message.chat.id);else await sendSummary(message.chat.id,identity);return true;}
  if(/^(ارصده العملاء|أرصدة العملاء|موقف العملاء|رصيد العملاء)$/.test(value)){if(!canView(identity))await deny(message.chat.id);else await sendBalances(message.chat.id,identity);return true;}
  if(/^(اكبر المديونيات|أكبر المديونيات|مديونيات العملاء|اكبر العملاء مديونيه|أكبر العملاء مديونية)$/.test(value)){if(!canView(identity))await deny(message.chat.id);else await sendTopDebt(message.chat.id,identity);return true;}
  if(/^(اكبر العملاء|أكبر العملاء|اكبر العملاء مبيعات|أكبر العملاء مبيعات)$/.test(value)){if(!canView(identity))await deny(message.chat.id);else await sendTopSales(message.chat.id,identity);return true;}
  if(/^(اعمار الديون|أعمار الديون|تحليل اعمار الديون|تحليل أعمار الديون)$/.test(value)){if(!canView(identity))await deny(message.chat.id);else await sendAging(message.chat.id,identity);return true;}
  if(/^(العملاء المتاخرون|العملاء المتأخرون|متاخرات العملاء|متأخرات العملاء)$/.test(value)){if(!canView(identity))await deny(message.chat.id);else await sendOverdue(message.chat.id,identity);return true;}
  const direct=raw.match(/^(?:\/client(?:@\w+)?|كشف حساب عميل|كشف عميل|تقرير عميل|مديونية عميل|رصيد عميل|رصيد العميل|حساب عميل|حساب العميل)\s+(.{2,})$/i);
  if(direct){if(!canView(identity))await deny(message.chat.id);else await sendCustomerStatement(message.chat.id,identity,direct[1]);return true;}
  return false;
}
