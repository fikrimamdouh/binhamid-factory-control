import { errorResponse, json, method } from '../http.js';
import { requireCapability } from '../permissions.js';
import { select } from '../supabase.js';

const clean=value=>String(value??'').trim();
const norm=value=>clean(value).toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/[^a-z0-9\u0600-\u06ff]+/gi,' ').replace(/\s+/g,' ').trim();
const isoDate=value=>{const text=clean(value).slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';};
const number=value=>Number.isFinite(Number(value))?Number(value):0;
const collectionAmount=row=>Math.max(number(row?.debit),number(row?.credit),number(row?.amount));
const customerKey=(code,name)=>clean(code)?`code:${norm(code)}`:`name:${norm(name)||'unknown'}`;
const validSector=value=>['block','concrete','all'].includes(value)?value:'all';

function salesType(row={}){
  const raw=norm(row.sales_type||row.kind||row.item_name||row.item||'');
  if(raw==='block'||raw.includes('بلوك')||raw.includes('بلك'))return'block';
  if(raw==='concrete'||raw.includes('خرسان')||raw.includes('ready mix')||raw==='rmc')return'concrete';
  return'';
}
function clientSector(client={}){
  const raw=norm(client.seg||client.segment||client.costCenter||'');
  if(raw.includes('بلوك')||raw.includes('بلك'))return'block';
  if(raw.includes('خرسان'))return'concrete';
  return raw.includes('اثنين')||raw.includes('الكل')?'all':'';
}
function statusOf(row){
  if(row.openingDebt<=0)return row.closingBalance<=0?'no_prior_debt':'new_debt';
  if(row.oldDebtRemaining<=0)return'settled';
  if(row.oldDebtPaid>0)return'partial';
  return'unpaid';
}
const STATUS_LABELS={settled:'صفّى الرصيد السابق',partial:'سداد جزئي للرصيد السابق',unpaid:'لم يسدد من الرصيد السابق',no_prior_debt:'لا يوجد رصيد سابق',new_debt:'مديونية نشأت خلال الفترة'};

async function paged(table,query,maxPages=30){
  const rows=[];
  for(let page=0;page<maxPages;page++){
    const part=await select(table,`${query}${query?'&':''}limit=1000&offset=${page*1000}`).catch(()=>[]);
    rows.push(...(part||[]));
    if(!part||part.length<1000)break;
  }
  return rows;
}
async function byBatchIds(table,ids,fields){
  const rows=[];
  for(let index=0;index<ids.length;index+=80){
    const group=ids.slice(index,index+80);
    if(!group.length)continue;
    const part=await paged(table,`batch_id=in.(${group.join(',')})&select=${fields}`,15);
    rows.push(...part);
  }
  return rows;
}
function legacyState(row){return row?.payload?.legacy||{};}
function employeeRoleType(employee={}){
  const role=norm(`${employee.role||''} ${employee.declarationRole||''}`);
  if(role.includes('بلوك')||role.includes('بلك'))return'block';
  if(role.includes('خرسان'))return'concrete';
  return'';
}
function mergeEmployees(legacyEmployees=[],cloudEmployees=[]){
  const map=new Map();
  for(const row of legacyEmployees||[]){const key=clean(row.id||row.external_id||row.nid||row.name);if(key)map.set(key,{...row,externalId:clean(row.id||row.external_id)});}
  for(const row of cloudEmployees||[]){
    const key=clean(row.external_id||row.national_id||row.full_name);if(!key)continue;
    const current=map.get(key)||{};
    map.set(key,{...current,id:row.external_id||current.id,externalId:row.external_id||current.externalId,name:row.full_name||current.name,nid:row.national_id||current.nid,no:row.employee_no||current.no,tel:row.phone||current.tel,role:row.role||current.role,active:row.active!==false});
  }
  return[...map.values()].filter(row=>row.active!==false&&row.act!==false&&employeeRoleType(row));
}

export async function customerPortfolioRange(req,res){
  if(!method(req,res,['GET']))return;
  try{
    await requireCapability(req,'daily_report.view');
    const today=new Date().toISOString().slice(0,10),to=isoDate(req.query?.to)||today,from=isoDate(req.query?.from)||to;
    if(from>to)throw Object.assign(new Error('تاريخ بداية الفترة يجب ألا يتجاوز تاريخ النهاية.'),{status:400,code:'PORTFOLIO_RANGE_INVALID'});
    const sector=validSector(clean(req.query?.sector)||'all'),employeeId=clean(req.query?.employee),statusFilter=clean(req.query?.status),search=norm(req.query?.search);
    const [batchRows,openingRows,stateRows,cloudEmployees]=await Promise.all([
      paged('daily_report_batches',`status=eq.approved&report_date=lte.${encodeURIComponent(to)}&select=id,report_date,original_name,committed_at&order=report_date.asc,committed_at.asc`,5),
      paged('customer_opening_balances','select=customer_code,customer_name,balance',10),
      select('app_state','key=eq.primary&select=payload&limit=1').catch(()=>[]),
      paged('employees','active=eq.true&select=external_id,national_id,employee_no,full_name,phone,role,active&order=full_name.asc',5)
    ]);
    const batches=(batchRows||[]).filter(row=>isoDate(row.report_date)),batchDate=new Map(batches.map(row=>[String(row.id),isoDate(row.report_date)])),ids=batches.map(row=>String(row.id));
    const [sales,cash]=await Promise.all([
      byBatchIds('daily_report_sales_lines',ids,'batch_id,source_row_no,invoice_no,sales_type,customer_code,customer_name,item_name,quantity,amount'),
      byBatchIds('daily_report_cash_movements',ids,'batch_id,source_row_no,account_code,account_name,debit,credit,is_customer_collection')
    ]);
    const legacy=legacyState(stateRows?.[0]),clients=Array.isArray(legacy.cli)?legacy.cli:[],employees=mergeEmployees(legacy.emp,cloudEmployees),clientsByKey=new Map();
    for(const client of clients){clientsByKey.set(customerKey(client.code||client.cr||client.id,client.name),client);if(client.name)clientsByKey.set(`name:${norm(client.name)}`,client);}
    const rows=new Map();
    const get=(code,name)=>{
      const key=customerKey(code,name),master=clientsByKey.get(key)||clientsByKey.get(`name:${norm(name)}`)||{},current=rows.get(key)||{key,customerCode:clean(code||master.code||master.cr||master.id),customerName:clean(name||master.name||code)||'عميل غير مسمى',phone:clean(master.tel||master.phone),registry:clean(master.cr||master.registry||master.nationalId),employeeId:clean(master.rep),segment:clientSector(master),baseOpening:0,priorSales:0,priorCollections:0,periodSales:0,periodCollections:0,invoiceCount:0,collectionCount:0,lastSaleDate:'',lastCollectionDate:''};
      rows.set(key,current);return current;
    };
    for(const row of openingRows||[])get(row.customer_code,row.customer_name).baseOpening+=number(row.balance);
    for(const sale of sales||[]){
      const date=batchDate.get(String(sale.batch_id));if(!date)continue;
      const row=get(sale.customer_code,sale.customer_name),amount=number(sale.amount),type=salesType(sale);
      if(type)row.segment=row.segment&&row.segment!==type?'all':type;
      if(date<from)row.priorSales+=amount;
      else if(date<=to){row.periodSales+=amount;row.invoiceCount++;if(date>row.lastSaleDate)row.lastSaleDate=date;}
    }
    for(const movement of cash||[]){
      if(!(movement.is_customer_collection===true||String(movement.is_customer_collection)==='true'))continue;
      const date=batchDate.get(String(movement.batch_id));if(!date)continue;
      const row=get(movement.account_code,movement.account_name),amount=collectionAmount(movement);
      if(date<from)row.priorCollections+=amount;
      else if(date<=to){row.periodCollections+=amount;row.collectionCount++;if(date>row.lastCollectionDate)row.lastCollectionDate=date;}
    }
    const employee=employees.find(row=>clean(row.id||row.externalId)===employeeId)||null,employeeType=employeeRoleType(employee||{}),output=[];
    for(const row of rows.values()){
      row.openingDebt=row.baseOpening+row.priorSales-row.priorCollections;
      row.oldDebtPaid=Math.min(Math.max(row.openingDebt,0),Math.max(row.periodCollections,0));
      row.oldDebtRemaining=Math.max(row.openingDebt-row.oldDebtPaid,0);
      const remainingCollection=Math.max(row.periodCollections-row.oldDebtPaid,0);
      row.currentSalesPaid=Math.min(Math.max(row.periodSales,0),remainingCollection);
      row.advance=Math.max(remainingCollection-row.currentSalesPaid,0);
      row.closingBalance=row.openingDebt+row.periodSales-row.periodCollections;
      row.status=statusOf(row);row.statusLabel=STATUS_LABELS[row.status];
      const effectiveSector=row.segment||clientSector(clientsByKey.get(row.key)||{});
      if(sector!=='all'&&effectiveSector!==sector&&effectiveSector!=='all')continue;
      if(employeeId){const assigned=row.employeeId===employeeId,roleSector=employeeType&&effectiveSector===employeeType;if(!assigned&&!roleSector)continue;}
      if(statusFilter&&statusFilter!=='all'&&row.status!==statusFilter)continue;
      if(search&&!norm(`${row.customerName} ${row.customerCode} ${row.phone} ${row.registry}`).includes(search))continue;
      if(!row.periodSales&&!row.periodCollections&&!row.openingDebt)continue;
      output.push({...row,segment:effectiveSector||sector});
    }
    output.sort((a,b)=>b.closingBalance-a.closingBalance||a.customerName.localeCompare(b.customerName,'ar'));
    const total=(field)=>output.reduce((sum,row)=>sum+number(row[field]),0),summary={customerCount:output.length,openingDebt:total('openingDebt'),sales:total('periodSales'),collections:total('periodCollections'),oldDebtPaid:total('oldDebtPaid'),oldDebtRemaining:total('oldDebtRemaining'),closingBalance:total('closingBalance'),advance:total('advance'),settledCount:output.filter(row=>row.status==='settled').length,partialCount:output.filter(row=>row.status==='partial').length,unpaidCount:output.filter(row=>row.status==='unpaid').length};
    json(res,200,{ok:true,from,to,sector,employee:employee?{id:clean(employee.id||employee.externalId),name:employee.name,role:employee.role,nationalId:employee.nid||''}:null,employees:employees.map(row=>({id:clean(row.id||row.externalId),name:row.name,role:row.role,nationalId:row.nid||'',sector:employeeRoleType(row)})),statusLabels:STATUS_LABELS,allocationRule:'تُوجّه تحصيلات الفترة أولًا إلى الرصيد السابق، ثم إلى مبيعات الفترة، ثم تُعرض الزيادة كدفعة مقدمة.',summary,rows:output,latestReportDate:batches.at(-1)?.report_date||null});
  }catch(error){errorResponse(res,error);}
}
