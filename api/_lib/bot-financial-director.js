import { select } from './supabase.js';
import { capabilityAllowed } from './permissions.js';
import { sendMessage, keyboard } from './telegram.js';
import { esc, formatAmount, norm } from './bot-enterprise-store.js';

const VIEW_CAPABILITY='accounting.view';
const CLOSED=new Set(['cancelled','rejected','closed','completed','collected','reversed']);
const money=value=>formatAmount(Number(value||0));
const number=value=>Number(value||0)||0;
const date=value=>String(value||'').slice(0,10);
async function safeSelect(table,query){try{return await select(table,query)||[];}catch(error){console.warn('[financial director read]',{table,message:String(error?.message||'').slice(0,220)});return[];}}
async function canView(identity){
  if(!identity?.active)return false;
  const userId=String(identity.user_id||''),[roleRows,userRows]=await Promise.all([
    safeSelect('role_capabilities',`role=eq.${encodeURIComponent(identity.role||'pending')}&select=capability,allowed&limit=500`),
    userId?safeSelect('user_capabilities',`app_user_id=eq.${encodeURIComponent(userId)}&select=capability,allowed&limit=500`):Promise.resolve([])
  ]);
  return capabilityAllowed(identity.role,VIEW_CAPABILITY,roleRows,userRows);
}
async function guarded(chatId,identity,work){if(!await canView(identity)){await sendMessage(chatId,'مساعد المدير المالي متاح فقط لمن يملك صلاحية accounting.view.');return null;}return work();}
function todayRiyadh(){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),get=type=>parts.find(item=>item.type===type)?.value||'';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
const monthOf=value=>date(value).slice(0,7);
const isOpen=status=>!CLOSED.has(String(status||''));
const isIncome=type=>/(receipt|collection|income|cash_in|deposit)/i.test(String(type||''));
const isOutflow=type=>/(payment|expense|supplier_invoice|cash_out|payroll|purchase)/i.test(String(type||''));

export const financialDirectorMenu=()=>keyboard([[{text:'🧠 قرار المدير المالي الآن',callback_data:'ent:cfo_brief'},{text:'💧 السيولة والحركة النقدية',callback_data:'ent:cfo_cash'}],[{text:'🚨 المخاطر المالية',callback_data:'ent:cfo_risks'},{text:'✅ إجراءات اليوم',callback_data:'ent:cfo_actions'}],[{text:'👥 مديونية العملاء',callback_data:'ent:insight_debt'},{text:'📈 الربحية والتكاليف',callback_data:'ent:cost_decision'}],[{text:'⚖️ سلامة الحسابات',callback_data:'ent:accounting_integrity'},{text:'🧾 الاعتمادات المعلقة',callback_data:'ent:approvals'}],[{text:'📚 مركز المحاسبة',callback_data:'ent:accounting_menu'},{text:'💰 تسجيل عملية مالية',callback_data:'ent:finance_menu'}]]);

