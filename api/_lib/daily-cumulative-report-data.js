import { select } from './supabase.js';

const PAGE_SIZE=1000;
const n=value=>Number(value||0)||0;
const norm=value=>String(value||'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/[^a-z0-9\u0600-\u06ff]+/gi,' ').replace(/\s+/g,' ').trim();
const closed=new Set(['cancelled','rejected']);
const date=value=>String(value||'').slice(0,10);

async function pagedSelect(table,query,maxPages=50){
  const output=[];
  for(let page=0;page<maxPages;page++){
    const rows=await select(table,`${query}&limit=${PAGE_SIZE}&offset=${page*PAGE_SIZE}`)||[];
    output.push(...rows);
    if(rows.length<PAGE_SIZE)break;
  }
  return output;
}

function customerKey(code,name){const c=norm(code);return c?`code:${c}`:`name:${norm(name)||'unknown'}`;}
function saleType(row){const raw=String(row?.sales_type||row?.kind||'').toLowerCase();if(raw==='block'||raw==='بلوك')return'block';if(raw==='concrete'||raw==='خرسانة'||raw==='خرسانه')return'concrete';return'other';}
function dailySale(row,index,reportDate){
  const total=Math.max(0,n(row.amount));
  return{id:`daily:${index}`,customerCode:String(row.customerCode||''),customerName:String(row.customer||'عميل غير مسمى'),type:saleType(row),item:String(row.item||''),quantity:n(row.quantity),total,paid:0,outstanding:total,openingOutstanding:0,date:reportDate,current:true,invoice:String(row.invoice||index+1)};
}
function storedSale(row){
  const total=Math.max(0,n(row.total_amount)),paid=Math.min(total,Math.max(0,n(row.paid_amount))),outstanding=Math.max(0,total-paid);
  return{id:String(row.reference_no||row.id||''),customerCode:String(row.customer_external_id||''),customerName:String(row.customer_name||'عميل غير مسمى'),type:saleType(row),item:String(row.item||''),quantity:n(row.quantity),total,paid,outstanding,openingOutstanding:outstanding,date:date(row.delivery_date||row.created_at),current:false,invoice:String(row.reference_no||'')};
}
function blankCustomer(key,code,name){return{key,code:String(code||''),name:String(name||code||'عميل غير مسمى'),invoices:[],currentCollections:0,currentUnallocated:0,applied:{block:0,concrete:0,other:0}};}

export function projectCumulativeDailyReport({storedSales=[],dailySales=[],dailyCollections=[],reportDate='',latestApprovedDate=''}={}){
  const customers=new Map();
  const get=(code,name)=>{const key=customerKey(code,name);if(!customers.has(key))customers.set(key,blankCustomer(key,code,name));const customer=customers.get(key);if(!customer.code&&code)customer.code=String(code);if((!customer.name||customer.name==='عميل غير مسمى')&&name)customer.name=String(name);return customer;};
  for(const row of storedSales||[]){if(closed.has(String(row.status||'')))continue;const sale=storedSale(row);if(sale.type==='other')continue;get(sale.customerCode,sale.customerName).invoices.push(sale);}
  for(const [index,row] of (dailySales||[]).entries()){const sale=dailySale(row,index,reportDate);if(sale.type==='other'||sale.total<=0)continue;get(sale.customerCode,sale.customerName).invoices.push(sale);}
  for(const row of dailyCollections||[]){
    const customer=get(row.customerCode,row.customer),amount=Math.max(0,n(row.amount));customer.currentCollections+=amount;
    let remaining=amount;
    const open=customer.invoices.filter(invoice=>invoice.outstanding>0).sort((a,b)=>String(a.date).localeCompare(String(b.date))||Number(a.current)-Number(b.current)||String(a.id).localeCompare(String(b.id)));
    for(const invoice of open){if(remaining<=0)break;const applied=Math.min(remaining,invoice.outstanding);invoice.outstanding-=applied;invoice.paid+=applied;remaining-=applied;customer.applied[invoice.type]=(customer.applied[invoice.type]||0)+applied;}
    customer.currentUnallocated+=remaining;
  }
  const departments={block:[],concrete:[]};
  for(const customer of customers.values())for(const type of ['block','concrete']){
    const invoices=customer.invoices.filter(row=>row.type===type),historical=invoices.filter(row=>!row.current),current=invoices.filter(row=>row.current);
    if(!invoices.length&&!customer.applied[type])continue;
    const openingBalance=historical.reduce((sum,row)=>sum+row.openingOutstanding,0),currentSales=current.reduce((sum,row)=>sum+row.total,0),currentQuantity=current.reduce((sum,row)=>sum+row.quantity,0),currentApplied=customer.applied[type]||0;
    const closingBalance=invoices.reduce((sum,row)=>sum+Math.max(0,row.outstanding),0),cumulativeSales=invoices.reduce((sum,row)=>sum+row.total,0),cumulativePaid=cumulativeSales-closingBalance;
    departments[type].push({key:customer.key,code:customer.code,name:customer.name,openingBalance,currentSales,currentQuantity,currentApplied,closingBalance,cumulativeSales,cumulativePaid,currentCollections:customer.currentCollections,currentUnallocated:customer.currentUnallocated,invoices:current,invoiceCount:invoices.length});
  }
  for(const type of ['block','concrete'])departments[type].sort((a,b)=>b.closingBalance-a.closingBalance||b.currentSales-a.currentSales||a.name.localeCompare(b.name,'ar'));
  const summarize=rows=>rows.reduce((out,row)=>{out.customers+=1;out.openingBalance+=row.openingBalance;out.currentSales+=row.currentSales;out.currentQuantity+=row.currentQuantity;out.currentApplied+=row.currentApplied;out.closingBalance+=row.closingBalance;out.cumulativeSales+=row.cumulativeSales;out.cumulativePaid+=row.cumulativePaid;out.unallocated+=row.currentUnallocated;return out;},{customers:0,openingBalance:0,currentSales:0,currentQuantity:0,currentApplied:0,closingBalance:0,cumulativeSales:0,cumulativePaid:0,unallocated:0});
  return{reportDate,latestApprovedDate,departments:{block:{rows:departments.block,totals:summarize(departments.block)},concrete:{rows:departments.concrete,totals:summarize(departments.concrete)}}};
}

export async function loadProjectedCumulativeDailyReport(analysis={},reportDate,options={}){
  const [sales,batches]=await Promise.all([
    pagedSelect('sales_orders','select=reference_no,sales_type,customer_external_id,customer_name,item,quantity,total_amount,paid_amount,status,delivery_date,created_at&order=created_at.asc').catch(()=>[]),
    select('daily_report_batches','status=eq.approved&select=report_date,status&order=report_date.desc&limit=50').catch(()=>[])
  ]),currentBatch=options?.currentBatch===true||analysis?.currentBatch===true;
  const storedSales=currentBatch?(sales||[]).filter(row=>date(row.delivery_date||row.created_at)<String(reportDate||'')):(sales||[]);
  const latestApprovedDate=currentBatch?((batches||[]).map(row=>String(row.report_date||'')).find(value=>value&&value<String(reportDate||''))||''):(batches?.[0]?.report_date||'');
  return projectCumulativeDailyReport({storedSales,dailySales:analysis?.sales||[],dailyCollections:analysis?.collections||[],reportDate,latestApprovedDate});
}
