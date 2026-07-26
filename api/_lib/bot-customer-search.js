import { sendMessage, sendDocumentBuffer, keyboard } from './telegram.js';
import { esc, formatAmount, norm, setEnterpriseSession } from './bot-enterprise-store.js';
import { findCustomers, loadCustomerAnalytics } from './bot-customer-report-data.js';
import { generateCustomerStatementPdf } from './customer-statement-pdf.js';

const REPORT_ROLES=new Set(['admin','manager','accountant','block_sales','concrete_sales','collector']);
const canView=identity=>Boolean(identity?.active&&REPORT_ROLES.has(identity.role));
const money=value=>`${formatAmount(value)} ر.س`;
const currentBalance=row=>Number(row.netBalance??row.balance??0)||0;
const decisionLabel={normal:'طبيعي',watch:'مراجعة قبل زيادة الائتمان',stop:'إيقاف البيع الآجل حتى المراجعة'};
const salesTypeLabel={block:'بلوك',concrete:'خرسانة'};

function invoiceLine(row){const type=salesTypeLabel[row.sales_type]||row.sales_type||'';return `• ${esc(String(row.delivery_date||row.created_at||'').slice(0,10)||'بدون تاريخ')} | <b>${esc(row.reference_no||'فاتورة')}</b> | ${esc(type)}\n  مدين ${money(row.total)} | مسدد ${money(row.paid)} | متبقي ${money(row.outstanding)}`;}
function collectionLine(row){const allocated=Number(row.allocated_amount??(Number(row.amount||0)-Number(row.unallocated||0)))||0,unallocated=Number(row.unallocated??row.unallocated_amount||0)||0;return `• ${esc(String(row.occurred_at||row.created_at||'').slice(0,10)||'بدون تاريخ')} | <b>${esc(row.reference_no||'تحصيل')}</b>\n  سداد ${money(row.amount)} | على الفواتير الجديدة ${money(allocated)}${unallocated?` | بعد الجديد ${money(unallocated)} يُخصم من الرصيد القديم`:''}`;}
function debtAllocation(row){
  const oldDebt=Math.max(0,Number(row.openingBalance||0)),newSales=Math.max(0,Number(row.grossSales||0)),paidNew=Math.min(newSales,Math.max(0,Number(row.paidApplied||0))),afterNew=Math.max(0,Number(row.unallocatedCredit||0)),paidOld=Math.min(oldDebt,afterNew),advance=Math.max(0,afterNew-paidOld),remainingNew=Math.max(0,newSales-paidNew),remainingOld=Math.max(0,oldDebt-paidOld);
  return{oldDebt,newSales,paidNew,paidOld,advance,remainingNew,remainingOld,totalPaid:Number(row.collections||0)};
}
function compactButtonName(value){let text=String(value||'عميل').trim()||'عميل';while(Buffer.byteLength(text,'utf8')>58)text=text.slice(0,-1);return text;}

async function sendStatement(chatId,identity,row,preserved={}){
  const recentSales=row.sales.slice(0,10),recentCollections=row.collectionRows.slice(0,10),movementCount=row.invoiceCount+row.collectionCount,a=debtAllocation(row);
  const text=`<b>كشف حساب عميل — مصنع بن حامد</b>\n━━━━━━━━━━━━━━\n<b>${esc(row.name)}</b>${row.code?`\nرقم الحساب: <code>${esc(row.code)}</code>`:''}${row.phone?`\nالجوال: ${esc(row.phone)}`:''}\nحتى تاريخ: <b>${esc(new Date().toISOString().slice(0,10))}</b>\n━━━━━━━━━━━━━━\n<b>تسوية الرصيد</b>\nالرصيد القديم${row.openingDate?` بتاريخ ${esc(row.openingDate)}`:''}: <b>${money(a.oldDebt)}</b>\nالفواتير الجديدة: <b>${money(a.newSales)}</b>${row.lastSale?` — آخر فاتورة ${esc(row.lastSale)}`:''}\nإجمالي ما سدده العميل: <b>${money(a.totalPaid)}</b>${row.lastCollection?` — آخر سداد ${esc(row.lastCollection)}`:''}\nخُصم من الفواتير الجديدة: <b>${money(a.paidNew)}</b>\nثم خُصم من الرصيد القديم: <b>${money(a.paidOld)}</b>\nالمتبقي من الفواتير الجديدة: <b>${money(a.remainingNew)}</b>\nالمتبقي من الرصيد القديم: <b>${money(a.remainingOld)}</b>${a.advance?`\nدفعة مقدمة/رصيد دائن: <b>${money(a.advance)}</b>`:''}\nالرصيد الحالي النهائي: <b>${money(currentBalance(row))}</b>\n\n<i>قاعدة التوزيع: يُقفل الجديد أولًا، ثم يُخصم الباقي من الرصيد القديم، وأي زيادة تصبح دفعة مقدمة.</i>\n━━━━━━━━━━━━━━\n<b>ملخص الحساب</b>\nمديونية على العميل: <b>${money(row.debitBalance)}</b>\nرصيد دائن للعميل: <b>${money(row.creditBalance)}</b>\nالمتأخر المؤرخ: <b>${money(row.overdue)}</b>\nعدد الحركات: <b>${movementCount}</b>\nالحالة الائتمانية: <b>${esc(decisionLabel[row.decision]||row.decision)}</b>${recentSales.length?`\n\n<b>أحدث الفواتير</b>\n${recentSales.map(invoiceLine).join('\n')}`:'\n\nلا توجد فواتير بعد الرصيد الافتتاحي.'}${recentCollections.length?`\n\n<b>أحدث التحصيلات</b>\n${recentCollections.map(collectionLine).join('\n')}`:'\n\nلا توجد تحصيلات بعد الرصيد الافتتاحي.'}\n\n<i>الحركات المعتمدة من التقرير اليومي تظهر تلقائيًا في هذا الكشف.</i>`;
  await setEnterpriseSession(chatId,identity.external_id||chatId,'enterprise_customer_last_statement',{code:row.code||'',name:row.name||'',query:preserved.query||'',choices:Array.isArray(preserved.choices)?preserved.choices:[],startedAt:preserved.startedAt||new Date().toISOString(),selectedAt:new Date().toISOString()});
  return sendMessage(chatId,text.slice(0,3900),keyboard([[{text:'كشف حساب PDF',callback_data:'ent:customer_pdf'}]]));
}

