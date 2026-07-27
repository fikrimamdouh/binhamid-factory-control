const n=value=>Number(value||0)||0;
export const roundMoney=value=>Math.abs(n(value))<0.005?0:Math.round((n(value)+Number.EPSILON)*100)/100;
export const normalizeCustomerValue=value=>String(value??'').trim().toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/[_-]+/g,' ').replace(/\s+/g,' ');
export const customerLookupKey=(code,name)=>{const normalized=normalizeCustomerValue(code);return normalized?`code:${normalized}`:`name:${normalizeCustomerValue(name)||'unknown'}`;};

const SALE_TYPE_LABEL={block:'بلوك',concrete:'خرسانة'};
const STATUS_LABEL={
  new_paid_full:'عميل جديد — سدد مشتريات التقرير بالكامل',
  new_partial:'عميل جديد — بقي عليه من مشتريات التقرير',
  new_unpaid:'عميل جديد — اشترى ولم يسدد',
  new_advance:'عميل جديد — لديه دفعة مقدمة',
  new_payment_only:'عميل جديد — سداد بلا مبيعات مطابقة',
  old_paid_new_and_previous:'عميل قديم — سدد الجديد وجزءًا من السابق',
  old_paid_new_only:'عميل قديم — سدد مشتريات التقرير',
  old_paid_previous_only:'عميل قديم — سدد من الرصيد السابق فقط',
  old_paid_previous_with_current_due:'عميل قديم — سدد من الرصيد السابق وبقيت مشتريات التقرير',
  old_partial_current:'عميل قديم — بقي عليه من مشتريات التقرير',
  old_bought_no_payment:'عميل قديم — اشترى ولم يسدد في التقرير',
  old_payment_unallocated:'عميل قديم — سداد يحتاج مراجعة التوزيع',
  old_no_report_activity:'عميل قديم — مديونية سابقة بلا حركة التقرير',
  advance:'دفعة مقدمة بعد إقفال كامل المديونية'
};

const ALERT_LABEL={
  missing_customer_code:'رقم العميل غير مسجل.',
  payment_without_sales_history:'سداد دون مبيعات سابقة أو حالية مطابقة.',
  advance_payment:'السداد تجاوز كامل المديونية وتحول الباقي إلى دفعة مقدمة.',
  duplicate_invoice:'رقم فاتورة مكرر داخل التقرير.',
  duplicate_collection:'حركة سداد مكررة داخل التقرير.',
  sales_type_mismatch:'تصنيف القطاع لا يطابق وصف الصنف.',
  overdue_90_plus:'يوجد رصيد متأخر أكثر من 90 يومًا.',
  balance_mismatch:'الرصيد المحسوب لا يطابق معادلة الرصيد السابق والحركة الحالية.'
};

function explicitSaleType(row={}){
  const raw=[row.salesType,row.sales_type,row.kind,row.type,row.segment].map(normalizeCustomerValue).filter(Boolean).join(' ');
  if(/بلوك|بلك|block/.test(raw))return'block';
  if(/خرسان|concrete|ready\s*mix|readymix|rmc/.test(raw))return'concrete';
  return'';
}
function itemSaleType(row={}){
  const raw=[row.item,row.itemName,row.item_name,row.product].map(normalizeCustomerValue).filter(Boolean).join(' ');
  if(/بلوك|بلك|block/.test(raw))return'block';
  if(/خرسان|concrete|ready\s*mix|readymix|rmc/.test(raw))return'concrete';
  return'';
}
export function saleTypeOf(row={}){return explicitSaleType(row)||itemSaleType(row);}

