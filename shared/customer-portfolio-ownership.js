const clean=value=>String(value??'').trim();
const norm=value=>clean(value).toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/[^a-z0-9\u0600-\u06ff]+/gi,' ').replace(/\s+/g,' ').trim();

export const CUSTOMER_PORTFOLIO_OWNERSHIP_VERSION='2026.07.30-concrete-cash-bank-cutoff-v4';

export function portfolioSector(value=''){
  const text=norm(value);
  if(text==='block'||text.includes('بلوك')||text.includes('بلك'))return'block';
  if(text==='concrete'||text.includes('خرسان')||text.includes('ready mix')||text==='rmc')return'concrete';
  return'';
}

export function employeePortfolioSector(employee={}){
  return portfolioSector([employee.declarationRole,employee.role,employee.job,employee.position].filter(Boolean).join(' '));
}

export function salePortfolioSector(row={}){
  const item=portfolioSector(row.item||row.itemName||row.item_name||row.product);
  if(item)return item;
  return portfolioSector(row.salesType||row.sales_type||row.kind||row.type||row.segment);
}

function employeeIds(employee={}){
  return new Set([employee.id,employee.external_id,employee.externalId,...(Array.isArray(employee.employeeAliases)?employee.employeeAliases:[])].map(clean).filter(Boolean));
}

function assignedEmployee(customer={},employees=[]){
  const assigned=clean(customer.rep||customer.repId||customer.salesRepId||customer.employeeId);
  if(!assigned)return null;
  return(employees||[]).find(employee=>employeeIds(employee).has(assigned))||null;
}

export function earliestPortfolioSector(sales=[]){
  const rows=(sales||[]).map((row,index)=>({row,index,type:salePortfolioSector(row),date:clean(row.delivery_date||row.deliveryDate||row.date||row.created_at).slice(0,10),reference:clean(row.reference_no||row.invoice||row.invoiceNo||row.invoice_no||row.id)})).filter(item=>item.type);
  rows.sort((a,b)=>(a.date||'9999-99-99').localeCompare(b.date||'9999-99-99')||a.reference.localeCompare(b.reference,'ar',{numeric:true})||a.index-b.index);
  return rows[0]?.type||'';
}

export function resolveCustomerPortfolioOwner({customer={},employees=[],historySales=[],fallbackSector=''}={}){
  const explicit=portfolioSector(customer.primarySector)||portfolioSector(customer.primary_sector)||portfolioSector(customer.ownerSector)||portfolioSector(customer.owner_sector);
  if(explicit)return{sector:explicit,source:'explicit_primary_sector',employee:assignedEmployee(customer,employees)};
  const employee=assignedEmployee(customer,employees),employeeSector=employeePortfolioSector(employee||{});
  if(employeeSector)return{sector:employeeSector,source:'assigned_representative',employee};
  const segment=portfolioSector(customer.seg)||portfolioSector(customer.segment)||portfolioSector(customer.costCenter)||portfolioSector(customer.cost_center);
  if(segment)return{sector:segment,source:'customer_segment',employee:null};
  const firstSale=earliestPortfolioSector(historySales);
  if(firstSale)return{sector:firstSale,source:'first_historical_sale',employee:null};
  const fallback=portfolioSector(fallbackSector);
  if(fallback)return{sector:fallback,source:'current_sale_fallback',employee:null};
  return{sector:'',source:'unclassified',employee:null};
}

export function portfolioSectorLabel(value=''){
  const type=portfolioSector(value);
  return type==='block'?'البلوك':type==='concrete'?'الخرسانة':'غير محدد';
}