export async function sendStatementPdf(chatId,identity){
  if(!canView(identity))return sendMessage(chatId,'ليست لديك صلاحية عرض حسابات العملاء.');
  const { select }=await import('./supabase.js');
  const session=(await select('bot_sessions',`channel=eq.telegram&chat_id=eq.${encodeURIComponent(String(chatId))}&external_user_id=eq.${encodeURIComponent(String(identity.external_id||chatId))}&select=*&limit=1`).catch(()=>[]))?.[0];
  const ref=session?.state==='enterprise_customer_last_statement'?session.context:null;
  if(!ref||(!ref.code&&!ref.name))return sendMessage(chatId,'ابحث عن عميل أولًا (اكتب اسمه أو رقم حسابه) ثم اطلب الكشف بصيغة PDF.');
  const data=await loadCustomerAnalytics(identity),matches=findCustomers(data,ref.code||ref.name);
  const row=matches.find(item=>String(item.code||'')===String(ref.code||''))||matches[0];
  if(!row)return sendMessage(chatId,'تعذر تحميل بيانات العميل. أعد البحث من جديد.');
  try{const{pdf,filename,caption}=await generateCustomerStatementPdf(row);await sendDocumentBuffer(chatId,pdf,filename,'application/pdf',caption);}
  catch(error){console.error('[telegram customer statement pdf]',{code:error?.code||null,message:String(error?.message||'').slice(0,300)});const reason=error?.code==='PDF_SERVICE_NOT_CONFIGURED'?'خدمة PDF غير مضبوطة على الخادم.':String(error?.message||'تعذر إنشاء الملف').slice(0,250);await sendMessage(chatId,`تعذر إنشاء كشف الحساب بصيغة PDF.\nالسبب: ${esc(reason)}`);}
}

async function searchAndChoose(message,identity,query){
  if(!canView(identity))return sendMessage(message.chat.id,'ليست لديك صلاحية عرض حسابات العملاء.');
  const data=await loadCustomerAnalytics(identity),matches=findCustomers(data,query);
  if(!matches.length)return sendMessage(message.chat.id,`لم أجد عميلًا مطابقًا لـ <b>${esc(query)}</b>. جرّب رقم الحساب أو جزءًا آخر من الاسم.`);
  const exact=matches.find(row=>norm(row.code)===norm(query));if(exact)return sendStatement(message.chat.id,identity,exact);
  if(matches.length===1)return sendStatement(message.chat.id,identity,matches[0]);
  const choices=matches.slice(0,10).map((row,index)=>({code:row.code,name:row.name,balance:currentBalance(row),index}));
  await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,'enterprise_customer_choose',{query,choices,startedAt:new Date().toISOString()});
  const rows=choices.map(item=>[{text:compactButtonName(item.name),callback_data:`ent:customer_pick|${item.index}`}]);
  return sendMessage(message.chat.id,`<b>نتائج البحث عن: ${esc(query)}</b>\nوجدت <b>${matches.length}</b> نتائج. الاسم ورقم الحساب والرصيد يظهرون داخل الكشف بعد الاختيار:`,keyboard(rows));
}

export async function continueSelectableCustomerSession(message,identity,session,text){if(session?.state!=='enterprise_customer_lookup')return false;const query=String(text||'').trim();if(query.length<2){await sendMessage(message.chat.id,'اكتب رقم الحساب أو حرفين على الأقل من اسم العميل.');return true;}await searchAndChoose(message,identity,query);return true;}

export async function handleSelectableCustomerCallback(message,from,identity,value){
  if(!String(value||'').startsWith('customer_pick|'))return false;
  const index=Number(String(value).split('|')[1]),{ select }=await import('./supabase.js');
  const session=(await select('bot_sessions',`channel=eq.telegram&chat_id=eq.${encodeURIComponent(String(message.chat.id))}&external_user_id=eq.${encodeURIComponent(String(identity.external_id||from.id))}&select=*&limit=1`).catch(()=>[]))?.[0],context=session?.context||{},choices=Array.isArray(context.choices)?context.choices:[],choice=['enterprise_customer_choose','enterprise_customer_last_statement'].includes(session?.state)?choices[index]:null;
  if(!choice)return sendMessage(message.chat.id,'انتهت نتائج البحث. ابدأ البحث من جديد.');
  const data=await loadCustomerAnalytics(identity),row=findCustomers(data,choice.code||choice.name).find(item=>String(item.code||'')===String(choice.code||''))||findCustomers(data,choice.name)[0];
  if(!row)return sendMessage(message.chat.id,'تعذر تحميل حساب العميل. أعد البحث.');
  return sendStatement(message.chat.id,identity,row,{query:context.query,choices,startedAt:context.startedAt});
}

export async function handleSelectableCustomerTextCommand(message,identity,text){const raw=String(text||'').trim(),direct=raw.match(/^(?:بحث عميل|ابحث عن عميل|كشف حساب(?: عميل)?|كشف عميل|رصيد(?: العميل)?|رصيد عميل)\s+(.{2,})$/i);if(!direct)return false;await searchAndChoose(message,identity,direct[1]);return true;}