function createActivity(code,name){return{code:String(code||''),name:String(name||code||'عميل غير محدد'),sales:0,collections:0,lastSale:'',lastCollection:'',items:new Set(),invoices:[],collectionRows:[],alerts:new Set()};}
function chooseDate(value,fallback=''){const text=String(value||fallback||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:String(fallback||'').slice(0,10);}
export function buildReportActivityIndex(analysis={},type='',reportDate=''){
  const byCustomerCode=new Map(),byCustomerName=new Map(),ambiguousNames=new Set(),invoiceKeys=new Set(),collectionKeys=new Set();
  const resolve=(code,name)=>{
    const codeNorm=normalizeCustomerValue(code),nameNorm=normalizeCustomerValue(name);let existing=codeNorm?byCustomerCode.get(codeNorm):(!ambiguousNames.has(nameNorm)?byCustomerName.get(nameNorm):null);
    if(codeNorm&&!existing&&nameNorm&&!ambiguousNames.has(nameNorm)){
      const named=byCustomerName.get(nameNorm);if(named&&normalizeCustomerValue(named.code)===codeNorm)existing=named;
    }
    const row=existing||createActivity(code,name);
    if(codeNorm)byCustomerCode.set(codeNorm,row);
    if(nameNorm){
      const named=byCustomerName.get(nameNorm),namedCode=normalizeCustomerValue(named?.code),rowCode=normalizeCustomerValue(row.code);
      if(!named&&!ambiguousNames.has(nameNorm))byCustomerName.set(nameNorm,row);
      else if(named!==row&&namedCode&&rowCode&&namedCode!==rowCode){byCustomerName.delete(nameNorm);ambiguousNames.add(nameNorm);}
      else if(!codeNorm&&!ambiguousNames.has(nameNorm))byCustomerName.set(nameNorm,row);
    }
    return row;
  };
  for(const [index,row] of (analysis?.sales||[]).entries()){
    const detected=saleTypeOf(row);if(type&&detected!==type)continue;
    const code=row.customerCode||row.customer_code||row.accountCode||'',name=row.customer||row.customerName||row.customer_name||row.accountName||'',activity=resolve(code,name),amount=Math.max(0,n(row.amount??row.total??row.total_amount)),invoice=String(row.invoice||row.invoiceNo||row.invoice_no||row.reference_no||`row-${row.row||index+1}`),date=chooseDate(row.deliveryDate||row.delivery_date||row.date,reportDate);
    activity.sales=roundMoney(activity.sales+amount);activity.lastSale=activity.lastSale>date?activity.lastSale:date;activity.invoices.push({invoice,date,item:String(row.item||row.itemName||row.item_name||''),quantity:n(row.quantity),amount,type:detected});if(row.item||row.itemName||row.item_name)activity.items.add(String(row.item||row.itemName||row.item_name));
    const duplicateKey=`${normalizeCustomerValue(code||name)}|${normalizeCustomerValue(invoice)}`;if(invoiceKeys.has(duplicateKey))activity.alerts.add('duplicate_invoice');invoiceKeys.add(duplicateKey);
    const declared=explicitSaleType(row),itemType=itemSaleType(row);if(declared&&itemType&&declared!==itemType)activity.alerts.add('sales_type_mismatch');
  }
  for(const [index,row] of (analysis?.collections||[]).entries()){
    const code=row.customerCode||row.customer_code||row.accountCode||row.account_code||'',name=row.customer||row.customerName||row.customer_name||row.accountName||row.account_name||'',activity=resolve(code,name),amount=Math.max(0,n(row.amount??row.debit??row.credit)),date=chooseDate(row.movementDate||row.movement_date||row.occurred_at||row.date,reportDate),reference=String(row.voucherNo||row.voucher_no||row.reference_no||`row-${row.row||index+1}`);
    activity.collections=roundMoney(activity.collections+amount);activity.lastCollection=activity.lastCollection>date?activity.lastCollection:date;activity.collectionRows.push({reference,date,amount,treasuryCode:String(row.treasuryCode||row.treasury_code||''),treasuryName:String(row.treasuryName||row.treasury_name||'')});
    const duplicateKey=`${normalizeCustomerValue(code||name)}|${normalizeCustomerValue(reference)}|${roundMoney(amount)}|${date}`;if(collectionKeys.has(duplicateKey))activity.alerts.add('duplicate_collection');collectionKeys.add(duplicateKey);
  }
  return{byCustomerCode,byCustomerName,rows:[...new Set([...byCustomerCode.values(),...byCustomerName.values()])]};
}

export function indexCustomerAnalytics(rows=[]){
  const byCustomerCode=new Map(),byCustomerName=new Map();
  for(const row of rows||[]){
    for(const value of [row.code,row.externalId,row.customer_code,row.customer_external_id].map(normalizeCustomerValue).filter(Boolean))if(!byCustomerCode.has(value))byCustomerCode.set(value,row);
    const name=normalizeCustomerValue(row.name||row.customer_name);if(name&&!byCustomerName.has(name))byCustomerName.set(name,row);
  }
  return{byCustomerCode,byCustomerName};
}
export function lookupCustomer(index={},code='',name=''){return index?.byCustomerCode?.get(normalizeCustomerValue(code))||index?.byCustomerName?.get(normalizeCustomerValue(name))||null;}
export function lookupActivity(index={},code='',name=''){return index?.byCustomerCode?.get(normalizeCustomerValue(code))||index?.byCustomerName?.get(normalizeCustomerValue(name))||createActivity(code,name);}

function consume(pool,amount){const used=Math.min(Math.max(0,roundMoney(pool)),Math.max(0,roundMoney(amount)));return{used:roundMoney(used),pool:roundMoney(pool-used),amount:roundMoney(amount-used)};}
function applyToAging(source={},amount=0){
  const aging={current:Math.max(0,n(source.current)),days1to30:Math.max(0,n(source.days1to30)),days31to60:Math.max(0,n(source.days31to60)),days61to90:Math.max(0,n(source.days61to90)),days90plus:Math.max(0,n(source.days90plus))};
  let remaining=Math.max(0,n(amount));
  for(const key of ['days90plus','days61to90','days31to60','days1to30','current']){const used=Math.min(remaining,aging[key]);aging[key]=roundMoney(aging[key]-used);remaining=roundMoney(remaining-used);if(remaining<=0)break;}
  return aging;
}
function deriveStatus({customerClass,reportSales,reportCollections,paidCurrent,paidPrevious,remainingCurrent,finalAdvance}){
  if(finalAdvance>0)return'advance';
  if(customerClass==='new'){
    if(reportCollections>0&&reportSales<=0)return'new_payment_only';
    if(reportSales>0&&remainingCurrent<=0)return'new_paid_full';
    if(reportSales>0&&paidCurrent>0)return'new_partial';
    return'new_unpaid';
  }
  if(reportCollections<=0)return reportSales>0?'old_bought_no_payment':'old_no_report_activity';
  if(paidCurrent>0&&paidPrevious>0)return'old_paid_new_and_previous';
  if(paidPrevious>0&&remainingCurrent>0)return'old_paid_previous_with_current_due';
  if(reportSales<=0&&paidPrevious>0)return'old_paid_previous_only';
  if(paidCurrent>0&&remainingCurrent<=0)return'old_paid_new_only';
  if(paidCurrent>0&&remainingCurrent>0)return'old_partial_current';
  return'old_payment_unallocated';
}
export function settleCustomerAccount(base={},activity={},options={}){
  const openingBalance=roundMoney(base.openingBalance),openingDebt=Math.max(0,openingBalance),openingCredit=Math.max(0,-openingBalance),priorSales=Math.max(0,roundMoney(base.grossSales)),priorPaidRecorded=Math.min(priorSales,Math.max(0,roundMoney(base.paidApplied)));
  let remainingPriorSales=roundMoney(priorSales-priorPaidRecorded),remainingOpening=roundMoney(openingDebt),creditPool=roundMoney(openingCredit+Math.max(0,n(base.unallocatedCredit))),creditAppliedPriorSales=0,creditAppliedOpening=0;
  let step=consume(creditPool,remainingPriorSales);creditPool=step.pool;remainingPriorSales=step.amount;creditAppliedPriorSales=step.used;
  step=consume(creditPool,remainingOpening);creditPool=step.pool;remainingOpening=step.amount;creditAppliedOpening=step.used;
  const previousBalance=roundMoney(remainingPriorSales+remainingOpening),previousCredit=roundMoney(creditPool);
  const reportSales=Math.max(0,roundMoney(activity.sales)),reportCollections=Math.max(0,roundMoney(activity.collections));let remainingCurrent=reportSales,priorAdvanceApplied=0;
  step=consume(creditPool,remainingCurrent);creditPool=step.pool;remainingCurrent=step.amount;priorAdvanceApplied=step.used;
  let paymentPool=reportCollections,paidCurrent=0,paidPreviousSales=0,paidOpening=0;
  // The production ledger is chronological FIFO: settle prior sales and the
  // opening receivable before applying a report-day receipt to new purchases.
  step=consume(paymentPool,remainingPriorSales);paymentPool=step.pool;remainingPriorSales=step.amount;paidPreviousSales=step.used;
  step=consume(paymentPool,remainingOpening);paymentPool=step.pool;remainingOpening=step.amount;paidOpening=step.used;
  step=consume(paymentPool,remainingCurrent);paymentPool=step.pool;remainingCurrent=step.amount;paidCurrent=step.used;
  const paidPrevious=roundMoney(paidPreviousSales+paidOpening),finalDebt=roundMoney(remainingCurrent+remainingPriorSales+remainingOpening),finalAdvance=roundMoney(creditPool+paymentPool),customerClass=(base.openingCount||Math.abs(openingBalance)>0.004||base.invoiceCount||priorSales>0||base.collectionCount)?'old':'new',status=deriveStatus({customerClass,reportSales,reportCollections,paidCurrent,paidPrevious,remainingCurrent,finalAdvance});
  let aging=applyToAging(base.aging||{},roundMoney(creditAppliedPriorSales+paidPreviousSales));aging.current=roundMoney(aging.current+remainingCurrent);const unagedOpening=roundMoney(remainingOpening),formulaNet=roundMoney(previousBalance-previousCredit+reportSales-reportCollections),formulaDebt=Math.max(0,formulaNet),formulaAdvance=Math.max(0,-formulaNet),alerts=new Set(activity.alerts||[]);
  if(!String(activity.code||base.code||base.externalId||'').trim())alerts.add('missing_customer_code');
  if(reportCollections>0&&customerClass==='new'&&reportSales<=0)alerts.add('payment_without_sales_history');
  if(finalAdvance>0)alerts.add('advance_payment');
  if(n(aging.days90plus)>0)alerts.add('overdue_90_plus');
  if(Math.abs(finalDebt-formulaDebt)>0.02||Math.abs(finalAdvance-formulaAdvance)>0.02)alerts.add('balance_mismatch');
  const alertCodes=[...alerts],alertLabels=alertCodes.map(code=>ALERT_LABEL[code]||code),oldestDaysLate=Math.max(0,...((base.sales||[]).map(row=>n(row.daysLate))));
  return{
    customerClass,customerClassLabel:customerClass==='old'?'عميل قديم':'عميل جديد',status,statusLabel:STATUS_LABEL[status]||status,
    openingBalance,openingDebt,previousBalance,previousCredit,priorSales,priorPaidRecorded,reportSales,reportCollections,
    priorAdvanceApplied,paidCurrent,paidPreviousSales,paidOpening,paidPrevious,remainingCurrent,remainingPriorSales,remainingOpening,
    finalDebt,finalAdvance,aging,unagedOpening,oldestDaysLate,
    alertCodes,alertLabels,hasReportActivity:reportSales>0||reportCollections>0,
    reportDate:String(options.reportDate||''),lastSale:String(activity.lastSale||base.lastSale||''),lastCollection:String(activity.lastCollection||base.lastCollection||''),
    invoices:Array.isArray(activity.invoices)?activity.invoices:[],collectionRows:Array.isArray(activity.collectionRows)?activity.collectionRows:[]
  };
}

export function aggregateSettlements(rows=[]){
  const totals={customers:0,newCustomers:0,oldCustomers:0,previousBalance:0,reportSales:0,reportCollections:0,paidCurrent:0,paidPrevious:0,remainingCurrent:0,remainingPrevious:0,finalDebt:0,finalAdvance:0,alerts:0,aging:{current:0,days1to30:0,days31to60:0,days61to90:0,days90plus:0},unagedOpening:0};
  for(const row of rows||[]){
    totals.customers+=1;totals[row.customerClass==='new'?'newCustomers':'oldCustomers']+=1;
    for(const key of ['previousBalance','reportSales','reportCollections','paidCurrent','paidPrevious','remainingCurrent','finalDebt','finalAdvance','unagedOpening'])totals[key]=roundMoney(totals[key]+n(row[key]));
    totals.remainingPrevious=roundMoney(totals.remainingPrevious+n(row.remainingPriorSales)+n(row.remainingOpening));totals.alerts+=Array.isArray(row.alertCodes)?row.alertCodes.length:0;
    for(const key of Object.keys(totals.aging))totals.aging[key]=roundMoney(totals.aging[key]+n(row.aging?.[key]));
  }
  return totals;
}

export function settlementStatusLabel(status){return STATUS_LABEL[status]||String(status||'');}
export function settlementAlertLabel(code){return ALERT_LABEL[code]||String(code||'');}
export function saleTypeLabel(type){return SALE_TYPE_LABEL[type]||String(type||'');}
