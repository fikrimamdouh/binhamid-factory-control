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

export function customerReportsMenu(){return keyboard([
  [{text:'تسجيل عميل جديد',callback_data:'ent:customer_create'},{text:'كشف عميل',callback_data:'ent:customer_lookup'}],
  [{text:'ملخص العملاء',callback_data:'ent:customer_summary'},{text:'أكبر المديونيات',callback_data:'ent:customer_debt'}],
  [{text:'أعمار الديون',callback_data:'ent:customer_aging'},{text:'العملاء المتأخرون',callback_data:'ent:customer_overdue'}]
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
  if(value==='customer_debt')return sendTopDebt(message.chat.id,identity);
  if(value==='customer_aging')return sendAging(message.chat.id,identity);
  if(value==='customer_overdue')return sendOverdue(message.chat.id,identity);
  if(value==='customer_lookup')return startCustomerLookup({...message,from},identity);
  return false;
}
export async function handleCustomerReportTextCommand(message,identity,text){
  const raw=String(text||'').trim(),value=norm(raw);
  if(/^(تسجيل عميل|اضافه عميل|إضافة عميل|عميل جديد)$/.test(value)){await startCustomerCreate(message,identity);return true;}
  if(/^\/(customers|clients)(?:@\w+)?$/i.test(raw)||/^(تقارير العملاء|تقرير العملاء|عملاء المصنع)$/.test(value)){await sendCustomerReportsMenu(message.chat.id,identity);return true;}
  if(/^(ملخص العملاء|اجمالي العملاء|إجمالي العملاء)$/.test(value)){if(!canView(identity))await deny(message.chat.id);else await sendSummary(message.chat.id,identity);return true;}
  if(/^(اكبر المديونيات|أكبر المديونيات|مديونيات العملاء)$/.test(value)){if(!canView(identity))await deny(message.chat.id);else await sendTopDebt(message.chat.id,identity);return true;}
  if(/^(اعمار الديون|أعمار الديون|تحليل اعمار الديون|تحليل أعمار الديون)$/.test(value)){if(!canView(identity))await deny(message.chat.id);else await sendAging(message.chat.id,identity);return true;}
  const direct=raw.match(/^(?:\/client(?:@\w+)?|كشف عميل|تقرير عميل|مديونية عميل|حساب عميل)\s+(.{2,})$/i);
  if(direct){if(!canView(identity))await deny(message.chat.id);else await sendCustomerStatement(message.chat.id,identity,direct[1]);return true;}
  return false;
}