export async function loadFinancialDirectorSnapshot(){
  const today=todayRiyadh(),month=today.slice(0,7),future=new Date(`${today}T12:00:00+03:00`);future.setDate(future.getDate()+7);const weekEnd=future.toISOString().slice(0,10);
  const [trial,entries,sales,collections,finance,approvals,purchases,inventory,periods]=await Promise.all([
    safeSelect('trial_balance','select=account_code,account_name_ar,account_type,total_debit,total_credit,balance&limit=2000'),
    safeSelect('journal_entries','select=id,reference_no,entry_date,status,posted_at&order=entry_date.desc,created_at.desc&limit=3000'),
    safeSelect('sales_orders','select=reference_no,customer_name,sales_type,total_amount,status,created_at,delivery_date&limit=5000'),
    safeSelect('collection_events','select=reference_no,customer_name,amount,allocated_amount,unallocated_amount,status,occurred_at,promise_date&limit=5000'),
    safeSelect('finance_events','select=reference_no,event_type,party_name,amount,status,occurred_at&limit=5000'),
    safeSelect('approvals','status=eq.pending&select=id,reference_no,entity_type,summary,amount,created_at&order=created_at.asc&limit=500'),
    safeSelect('purchase_requests','select=reference_no,item_description,urgency,status,requested_at,created_at&limit=3000'),
    safeSelect('inventory_items','active=eq.true&select=item_name,quantity_on_hand,minimum_quantity,unit&limit=5000'),
    safeSelect('financial_periods','select=period_start,period_end,status,closed_at&order=period_start.desc&limit=12')
  ]);
  const monthSales=sales.filter(row=>monthOf(row.created_at||row.delivery_date)===month&&!['cancelled','rejected'].includes(row.status)),monthCollections=collections.filter(row=>monthOf(row.occurred_at)===month&&!['rejected','cancelled'].includes(row.status)),monthFinance=finance.filter(row=>monthOf(row.occurred_at)===month&&!['rejected','cancelled'].includes(row.status));
  const salesAmount=monthSales.reduce((sum,row)=>sum+number(row.total_amount),0),collectionsAmount=monthCollections.reduce((sum,row)=>sum+number(row.amount),0),otherIncome=monthFinance.filter(row=>isIncome(row.event_type)).reduce((sum,row)=>sum+number(row.amount),0),outflow=monthFinance.filter(row=>isOutflow(row.event_type)).reduce((sum,row)=>sum+number(row.amount),0);
  const lifetimeSales=sales.filter(row=>!['cancelled','rejected'].includes(row.status)).reduce((sum,row)=>sum+number(row.total_amount),0),lifetimeCollections=collections.filter(row=>!['rejected','cancelled'].includes(row.status)).reduce((sum,row)=>sum+number(row.amount),0);
  const trialTotals=trial.reduce((out,row)=>{out.debit+=number(row.total_debit);out.credit+=number(row.total_credit);return out;},{debit:0,credit:0}),accountingAvailable=trial.length>0,balanced=accountingAvailable&&Number(trialTotals.debit.toFixed(2))===Number(trialTotals.credit.toFixed(2));
  const overdueSales=sales.filter(row=>isOpen(row.status)&&row.delivery_date&&date(row.delivery_date)<today),unallocated=collections.reduce((sum,row)=>sum+number(row.unallocated_amount),0),draftEntries=entries.filter(row=>row.status==='draft'),urgentPurchases=purchases.filter(row=>isOpen(row.status)&&['urgent','critical'].includes(row.urgency)),inventoryRisks=inventory.filter(row=>number(row.quantity_on_hand)<0||(number(row.minimum_quantity)>0&&number(row.quantity_on_hand)<=number(row.minimum_quantity)));
  const promised=collections.filter(row=>row.promise_date&&date(row.promise_date)>=today&&date(row.promise_date)<=weekEnd&&isOpen(row.status)).reduce((sum,row)=>sum+number(row.amount),0),pendingApprovalAmount=approvals.reduce((sum,row)=>sum+number(row.amount),0);
  return{today,month,weekEnd,trial,entries,sales,collections,finance,approvals,purchases,inventory,periods,metrics:{salesAmount,collectionsAmount,collectionRate:salesAmount?collectionsAmount/salesAmount*100:0,otherIncome,outflow,netCashMovement:collectionsAmount+otherIncome-outflow,receivables:Math.max(0,lifetimeSales-lifetimeCollections),overdueSales:overdueSales.length,unallocated,draftEntries:draftEntries.length,urgentPurchases:urgentPurchases.length,inventoryRisks:inventoryRisks.length,pendingApprovals:approvals.length,pendingApprovalAmount,promised,accountingAvailable,balanced,trialDebit:trialTotals.debit,trialCredit:trialTotals.credit,openPeriod:periods.find(row=>row.status==='open'||row.status==='active')||null}};
}
function risks(snapshot){
  const m=snapshot.metrics,items=[];
  if(!m.accountingAvailable)items.push({level:'عاجل',text:'لا توجد بيانات ميزان مراجعة متاحة؛ القرار المالي غير مكتمل حتى مزامنة القيود.'});
  else if(!m.balanced)items.push({level:'حرج',text:'ميزان المراجعة غير متزن؛ أوقف أي إقفال أو قرار توزيع حتى مراجعة القيود.'});
  if(m.draftEntries)items.push({level:'عاجل',text:`${m.draftEntries} قيد مسودة لم يُرحّل بعد.`});
  if(m.salesAmount>0&&m.collectionRate<70)items.push({level:'عاجل',text:`التحصيل ${m.collectionRate.toFixed(1)}% فقط من مبيعات الشهر.`});
  if(m.receivables>0)items.push({level:m.overdueSales?'عاجل':'متابعة',text:`مديونية تشغيلية تقديرية ${money(m.receivables)} ر.س مع ${m.overdueSales} طلب متأخر.`});
  if(m.unallocated>0)items.push({level:'عاجل',text:`تحصيلات غير موزعة بقيمة ${money(m.unallocated)} ر.س تحتاج ربطًا بالفواتير.`});
  if(m.pendingApprovals)items.push({level:'متابعة',text:`${m.pendingApprovals} اعتماد مالي/تشغيلي معلق بقيمة ${money(m.pendingApprovalAmount)} ر.س.`});
  if(m.inventoryRisks)items.push({level:'متابعة',text:`${m.inventoryRisks} صنفًا سالبًا أو عند الحد الأدنى قد يعطل الإنتاج.`});
  if(m.urgentPurchases)items.push({level:'عاجل',text:`${m.urgentPurchases} طلب شراء عاجل ما زال مفتوحًا.`});
  if(m.netCashMovement<0)items.push({level:'عاجل',text:`صافي الحركة النقدية الشهرية سالب ${money(Math.abs(m.netCashMovement))} ر.س.`});
  if(!items.length)items.push({level:'مستقر',text:'لا تظهر إشارة مالية حرجة من البيانات المسجلة حاليًا.'});
  return items;
}
function actions(snapshot){
  const m=snapshot.metrics,out=[];
  if(!m.accountingAvailable)out.push('مزامنة القيود وميزان المراجعة قبل اعتماد أي قرار مالي نهائي.');
  else if(!m.balanced)out.push('مطابقة إجمالي المدين والدائن وتحديد القيد غير المتزن قبل أي اعتماد جديد.');
  if(m.draftEntries)out.push(`مراجعة وترحيل أو إلغاء ${m.draftEntries} قيد مسودة.`);
  if(m.unallocated>0)out.push(`توزيع ${money(m.unallocated)} ر.س من التحصيلات غير المربوطة على فواتير العملاء.`);
  if(m.overdueSales)out.push(`تكليف التحصيل بمتابعة ${m.overdueSales} طلب بيع متأخر وتحديد موعد سداد.`);
  if(m.pendingApprovals)out.push(`حسم ${m.pendingApprovals} اعتماد معلق بعد التحقق من المستندات والميزانية.`);
  if(m.inventoryRisks)out.push(`تأكيد احتياجات ${m.inventoryRisks} صنفًا حرجًا مع الإنتاج والمشتريات.`);
  if(m.netCashMovement<0)out.push('تأجيل المصروفات غير الضرورية حتى يعود صافي الحركة النقدية موجبًا.');
  if(!out.length)out.push('الاستمرار في تحديث المبيعات والتحصيل والمصروفات يوميًا ومراجعة لوحة القرار صباحًا.');
  return out;
}
export async function sendFinancialDirectorBrief(chatId,identity){
  return guarded(chatId,identity,async()=>{const s=await loadFinancialDirectorSnapshot(),m=s.metrics,r=risks(s),a=actions(s),period=m.openPeriod?`${m.openPeriod.period_start} → ${m.openPeriod.period_end}`:'لا توجد فترة مالية مفتوحة';
    return sendMessage(chatId,`<b>مساعد المدير المالي — قرار ${esc(s.today)}</b>\n\n<b>الموقف المالي للشهر</b>\n• المبيعات: <b>${money(m.salesAmount)} ر.س</b>\n• التحصيل: <b>${money(m.collectionsAmount)} ر.س</b> (${m.collectionRate.toFixed(1)}%)\n• المصروف/الالتزامات المسجلة: <b>${money(m.outflow)} ر.س</b>\n• صافي الحركة النقدية: <b>${money(m.netCashMovement)} ر.س</b>\n• المديونية التشغيلية: <b>${money(m.receivables)} ر.س</b>\n• الفترة المفتوحة: <b>${esc(period)}</b>\n• سلامة ميزان المراجعة: <b>${m.accountingAvailable?(m.balanced?'متزن ✅':'غير متزن ⚠️'):'بيانات غير متاحة'}</b>\n\n<b>الحكم التنفيذي</b>\n${r.slice(0,5).map(item=>`• [${item.level}] ${esc(item.text)}`).join('\n')}\n\n<b>أول 3 قرارات اليوم</b>\n${a.slice(0,3).map((item,index)=>`${index+1}. ${esc(item)}`).join('\n')}\n\nالتحليل مبني فقط على بيانات المصنع المسجلة؛ أي جدول غير محدث يقلل دقة القرار.`.slice(0,3900),financialDirectorMenu());});
}
export async function sendCashControl(chatId,identity){
  return guarded(chatId,identity,async()=>{const s=await loadFinancialDirectorSnapshot(),m=s.metrics;
    return sendMessage(chatId,`<b>مركز السيولة — ${esc(s.month)}</b>\n\n• تحصيل العملاء: <b>${money(m.collectionsAmount)} ر.س</b>\n• إيرادات مالية أخرى: <b>${money(m.otherIncome)} ر.س</b>\n• مدفوعات ومصروفات: <b>${money(m.outflow)} ر.س</b>\n• صافي الحركة: <b>${money(m.netCashMovement)} ر.س</b>\n• وعود تحصيل حتى ${esc(s.weekEnd)}: <b>${money(m.promised)} ر.س</b>\n• اعتمادات معلقة: <b>${money(m.pendingApprovalAmount)} ر.س</b>\n• تحصيلات غير موزعة: <b>${money(m.unallocated)} ر.س</b>\n\n<b>القاعدة:</b> لا تعتمد مصروفًا غير ضروري إذا كان صافي الحركة سالبًا أو لا توجد تغطية موثقة.`);
  });
}
export async function sendFinancialRisks(chatId,identity){return guarded(chatId,identity,async()=>{const s=await loadFinancialDirectorSnapshot(),items=risks(s);return sendMessage(chatId,`<b>سجل المخاطر المالية الحالي</b>\n\n${items.map((item,index)=>`${index+1}. <b>${esc(item.level)}</b> — ${esc(item.text)}`).join('\n\n')}`.slice(0,3900));});}
export async function sendFinancialActions(chatId,identity){return guarded(chatId,identity,async()=>{const s=await loadFinancialDirectorSnapshot(),items=actions(s);return sendMessage(chatId,`<b>قائمة عمل المدير المالي اليوم</b>\n\n${items.map((item,index)=>`${index+1}. ${esc(item)}`).join('\n\n')}\n\nابدأ بالأثر الأكبر على السيولة، ثم سلامة القيود، ثم استمرارية الإنتاج.`.slice(0,3900));});}
export async function showFinancialDirectorMenu(message,identity){return guarded(message.chat.id,identity,()=>sendMessage(message.chat.id,'<b>مساعد المدير المالي</b>\nيحوّل بيانات المصنع الفعلية إلى موقف مالي ومخاطر وقرارات يومية:',financialDirectorMenu()));}
export async function handleFinancialDirectorCallback(message,identity,value){
  if(value==='cfo_menu')return showFinancialDirectorMenu(message,identity);
  if(value==='cfo_brief')return sendFinancialDirectorBrief(message.chat.id,identity);
  if(value==='cfo_cash')return sendCashControl(message.chat.id,identity);
  if(value==='cfo_risks')return sendFinancialRisks(message.chat.id,identity);
  if(value==='cfo_actions')return sendFinancialActions(message.chat.id,identity);
  return false;
}
export async function handleFinancialDirectorTextCommand(message,identity,text){
  const raw=String(text||'').trim(),value=norm(raw);
  if(/^\/(cfo|finance_manager)(?:@\w+)?$/i.test(raw)||/^(المدير المالي|مساعد المدير المالي|المركز المالي|لوحه المدير المالي|لوحة المدير المالي)$/.test(value)){await showFinancialDirectorMenu(message,identity);return true;}
  if(/^(حلل الوضع المالي|قرار المدير المالي|ماذا افعل ماليا|ماذا أفعل ماليًا|الموقف المالي الان|الموقف المالي الآن)$/.test(value)){await sendFinancialDirectorBrief(message.chat.id,identity);return true;}
  if(/^(السيوله|السيولة|حركه النقديه|الحركة النقدية|موقف الكاش)$/.test(value)){await sendCashControl(message.chat.id,identity);return true;}
  if(/^(المخاطر الماليه|المخاطر المالية|تنبيهات المدير المالي)$/.test(value)){await sendFinancialRisks(message.chat.id,identity);return true;}
  if(/^(قرارات اليوم الماليه|قرارات اليوم المالية|اعمل ايه النهارده ماليا|ماذا انفذ اليوم ماليا)$/.test(value)){await sendFinancialActions(message.chat.id,identity);return true;}
  return false;
}
