import crypto from 'node:crypto';
import * as XLSX from 'xlsx';
import { config } from '../_lib/config.js';
import { classifyFile, sha256 } from '../_lib/domain.js';
import { errorResponse, json, method } from '../_lib/http.js';
import { parseDailyWorkbook } from '../_lib/daily-summary-parser.js';
import { commitDailyReportFromTelegram } from '../_lib/routes/daily-report.js';
import { insert, patch, rpc, select, uploadObject } from '../_lib/supabase.js';
import { erpSaleType, prepareErpSuccessDelivery, sendErpDuplicateNotice, sendErpFailureNotice, sendErpSuccessDelivery } from '../_lib/erp-telegram-delivery.js';

const SYNC_TOKEN_SHA256='b4ba6180ffc5d0ce658168f76b3362b69b7e930b998e8304fa6afe68da8289a0';
const DAILY_TYPES=new Set(['daily_movement','block_daily_movement','concrete_daily_movement']);
const LEGACY_BASELINE_START='2026-07-19';
const LEGACY_BASELINE_END='2026-07-23';
const clean=(value,max=1000)=>String(value??'').trim().slice(0,max);
const westernDigits=value=>String(value??'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
const money=value=>Math.round((Number(value||0)+Number.EPSILON)*100)/100;
const qty=value=>Math.round((Number(value||0)+Number.EPSILON)*1000)/1000;
const norm=value=>clean(value,1000).toLowerCase().replace(/[أإآٱ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ً-ْـ]/g,'').replace(/\s+/g,' ');
const stableHash=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const safeFile=value=>{
  let name=clean(value,240).replace(/[^\x00-\x7F]/g,'_').replace(/[^A-Za-z0-9._-]/g,'_').replace(/_+/g,'_').replace(/^_+|_+$/g,'');
  if(!name||name.startsWith('.'))name='daily-report.xlsx';
  return name.slice(0,140);
};
const equal=(a,b)=>{const aa=Buffer.from(String(a||'')),bb=Buffer.from(String(b||''));return aa.length===bb.length&&aa.length>0&&crypto.timingSafeEqual(aa,bb);};

function requireSyncToken(req){
  const supplied=clean(req.headers?.['x-erp-sync-token'],300);
  const digest=crypto.createHash('sha256').update(supplied).digest('hex');
  if(!equal(digest,SYNC_TOKEN_SHA256))throw Object.assign(new Error('اعتماد جهاز مزامنة ERP غير صحيح'),{status:401,code:'ERP_SYNC_AUTH_REQUIRED'});
}

async function rawBody(req,limit){
  if(Buffer.isBuffer(req.body))return req.body;
  if(req.body instanceof Uint8Array)return Buffer.from(req.body);
  if(typeof req.body==='string')return Buffer.from(req.body,'binary');
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>limit)throw Object.assign(new Error('حجم ملف التقرير يتجاوز الحد المسموح'),{status:413,code:'ERP_SYNC_FILE_TOO_LARGE'});chunks.push(chunk);}
  return Buffer.concat(chunks);
}

function decodedFilename(req){
  const encoded=clean(req.headers?.['x-erp-filename-b64'],1000);
  if(encoded){try{const value=Buffer.from(encoded,'base64').toString('utf8');if(value)return clean(value,240);}catch{}}
  return clean(req.headers?.['x-erp-filename'],240)||'daily-report.xlsx';
}

function isoDate(year,month,day){
  const y=Number(year),m=Number(month),d=Number(day),value=`${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  if(y<2000||y>2100||m<1||m>12||d<1||d>31||Number.isNaN(new Date(`${value}T12:00:00Z`).getTime()))return'';
  return value;
}

function dateCandidate(value,allowSerial=false){
  if(value instanceof Date&&!Number.isNaN(value.getTime()))return`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
  const text=westernDigits(value).trim();
  const serial=Number(text);
  if(allowSerial&&Number.isFinite(serial)&&serial>=30000&&serial<=80000){const parsed=new Date(Date.UTC(1899,11,30)+Math.round(serial)*86400000);if(!Number.isNaN(parsed.getTime()))return parsed.toISOString().slice(0,10);}
  let match=text.match(/(20\d{2})[.\/_-](\d{1,2})[.\/_-](\d{1,2})/);if(match)return isoDate(match[1],match[2],match[3]);
  match=text.match(/(\d{1,2})[.\/_-](\d{1,2})[.\/_-](20\d{2})/);if(match)return isoDate(match[3],match[2],match[1]);
  return'';
}

