import { select } from './supabase.js';

const n=value=>Number(value||0)||0;
const money=value=>Math.round((n(value)+Number.EPSILON)*100)/100;
const norm=value=>String(value||'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/[^a-z0-9\u0600-\u06ff]+/gi,' ').replace(/\s+/g,' ').trim();
const dayMs=86_400_000;
const closedStatus=new Set(['cancelled','rejected']);
const PAGE_SIZE=1000;

export function customerReportScope(role=''){
  if(role==='block_sales')return'block';
  if(role==='concrete_sales')return'concrete';
  return'all';
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
function segmentScope(value=''){
  const text=norm(value);
  if(/خرسان|concrete/.test(text))return'concrete';
  if(/بلوك|بلك|block/.test(text))return'block';
  return'all';
}
function segmentAllowed(value,scope){const segment=segmentScope(value);return scope==='all'||segment==='all'||segment===scope;}
function emptyAging(){return{current:0,days1to30:0,days31to60:0,days61to90:0,days90plus:0};}
function reduceAging(aging,credit){
  let remaining=Math.max(0,n(credit));
  for(const key of ['days90plus','days61to90','days31to60','days1to30','current']){
    if(remaining<=0)break;
    const applied=Math.min(aging[key],remaining);aging[key]=money(aging[key]-applied);remaining=money(remaining-applied);
  }
  return remaining;
}
async function pagedSelect(table,query,maxPages=50){
  const output=[];
  for(let page=0;page<maxPages;page++){
    const rows=await select(table,`${query}&limit=${PAGE_SIZE}&offset=${page*PAGE_SIZE}`)||[];
    output.push(...rows);if(rows.length<PAGE_SIZE)break;
  }
  return output;
}

function baseAggregate(customer={},key=''){
  return{
    key,externalId:String(customer.external_id||''),code:String(customer.customer_code||customer.external_id||''),name:String(customer.customer_name||'عميل غير مسمى'),
    phone:String(customer.phone||''),segment:String(customer.segment||''),creditLimit:n(customer.credit_limit),paymentDays:n(customer.payment_days),
    openingBalance:0,openingDebit:0,openingCredit:0,openingDate:'',openingCount:0,openingRows:[],
    grossSales:0,paidApplied:0,salesOutstanding:0,balance:0,creditBalance:0,netBalance:0,collections:0,unallocatedCredit:0,
    invoiceCount:0,collectionCount:0,lastSale:'',lastCollection:'',aging:emptyAging(),sales:[],collectionRows:[],products:new Set(),salesTypes:new Set()
  };
}
function canonicalKey(customer={}){const code=norm(customer.customer_code||customer.external_id);return code?`code:${code}`:`name:${norm(customer.customer_name)||'unknown'}`;}

export function extractStateCustomerData(payload={}){
  const legacy=payload?.legacy||{},ops=payload?.ops||{},clients=Array.isArray(legacy.cli)?legacy.cli:[],clientById=new Map(),codeByClientId=new Map();
  for(const client of clients){const id=String(client?.id||'');if(id)clientById.set(id,client);}
  for(const [customerCode,clientId] of Object.entries(ops?.settings?.customerCodeMap||{})){if(clientId&&!codeByClientId.has(String(clientId)))codeByClientId.set(String(clientId),String(customerCode));}
  const customers=clients.map(client=>({
    external_id:String(client.id||client.code||client.no||''),customer_code:String(client.code||client.no||codeByClientId.get(String(client.id||''))||''),customer_name:String(client.name||'عميل غير مسمى'),phone:String(client.tel||client.phone||''),segment:String(client.seg||client.segment||''),credit_limit:n(client.cap||client.credit),payment_days:n(client.days),active:client.act!==false
  })).filter(row=>row.external_id||row.customer_code);
  const openingBalances=(Array.isArray(ops.customerOpeningBalances)?ops.customerOpeningBalances:[]).map(item=>{
    const client=clientById.get(String(item?.clientId||''))||{},customerCode=String(item?.customerCode||client.code||client.no||codeByClientId.get(String(item?.clientId||''))||'');
    return{customer_external_id:String(client.id||customerCode),customer_code:customerCode,customer_name:String(item?.customerName||client.name||customerCode||'عميل غير مسمى'),segment:String(item?.segment||client.seg||'الاثنين'),amount:money(item?.amount),balance_date:String(item?.date||item?.balanceDate||'').slice(0,10),note:String(item?.note||''),source_format:String(item?.sourceFormat||''),client_id:String(item?.clientId||'')};
  }).filter(row=>row.customer_code||row.customer_name);
  return{customers,openingBalances};
}

function mergeCustomers(primary=[],fallback=[]){
  const map=new Map();
  for(const row of [...fallback,...primary]){
    const key=norm(row.customer_code||row.external_id||row.customer_name);if(!key)continue;
    const old=map.get(key)||{};
    map.set(key,{...old,...row,external_id:row.external_id||old.external_id||'',customer_code:row.customer_code||old.customer_code||'',customer_name:row.customer_name||old.customer_name||'عميل غير مسمى',phone:row.phone||old.phone||'',segment:row.segment||old.segment||'',credit_limit:n(row.credit_limit||old.credit_limit),payment_days:n(row.payment_days||old.payment_days),active:row.active!==false});
  }
  return[...map.values()];
}

export function buildCustomerAnalytics({customers=[],sales=[],collections=[],openingBalances=[],role='admin',asOf=riyadhToday()}={}){
  const scope=customerReportScope(role),reportDate=asOf instanceof Date?asOf:new Date(asOf),aggregates=new Map(),codeMap=new Map(),nameCandidates=new Map();
  for(const customer of customers||[]){
    const key=canonicalKey(customer),existing=aggregates.get(key),agg=existing||baseAggregate(customer,key);
    if(existing){agg.name=customer.customer_name||agg.name;agg.phone=customer.phone||agg.phone;agg.segment=customer.segment||agg.segment;agg.creditLimit=n(customer.credit_limit||agg.creditLimit);agg.paymentDays=n(customer.payment_days||agg.paymentDays);}
    aggregates.set(key,agg);
    for(const code of [customer.external_id,customer.customer_code].map(norm).filter(Boolean))codeMap.set(code,key);
    const name=norm(customer.customer_name);if(name){const list=nameCandidates.get(name)||[];if(!list.includes(key))list.push(key);nameCandidates.set(name,list);}
  }
  const resolve=(code,name,create=true)=>{
    const codeNorm=norm(code),nameNorm=norm(name);let key=codeNorm?codeMap.get(codeNorm):'';
    if(!key&&nameNorm&&nameCandidates.get(nameNorm)?.length===1)key=nameCandidates.get(nameNorm)[0];
    if(!key)key=codeNorm?`code:${codeNorm}`:`name:${nameNorm||'unknown'}`;
    if(!aggregates.has(key)&&create){const agg=baseAggregate({external_id:code||'',customer_code:code||'',customer_name:name||code||'عميل غير مسمى'},key);aggregates.set(key,agg);if(codeNorm)codeMap.set(codeNorm,key);}
    return key;
  };

  const scopedKeys=new Set();
  for(const row of openingBalances||[]){
    if(!segmentAllowed(row.segment,scope))continue;
    const code=row.customer_code||row.customer_external_id,key=resolve(code,row.customer_name),agg=aggregates.get(key),amount=money(row.amount);scopedKeys.add(key);
    agg.openingBalance=money(agg.openingBalance+amount);agg.openingDebit=money(agg.openingDebit+Math.max(0,amount));agg.openingCredit=money(agg.openingCredit+Math.max(0,-amount));agg.openingCount+=1;
    agg.openingDate=newest(agg.openingDate,String(row.balance_date||'').slice(0,10));agg.openingRows.push({...row,amount});if(row.segment)agg.segment=agg.segment||row.segment;
    const base=dateValue(row.balance_date),due=addDays(base,agg.paymentDays),late=due?Math.floor((reportDate-due)/dayMs):0;
    if(amount>0)agg.aging[agingBucket(late)]=money(agg.aging[agingBucket(late)]+amount);
  }

  for(const row of sales||[]){
    if(closedStatus.has(String(row.status||'')))continue;
    if(scope!=='all'&&String(row.sales_type||'')!==scope)continue;
    const key=resolve(row.customer_external_id,row.customer_name),agg=aggregates.get(key);scopedKeys.add(key);
    const total=n(row.total_amount),paid=Math.min(total,Math.max(0,n(row.paid_amount))),outstanding=Math.max(0,total-paid);
    agg.grossSales=money(agg.grossSales+total);agg.paidApplied=money(agg.paidApplied+paid);agg.salesOutstanding=money(agg.salesOutstanding+outstanding);agg.invoiceCount+=1;
    agg.lastSale=newest(agg.lastSale,String(row.delivery_date||row.created_at||'').slice(0,10));if(row.item)agg.products.add(String(row.item));if(row.sales_type)agg.salesTypes.add(String(row.sales_type));
    const base=dateValue(row.delivery_date||row.created_at),due=addDays(base,agg.paymentDays),late=due?Math.floor((reportDate-due)/dayMs):0,bucket=agingBucket(late);
    agg.aging[bucket]=money(agg.aging[bucket]+outstanding);agg.sales.push({...row,total,paid,outstanding,dueDate:due?due.toISOString().slice(0,10):'',daysLate:Math.max(0,late)});
  }

  for(const row of collections||[]){
    if(closedStatus.has(String(row.status||'')))continue;
    const key=resolve(row.customer_external_id,row.customer_name,scope==='all');if(scope!=='all'&&!scopedKeys.has(key))continue;
    const agg=aggregates.get(key);if(!agg)continue;
    const amount=Math.max(0,n(row.amount)),unallocated=Math.max(0,n(row.unallocated_amount));agg.collections=money(agg.collections+amount);agg.unallocatedCredit=money(agg.unallocatedCredit+unallocated);agg.collectionCount+=1;
    agg.lastCollection=newest(agg.lastCollection,String(row.occurred_at||row.created_at||'').slice(0,10));agg.collectionRows.push({...row,amount,unallocated});
  }

  let rows=[...aggregates.values()].filter(item=>scope==='all'?(item.openingCount||item.invoiceCount||item.collectionCount):scopedKeys.has(item.key));
  rows=rows.map(item=>{
    const totalDebit=money(item.openingDebit+item.salesOutstanding),totalCredit=money(item.openingCredit+item.unallocatedCredit),net=money(totalDebit-totalCredit);
    item.balance=Math.max(0,net);item.creditBalance=Math.max(0,-net);item.netBalance=net;reduceAging(item.aging,totalCredit);
    const overdue=money(item.aging.days1to30+item.aging.days31to60+item.aging.days61to90+item.aging.days90plus),utilization=item.creditLimit>0?item.balance/item.creditLimit:null;
    let decision='normal';if(item.aging.days90plus>0||(item.creditLimit>0&&item.balance>item.creditLimit))decision='stop';else if(overdue>0||(utilization!==null&&utilization>=0.8)||(item.balance>0&&item.creditLimit===0))decision='watch';
    item.sales.sort((a,b)=>String(b.delivery_date||b.created_at||'').localeCompare(String(a.delivery_date||a.created_at||'')));item.collectionRows.sort((a,b)=>String(b.occurred_at||b.created_at||'').localeCompare(String(a.occurred_at||a.created_at||'')));
    return{...item,overdue,utilization,decision,products:[...item.products].slice(0,12),salesTypes:[...item.salesTypes]};
  });
  const totals=rows.reduce((out,row)=>{
    out.customers+=1;out.openingDebit+=row.openingDebit;out.openingCredit+=row.openingCredit;out.grossSales+=row.grossSales;out.paidApplied+=row.paidApplied;out.salesOutstanding+=row.salesOutstanding;out.balance+=row.balance;out.creditBalance+=row.creditBalance;out.collections+=row.collections;out.unallocatedCredit+=row.unallocatedCredit;out.overdue+=row.overdue;
    for(const key of Object.keys(out.aging))out.aging[key]+=row.aging[key];if(row.decision==='stop')out.stopped+=1;else if(row.decision==='watch')out.watch+=1;return out;
  },{customers:0,openingDebit:0,openingCredit:0,grossSales:0,paidApplied:0,salesOutstanding:0,balance:0,creditBalance:0,netBalance:0,collections:0,unallocatedCredit:0,overdue:0,stopped:0,watch:0,aging:emptyAging(),collectionRatio:null,overdueRatio:null});
  for(const key of ['openingDebit','openingCredit','grossSales','paidApplied','salesOutstanding','balance','creditBalance','collections','unallocatedCredit','overdue'])totals[key]=money(totals[key]);
  for(const key of Object.keys(totals.aging))totals.aging[key]=money(totals.aging[key]);
  totals.netBalance=money(totals.balance-totals.creditBalance);totals.collectionRatio=totals.grossSales>0?totals.paidApplied/totals.grossSales:null;totals.overdueRatio=totals.balance>0?totals.overdue/totals.balance:null;
  return{scope,rows,totals,asOf:reportDate.toISOString().slice(0,10)};
}

export function findCustomers(analytics,query){
  const q=norm(query);if(!q)return[];
  return(analytics?.rows||[]).map(row=>{const code=norm(row.code||row.externalId),name=norm(row.name),phone=norm(row.phone);let score=0;if(code===q)score=100;else if(name===q)score=95;else if(code.startsWith(q))score=85;else if(name.startsWith(q))score=80;else if(code.includes(q))score=70;else if(name.includes(q))score=65;else if(phone.includes(q))score=55;return{row,score};}).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||b.row.balance-a.row.balance||b.row.grossSales-a.row.grossSales).map(x=>x.row).slice(0,10);
}

export async function loadCustomerAnalytics(identity){
  const [databaseCustomers,sales,collections,stateRows]=await Promise.all([
    pagedSelect('customers','active=eq.true&select=external_id,customer_code,customer_name,phone,segment,credit_limit,payment_days,active&order=customer_name.asc').catch(()=>[]),
    pagedSelect('sales_orders','select=reference_no,sales_type,customer_external_id,customer_name,item,quantity,unit,total_amount,paid_amount,payment_method,status,delivery_date,created_at&order=created_at.desc').catch(()=>[]),
    pagedSelect('collection_events','select=reference_no,customer_external_id,customer_name,amount,allocated_amount,unallocated_amount,payment_method,status,note,occurred_at,created_at&order=occurred_at.desc').catch(()=>[]),
    select('app_state','key=eq.primary&select=payload,updated_at&limit=1').catch(()=>[])
  ]);
  const stateData=extractStateCustomerData(stateRows?.[0]?.payload||{}),customers=mergeCustomers(databaseCustomers,stateData.customers);
  return buildCustomerAnalytics({customers,sales,collections,openingBalances:stateData.openingBalances,role:identity?.role||''});
}
