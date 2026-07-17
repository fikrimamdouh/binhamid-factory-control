import { select } from './supabase.js';

const n=value=>Number(value||0)||0;
const norm=value=>String(value||'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/[^a-z0-9\u0600-\u06ff]+/gi,' ').replace(/\s+/g,' ').trim();
const dayMs=86_400_000;
const closedStatus=new Set(['cancelled','rejected']);

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
function baseAggregate(customer={},key=''){
  return{
    key,
    externalId:String(customer.external_id||''),
    code:String(customer.customer_code||customer.external_id||''),
    name:String(customer.customer_name||'عميل غير مسمى'),
    phone:String(customer.phone||''),segment:String(customer.segment||''),
    creditLimit:n(customer.credit_limit),paymentDays:n(customer.payment_days),
    grossSales:0,paidApplied:0,balance:0,collections:0,unallocatedCredit:0,
    invoiceCount:0,collectionCount:0,lastSale:'',lastCollection:'',
    aging:{current:0,days1to30:0,days31to60:0,days61to90:0,days90plus:0},
    sales:[],collectionRows:[],products:new Set(),salesTypes:new Set()
  };
}
function canonicalKey(customer={}){
  const code=norm(customer.external_id||customer.customer_code);if(code)return`code:${code}`;
  return`name:${norm(customer.customer_name)||'unknown'}`;
}

export function buildCustomerAnalytics({customers=[],sales=[],collections=[],role='admin',asOf=riyadhToday()}={}){
  const scope=customerReportScope(role),aggregates=new Map(),codeMap=new Map(),nameCandidates=new Map();
  for(const customer of customers||[]){
    const key=canonicalKey(customer),agg=baseAggregate(customer,key);aggregates.set(key,agg);
    for(const code of [customer.external_id,customer.customer_code].map(norm).filter(Boolean))codeMap.set(code,key);
    const name=norm(customer.customer_name);if(name){const list=nameCandidates.get(name)||[];list.push(key);nameCandidates.set(name,list);}
  }
  const resolve=(code,name,create=true)=>{
    const codeNorm=norm(code),nameNorm=norm(name);
    let key=codeNorm?codeMap.get(codeNorm):'';
    if(!key&&nameNorm&&nameCandidates.get(nameNorm)?.length===1)key=nameCandidates.get(nameNorm)[0];
    if(!key)key=codeNorm?`code:${codeNorm}`:`name:${nameNorm||'unknown'}`;
    if(!aggregates.has(key)&&create)aggregates.set(key,baseAggregate({external_id:code||'',customer_code:code||'',customer_name:name||code||'عميل غير مسمى'},key));
    return key;
  };

  const scopedKeys=new Set();
  for(const row of sales||[]){
    if(closedStatus.has(String(row.status||'')))continue;
    if(scope!=='all'&&String(row.sales_type||'')!==scope)continue;
    const key=resolve(row.customer_external_id,row.customer_name),agg=aggregates.get(key);scopedKeys.add(key);
    const total=n(row.total_amount),paid=Math.min(total,Math.max(0,n(row.paid_amount))),outstanding=Math.max(0,total-paid);
    agg.grossSales+=total;agg.paidApplied+=paid;agg.balance+=outstanding;agg.invoiceCount+=1;
    agg.lastSale=newest(agg.lastSale,String(row.delivery_date||row.created_at||'').slice(0,10));
    if(row.item)agg.products.add(String(row.item));if(row.sales_type)agg.salesTypes.add(String(row.sales_type));
    const base=dateValue(row.delivery_date||row.created_at),due=addDays(base,agg.paymentDays),late=due?Math.floor((asOf-due)/dayMs):0,bucket=agingBucket(late);
    agg.aging[bucket]+=outstanding;
    agg.sales.push({...row,total,paid,outstanding,dueDate:due?due.toISOString().slice(0,10):'',daysLate:Math.max(0,late)});
  }

  for(const row of collections||[]){
    if(closedStatus.has(String(row.status||'')))continue;
    const key=resolve(row.customer_external_id,row.customer_name,scope==='all');
    if(scope!=='all'&&!scopedKeys.has(key))continue;
    const agg=aggregates.get(key);if(!agg)continue;
    const amount=Math.max(0,n(row.amount)),unallocated=Math.max(0,n(row.unallocated_amount));
    agg.collections+=amount;agg.unallocatedCredit+=unallocated;agg.collectionCount+=1;
    agg.lastCollection=newest(agg.lastCollection,String(row.occurred_at||row.created_at||'').slice(0,10));
    agg.collectionRows.push({...row,amount,unallocated});
  }

  let rows=[...aggregates.values()].filter(item=>scope==='all'?(item.invoiceCount||item.collectionCount):scopedKeys.has(item.key));
  rows=rows.map(item=>{
    const overdue=item.aging.days1to30+item.aging.days31to60+item.aging.days61to90+item.aging.days90plus;
    const utilization=item.creditLimit>0?item.balance/item.creditLimit:null;
    let decision='normal';
    if(item.aging.days90plus>0||(item.creditLimit>0&&item.balance>item.creditLimit))decision='stop';
    else if(overdue>0||(utilization!==null&&utilization>=0.8)||(item.balance>0&&item.creditLimit===0))decision='watch';
    item.sales.sort((a,b)=>String(b.delivery_date||b.created_at||'').localeCompare(String(a.delivery_date||a.created_at||'')));
    item.collectionRows.sort((a,b)=>String(b.occurred_at||b.created_at||'').localeCompare(String(a.occurred_at||a.created_at||'')));
    return{...item,overdue,utilization,decision,products:[...item.products].slice(0,12),salesTypes:[...item.salesTypes]};
  });
  const totals=rows.reduce((out,row)=>{
    out.customers+=1;out.grossSales+=row.grossSales;out.paidApplied+=row.paidApplied;out.balance+=row.balance;out.collections+=row.collections;out.unallocatedCredit+=row.unallocatedCredit;out.overdue+=row.overdue;
    for(const key of Object.keys(out.aging))out.aging[key]+=row.aging[key];
    if(row.decision==='stop')out.stopped+=1;else if(row.decision==='watch')out.watch+=1;
    return out;
  },{customers:0,grossSales:0,paidApplied:0,balance:0,collections:0,unallocatedCredit:0,overdue:0,stopped:0,watch:0,aging:{current:0,days1to30:0,days31to60:0,days61to90:0,days90plus:0}});
  return{scope,rows,totals,asOf:asOf.toISOString().slice(0,10)};
}

export function findCustomers(analytics,query){
  const q=norm(query);if(!q)return[];
  return(analytics?.rows||[]).map(row=>{
    const code=norm(row.code||row.externalId),name=norm(row.name),phone=norm(row.phone);
    let score=0;if(code===q)score=100;else if(name===q)score=95;else if(code.startsWith(q))score=85;else if(name.startsWith(q))score=80;else if(code.includes(q))score=70;else if(name.includes(q))score=65;else if(phone.includes(q))score=55;
    return{row,score};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||b.row.grossSales-a.row.grossSales).map(x=>x.row).slice(0,10);
}

export async function loadCustomerAnalytics(identity){
  const [customers,sales,collections]=await Promise.all([
    select('customers','active=eq.true&select=external_id,customer_code,customer_name,phone,segment,credit_limit,payment_days,active&order=customer_name.asc&limit=5000').catch(()=>[]),
    select('sales_orders','select=reference_no,sales_type,customer_external_id,customer_name,item,quantity,unit,total_amount,paid_amount,payment_method,status,delivery_date,created_at&order=created_at.desc&limit=10000').catch(()=>[]),
    select('collection_events','select=reference_no,customer_external_id,customer_name,amount,allocated_amount,unallocated_amount,payment_method,status,note,occurred_at,created_at&order=occurred_at.desc&limit=10000').catch(()=>[])
  ]);
  return buildCustomerAnalytics({customers,sales,collections,role:identity?.role||''});
}
