import { sendMessage, sendDocumentBuffer, keyboard } from './telegram.js';
import { esc, formatAmount, norm, setEnterpriseSession } from './bot-enterprise-store.js';
import { findCustomers, loadCustomerAnalytics } from './bot-customer-report-data.js';
import { generateCustomerStatementPdf } from './customer-statement-pdf.js';
import { settlementAlertLabel } from './customer-settlement.js';

const REPORT_ROLES=new Set(['admin','manager','accountant','block_sales','concrete_sales','collector']);
const canView=identity=>Boolean(identity?.active&&REPORT_ROLES.has(identity.role));
const money=value=>`${formatAmount(value)} ر.س`;
const currentBalance=row=>Number(row.netBalance??row.balance??0)||0;
const decisionLabel={normal:'طبيعي',watch:'مراجعة قبل زيادة الائتمان',stop:'إيقاف البيع الآجل حتى المراجعة'};
const salesTypeLabel={block:'بلوك',concrete:'خرسانة'};

function invoiceLine(row){const type=salesTypeLabel[row.sales_type]||row.sales_type||'',status=Number(row.outstanding||0)<=0?'مسددة':'متبقي';return `• ${esc(String(row.delivery_date||row.created_at||'').slice(0,10)||'بدون تاريخ')} | <b>${esc(row.reference_no||'فاتورة')}</b> | ${esc(type)} | ${status}\n  إجمالي ${money(row.total)} | مسدد ${money(row.paid)} | متبقي ${money(row.outstanding)}`;}
function collectionLine(row){const allocated=Number(row.allocated_amount??(Number(row.amount||0)-Number(row.unallocated||0)))||0,unallocated=Number((row.unallocated??row.unallocated_amount)||0)||0;return `• ${esc(String(row.occurred_at||row.created_at||'').slice(0,10)||'بدون تاريخ')} | <b>${esc(row.reference_no||'تحصيل')}</b>\n  سداد ${money(row.amount)} | موزع على الفواتير ${money(allocated)}${unallocated?` | غير موزع ${money(unallocated)}`:''}`;}
function consume(pool,amount){const used=Math.min(Math.max(0,pool),Math.max(0,amount));return{used,pool:pool-used,amount:amount-used};}
function debtAllocation(row){
  const oldDebt=Math.max(0,Number(row.openingBalance||0)),openingCredit=Math.max(0,-Number(row.openingBalance||0)),newSales=Math.max(0,Number(row.grossSales||0)),paidRecorded=Math.min(newSales,Math.max(0,Number(row.paidApplied||0)));
  let remainingNew=Math.max(0,newSales-paidRecorded),remainingOld=oldDebt,creditPool=openingCredit+Math.max(0,Number(row.unallocatedCredit||0)),paidNew=paidRecorded,paidOld=0;
  let step=consume(creditPool,remainingNew);creditPool=step.pool;remainingNew=step.amount;paidNew+=step.used;
  step=consume(creditPool,remainingOld);creditPool=step.pool;remainingOld=step.amount;paidOld+=step.used;
  return{oldDebt,newSales,paidNew,paidOld,advance:creditPool,remainingNew,remainingOld,totalPaid:Number(row.collections||0)};
}
function compactButtonName(value){let text=String(value||'عميل').trim()||'عميل';while(Buffer.byteLength(text,'utf8')>58)text=text.slice(0,-1);return text;}
function agingText(row){const aging=row.aging||{};return `حتى 30 يومًا: ${money(Number(aging.current||0)+Number(aging.days1to30||0))}\n31–60 يومًا: ${money(aging.days31to60)}\n61–90 يومًا: ${money(aging.days61to90)}\nأكثر من 90 يومًا: ${money(aging.days90plus)}`;}