function dateFromWorkbook(workbook){
  for(const sheetName of workbook.SheetNames||[]){
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
  const explicit=dateCandidate(req.headers?.['x-erp-report-date']);if(explicit)return explicit;
  const fromWorkbook=dateFromWorkbook(workbook);if(fromWorkbook)return fromWorkbook;
  const parsedDates=[...new Set(analysis?.reportDates||[])].filter(value=>/^\d{4}-\d{2}-\d{2}$/.test(value)).sort();if(parsedDates.length)return parsedDates.at(-1);
  const fromName=dateCandidate(name);if(fromName)return fromName;
  const modified=dateCandidate(req.headers?.['x-erp-file-date']);if(modified)return modified;
  throw Object.assign(new Error('تعذر تحديد تاريخ التقرير. ضع التاريخ داخل اسم الملف أو في خانة تاريخ التقرير داخل Excel.'),{status:422,code:'ERP_REPORT_DATE_REQUIRED'});
}

export function dailyParserEvidence(analysis={}){
  const counts={sales:Number(analysis?.sales?.length||0),collections:Number(analysis?.collections?.length||0),cashMovements:Number(analysis?.cashMovements?.length||0),treasuries:Number(analysis?.treasuries?.length||0),finishedGoods:Number(analysis?.finishedGoods?.length||0),rawMaterials:Number(analysis?.rawMaterials?.length||0)};
  return{recognized:Object.values(counts).some(value=>value>0),counts};
}

function resolveDailyReportType(req,workbook,name,analysis){
  const classified=classifyFile(name,'finance',workbook.SheetNames,analysis.contentText),requested=clean(req.headers?.['x-erp-report-type'],40),evidence=dailyParserEvidence(analysis);
  if(DAILY_TYPES.has(classified))return{reportType:classified,classified,requested,evidence};
  if(evidence.recognized)return{reportType:DAILY_TYPES.has(requested)?requested:'daily_movement',classified,requested,evidence};
  const sheets=(workbook.SheetNames||[]).join('، ')||'لا توجد أوراق',counts=evidence.counts;
  throw Object.assign(new Error(`الملف لا يطابق تنسيق التقرير اليومي المعتمد في مصنع بن حامد. نتيجة القارئ: مبيعات ${counts.sales}، تحصيلات ${counts.collections}، حركات مالية ${counts.cashMovements}، منتجات تامة ${counts.finishedGoods}، خامات ${counts.rawMaterials}. الأوراق: ${sheets}`),{status:422,code:'ERP_SYNC_NOT_DAILY_REPORT'});
}

export function payloadFromAnalysis(analysis,reportDate){
  const inventory=[
    ...(analysis.finishedGoods||[]).map((row,index)=>({sourceRowNo:row.row||index+1,inventoryType:'finished_goods',itemCode:row.itemCode,itemName:row.itemName,unit:row.unit,opening:row.opening,received:row.received,issued:row.issued,closing:row.closing})),
    ...(analysis.rawMaterials||[]).map((row,index)=>({sourceRowNo:row.row||index+1,inventoryType:'raw_material',itemCode:row.itemCode,itemName:row.itemName,unit:row.unit,opening:row.opening,received:row.received,issued:row.issued,closing:row.closing}))
  ];
  return{
    sales:(analysis.sales||[]).map((row,index)=>({sourceRowNo:row.row||index+1,invoiceNo:row.invoice,salesType:erpSaleType(row),customerCode:row.customerCode,customerName:row.customer,item:row.item,quantity:row.quantity,amount:row.amount,paymentTerms:row.paymentTerms||null})),
    cashMovements:(analysis.cashMovements||analysis.collections||[]).map((row,index)=>({sourceRowNo:row.row||index+1,treasuryCode:row.treasuryCode,treasuryName:row.treasuryName,debit:row.debit??row.amount??0,credit:row.credit??0,accountName:row.accountName??row.customer,accountType:row.accountType||null,accountCode:row.accountCode??row.customerCode,description:row.description||null,movementType:row.movementType??row.type??null,voucherNo:row.voucherNo??row.receipt??null,movementDate:row.movementDate||row.reportDate||reportDate,paymentMethod:row.paymentMethod||null,isCustomerCollection:Boolean(row.isCustomerCollection??row.customerCode)})),
    treasuries:(analysis.treasuries||[]).map(row=>({treasuryCode:row.treasuryCode,treasuryName:row.treasuryName,opening:row.opening,closing:row.closing})),inventory,summary:{...analysis.summary,totalSales:analysis.summary?.salesTotal||0,parserVersion:'daily-report-v3-aggregate-safe'}
  };
}

const saleCoreKey=row=>[clean(row?.invoiceNo??row?.invoice_no??row?.invoice,120),clean(row?.customerCode??row?.customer_code,120),erpSaleType({salesType:row?.salesType??row?.sales_type,kind:row?.kind,item:row?.item??row?.item_name})].join('|');
const cashCoreKey=row=>{
  const treasury=clean(row?.treasuryCode??row?.treasury_code,40),account=clean(row?.accountCode??row?.account_code,120),voucher=clean(row?.voucherNo??row?.voucher_no??row?.receipt,120),type=norm(row?.movementType??row?.movement_type??row?.type);
  if(voucher)return['voucher',treasury,account,voucher].join('|');
  return['fallback',treasury,account,type,norm(row?.description??row?.notes),money(row?.debit??row?.amount),money(row?.credit)].join('|');
};
const saleValuesEqual=(a,b)=>qty(a?.quantity)===qty(b?.quantity)&&money(a?.amount)===money(b?.amount);
const cashValuesEqual=(a,b)=>money(a?.debit??a?.amount)===money(b?.debit??b?.amount)&&money(a?.credit)===money(b?.credit);

export function historicalSalesCompatibility(existingSales=[],incomingSales=[]){
  const existingKeys=[...new Set((existingSales||[]).map(saleCoreKey).filter(key=>!key.startsWith('||')))];
  const incomingKeys=new Set((incomingSales||[]).map(saleCoreKey).filter(key=>!key.startsWith('||'))),missing=existingKeys.filter(key=>!incomingKeys.has(key));
  return{compatible:existingKeys.length>0&&missing.length===0&&incomingKeys.size>=existingKeys.length,existingCount:existingKeys.length,incomingCount:incomingKeys.size,missing};
}

export function postingDateForTransaction(transactionDate){
  const value=dateCandidate(transactionDate);
  return value&&value>=LEGACY_BASELINE_START&&value<=LEGACY_BASELINE_END?LEGACY_BASELINE_END:value;
}

function summarizeAnalysis(group){
  const sales=group.sales||[],cash=group.cashMovements||[],collections=cash.filter(row=>row.isCustomerCollection),block=sales.filter(row=>erpSaleType(row)==='block'),concrete=sales.filter(row=>erpSaleType(row)==='concrete');
  return{invoiceCount:sales.length,salesTotal:money(sales.reduce((sum,row)=>sum+Number(row.amount||0),0)),blockSales:money(block.reduce((sum,row)=>sum+Number(row.amount||0),0)),concreteSales:money(concrete.reduce((sum,row)=>sum+Number(row.amount||0),0)),blockQuantity:qty(block.reduce((sum,row)=>sum+Number(row.quantity||0),0)),concreteQuantity:qty(concrete.reduce((sum,row)=>sum+Number(row.quantity||0),0)),collectionCount:collections.length,collectionTotal:money(collections.reduce((sum,row)=>sum+Number(row.debit??row.amount??0),0)),cashMovementCount:cash.length,bankMovementCount:cash.filter(row=>row.isBank||String(row.paymentMethod||'').toLowerCase()==='bank').length,treasuryCount:(group.treasuries||[]).length,finishedGoodsCount:(group.finishedGoods||[]).length,rawMaterialsCount:(group.rawMaterials||[]).length};
}

export function splitAggregatedAnalysis(analysis={}){
  const explicit=[...new Set((analysis.reportDates||[]).filter(value=>/^\d{4}-\d{2}-\d{2}$/.test(value)))].sort(),latest=explicit.at(-1)||'';
  const groups=new Map(),undated=[];
  const get=date=>{const target=postingDateForTransaction(date);if(!target)return null;if(!groups.has(target))groups.set(target,{sales:[],cashMovements:[],collections:[],treasuries:[],finishedGoods:[],rawMaterials:[],reportDates:[target],sourceDates:new Set()});const group=groups.get(target);group.sourceDates.add(date);return group;};
  for(const row of analysis.sales||[]){const actual=dateCandidate(row.reportDate);if(!actual){undated.push({type:'sale',row:row.row||null});continue;}get(actual)?.sales.push({...row,reportDate:actual});}
  for(const row of analysis.cashMovements||analysis.collections||[]){const actual=dateCandidate(row.movementDate||row.reportDate);if(!actual){undated.push({type:'cash',row:row.row||null});continue;}get(actual)?.cashMovements.push({...row,reportDate:actual,movementDate:actual});}
  const snapshotDate=latest?postingDateForTransaction(latest):'';
  if(snapshotDate){const group=get(latest);for(const row of analysis.treasuries||[])group.treasuries.push({...row,reportDate:dateCandidate(row.reportDate)||latest});for(const row of analysis.finishedGoods||[])group.finishedGoods.push({...row,reportDate:dateCandidate(row.reportDate)||latest});for(const row of analysis.rawMaterials||[])group.rawMaterials.push({...row,reportDate:dateCandidate(row.reportDate)||latest});}
  for(const [target,group] of groups){group.collections=group.cashMovements.filter(row=>row.isCustomerCollection);group.sales=group.sales.map((row,index)=>({...row,row:index+1}));group.cashMovements=group.cashMovements.map((row,index)=>({...row,row:index+1}));group.finishedGoods=group.finishedGoods.map((row,index)=>({...row,row:index+1}));group.rawMaterials=group.rawMaterials.map((row,index)=>({...row,row:index+1}));group.sourceDates=[...group.sourceDates].sort();group.summary=summarizeAnalysis(group);group.contentText=analysis.contentText||'';group.rowCount=group.sales.length+group.cashMovements.length+group.finishedGoods.length+group.rawMaterials.length;group.reportDates=[target];}
  return{groups:[...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([reportDate,group])=>({reportDate,analysis:group})),undated,sourceDates:explicit,baseline:{start:LEGACY_BASELINE_START,end:LEGACY_BASELINE_END}};
}

function indexBy(rows,keyFn){const map=new Map();for(const row of rows||[]){const key=keyFn(row);if(!map.has(key))map.set(key,[]);map.get(key).push(row);}return map;}

export function buildReconciliationPlan(existingSales=[],existingCash=[],incomingAnalysis={},targetBatchId=''){
  const salesIndex=indexBy(existingSales,saleCoreKey),cashIndex=indexBy(existingCash,cashCoreKey),missingSales=[],missingCash=[],matchedSales=[],matchedCash=[],cashDateCorrections=[],conflicts=[];
  for(const row of incomingAnalysis.sales||[]){const key=saleCoreKey(row),candidates=salesIndex.get(key)||[],exact=candidates.filter(candidate=>saleValuesEqual(candidate,row));if(exact.length){matchedSales.push({incoming:row,existing:exact[0]});continue;}if(candidates.length){conflicts.push({type:'sale',key,invoice:row.invoice,reason:'نفس رقم الفاتورة والعميل موجود بمبلغ أو كمية مختلفة'});continue;}missingSales.push(row);}
  for(const row of incomingAnalysis.cashMovements||[]){const key=cashCoreKey(row),candidates=cashIndex.get(key)||[],exact=candidates.filter(candidate=>cashValuesEqual(candidate,row));if(exact.length){const preferred=exact.find(candidate=>!targetBatchId||candidate.batch_id===targetBatchId)||exact[0];matchedCash.push({incoming:row,existing:preferred});const actual=dateCandidate(row.movementDate||row.reportDate),stored=dateCandidate(preferred.movement_date_text);if(actual&&actual!==stored)cashDateCorrections.push({existing:preferred,actualDate:actual});continue;}if(candidates.length){conflicts.push({type:'cash',key,voucher:row.voucherNo||row.receipt||'',reason:'نفس رقم الحركة والحساب موجود بقيمة مختلفة'});continue;}missingCash.push(row);}
  return{missingSales,missingCash,matchedSales,matchedCash,cashDateCorrections,conflicts};
}

async function postedBatch(reportDate){return(await select('daily_report_batches',`report_date=eq.${reportDate}&status=eq.approved&select=id,report_date,file_hash,status,original_name,summary&limit=1`))?.[0]||null;}
async function rowsForBatch(batchId){
  if(!batchId)return{sales:[],cash:[],inventory:[]};
  const [sales,cash,inventory]=await Promise.all([
    select('daily_report_sales_lines',`batch_id=eq.${encodeURIComponent(batchId)}&select=id,batch_id,source_row_no,invoice_no,sales_type,customer_code,item_name,quantity,amount,line_identity&limit=10000`).catch(()=>[]),
    select('daily_report_cash_movements',`batch_id=eq.${encodeURIComponent(batchId)}&select=id,batch_id,source_row_no,treasury_code,treasury_name,debit,credit,account_name,account_type,account_code,description,movement_type,voucher_no,movement_date_text,payment_method,is_customer_collection,line_identity&limit=10000`).catch(()=>[]),
    select('daily_report_inventory_snapshots',`batch_id=eq.${encodeURIComponent(batchId)}&select=id,batch_id,source_row_no,inventory_type,item_code,item_name&limit=20000`).catch(()=>[])
  ]);
  return{sales:sales||[],cash:cash||[],inventory:inventory||[]};
}

function remapDeltaRows(plan,existingRows,analysis){
  let saleNo=Math.max(0,...existingRows.sales.map(row=>Number(row.source_row_no||0))),cashNo=Math.max(0,...existingRows.cash.map(row=>Number(row.source_row_no||0))),inventoryNo=Math.max(0,...existingRows.inventory.map(row=>Number(row.source_row_no||0)));
  const inventoryIndex=new Map(existingRows.inventory.map(row=>[[row.inventory_type,row.item_code].join('|'),row.source_row_no]));
  const remapInventory=(rows,type)=>(rows||[]).map(row=>({...row,row:Number(inventoryIndex.get([type,row.itemCode].join('|'))||(++inventoryNo))}));
  return{...analysis,sales:plan.missingSales.map(row=>({...row,row:++saleNo})),cashMovements:plan.missingCash.map(row=>({...row,row:++cashNo})),collections:plan.missingCash.filter(row=>row.isCustomerCollection).map(row=>({...row})),finishedGoods:remapInventory(analysis.finishedGoods,'finished_goods'),rawMaterials:remapInventory(analysis.rawMaterials,'raw_material'),summary:analysis.summary};
}

async function applyCashDateCorrections(corrections,batch){
  let corrected=0;const affectedCustomers=new Set();
  for(const item of corrections){
    await patch('daily_report_cash_movements',`id=eq.${encodeURIComponent(item.existing.id)}`,{movement_date_text:item.actualDate});
    const rowNo=String(item.existing.source_row_no||0).padStart(4,'0'),stamp=`${item.actualDate}T12:00:00+03:00`,prefix=`DR-${String(batch.report_date).replaceAll('-','')}`;
    await patch('finance_events',`reference_no=eq.${encodeURIComponent(`${prefix}-F-${rowNo}`)}`,{occurred_at:stamp}).catch(()=>{});
    if(item.existing.is_customer_collection){await patch('collection_events',`reference_no=eq.${encodeURIComponent(`${prefix}-C-${rowNo}`)}`,{occurred_at:stamp}).catch(()=>{});if(item.existing.account_code)affectedCustomers.add(item.existing.account_code);}
    corrected++;
  }
  for(const customerCode of affectedCustomers)await rpc('rebuild_customer_fifo',{p_customer_external_id:customerCode,p_actor:'erp-folder-sync-v3-aggregate',p_reason:'تصحيح تاريخ حركة من ملف ERP مجمع مع منع التكرار'});
  return corrected;
}

async function upgradePostedImport(existing,analysis,reportDate,trustedHash,sourceHash=trustedHash){
  const payload=payloadFromAnalysis(analysis,reportDate);
  try{
    const upgradedRaw=await rpc('upgrade_daily_report_details',{p_report_date:reportDate,p_file_hash:trustedHash,p_payload:payload,p_actor:'erp-folder-sync-v3-aggregate'}),upgraded=Array.isArray(upgradedRaw)?upgradedRaw[0]:upgradedRaw;
    const summary={sheetNames:[],daily:analysis.summary,source:{kind:'erp-folder',parserVersion:'daily-report-v3-aggregate-safe',sourceFileHash:sourceHash,matchedFileHash:trustedHash,upgradedAt:new Date().toISOString()}};
    await patch('imports',`id=eq.${encodeURIComponent(existing.id)}`,{status:'posted',posted_batch_id:upgraded?.batchId||null,summary,error_count:0,warning_count:0,last_error_code:null,last_error_message:null}).catch(()=>{});
    return{...upgraded,sourceFileHash:sourceHash,matchedFileHash:trustedHash};
  }catch(error){const text=[error?.message,error?.data?.message,error?.data?.code,error?.code].filter(Boolean).join(' ');if(/upgrade_daily_report_details|PGRST202|42883/i.test(text))return{available:false,reason:'MIGRATION_029_REQUIRED'};throw error;}
}

async function deliverUpgradeTelegram({analysis,originalName,reportDate,upgrade,shouldSendReports}){
  if(!shouldSendReports)return{disabled:true};
  if(!upgrade?.upgraded)return sendErpDuplicateNotice({reportDate,sourceFile:originalName,upgrade});
  const prepared=await prepareErpSuccessDelivery({analysis,sourceFile:originalName,reportDate}).catch(error=>({recipients:[],collections:[],reports:[],errors:[String(error?.message||error)]}));
  return sendErpSuccessDelivery({analysis,sourceFile:originalName,reportDate,posting:{...upgrade,batchId:upgrade.batchId,duplicate:false,upgraded:true},prepared});
}

async function ensureImport({fileHash,storagePath,originalName,reportType,summary,rowCount}){
  let imp=(await select('imports',`file_hash=eq.${fileHash}&select=id,status,original_name,report_type,file_path,file_hash,summary&limit=1`))?.[0]||null;
  if(!imp){const rows=await insert('imports',[{source:'erp-folder',department:'finance',report_type:reportType,status:'ready',original_name:originalName,mime_type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',file_path:storagePath,file_hash:fileHash,row_count:rowCount,error_count:0,warning_count:0,summary,last_error_code:null,last_error_message:null}]);imp=rows?.[0];}
  else if(!imp.file_path){const rows=await patch('imports',`id=eq.${encodeURIComponent(imp.id)}`,{file_path:storagePath,report_type:reportType,summary,last_error_code:null,last_error_message:null});imp=rows?.[0]||{...imp,file_path:storagePath,report_type:reportType,summary};}
  if(!imp?.id)throw Object.assign(new Error('تعذر تسجيل ملف ERP في مركز الوارد'),{status:502,code:'ERP_SYNC_IMPORT_REGISTER_FAILED'});
  return imp;
}

async function processAggregate({buffer,originalName,sourceHash,workbook,analysis,classification,reportType}){
  const split=splitAggregatedAnalysis(analysis);
  if(split.sourceDates.length<2)return null;
  if(split.undated.length)throw Object.assign(new Error(`الملف المجمع يحتوي ${split.undated.length} حركة مبيعات أو خزينة بلا تاريخ داخل السطر. لم يُرحّل شيء.`),{status:422,code:'ERP_AGGREGATE_UNDATED_TRANSACTIONS',details:split.undated.slice(0,50)});
  const plans=[];
  for(const group of split.groups){const batch=await postedBatch(group.reportDate),existingRows=await rowsForBatch(batch?.id),plan=buildReconciliationPlan(existingRows.sales,existingRows.cash,group.analysis,batch?.id||'');plans.push({...group,batch,existingRows,plan});}
  const conflicts=plans.flatMap(item=>item.plan.conflicts.map(conflict=>({reportDate:item.reportDate,...conflict})));
  if(conflicts.length)throw Object.assign(new Error(`توقف الملف المجمع بسبب ${conflicts.length} تعارضًا في رقم فاتورة أو حركة. لم يُرحّل شيء.`),{status:409,code:'ERP_AGGREGATE_TRANSACTION_CONFLICT',details:conflicts.slice(0,100)});
  const storagePath=`erp-folder/ranges/${split.sourceDates[0]}_${split.sourceDates.at(-1)}/${sourceHash.slice(0,16)}-${safeFile(originalName)}`;
  await uploadObject(storagePath,buffer,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const results=[];
  for(const item of plans){
    const dayHash=stableHash(`${sourceHash}|${item.reportDate}`),dayName=`${originalName} [${item.reportDate}]`,summary={sheetNames:workbook.SheetNames,daily:item.analysis.summary,source:{kind:'erp-folder-aggregate',receivedAt:new Date().toISOString(),classification,sourceFileHash:sourceHash,sourceDates:item.analysis.sourceDates,baselineMapped:item.reportDate===LEGACY_BASELINE_END}};
    const imp=await ensureImport({fileHash:dayHash,storagePath,originalName:dayName,reportType,summary,rowCount:item.analysis.rowCount});
    if(item.batch){
      const delta=remapDeltaRows(item.plan,item.existingRows,item.analysis),hasDelta=delta.sales.length||delta.cashMovements.length||delta.treasuries.length||delta.finishedGoods.length||delta.rawMaterials.length;
      let upgrade={upgraded:false,batchId:item.batch.id,salesAdded:0,cashMovementsAdded:0,treasuriesAdded:0,inventoryAdded:0};
      if(hasDelta)upgrade=await upgradePostedImport(imp,delta,item.reportDate,item.batch.file_hash,sourceHash);
      const datesCorrected=await applyCashDateCorrections(item.plan.cashDateCorrections,item.batch);
      await patch('imports',`id=eq.${encodeURIComponent(imp.id)}`,{status:'posted',posted_batch_id:item.batch.id,summary:{...summary,reconciliation:{matchedSales:item.plan.matchedSales.length,matchedCash:item.plan.matchedCash.length,datesCorrected,missingSales:item.plan.missingSales.length,missingCash:item.plan.missingCash.length}},last_error_code:null,last_error_message:null}).catch(()=>{});
      results.push({reportDate:item.reportDate,status:'updated',batchId:item.batch.id,matchedSales:item.plan.matchedSales.length,matchedCash:item.plan.matchedCash.length,datesCorrected,addedSales:item.plan.missingSales.length,addedCash:item.plan.missingCash.length,upgrade});
      continue;
    }
    const posting=await commitDailyReportFromTelegram({reportDate:item.reportDate,originalName:dayName,fileHash:dayHash,contentHash:dayHash,idempotencyKey:`erp-folder-aggregate:${item.reportDate}:${dayHash}`,importId:imp.id,payload:payloadFromAnalysis(item.analysis,item.reportDate)},'erp-folder-sync-aggregate');
    if(!posting?.ok)throw Object.assign(new Error(clean(posting?.reason,500)||`فشل ترحيل يوم ${item.reportDate}`),{status:422,code:'ERP_AGGREGATE_DAY_FAILED',details:{reportDate:item.reportDate,posting}});
    results.push({reportDate:item.reportDate,status:posting.duplicate?'duplicate':'posted',batchId:posting.postedBatchId||posting.existingImportId||null,matchedSales:0,matchedCash:0,datesCorrected:0,addedSales:item.analysis.sales.length,addedCash:item.analysis.cashMovements.length});
  }
  return{ok:true,aggregate:true,duplicate:false,upgraded:true,reportDate:split.sourceDates.at(-1),fileHash:sourceHash,storagePath,baseline:split.baseline,sourceDates:split.sourceDates,days:results,totals:results.reduce((out,row)=>{out.matched+=row.matchedSales+row.matchedCash;out.added+=row.addedSales+row.addedCash;out.datesCorrected+=row.datesCorrected;return out;},{matched:0,added:0,datesCorrected:0})};
}

export default async function handler(req,res){
  if(!method(req,res,['POST']))return;
  try{
    requireSyncToken(req);
    const buffer=await rawBody(req,config.maxImportFileBytes);
    if(!buffer.length)throw Object.assign(new Error('ملف التقرير غير موجود في الطلب'),{status:400,code:'ERP_SYNC_FILE_REQUIRED'});
    if(buffer.length>config.maxImportFileBytes)throw Object.assign(new Error('حجم ملف التقرير يتجاوز الحد المسموح'),{status:413,code:'ERP_SYNC_FILE_TOO_LARGE'});
    if(buffer[0]!==0x50||buffer[1]!==0x4b)throw Object.assign(new Error('الملف ليس XLSX صالحًا'),{status:415,code:'ERP_SYNC_XLSX_REQUIRED'});

    const originalName=decodedFilename(req),hash=sha256(buffer),workbook=XLSX.read(buffer,{type:'buffer',cellDates:true}),analysis=parseDailyWorkbook(workbook,XLSX),classification=resolveDailyReportType(req,workbook,originalName,analysis),reportType=classification.reportType;
    const aggregate=await processAggregate({buffer,originalName,sourceHash:hash,workbook,analysis,classification,reportType});
    if(aggregate)return json(res,200,aggregate);

    const reportDate=resolveReportDate(req,workbook,originalName,analysis),existing=(await select('imports',`file_hash=eq.${hash}&select=id,status,original_name,report_type,file_path,file_hash,summary&limit=1`))?.[0]||null,shouldSendReports=String(req.headers?.['x-erp-send-reports']??'1')!=='0';
    if(existing&&['posted','approved'].includes(existing.status)){
      const batch=await postedBatch(reportDate),rows=await rowsForBatch(batch?.id),plan=buildReconciliationPlan(rows.sales,rows.cash,analysis,batch?.id||'');
      if(plan.conflicts.length)throw Object.assign(new Error('يوجد تعارض في رقم فاتورة أو حركة داخل التقرير المعاد رفعه.'),{status:409,code:'ERP_TRANSACTION_CONFLICT',details:plan.conflicts});
      if(batch){const delta=remapDeltaRows(plan,rows,analysis),upgrade=await upgradePostedImport(existing,delta,reportDate,batch.file_hash,hash),datesCorrected=await applyCashDateCorrections(plan.cashDateCorrections,batch);const telegram=await deliverUpgradeTelegram({analysis,originalName,reportDate,upgrade,shouldSendReports}).catch(error=>({errors:[String(error?.message||error)]}));return json(res,200,{ok:true,duplicate:true,upgraded:Boolean(upgrade?.upgraded),upgrade,datesCorrected,reportDate,fileHash:hash,importId:existing.id,status:existing.status,summary:analysis.summary,telegram});}
    }

    const storagePath=existing?.file_path||`erp-folder/${reportDate}/${hash.slice(0,16)}-${safeFile(originalName)}`;
    if(!existing?.file_path)await uploadObject(storagePath,buffer,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const summary={sheetNames:workbook.SheetNames,daily:analysis.summary,source:{kind:'erp-folder',receivedAt:new Date().toISOString(),classification}},imp=await ensureImport({fileHash:hash,storagePath,originalName,reportType,summary,rowCount:analysis.rowCount});
    const batch=await postedBatch(reportDate);
    if(batch){const rows=await rowsForBatch(batch.id),plan=buildReconciliationPlan(rows.sales,rows.cash,analysis,batch.id);if(plan.conflicts.length){const reason='يوجد تقرير معتمد لنفس التاريخ، لكن نفس رقم الفاتورة أو الحركة يحمل قيمة مختلفة. أُوقف التحديث لمنع التكرار.';const telegram=await sendErpFailureNotice({reportDate,sourceFile:originalName,reason}).catch(error=>({errors:[String(error?.message||error)]}));return json(res,409,{ok:false,duplicate:false,code:'ERP_HISTORICAL_REPORT_MISMATCH',reason,reportDate,fileHash:hash,importId:imp.id,storagePath,summary:analysis.summary,conflicts:plan.conflicts,telegram});}const delta=remapDeltaRows(plan,rows,analysis),upgrade=await upgradePostedImport(imp,delta,reportDate,batch.file_hash,hash),datesCorrected=await applyCashDateCorrections(plan.cashDateCorrections,batch),telegram=await deliverUpgradeTelegram({analysis,originalName,reportDate,upgrade,shouldSendReports}).catch(error=>({errors:[String(error?.message||error)]}));return json(res,200,{ok:true,duplicate:true,upgraded:Boolean(upgrade?.upgraded),upgrade,datesCorrected,reportDate,fileHash:hash,importId:imp.id,status:'posted',summary:analysis.summary,reconciliation:{matchedSales:plan.matchedSales.length,matchedCash:plan.matchedCash.length,addedSales:plan.missingSales.length,addedCash:plan.missingCash.length},telegram});}

    const preparedTelegram=shouldSendReports?await prepareErpSuccessDelivery({analysis,sourceFile:originalName,reportDate}).catch(error=>({recipients:[],collections:[],reports:[],errors:[String(error?.message||error)]})):null,posting=await commitDailyReportFromTelegram({reportDate,originalName,fileHash:hash,contentHash:hash,idempotencyKey:`erp-folder:${reportDate}:${hash}`,importId:imp.id,payload:payloadFromAnalysis(analysis,reportDate)},'erp-folder-sync');
    if(!posting?.ok){const errors=(posting?.errors||[]).slice(0,5),reason=errors.map((item,index)=>`${index+1}. ${clean(item?.message||item?.code,300)}`).join('\n')||clean(posting?.reason,500)||'فشل تحقق التقرير على الخادم.',telegram=await sendErpFailureNotice({reportDate,sourceFile:originalName,reason}).catch(error=>({errors:[String(error?.message||error)]}));return json(res,422,{ok:false,duplicate:false,reportDate,fileHash:hash,importId:imp.id,storagePath,summary:analysis.summary,posting,telegram});}
    let telegram;if(posting?.duplicate)telegram=await sendErpDuplicateNotice({reportDate,sourceFile:originalName}).catch(error=>({errors:[String(error?.message||error)]}));else if(shouldSendReports)telegram=await sendErpSuccessDelivery({analysis,sourceFile:originalName,reportDate,posting,prepared:preparedTelegram}).catch(error=>({errors:[String(error?.message||error)]}));else telegram={disabled:true};
    return json(res,200,{ok:Boolean(posting?.ok),duplicate:Boolean(posting?.duplicate),reportDate,fileHash:hash,importId:imp.id,storagePath,summary:analysis.summary,posting,telegram});
  }catch(error){errorResponse(res,error);}
}
