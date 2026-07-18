import { loadCostDecisionData, productEconomics } from './bot-costs-data.js';
import { select } from './supabase.js';

const n=value=>{const parsed=Number(value);return Number.isFinite(parsed)?parsed:0;};
const norm=value=>String(value||'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/[^a-z0-9\u0600-\u06ff]+/gi,' ').replace(/\s+/g,' ').trim();
const excluded=new Set(['cancelled','rejected','void','deleted']);
const PAGE_SIZE=1000;
async function pagedSelect(table,query,maxPages=20){const rows=[];for(let page=0;page<maxPages;page++){const pageRows=await select(table,`${query}&limit=${PAGE_SIZE}&offset=${page*PAGE_SIZE}`)||[];rows.push(...pageRows);if(pageRows.length<PAGE_SIZE)break;}return rows;}
function monthBounds(period){const [year,month]=String(period).split('-').map(Number),next=new Date(Date.UTC(year,month,1)),startDate=new Date(Date.UTC(year,month-1,1));return{start:`${period}-01`,next:next.toISOString().slice(0,10),days:Math.round((next-startDate)/86400000)};}
async function loadPeriodSales(start,next){
  const base=`delivery_date=gte.${start}&delivery_date=lt.${next}`;
  const advanced=`${base}&select=id,reference_no,sales_type,customer_external_id,customer_name,item,quantity,unit,total_amount,paid_amount,status,delivery_date,created_at,subtotal_before_vat,discount_amount,return_amount,vat_amount,vat_rate,amount_includes_vat,net_amount_before_vat&order=delivery_date.asc`;
  try{return{rows:await pagedSelect('sales_orders',advanced),taxFieldsAvailable:true};}
  catch{return{rows:await pagedSelect('sales_orders',`${base}&select=id,reference_no,sales_type,customer_external_id,customer_name,item,quantity,unit,total_amount,paid_amount,status,delivery_date,created_at&order=delivery_date.asc`).catch(()=>[]),taxFieldsAvailable:false};}
}

export function resolveSaleNetBeforeVat(row={}){
  const discount=Math.max(0,n(row.discount_amount??row.discountAmount)),returns=Math.max(0,n(row.return_amount??row.returnAmount)),total=n(row.total_amount??row.totalAmount),explicit=row.net_amount_before_vat??row.netAmountBeforeVat,subtotal=row.subtotal_before_vat??row.subtotalBeforeVat,vat=n(row.vat_amount??row.vatAmount),rate=n(row.vat_rate??row.vatRate??15);
  if(explicit!==undefined&&explicit!==null)return{netSales:Math.max(0,n(explicit)-returns),reliable:true,basis:'net_amount_before_vat'};
  if(subtotal!==undefined&&subtotal!==null)return{netSales:Math.max(0,n(subtotal)-discount-returns),reliable:true,basis:'subtotal_before_vat'};
  if(vat>0)return{netSales:Math.max(0,total-vat-discount-returns),reliable:true,basis:'total_less_recorded_vat'};
  if(row.amount_includes_vat===true||row.amountIncludesVat===true){if(rate<0||rate>=100)return{netSales:Math.max(0,total-discount-returns),reliable:false,basis:'invalid_vat_rate'};return{netSales:Math.max(0,total/(1+rate/100)-discount-returns),reliable:true,basis:'total_divided_by_vat'};}
  if(row.amount_includes_vat===false||row.amountIncludesVat===false)return{netSales:Math.max(0,total-discount-returns),reliable:true,basis:'recorded_pre_vat'};
  return{netSales:Math.max(0,total-discount-returns),reliable:false,basis:'recorded_total_tax_unknown'};
}

export function buildCustomerProfitability({sales=[],unitCosts={},customers=[],periodDays=30}={}){
  const customerByCode=new Map(),customerByName=new Map();for(const row of customers){if(row.external_id)customerByCode.set(norm(row.external_id),row);if(row.customer_code)customerByCode.set(norm(row.customer_code),row);if(row.customer_name)customerByName.set(norm(row.customer_name),row);}
  const seen=new Set(),map=new Map();
  for(const row of sales||[]){
    if(excluded.has(String(row.status||'').toLowerCase()))continue;
    const ref=String(row.reference_no||row.invoice_no||row.id||'');if(ref&&seen.has(ref))continue;if(ref)seen.add(ref);
    const type=String(row.sales_type||'');if(!['block','concrete'].includes(type))continue;
    const code=String(row.customer_external_id||row.customer_code||''),name=String(row.customer_name||''),master=customerByCode.get(norm(code))||customerByName.get(norm(name))||{},key=norm(code)?`code:${norm(code)}`:`name:${norm(name)||'unknown'}`;
    if(!map.has(key))map.set(key,{key,code:code||master.customer_code||master.external_id||'',name:name||master.customer_name||'عميل غير مسمى',blockQuantity:0,concreteQuantity:0,blockCost:0,concreteCost:0,recordedSales:0,netSalesBeforeVat:0,estimatedCost:0,profit:0,marginRate:null,balance:n(master.balance??master.outstanding_balance??master.current_balance),creditLimit:n(master.credit_limit),paymentDays:n(master.payment_days),invoiceCount:0,taxBasisReliable:true,missingUnitCosts:new Set(),bases:new Set()});
    const item=map.get(key),quantity=Math.max(0,n(row.quantity)),unitCost=n(unitCosts[type]);item.invoiceCount+=1;if(type==='block')item.blockQuantity+=quantity;else item.concreteQuantity+=quantity;
    if(unitCost>0){const cost=quantity*unitCost;if(type==='block')item.blockCost+=cost;else item.concreteCost+=cost;item.estimatedCost+=cost;}else item.missingUnitCosts.add(type);
    const sale=resolveSaleNetBeforeVat(row);item.recordedSales+=n(row.total_amount);item.netSalesBeforeVat+=sale.netSales;item.taxBasisReliable&&=sale.reliable;item.bases.add(sale.basis);
  }
  return[...map.values()].map(item=>{const missing=[...item.missingUnitCosts],bases=[...item.bases];item.profit=item.netSalesBeforeVat-item.estimatedCost;item.marginRate=item.netSalesBeforeVat>0?item.profit/item.netSalesBeforeVat*100:null;const collectionDaysEstimate=item.netSalesBeforeVat>0?Math.min(999,item.balance/item.netSalesBeforeVat*Math.max(1,n(periodDays))):null;return{...item,missingUnitCosts:missing,bases,collectionDaysEstimate,reliable:item.taxBasisReliable&&missing.length===0};}).sort((a,b)=>b.profit-a.profit);
}

export function findCustomerProfitability(rows,query){const q=norm(query);if(!q)return[];return(rows||[]).map(row=>{const code=norm(row.code),name=norm(row.name);let score=0;if(code===q)score=100;else if(name===q)score=95;else if(code.startsWith(q))score=85;else if(name.startsWith(q))score=80;else if(code.includes(q))score=70;else if(name.includes(q))score=65;return{row,score};}).filter(item=>item.score).sort((a,b)=>b.score-a.score||b.row.profit-a.row.profit).map(item=>item.row).slice(0,10);}

export async function loadCustomerProfitability(period){
  const costData=await loadCostDecisionData(period),economics=productEconomics(costData),unitCosts=Object.fromEntries(economics.map(row=>[row.costCenter,row.unitCost])),{start,next,days}=monthBounds(costData.period);
  const [salesResult,customers,exposures]=await Promise.all([
    loadPeriodSales(start,next),
    pagedSelect('customers','active=eq.true&select=external_id,customer_code,customer_name,credit_limit,payment_days,active&order=customer_name.asc').catch(()=>[]),
    pagedSelect('control_credit_exposure','select=customer_external_id,customer_code,customer_name,credit_limit,payment_days,outstanding_balance,over_limit_amount,open_orders&order=customer_name.asc').catch(()=>[])
  ]);
  const exposureByCode=new Map(exposures.map(row=>[norm(row.customer_external_id||row.customer_code),row])),enriched=customers.map(row=>({...row,...(exposureByCode.get(norm(row.external_id||row.customer_code))||{})}));
  const rows=buildCustomerProfitability({sales:salesResult.rows,unitCosts,customers:enriched,periodDays:days});return{period:costData.period,periodStatus:String(costData.report?.period?.status||'not_calculated'),unitCosts,rows,taxFieldsAvailable:salesResult.taxFieldsAvailable,disclaimer:salesResult.taxFieldsAvailable?'تكلفة الوحدة متوسط شهري فعلي؛ النتيجة تقديرية على مستوى العميل وليست تكلفة Batch لكل فاتورة.':'تكلفة الوحدة متوسط شهري فعلي. بعض الفواتير القديمة لا تفصل الضريبة والخصم والمرتجع، لذلك الربحية تقديرية حتى استكمال حقول الأساس الضريبي.'};
}