async function sendStatement(chatId,identity,row,preserved={}){
  const recentSales=row.sales.slice(0,10),recentCollections=row.collectionRows.slice(0,10),movementCount=row.invoiceCount+row.collectionCount,a=debtAllocation(row),alerts=(row.controlAlerts||[]).map(settlementAlertLabel);
  const text=`<b>كشف حساب عميل — مصنع بن حامد</b>\n━━━━━━━━━━━━━━\n<b>${esc(row.name)}</b> — <b>${esc(row.customerClassLabel||'عميل قديم')}</b>${row.code?`\nرقم الحساب: <code>${esc(row.code)}</code>`:''}${row.phone?`\nالجوال: ${esc(row.phone)}`:''}\nحتى تاريخ: <b>${esc(new Date().toISOString().slice(0,10))}</b>\n━━━━━━━━━━━━━━\n<b>تسوية الحساب</b>\nالرصيد الافتتاحي${row.openingDate?` بتاريخ ${esc(row.openingDate)}`:''}: <b>${money(a.oldDebt)}</b>\nإجمالي المبيعات بعد الافتتاحي: <b>${money(a.newSales)}</b>${row.lastSale?` — آخر فاتورة ${esc(row.lastSale)}`:''}\nإجمالي التحصيلات: <b>${money(a.totalPaid)}</b>${row.lastCollection?` — آخر سداد ${esc(row.lastCollection)}`:''}\nالمسدد من المبيعات: <b>${money(a.paidNew)}</b>\nالمسدد من الرصيد الافتتاحي: <b>${money(a.paidOld)}</b>\nالمتبقي من المبيعات: <b>${money(a.remainingNew)}</b>\nالمتبقي من الرصيد الافتتاحي: <b>${money(a.remainingOld)}</b>${a.advance?`\nدفعة مقدمة/رصيد دائن: <b>${money(a.advance)}</b>`:''}\nالرصيد الحالي النهائي: <b>${money(currentBalance(row))}</b>\n━━━━━━━━━━━━━━\n<b>أعمار المديونية</b>\n${agingText(row)}\n\n<b>الحالة الائتمانية:</b> ${esc(decisionLabel[row.decision]||row.decision)}${alerts.length?`\n<b>تنبيهات رقابية:</b> ${esc(alerts.join(' — '))}`:''}${recentSales.length?`\n\n<b>أحدث الفواتير</b>\n${recentSales.map(invoiceLine).join('\n')}`:'\n\nلا توجد فواتير بعد الرصيد الافتتاحي.'}${recentCollections.length?`\n\n<b>أحدث التحصيلات</b>\n${recentCollections.map(collectionLine).join('\n')}`:'\n\nلا توجد تحصيلات بعد الرصيد الافتتاحي.'}\n\nعدد الحركات: <b>${movementCount}</b>`;
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
  return sendMessage(message.chat.id,`<b>نتائج البحث عن: ${esc(query)}</b>\nوجدت <b>${matches.length}</b> نتائج. التفاصيل المالية تظهر داخل الكشف بعد الاختيار:`,keyboard(rows));
}

export async function continueSelectableCustomerSession(message,identity,session,text){if(session?.state!=='enterprise_customer_lookup')return false;const query=String(text||'').trim();if(query.length<2){await sendMessage(message.chat.id,'اكتب رقم الحساب أو حرفين على الأقل من اسم العميل.');return true;}await searchAndChoose(message,identity,query);return true;}
export async function handleSelectableCustomerCallback(message,from,identity,value){if(!String(value||'').startsWith('customer_pick|'))return false;const index=Number(String(value).split('|')[1]),{ select }=await import('./supabase.js');const session=(await select('bot_sessions',`channel=eq.telegram&chat_id=eq.${encodeURIComponent(String(message.chat.id))}&external_user_id=eq.${encodeURIComponent(String(identity.external_id||from.id))}&select=*&limit=1`).catch(()=>[]))?.[0],context=session?.context||{},choices=Array.isArray(context.choices)?context.choices:[],choice=['enterprise_customer_choose','enterprise_customer_last_statement'].includes(session?.state)?choices[index]:null;if(!choice)return sendMessage(message.chat.id,'انتهت نتائج البحث. ابدأ البحث من جديد.');const data=await loadCustomerAnalytics(identity),row=findCustomers(data,choice.code||choice.name).find(item=>String(item.code||'')===String(choice.code||''))||findCustomers(data,choice.name)[0];if(!row)return sendMessage(message.chat.id,'تعذر تحميل حساب العميل. أعد البحث.');return sendStatement(message.chat.id,identity,row,{query:context.query,choices,startedAt:context.startedAt});}
export async function handleSelectableCustomerTextCommand(message,identity,text){const raw=String(text||'').trim(),direct=raw.match(/^(?:بحث عميل|ابحث عن عميل|كشف حساب(?: عميل)?|كشف عميل|رصيد(?: العميل)?|رصيد عميل)\s+(.{2,})$/i);if(!direct)return false;await searchAndChoose(message,identity,direct[1]);return true;}
