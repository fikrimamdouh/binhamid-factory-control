import * as XLSX from 'xlsx';
import { erpSaleType } from './erp-telegram-delivery.js';

const clean=(value,max=1000)=>String(value??'').trim().slice(0,max);
const westernDigits=value=>String(value??'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
const money=value=>Math.round((Number(value||0)+Number.EPSILON)*100)/100;
const qty=value=>Math.round((Number(value||0)+Number.EPSILON)*1000)/1000;
const norm=value=>clean(value,1000).toLowerCase().replace(/[أإآٱ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ً-ْـ]/g,'').replace(/\s+/g,' ');
const LEGACY_BASELINE_START='2026-07-19';
const LEGACY_BASELINE_END='2026-07-23';

function isoDate(year,month,day){
  const y=Number(year),m=Number(month),d=Number(day),value=`${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  if(y<2000||y>2100||m<1||m>12||d<1||d>31||Number.isNaN(new Date(`${value}T12:00:00Z`).getTime()))return'';
  return value;
}

function dateCandidate(value,allowSerial=false){
  if(value instanceof Date&&!Number.isNaN(value.getTime()))return`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
  const text=westernDigits(value).trim(),serial=Number(text);
  if(allowSerial&&Number.isFinite(serial)&&serial>=30000&&serial<=80000){const parsed=new Date(Date.UTC(1899,11,30)+Math.round(serial)*86400000);if(!Number.isNaN(parsed.getTime()))return parsed.toISOString().slice(0,10);}
  let match=text.match(/(20\d{2})[.\/_-](\d{1,2})[.\/_-](\d{1,2})/);if(match)return isoDate(match[1],match[2],match[3]);
  match=text.match(/(\d{1,2})[.\/_-](\d{1,2})[.\/_-](20\d{2})/);if(match)return isoDate(match[3],match[2],match[1]);
  return'';
}

function dateFromWorkbook(workbook){
  for(const sheetName of workbook?.SheetNames||[]){
    const rows=XLSX.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,defval:'',raw:true,cellDates:true,blankrows:false}).slice(0,120);
    for(const row of rows)for(let index=0;index<row.length;index++){
      const label=String(row[index]??'').replace(/\s+/g,' ').trim();
      if(!/تاريخ(?:\s+التقرير|\s+الحركه|\s+الحركة)?|report\s*date/i.test(label))continue;
      for(const candidate of [row[index],row[index+1],row[index+2],row[index+3]]){const parsed=dateCandidate(candidate,true);if(parsed)return parsed;}
    }
  }
  return'';
}

export function resolveReportDate(req,workbook,name,analysis={}){
  const explicit=dateCandidate(req?.headers?.['x-erp-report-date']);if(explicit)return explicit;
  const fromWorkbook=dateFromWorkbook(workbook);if(fromWorkbook)return fromWorkbook;
  const parsedDates=[...new Set(analysis?.reportDates||[])].filter(value=>/^\d{4}-\d{2}-\d{2}$/.test(value)).sort();if(parsedDates.length)return parsedDates.at(-1);
  const fromName=dateCandidate(name);if(fromName)return fromName;
  const modified=dateCandidate(req?.headers?.['x-erp-file-date']);if(modified)return modified;
  throw Object.assign(new Error('تعذر تحديد تاريخ التقرير. ضع التاريخ داخل اسم الملف أو في خانة تاريخ التقرير داخل Excel.'),{status:422,code:'ERP_REPORT_DATE_REQUIRED'});
}

export function dailyParserEvidence(analysis={}){
  const counts={sales:Number(analysis?.sales?.length||0),collections:Number(analysis?.collections?.length||0),cashMovements:Number(analysis?.cashMovements?.length||0),treasuries:Number(analysis?.treasuries?.length||0),finishedGoods:Number(analysis?.finishedGoods?.length||0),rawMaterials:Number(analysis?.rawMaterials?.length||0)};
  return{recognized:Object.values(counts).some(value=>value>0),counts};
}

export function payloadFromAnalysis(analysis,reportDate){
  const inventory=[
    ...(analysis.finishedGoods||[]).map((row,index)=>({sourceRowNo:row.row||index+1,inventoryType:'finished_goods',itemCode:row.itemCode,itemName:row.itemName,unit:row.unit,opening:row.opening,received:row.received,issued:row.issued,closing:row.closing})),
    ...(analysis.rawMaterials||[]).map((row,index)=>({sourceRowNo:row.row||index+1,inventoryType:'raw_material',itemCode:row.itemCode,itemName:row.itemName,unit:row.unit,opening:row.opening,received:row.received,issued:row.issued,closing:row.closing}))
  ];
  return{
    sales:(analysis.sales||[]).map((row,index)=>({sourceRowNo:row.row||index+1,invoiceNo:row.invoice,salesType:erpSaleType(row),customerCode:row.customerCode,customerName:row.customer,item:row.item,quantity:row.quantity,amount:row.amount,paymentTerms:row.paymentTerms||null,transactionDate:row.reportDate||reportDate})),
    cashMovements:(analysis.cashMovements||analysis.collections||[]).map((row,index)=>({sourceRowNo:row.row||index+1,treasuryCode:row.treasuryCode,treasuryName:row.treasuryName,debit:row.debit??row.amount??0,credit:row.credit??0,accountName:row.accountName??row.customer,accountType:row.accountType||null,accountCode:row.accountCode??row.customerCode,description:row.description||null,movementType:row.movementType??row.type??null,voucherNo:row.voucherNo??row.receipt??null,movementDate:row.movementDate||row.reportDate||reportDate,paymentMethod:row.paymentMethod||null,isCustomerCollection:Boolean(row.isCustomerCollection??row.customerCode)})),
    treasuries:(analysis.treasuries||[]).map(row=>({treasuryCode:row.treasuryCode,treasuryName:row.treasuryName,opening:row.opening,closing:row.closing})),
    inventory,
    summary:{...analysis.summary,totalSales:analysis.summary?.salesTotal||0,parserVersion:'daily-report-v3-aggregate-safe'}
  };
}

