import { select } from './supabase.js';

const n=value=>Number(value||0)||0;
const money=value=>Math.abs(n(value))<0.005?0:Math.round((n(value)+Number.EPSILON)*100)/100;
const norm=value=>String(value||'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/[^a-z0-9\u0600-\u06ff]+/gi,' ').replace(/\s+/g,' ').trim();
const dayMs=86_400_000;
const closedStatus=new Set(['cancelled','rejected']);
const PAGE_SIZE=1000;
// حسابات تحكم/تجميع عامة موجودة في ميزان المراجعة المستورد من البرنامج
// القديم وليست عملاء حقيقيين — تُستبعد من كل تقارير وبحث العملاء نهائيًا.
const EXCLUDED_CUSTOMER_CODES=new Set(['13115']);
const EXCLUDED_CUSTOMER_NAMES=new Set(['ذمم مدينة عملاء'].map(value=>norm(value)));
const isExcludedCustomer=(code,name)=>EXCLUDED_CUSTOMER_CODES.has(String(code||'').trim())||EXCLUDED_CUSTOMER_NAMES.has(norm(name));

export function customerReportScope(role=''){
  if(role==='block_sales')return'block';
  if(role==='concrete_sales')return'concrete';
  return'all';
}
function segmentScope(value=''){
  const text=norm(value);if(text.includes('بلوك')||text==='block')return'block';if(text.includes('خرسان')||text==='concrete')return'concrete';return'all';
}
function riyadhToday(){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const get=type=>parts.find(x=>x.type===type)?.value||'';
  return new Date(`${get('year')}-${get('month')}-${get('day')}T00:00:00Z`);
}
function dateValue(value){const text=String(value||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(text)?new Date(`${text}T00:00:00Z`):null;}
function addDays(date,days){if(!date)return null;return new Date(date.getTime()+Math.max(0,n(days))*dayMs);}
function newest(a,b){if(!a)return b||'';if(!b)return a;return String(a)>String(b)?a:b;}
function agingBucket(days){if(days<=0)return'current';if(days<=30)return'days1to30';if(days<=60)return'days31to60';if(days<=90)return'days61to90';return'days90plus';}
async function pagedSelect(table,query,maxPages=50){
  const output=[];
  for(let page=0;page<maxPages;page++){
    const rows=await select(table,`${query}&limit=${PAGE_SIZE}&offset=${page*PAGE_SIZE}`)||[];output.push(...rows);if(rows.length<PAGE_SIZE)break;
  }
  return output;
}
function baseAggregate(customer={},key=''){
  return{
    key,externalId:String(customer.external_id||''),code:String(customer.customer_code||customer.external_id||''),name:String(customer.customer_name||'عميل غير مسمى'),phone:String(customer.phone||''),segment:String(customer.segment||''),creditLimit:n(customer.credit_limit),paymentDays:n(customer.payment_days),
    openingBalance:0,openingDate:'',openingCheques:0,openingPrevious:0,openingDebitTurnover:0,openingCreditTurnover:0,openingSource:'',openingCount:0,unagedOpening:0,
    grossSales:0,paidApplied:0,balance:0,netBalance:0,debitBalance:0,creditBalance:0,collections:0,unallocatedCredit:0,
    invoiceCount:0,collectionCount:0,lastSale:'',lastCollection:'',aging:{current:0,days1to30:0,days31to60:0,days61to90:0,days90plus:0},sales:[],collectionRows:[],products:new Set(),salesTypes:new Set()
  };
}
function canonicalKey(customer={}){const code=norm(customer.external_id||customer.customer_code);if(code)return`code:${code}`;return`name:${norm(customer.customer_name)||'unknown'}`;}
function mergeLocalCustomers(customers=[],payload={}){
  const merged=[...(customers||[])],byExternal=new Map(),byCode=new Map();
  for(const row of merged){if(row.external_id)byExternal.set(norm(row.external_id),row);if(row.customer_code)byCode.set(norm(row.customer_code),row);}
  for(const row of payload?.legacy?.cli||[]){
    const external=String(row.id||row.code||''),customerCode=String(row.code||row.no||external),current=byExternal.get(norm(external))||byCode.get(norm(customerCode));
    if(current){if(!current.customer_name&&row.name)current.customer_name=row.name;if(!current.segment&&row.seg)current.segment=row.seg;if(!current.phone&&row.tel)current.phone=row.tel;continue;}
    const customer={external_id:external||customerCode,customer_code:customerCode,customer_name:String(row.name||customerCode||'عميل غير مسمى'),phone:String(row.tel||''),segment:String(row.seg||''),credit_limit:n(row.cap||row.credit),payment_days:n(row.days),active:row.act!==false};
    merged.push(customer);if(customer.external_id)byExternal.set(norm(customer.external_id),customer);if(customer.customer_code)byCode.set(norm(customer.customer_code),customer);
  }
  return merged;
}
async function openingRows(payload={}){
  // المصدر الأول: جدول الأرصدة المستقل (يُرفع على دفعات ولا يمسحه أي جهاز).
  // الاحتياط: النسخة المضمّنة القديمة داخل الحالة إن كان الجدول فارغًا.
  // القراءة على دفعات: السقف الافتراضي للقاعدة كان يقتصر على 1000 رصيد،
  // فتظهر مديونيات ناقصة في تقارير البوت.
  const tableRows=await pagedSelect('customer_opening_balances','select=customer_code,customer_name,client_id,balance,previous,debit,credit,cheques,difference,balance_date').catch(()=>null);
  if(Array.isArray(tableRows)&&tableRows.length)return tableRows.map(row=>({customerCode:row.customer_code,customerName:row.customer_name,clientId:row.client_id,amount:Number(row.balance)||0,previous:Number(row.previous)||0,debit:Number(row.debit)||0,credit:Number(row.credit)||0,cheques:Number(row.cheques)||0,difference:Number(row.difference)||0,date:row.balance_date||''}));
  return Array.isArray(payload?.ops?.customerOpeningBalances)?payload.ops.customerOpeningBalances:[];
}

export function buildCustomerAnalytics({customers=[],sales=[],collections=[],openingBalances=[],role='admin',asOf=riyadhToday()}={}){
  customers=(customers||[]).filter(c=>!isExcludedCustomer(c.external_id||c.customer_code,c.customer_name));
  openingBalances=(openingBalances||[]).filter(r=>!isExcludedCustomer(r.customerCode||r.clientId,r.customerName));
  sales=(sales||[]).filter(r=>!isExcludedCustomer(r.customer_external_id,r.customer_name));
  collections=(collections||[]).filter(r=>!isExcludedCustomer(r.customer_external_id,r.customer_name));
  const scope=customerReportScope(role),aggregates=new Map(),codeMap=new Map(),nameCandidates=new Map();
  for(const customer of customers||[]){
    const key=canonicalKey(customer),existing=aggregates.get(key),agg=existing||baseAggregate(customer,key);if(existing){agg.name=agg.name==='عميل غير مسمى'&&customer.customer_name?String(customer.customer_name):agg.name;agg.segment=agg.segment||String(customer.segment||'');agg.phone=agg.phone||String(customer.phone||'');}else aggregates.set(key,agg);
    for(const customerCode of [customer.external_id,customer.customer_code].map(norm).filter(Boolean))codeMap.set(customerCode,key);
    const name=norm(customer.customer_name);if(name){const list=nameCandidates.get(name)||[];if(!list.includes(key))list.push(key);nameCandidates.set(name,list);}
  }
  const resolve=(customerCode,name,create=true)=>{
    const codeNorm=norm(customerCode),nameNorm=norm(name);let key=codeNorm?codeMap.get(codeNorm):'';
    if(!key&&nameNorm&&nameCandidates.get(nameNorm)?.length===1)key=nameCandidates.get(nameNorm)[0];
    if(!key)key=codeNorm?`code:${codeNorm}`:`name:${nameNorm||'unknown'}`;
    if(!aggregates.has(key)&&create){const agg=baseAggregate({external_id:customerCode||'',customer_code:customerCode||'',customer_name:name||customerCode||'عميل غير مسمى'},key);aggregates.set(key,agg);if(codeNorm)codeMap.set(codeNorm,key);}
    return key;
  };
  const scopedKeys=new Set();
  for(const row of openingBalances||[]){
    const key=resolve(row.customerCode||row.clientId,row.customerName),agg=aggregates.get(key);if(!agg)continue;
    const opening=money(row.amount),rowScope=segmentScope(row.segment||agg.segment);agg.openingBalance=money(agg.openingBalance+opening);agg.openingDate=newest(agg.openingDate,String(row.date||row.balanceDate||'').slice(0,10));agg.openingCheques=money(agg.openingCheques+n(row.cheques));agg.openingPrevious=money(agg.openingPrevious+n(row.previous));agg.openingDebitTurnover=money(agg.openingDebitTurnover+n(row.debit));agg.openingCreditTurnover=money(agg.openingCreditTurnover+n(row.credit));agg.openingSource=String(row.sourceFile||row.sourceHash||agg.openingSource||'');agg.openingCount+=1;agg.balance=money(agg.balance+opening);agg.unagedOpening=money(agg.unagedOpening+Math.max(0,opening));
    if(scope==='all'||rowScope==='all'||rowScope===scope)scopedKeys.add(key);
  }
  for(const row of sales||[]){
    if(closedStatus.has(String(row.status||'')))continue;if(scope!=='all'&&String(row.sales_type||'')!==scope)continue;
    const key=resolve(row.customer_external_id,row.customer_name),agg=aggregates.get(key);scopedKeys.add(key);const total=n(row.total_amount),paid=Math.min(total,Math.max(0,n(row.paid_amount))),outstanding=Math.max(0,total-paid);
    agg.grossSales=money(agg.grossSales+total);agg.paidApplied=money(agg.paidApplied+paid);agg.balance=money(agg.balance+outstanding);agg.invoiceCount+=1;agg.lastSale=newest(agg.lastSale,String(row.delivery_date||row.created_at||'').slice(0,10));if(row.item)agg.products.add(String(row.item));if(row.sales_type)agg.salesTypes.add(String(row.sales_type));
    const base=dateValue(row.delivery_date||row.created_at),due=addDays(base,agg.paymentDays),late=due?Math.floor((asOf-due)/dayMs):0,bucket=agingBucket(late);agg.aging[bucket]=money(agg.aging[bucket]+outstanding);agg.sales.push({...row,total,paid,outstanding,dueDate:due?due.toISOString().slice(0,10):'',daysLate:Math.max(0,late)});
  }
  for(const row of collections||[]){
    if(closedStatus.has(String(row.status||'')))continue;const key=resolve(row.customer_external_id,row.customer_name,scope==='all');if(scope!=='all'&&!scopedKeys.has(key))continue;const agg=aggregates.get(key);if(!agg)continue;
    const collected=Math.max(0,n(row.amount)),unallocated=Math.max(0,n(row.unallocated_amount));agg.collections=money(agg.collections+collected);agg.unallocatedCredit=money(agg.unallocatedCredit+unallocated);agg.collectionCount+=1;agg.lastCollection=newest(agg.lastCollection,String(row.occurred_at||row.created_at||'').slice(0,10));agg.collectionRows.push({...row,amount:collected,unallocated});
  }
  let rows=[...aggregates.values()].filter(item=>scope==='all'?(item.invoiceCount||item.collectionCount||item.openingCount):scopedKeys.has(item.key));
  rows=rows.map(item=>{
    const overdue=money(item.aging.days1to30+item.aging.days31to60+item.aging.days61to90+item.aging.days90plus),netBalance=money(item.balance-item.unallocatedCredit),debitBalance=Math.max(0,netBalance),creditBalance=Math.max(0,-netBalance),utilization=item.creditLimit>0?debitBalance/item.creditLimit:null;
    let decision='normal';if(item.aging.days90plus>0||(item.creditLimit>0&&debitBalance>item.creditLimit))decision='stop';else if(overdue>0||(utilization!==null&&utilization>=0.8)||(debitBalance>0&&item.creditLimit===0))decision='watch';
    item.sales.sort((a,b)=>String(b.delivery_date||b.created_at||'').localeCompare(String(a.delivery_date||a.created_at||'')));item.collectionRows.sort((a,b)=>String(b.occurred_at||b.created_at||'').localeCompare(String(a.occurred_at||a.created_at||'')));
    return{...item,overdue,netBalance,debitBalance,creditBalance,utilization,decision,products:[...item.products].slice(0,12),salesTypes:[...item.salesTypes]};
  });
  const totals=rows.reduce((out,row)=>{
    out.customers+=1;out.grossSales=money(out.grossSales+row.grossSales);out.paidApplied=money(out.paidApplied+row.paidApplied);out.balance=money(out.balance+row.balance);out.netBalance=money(out.netBalance+row.netBalance);out.debitBalance=money(out.debitBalance+row.debitBalance);out.creditBalance=money(out.creditBalance+row.creditBalance);out.collections=money(out.collections+row.collections);out.unallocatedCredit=money(out.unallocatedCredit+row.unallocatedCredit);out.overdue=money(out.overdue+row.overdue);
    if(row.openingCount){out.openingCustomers+=1;out.openingNet=money(out.openingNet+row.openingBalance);out.openingDebit=money(out.openingDebit+Math.max(0,row.openingBalance));out.openingCredit=money(out.openingCredit+Math.max(0,-row.openingBalance));out.openingCheques=money(out.openingCheques+row.openingCheques);}
    if(!row.invoiceCount&&!row.collectionCount&&row.openingCount)out.noMovement+=1;if(Math.abs(row.netBalance)<0.01)out.zeroBalances+=1;
    for(const key of Object.keys(out.aging))out.aging[key]=money(out.aging[key]+row.aging[key]);if(row.decision==='stop')out.stopped+=1;else if(row.decision==='watch')out.watch+=1;return out;
  },{customers:0,openingCustomers:0,openingDebit:0,openingCredit:0,openingNet:0,openingCheques:0,grossSales:0,paidApplied:0,balance:0,netBalance:0,debitBalance:0,creditBalance:0,collections:0,unallocatedCredit:0,overdue:0,noMovement:0,zeroBalances:0,stopped:0,watch:0,aging:{current:0,days1to30:0,days31to60:0,days61to90:0,days90plus:0}});
  return{scope,rows,totals,asOf:asOf.toISOString().slice(0,10)};
}
export function findCustomers(analytics,query){
  const q=norm(query);if(!q)return[];
  return(analytics?.rows||[]).map(row=>{const customerCode=norm(row.code||row.externalId),name=norm(row.name),phone=norm(row.phone);let score=0;if(customerCode===q)score=100;else if(name===q)score=95;else if(customerCode.startsWith(q))score=85;else if(name.startsWith(q))score=80;else if(customerCode.includes(q))score=70;else if(name.includes(q))score=65;else if(phone.includes(q))score=55;return{row,score};}).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||b.row.grossSales-a.row.grossSales).map(x=>x.row).slice(0,10);
}
export async function loadCustomerAnalytics(identity){
  const [databaseCustomers,sales,collections,stateRows]=await Promise.all([
    pagedSelect('customers','active=eq.true&select=external_id,customer_code,customer_name,phone,segment,credit_limit,payment_days,active&order=customer_name.asc').catch(()=>[]),
    pagedSelect('sales_orders','select=reference_no,sales_type,customer_external_id,customer_name,item,quantity,unit,total_amount,paid_amount,payment_method,status,delivery_date,created_at&order=created_at.desc').catch(()=>[]),
    pagedSelect('collection_events','select=reference_no,customer_external_id,customer_name,amount,allocated_amount,unallocated_amount,payment_method,status,note,occurred_at,created_at&order=occurred_at.desc').catch(()=>[]),
    select('app_state','key=eq.primary&select=payload&limit=1').catch(()=>[])
  ]);
  const payload=stateRows?.[0]?.payload||{},customers=mergeLocalCustomers(databaseCustomers,payload);
  return buildCustomerAnalytics({customers,sales,collections,openingBalances:await openingRows(payload),role:identity?.role||''});
}