const saleCoreKey=row=>[
  clean(row?.invoiceNo??row?.invoice_no??row?.invoice,120),
  clean(row?.customerCode??row?.customer_code,120),
  erpSaleType({salesType:row?.salesType??row?.sales_type,kind:row?.kind,item:row?.item??row?.item_name}),
  norm(row?.item??row?.item_name)
].join('|');

export function historicalSalesCompatibility(existingSales=[],incomingSales=[]){
  const existingKeys=[...new Set((existingSales||[]).map(saleCoreKey).filter(key=>!key.startsWith('|||')))];
  const incomingKeys=new Set((incomingSales||[]).map(saleCoreKey).filter(key=>!key.startsWith('|||'))),missing=existingKeys.filter(key=>!incomingKeys.has(key));
  return{compatible:existingKeys.length>0&&missing.length===0&&incomingKeys.size>=existingKeys.length,existingCount:existingKeys.length,incomingCount:incomingKeys.size,missing};
}

export function postingDateForTransaction(transactionDate){
  const value=dateCandidate(transactionDate);
  return value&&value>=LEGACY_BASELINE_START&&value<=LEGACY_BASELINE_END?LEGACY_BASELINE_END:value;
}

function summarize(group){
  const sales=group.sales||[],cash=group.cashMovements||[],collections=cash.filter(row=>row.isCustomerCollection),block=sales.filter(row=>erpSaleType(row)==='block'),concrete=sales.filter(row=>erpSaleType(row)==='concrete');
  return{invoiceCount:sales.length,salesTotal:money(sales.reduce((sum,row)=>sum+Number(row.amount||0),0)),blockSales:money(block.reduce((sum,row)=>sum+Number(row.amount||0),0)),concreteSales:money(concrete.reduce((sum,row)=>sum+Number(row.amount||0),0)),blockQuantity:qty(block.reduce((sum,row)=>sum+Number(row.quantity||0),0)),concreteQuantity:qty(concrete.reduce((sum,row)=>sum+Number(row.quantity||0),0)),collectionCount:collections.length,collectionTotal:money(collections.reduce((sum,row)=>sum+Number(row.debit??row.amount??0),0)),cashMovementCount:cash.length,bankMovementCount:cash.filter(row=>row.isBank||row.paymentMethod==='bank').length,treasuryCount:(group.treasuries||[]).length,finishedGoodsCount:(group.finishedGoods||[]).length,rawMaterialsCount:(group.rawMaterials||[]).length};
}

export function splitAggregatedAnalysis(analysis={}){
  const explicit=[...new Set((analysis.reportDates||[]).filter(value=>/^\d{4}-\d{2}-\d{2}$/.test(value)))].sort(),latest=explicit.at(-1)||'',groups=new Map(),undated=[];
  const get=date=>{const target=postingDateForTransaction(date);if(!target)return null;if(!groups.has(target))groups.set(target,{sales:[],cashMovements:[],collections:[],treasuries:[],finishedGoods:[],rawMaterials:[],reportDates:[target],sourceDates:new Set()});const group=groups.get(target);group.sourceDates.add(date);return group;};
  for(const row of analysis.sales||[]){const actual=dateCandidate(row.reportDate);if(!actual){undated.push({type:'sale',row:row.row||null});continue;}get(actual)?.sales.push({...row,reportDate:actual});}
  for(const row of analysis.cashMovements||analysis.collections||[]){const actual=dateCandidate(row.movementDate||row.reportDate);if(!actual){undated.push({type:'cash',row:row.row||null});continue;}get(actual)?.cashMovements.push({...row,reportDate:actual,movementDate:actual});}
  if(latest){const group=get(latest);for(const row of analysis.treasuries||[])group.treasuries.push({...row,reportDate:dateCandidate(row.reportDate)||latest});for(const row of analysis.finishedGoods||[])group.finishedGoods.push({...row,reportDate:dateCandidate(row.reportDate)||latest});for(const row of analysis.rawMaterials||[])group.rawMaterials.push({...row,reportDate:dateCandidate(row.reportDate)||latest});}
  for(const [target,group] of groups){group.collections=group.cashMovements.filter(row=>row.isCustomerCollection);group.sales=group.sales.map((row,index)=>({...row,row:index+1}));group.cashMovements=group.cashMovements.map((row,index)=>({...row,row:index+1}));group.finishedGoods=group.finishedGoods.map((row,index)=>({...row,row:index+1}));group.rawMaterials=group.rawMaterials.map((row,index)=>({...row,row:index+1}));group.sourceDates=[...group.sourceDates].sort();group.summary=summarize(group);group.contentText=analysis.contentText||'';group.rowCount=group.sales.length+group.cashMovements.length+group.finishedGoods.length+group.rawMaterials.length;group.reportDates=[target];}
  return{groups:[...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([reportDate,group])=>({reportDate,analysis:group})),undated,sourceDates:explicit,baseline:{start:LEGACY_BASELINE_START,end:LEGACY_BASELINE_END}};
}
