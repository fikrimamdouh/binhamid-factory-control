import crypto from 'node:crypto';
import * as XLSX from 'xlsx';
import { config } from './config.js';
import { classifyFile,sha256 } from './domain.js';
import { errorResponse,json,method } from './http.js';
import { parseDailyWorkbook } from './daily-summary-parser.js';
import { commitDailyReportFromTelegram } from './routes/daily-report.js';
import { insert,patch,rpc,select,uploadObject } from './supabase.js';
import {
  erpSaleType,
  prepareErpSuccessDelivery,
  sendErpDuplicateNotice,
  sendErpFailureNotice,
  sendErpSuccessDelivery
} from './erp-telegram-delivery.js';
import {
  dailyParserEvidence,
  payloadFromAnalysis,
  resolveReportDate,
  splitAggregatedAnalysis
} from './daily-report-v3.js';

const SYNC_TOKEN_SHA256='b4ba6180ffc5d0ce658168f76b3362b69b7e930b998e8304fa6afe68da8289a0';
const DAILY_TYPES=new Set(['daily_movement','block_daily_movement','concrete_daily_movement']);
const LEGACY_BASELINE_DATE='2026-07-23';
const clean=(value,max=1000)=>String(value??'').trim().slice(0,max);
const norm=value=>clean(value,1000).toLowerCase().replace(/[أإآٱ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ً-ْـ]/g,'').replace(/\s+/g,' ');
const money=value=>Math.round((Number(value||0)+Number.EPSILON)*100)/100;
const qty=value=>Math.round((Number(value||0)+Number.EPSILON)*1000)/1000;
const stableHash=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const one=value=>Array.isArray(value)?value[0]:value;
const safeFile=value=>{
  let name=clean(value,240)
    .replace(/[^\x00-\x7F]/g,'_')
    .replace(/[^A-Za-z0-9._-]/g,'_')
    .replace(/_+/g,'_')
    .replace(/^_+|_+$/g,'');
  if(!name||name.startsWith('.'))name='daily-report.xlsx';
  return name.slice(0,140);
};
const equal=(a,b)=>{
  const aa=Buffer.from(String(a||''));
  const bb=Buffer.from(String(b||''));
  return aa.length===bb.length&&aa.length>0&&crypto.timingSafeEqual(aa,bb);
};
const byId=rows=>{
  const map=new Map();
  for(const row of rows||[])if(row?.id)map.set(row.id,row);
  return [...map.values()];
};

function requireSyncToken(req){
  const supplied=clean(req.headers?.['x-erp-sync-token'],300);
  const digest=crypto.createHash('sha256').update(supplied).digest('hex');
  if(!equal(digest,SYNC_TOKEN_SHA256)){
    throw Object.assign(new Error('اعتماد جهاز مزامنة ERP غير صحيح'),{status:401,code:'ERP_SYNC_AUTH_REQUIRED'});
  }
}

async function rawBody(req,limit){
  if(Buffer.isBuffer(req.body))return req.body;
  if(req.body instanceof Uint8Array)return Buffer.from(req.body);
  if(typeof req.body==='string')return Buffer.from(req.body,'binary');
  const chunks=[];
  let size=0;
  for await(const chunk of req){
    size+=chunk.length;
    if(size>limit){
      throw Object.assign(new Error('حجم ملف التقرير يتجاوز الحد المسموح'),{status:413,code:'ERP_SYNC_FILE_TOO_LARGE'});
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function decodedFilename(req){
  const encoded=clean(req.headers?.['x-erp-filename-b64'],1000);
  if(encoded){
    try{
      const value=Buffer.from(encoded,'base64').toString('utf8');
      if(value)return clean(value,240);
    }catch{}
  }
  return clean(req.headers?.['x-erp-filename'],240)||'daily-report.xlsx';
}

function resolveDailyReportType(req,workbook,name,analysis){
  const classified=classifyFile(name,'finance',workbook.SheetNames,analysis.contentText);
  const requested=clean(req.headers?.['x-erp-report-type'],40);
  const evidence=dailyParserEvidence(analysis);
  if(DAILY_TYPES.has(classified))return{reportType:classified,classified,requested,evidence};
  if(evidence.recognized){
    return{reportType:DAILY_TYPES.has(requested)?requested:'daily_movement',classified,requested,evidence};
  }
  const sheets=(workbook.SheetNames||[]).join('، ')||'لا توجد أوراق';
  const counts=evidence.counts;
  throw Object.assign(
    new Error(`الملف لا يطابق تنسيق التقرير اليومي المعتمد في مصنع بن حامد. نتيجة القارئ: مبيعات ${counts.sales}، تحصيلات ${counts.collections}، حركات مالية ${counts.cashMovements}، منتجات تامة ${counts.finishedGoods}، خامات ${counts.rawMaterials}. الأوراق: ${sheets}`),
    {status:422,code:'ERP_SYNC_NOT_DAILY_REPORT'}
  );
}

const invoiceNo=row=>clean(row?.invoice??row?.invoiceNo??row?.invoice_no,120);
const customerCode=row=>clean(row?.customerCode??row?.customer_code??row?.accountCode??row?.account_code,120);
const movementDate=row=>clean(row?.movementDate??row?.movement_date_text??row?.reportDate,10);
const treasuryCode=row=>clean(row?.treasuryCode??row?.treasury_code,40);
const voucherNo=row=>clean(row?.voucherNo??row?.voucher_no??row?.receipt,120);
const isCollection=row=>Boolean(row?.isCustomerCollection??row?.is_customer_collection);
const amountToken=row=>`${money(row?.debit??row?.amount)}:${money(row?.credit)}`;
const invoiceLine=row=>[
  customerCode(row),
  erpSaleType({salesType:row?.salesType??row?.sales_type,kind:row?.kind,item:row?.item??row?.item_name}),
  norm(row?.item??row?.item_name),
  qty(row?.quantity),
  money(row?.amount)
].join('|');
const collectionKey=row=>['collection',movementDate(row),customerCode(row),amountToken(row)].join('|');
const legacyCollectionKey=row=>['collection',customerCode(row),amountToken(row)].join('|');
const otherCashKey=row=>[
  'cash',movementDate(row),treasuryCode(row),customerCode(row),voucherNo(row),
  norm(row?.movementType??row?.movement_type??row?.type),amountToken(row)
].join('|');
const legacyOtherCashKey=row=>[
  'cash',treasuryCode(row),customerCode(row),voucherNo(row),
  norm(row?.movementType??row?.movement_type??row?.type),amountToken(row)
].join('|');
const cashKey=(row,legacyBaseline=false)=>isCollection(row)
  ?(legacyBaseline?legacyCollectionKey(row):collectionKey(row))
  :(legacyBaseline?legacyOtherCashKey(row):otherCashKey(row));

function invoiceGroups(rows=[]){
  const groups=new Map();
  for(const row of rows){
    const number=invoiceNo(row);
    if(!number)continue;
    if(!groups.has(number))groups.set(number,[]);
    groups.get(number).push(row);
  }
  return groups;
}

function invoiceSnapshot(rows=[]){return rows.map(invoiceLine).sort();}
function sameInvoice(existing=[],incoming=[]){
  const left=invoiceSnapshot(existing);
  const right=invoiceSnapshot(incoming);
  return left.length===right.length&&left.every((value,index)=>value===right[index]);
}
function groupRowsByBatch(rows=[]){
  const groups=new Map();
  for(const row of rows){
    const key=clean(row?.batch_id,100)||'no-batch';
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(row);
  }
  return [...groups.values()];
}
function indexRows(rows,keyFn){
  const map=new Map();
  for(const row of rows||[]){
    const key=keyFn(row);
    if(!map.has(key))map.set(key,[]);
    map.get(key).push(row);
  }
  return map;
}

function duplicateCashConflicts(rows=[],legacyBaseline=false){
  const seen=new Map();
  const conflicts=[];
  for(const row of rows){
    const key=cashKey(row,legacyBaseline);
    if(!movementDate(row)&&!legacyBaseline){
      conflicts.push({type:'cash',key,reason:'حركة مالية بلا تاريخ'});
      continue;
    }
    if(isCollection(row)&&(!customerCode(row)||amountToken(row)==='0:0')){
      conflicts.push({type:'cash',key,reason:'سداد بلا رقم عميل أو مبلغ'});
      continue;
    }
    if(seen.has(key)){
      conflicts.push({type:'cash',key,voucher:voucherNo(row),reason:'السداد مكرر داخل الملف بنفس التاريخ ورقم العميل والمبلغ'});
    }else{
      seen.set(key,row);
    }
  }
  return conflicts;
}

function chooseCashCandidate(candidates,row){
  if(!candidates.length)return null;
  let exact=candidates;
  if(voucherNo(row)){
    const byVoucher=exact.filter(item=>voucherNo(item)===voucherNo(row));
    if(byVoucher.length)exact=byVoucher;
  }
  if(treasuryCode(row)){
    const byTreasury=exact.filter(item=>treasuryCode(item)===treasuryCode(row));
    if(byTreasury.length)exact=byTreasury;
  }
  return exact[0]||candidates[0];
}

export function buildSnapshotPlan(existingSales=[],existingCash=[],incoming={},options={}){
  const currentBatchId=clean(options.currentBatchId,100);
  const legacyBaseline=Boolean(options.legacyBaseline);
  const conflicts=[...duplicateCashConflicts(incoming.cashMovements||[],legacyBaseline)];
  const matchedSales=[];
  const matchedCash=[];
  const missingSales=[];
  const missingCash=[];
  const usedCash=new Set();

  const currentSales=currentBatchId?existingSales.filter(row=>row.batch_id===currentBatchId):[];
  const historicalSales=currentBatchId?existingSales.filter(row=>row.batch_id!==currentBatchId):existingSales;
  const currentInvoices=invoiceGroups(currentSales);
  const historicalInvoices=invoiceGroups(historicalSales);
  const incomingInvoices=invoiceGroups(incoming.sales||[]);

  for(const row of incoming.sales||[]){
    if(!invoiceNo(row))conflicts.push({type:'sale',reason:'فاتورة بلا رقم مرجعي'});
  }

  for(const [number,rows] of incomingInvoices){
    const current=currentInvoices.get(number)||[];
    if(current.length){
      if(sameInvoice(current,rows)){
        matchedSales.push({invoice:number,existing:current,incoming:rows,scope:'current'});
      }else{
        conflicts.push({type:'sale',invoice:number,reason:'رقم الفاتورة موجود في تقرير اليوم ببيانات مختلفة؛ الفاتورة المعتمدة لا تُعدّل'});
      }
      continue;
    }

    const historical=historicalInvoices.get(number)||[];
    if(!historical.length){
      missingSales.push(...rows);
      continue;
    }

    const exactGroup=groupRowsByBatch(historical).find(group=>sameInvoice(group,rows));
    if(exactGroup){
      matchedSales.push({invoice:number,existing:exactGroup,incoming:rows,scope:'historical'});
    }else{
      conflicts.push({type:'sale',invoice:number,reason:'رقم الفاتورة موجود في تقرير سابق ببيانات مختلفة؛ الفاتورة المعتمدة لا تُعدّل'});
    }
  }

  const currentCash=currentBatchId?existingCash.filter(row=>row.batch_id===currentBatchId):[];
  const historicalCash=currentBatchId?existingCash.filter(row=>row.batch_id!==currentBatchId):existingCash;
  const currentCashIndex=indexRows(currentCash,row=>cashKey(row,legacyBaseline));
  const historicalCashIndex=indexRows(historicalCash,row=>cashKey(row,legacyBaseline));

  for(const row of incoming.cashMovements||[]){
    const key=cashKey(row,legacyBaseline);
    const currentCandidates=(currentCashIndex.get(key)||[]).filter(item=>!usedCash.has(item.id));
    let chosen=chooseCashCandidate(currentCandidates,row);
    let scope='current';
    if(!chosen){
      const historicalCandidates=(historicalCashIndex.get(key)||[]).filter(item=>!usedCash.has(item.id));
      chosen=chooseCashCandidate(historicalCandidates,row);
      scope='historical';
    }
    if(!chosen){
      missingCash.push(row);
      continue;
    }
    usedCash.add(chosen.id);
    matchedCash.push({existing:chosen,incoming:row,scope});
  }

  const dateCorrections=matchedCash.filter(item=>
    item.scope==='current'&&
    item.existing.batch_id===currentBatchId&&
    movementDate(item.incoming)&&
    movementDate(item.incoming)!==movementDate(item.existing)
  );

  return{
    conflicts,matchedSales,matchedCash,missingSales,missingCash,dateCorrections,
    datesCorrected:dateCorrections.length
  };
}

function conflictSummary(conflicts=[]){
  return conflicts.slice(0,10).map((item,index)=>{
    const reference=item.invoice?`فاتورة ${item.invoice}`:item.voucher?`سداد ${item.voucher}`:item.type==='cash'?'سداد':'فاتورة';
    return `${index+1}. ${reference}: ${item.reason}`;
  }).join('\n');
}

async function postedBatch(reportDate){
  return(await select('daily_report_batches',`report_date=eq.${reportDate}&status=eq.approved&select=id,report_date,file_hash,status,original_name,summary&limit=1`))?.[0]||null;
}

async function rowsForBatch(batchId){
  if(!batchId)return{sales:[],cash:[],inventory:[],treasuries:[]};
  const [sales,cash,inventory,treasuries]=await Promise.all([
    select('daily_report_sales_lines',`batch_id=eq.${encodeURIComponent(batchId)}&select=id,batch_id,source_row_no,invoice_no,sales_type,customer_code,customer_name,item_name,quantity,unit,amount,payment_terms,issues,line_identity&limit=10000`),
    select('daily_report_cash_movements',`batch_id=eq.${encodeURIComponent(batchId)}&select=id,batch_id,source_row_no,treasury_code,treasury_name,debit,credit,account_name,account_type,account_code,description,movement_type,voucher_no,movement_date_text,payment_method,is_customer_collection,line_identity&limit=10000`),
    select('daily_report_inventory_snapshots',`batch_id=eq.${encodeURIComponent(batchId)}&select=id,batch_id,source_row_no,inventory_type,item_code,item_name,unit,opening_quantity,received_quantity,issued_quantity,closing_quantity&limit=20000`),
    select('daily_report_treasury_balances',`batch_id=eq.${encodeURIComponent(batchId)}&select=id,batch_id,treasury_code,treasury_name,opening_balance,closing_balance&limit=500`)
  ]);
  return{sales:sales||[],cash:cash||[],inventory:inventory||[],treasuries:treasuries||[]};
}

function postgrestIn(values){
  return encodeURIComponent(`(${values.map(value=>`"${String(value).replaceAll('\\','\\\\').replaceAll('"','\\"')}"`).join(',')})`);
}

async function selectInChunks(table,column,values,fields,extra=''){
  const unique=[...new Set(values.map(value=>clean(value,120)).filter(Boolean))];
  const rows=[];
  for(let index=0;index<unique.length;index+=80){
    const chunk=unique.slice(index,index+80);
    rows.push(...await select(table,`${column}=in.${postgrestIn(chunk)}${extra}&select=${fields}&limit=10000`));
  }
  return rows;
}

async function globalRowsForIncoming(incoming){
  const invoices=(incoming.sales||[]).map(invoiceNo);
  const customers=(incoming.cashMovements||[]).filter(isCollection).map(customerCode);
  const [sales,cash]=await Promise.all([
    selectInChunks('daily_report_sales_lines','invoice_no',invoices,'id,batch_id,source_row_no,invoice_no,sales_type,customer_code,customer_name,item_name,quantity,unit,amount,payment_terms,issues,line_identity'),
    selectInChunks('daily_report_cash_movements','account_code',customers,'id,batch_id,source_row_no,treasury_code,treasury_name,debit,credit,account_name,account_type,account_code,description,movement_type,voucher_no,movement_date_text,payment_method,is_customer_collection,line_identity','&is_customer_collection=eq.true')
  ]);
  return{sales:sales||[],cash:cash||[]};
}

const existingSale=row=>({
  row:Number(row.source_row_no),invoice:row.invoice_no,customerCode:row.customer_code,
  customer:row.customer_name,item:row.item_name,kind:row.sales_type,
  quantity:Number(row.quantity||0),unit:row.unit,amount:Number(row.amount||0),
  paymentTerms:row.payment_terms||null
});
const existingCash=row=>({
  row:Number(row.source_row_no),treasuryCode:row.treasury_code,treasuryName:row.treasury_name,
  debit:Number(row.debit||0),credit:Number(row.credit||0),accountName:row.account_name,
  accountType:row.account_type,accountCode:row.account_code,description:row.description,
  movementType:row.movement_type,voucherNo:row.voucher_no,movementDate:row.movement_date_text,
  paymentMethod:row.payment_method,isCustomerCollection:Boolean(row.is_customer_collection)
});
const existingInventory=row=>({
  row:Number(row.source_row_no),itemCode:row.item_code,itemName:row.item_name,unit:row.unit,
  opening:Number(row.opening_quantity||0),received:Number(row.received_quantity||0),
  issued:Number(row.issued_quantity||0),closing:Number(row.closing_quantity||0)
});

function summarize(analysis){
  const sales=analysis.sales||[];
  const cash=analysis.cashMovements||[];
  const collections=cash.filter(isCollection);
  const block=sales.filter(row=>erpSaleType(row)==='block');
  const concrete=sales.filter(row=>erpSaleType(row)==='concrete');
  return{
    invoiceCount:sales.length,
    salesTotal:money(sales.reduce((sum,row)=>sum+Number(row.amount||0),0)),
    blockSales:money(block.reduce((sum,row)=>sum+Number(row.amount||0),0)),
    concreteSales:money(concrete.reduce((sum,row)=>sum+Number(row.amount||0),0)),
    blockQuantity:qty(block.reduce((sum,row)=>sum+Number(row.quantity||0),0)),
    concreteQuantity:qty(concrete.reduce((sum,row)=>sum+Number(row.quantity||0),0)),
    collectionCount:collections.length,
    collectionTotal:money(collections.reduce((sum,row)=>sum+Number(row.debit??row.amount??0),0)),
    cashMovementCount:cash.length,
    bankMovementCount:cash.filter(row=>row.isBank||row.paymentMethod==='bank').length,
    treasuryCount:(analysis.treasuries||[]).length,
    finishedGoodsCount:(analysis.finishedGoods||[]).length,
    rawMaterialsCount:(analysis.rawMaterials||[]).length
  };
}

export function buildFullSnapshot(existing,plan,incoming){
  let saleNo=Math.max(0,...existing.sales.map(row=>Number(row.source_row_no||0)));
  let cashNo=Math.max(0,...existing.cash.map(row=>Number(row.source_row_no||0)));
  let inventoryNo=Math.max(0,...existing.inventory.map(row=>Number(row.source_row_no||0)));

  const sales=existing.sales.map(existingSale);
  for(const row of plan.missingSales)sales.push({...row,row:++saleNo});

  const cashMatch=new Map(
    plan.matchedCash
      .filter(item=>item.scope==='current'&&existing.cash.some(row=>row.id===item.existing.id))
      .map(item=>[item.existing.id,item.incoming])
  );
  const cashMovements=existing.cash.map(row=>{
    const fresh=cashMatch.get(row.id);
    const kept=existingCash(row);
    return fresh?{...kept,movementDate:movementDate(fresh)||kept.movementDate}:kept;
  });
  for(const row of plan.missingCash)cashMovements.push({...row,row:++cashNo});

  const incomingInventory=[
    ...(incoming.finishedGoods||[]).map(row=>({...row,inventoryType:'finished_goods'})),
    ...(incoming.rawMaterials||[]).map(row=>({...row,inventoryType:'raw_material'}))
  ];
  const inventoryMap=new Map(incomingInventory.map(row=>[[row.inventoryType,row.itemCode].join('|'),row]));
  const finishedGoods=[];
  const rawMaterials=[];
  for(const old of existing.inventory){
    const key=[old.inventory_type,old.item_code].join('|');
    const fresh=inventoryMap.get(key);
    const row=fresh?{...fresh,row:Number(old.source_row_no)}:existingInventory(old);
    inventoryMap.delete(key);
    (old.inventory_type==='finished_goods'?finishedGoods:rawMaterials).push(row);
  }
  for(const fresh of inventoryMap.values()){
    const row={...fresh,row:++inventoryNo};
    (fresh.inventoryType==='finished_goods'?finishedGoods:rawMaterials).push(row);
  }

  const treasuryMap=new Map(existing.treasuries.map(row=>[
    row.treasury_code,
    {treasuryCode:row.treasury_code,treasuryName:row.treasury_name,opening:Number(row.opening_balance||0),closing:Number(row.closing_balance||0)}
  ]));
  for(const row of incoming.treasuries||[])treasuryMap.set(row.treasuryCode,row);

  const full={
    sales,cashMovements,collections:cashMovements.filter(isCollection),
    treasuries:[...treasuryMap.values()],finishedGoods,rawMaterials,
    reportDates:incoming.reportDates||[],contentText:incoming.contentText||'',
    rowCount:sales.length+cashMovements.length+finishedGoods.length+rawMaterials.length
  };
  full.summary=summarize(full);
  return full;
}

function freshAnalysis(incoming,plan){
  const fresh={
    ...incoming,
    sales:plan.missingSales,
    cashMovements:plan.missingCash,
    collections:plan.missingCash.filter(isCollection)
  };
  fresh.summary=summarize(fresh);
  fresh.rowCount=fresh.sales.length+fresh.cashMovements.length+(fresh.finishedGoods||[]).length+(fresh.rawMaterials||[]).length;
  return fresh;
}

async function ensureImport({fileHash,storagePath,originalName,reportType,summary,rowCount}){
  let imp=(await select('imports',`file_hash=eq.${fileHash}&select=id,status,original_name,report_type,file_path,file_hash,summary&limit=1`))?.[0]||null;
  if(!imp){
    imp=(await insert('imports',[{
      source:'erp-folder',department:'finance',report_type:reportType,status:'ready',
      original_name:originalName,mime_type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      file_path:storagePath,file_hash:fileHash,row_count:rowCount,error_count:0,warning_count:0,
      summary,last_error_code:null,last_error_message:null
    }]))?.[0];
  }else if(!imp.file_path){
    imp=(await patch('imports',`id=eq.${encodeURIComponent(imp.id)}`,{
      file_path:storagePath,report_type:reportType,summary,last_error_code:null,last_error_message:null
    }))?.[0]||{...imp,file_path:storagePath};
  }
  if(!imp?.id){
    throw Object.assign(new Error('تعذر تسجيل ملف ERP في مركز الوارد'),{status:502,code:'ERP_SYNC_IMPORT_REGISTER_FAILED'});
  }
  return imp;
}

async function upgradeSnapshot({batch,imp,analysis,reportDate,sourceHash}){
  const raw=await rpc('upgrade_daily_report_details',{
    p_report_date:reportDate,p_file_hash:batch.file_hash,
    p_payload:payloadFromAnalysis(analysis,reportDate),p_actor:'erp-folder-sync-v6-current-first'
  });
  const result=one(raw);
  if(result?.available===false){
    throw Object.assign(new Error('تحديث التقارير التاريخية غير متاح في قاعدة البيانات'),{
      status:503,code:result.reason||'ERP_UPGRADE_MIGRATION_REQUIRED'
    });
  }
  await patch('imports',`id=eq.${encodeURIComponent(imp.id)}`,{
    status:'posted',posted_batch_id:batch.id,
    summary:{daily:analysis.summary,source:{kind:'erp-folder-snapshot',parserVersion:'daily-report-v6-current-first',sourceFileHash:sourceHash,upgradedAt:new Date().toISOString()}},
    error_count:0,warning_count:0,last_error_code:null,last_error_message:null
  });
  return result||{};
}

async function planForDay(current,incoming,batchId,legacyBaseline){
  const global=await globalRowsForIncoming(incoming);
  const sales=byId([...current.sales,...global.sales]);
  const cash=byId([...current.cash,...global.cash]);
  return buildSnapshotPlan(sales,cash,incoming,{currentBatchId:batchId,legacyBaseline});
}

async function processExistingDay({batch,incoming,imp,reportDate,sourceHash,legacyBaseline=false}){
  const current=await rowsForBatch(batch.id);
  const plan=await planForDay(current,incoming,batch.id,legacyBaseline);
  if(plan.conflicts.length){
    const detail=conflictSummary(plan.conflicts);
    throw Object.assign(new Error(`تعارض في ${plan.conflicts.length} فاتورة أو سداد؛ لم يتم تعديل يوم ${reportDate}.\n${detail}`),{
      status:409,code:'ERP_TRANSACTION_CONFLICT',details:{reportDate,conflicts:plan.conflicts}
    });
  }
  const full=buildFullSnapshot(current,plan,incoming);
  const unchanged=plan.missingSales.length===0&&plan.missingCash.length===0&&plan.datesCorrected===0&&
    (incoming.finishedGoods||[]).length===0&&(incoming.rawMaterials||[]).length===0&&(incoming.treasuries||[]).length===0;
  if(unchanged){
    await patch('imports',`id=eq.${encodeURIComponent(imp.id)}`,{
      status:'posted',posted_batch_id:batch.id,last_error_code:null,last_error_message:null
    });
    return{
      status:'duplicate',batchId:batch.id,matchedInvoices:plan.matchedSales.length,
      matchedCash:plan.matchedCash.length,addedSales:0,addedCash:0,
      datesCorrected:0,upgraded:false,analysis:full
    };
  }
  const upgrade=await upgradeSnapshot({batch,imp,analysis:full,reportDate,sourceHash});
  return{
    status:'updated',batchId:batch.id,matchedInvoices:plan.matchedSales.length,
    matchedCash:plan.matchedCash.length,addedSales:plan.missingSales.length,
    addedCash:plan.missingCash.length,datesCorrected:plan.datesCorrected,
    upgraded:true,upgrade,analysis:full
  };
}

async function processNewDay({incoming,imp,reportDate,dayHash,dayName}){
  const plan=await planForDay({sales:[],cash:[]},incoming,'',false);
  if(plan.conflicts.length){
    const detail=conflictSummary(plan.conflicts);
    throw Object.assign(new Error(`تعارض في ${plan.conflicts.length} فاتورة أو سداد؛ لم يتم ترحيل يوم ${reportDate}.\n${detail}`),{
      status:409,code:'ERP_TRANSACTION_CONFLICT',details:{reportDate,conflicts:plan.conflicts}
    });
  }
  const analysis=freshAnalysis(incoming,plan);
  const hasRows=analysis.sales.length||analysis.cashMovements.length||(analysis.treasuries||[]).length||
    (analysis.finishedGoods||[]).length||(analysis.rawMaterials||[]).length;
  if(!hasRows){
    await patch('imports',`id=eq.${encodeURIComponent(imp.id)}`,{
      status:'posted',last_error_code:null,last_error_message:null
    });
    return{
      status:'duplicate',batchId:null,matchedInvoices:plan.matchedSales.length,
      matchedCash:plan.matchedCash.length,addedSales:0,addedCash:0,
      datesCorrected:0,upgraded:false,analysis
    };
  }
  const posting=await commitDailyReportFromTelegram({
    reportDate,originalName:dayName,fileHash:dayHash,contentHash:dayHash,
    idempotencyKey:`erp-folder-range:${reportDate}:${dayHash}`,importId:imp.id,
    payload:payloadFromAnalysis(analysis,reportDate)
  },'erp-folder-sync-v6');
  if(!posting?.ok){
    throw Object.assign(new Error(clean(posting?.reason,500)||`فشل ترحيل يوم ${reportDate}`),{
      status:422,code:'ERP_DAY_FAILED',details:{reportDate,posting}
    });
  }
  return{
    status:posting.duplicate?'duplicate':'posted',
    batchId:posting.postedBatchId||posting.existingImportId||null,
    matchedInvoices:plan.matchedSales.length,matchedCash:plan.matchedCash.length,
    addedSales:analysis.sales.length,addedCash:analysis.cashMovements.length,
    datesCorrected:0,upgraded:false,posting,analysis
  };
}

function crossDayInvoiceConflicts(groups){
  const dates=new Map();
  const conflicts=[];
  for(const item of groups){
    for(const number of invoiceGroups(item.analysis.sales).keys()){
      if(!dates.has(number))dates.set(number,item.reportDate);
      else if(dates.get(number)!==item.reportDate){
        conflicts.push({type:'sale',invoice:number,reason:`رقم الفاتورة ظهر في يومين داخل الملف: ${dates.get(number)} و${item.reportDate}`});
      }
    }
  }
  return conflicts;
}

async function processRange({buffer,originalName,hash,workbook,analysis,classification,reportType}){
  const split=splitAggregatedAnalysis(analysis);
  if(split.sourceDates.length<2)return null;
  if(split.undated.length){
    throw Object.assign(new Error(`الملف المجمع يحتوي ${split.undated.length} حركة بلا تاريخ داخل السطر؛ لم يُرحّل شيء.`),{
      status:422,code:'ERP_RANGE_UNDATED_ROWS',details:split.undated.slice(0,100)
    });
  }
  const crossConflicts=crossDayInvoiceConflicts(split.groups);
  if(crossConflicts.length){
    throw Object.assign(new Error(`الملف المجمع يحتوي ${crossConflicts.length} رقم فاتورة مكررًا بين الأيام؛ لم يبدأ الترحيل.\n${conflictSummary(crossConflicts)}`),{
      status:409,code:'ERP_RANGE_INVOICE_CONFLICT',details:crossConflicts
    });
  }

  const preflight=[];
  for(const item of split.groups){
    const batch=await postedBatch(item.reportDate);
    const current=await rowsForBatch(batch?.id);
    const legacyBaseline=item.reportDate===LEGACY_BASELINE_DATE&&
      (item.analysis.sourceDates||[]).some(date=>date<LEGACY_BASELINE_DATE);
    const plan=await planForDay(current,item.analysis,batch?.id||'',legacyBaseline);
    preflight.push({...item,batch,legacyBaseline,preflightPlan:plan});
  }
  const conflicts=preflight.flatMap(item=>
    item.preflightPlan.conflicts.map(row=>({reportDate:item.reportDate,...row}))
  );
  if(conflicts.length){
    throw Object.assign(new Error(`الملف المجمع يحتوي ${conflicts.length} تعارضًا؛ لم يبدأ الترحيل.\n${conflictSummary(conflicts)}`),{
      status:409,code:'ERP_RANGE_CONFLICT',details:conflicts
    });
  }

  const storagePath=`erp-folder/ranges/${split.sourceDates[0]}_${split.sourceDates.at(-1)}/${hash.slice(0,16)}-${safeFile(originalName)}`;
  await uploadObject(storagePath,buffer,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const results=[];
  for(const item of preflight){
    try{
      const dayHash=stableHash(`${hash}|${item.reportDate}`);
      const dayName=`${originalName} [${item.reportDate}]`;
      const summary={
        sheetNames:workbook.SheetNames,daily:item.analysis.summary,
        source:{kind:'erp-folder-range',classification,sourceHash:hash,sourceDates:item.analysis.sourceDates}
      };
      const imp=await ensureImport({
        fileHash:dayHash,storagePath,originalName:dayName,reportType,
        summary,rowCount:item.analysis.rowCount
      });
      const result=item.batch
        ?await processExistingDay({
          batch:item.batch,incoming:item.analysis,imp,reportDate:item.reportDate,
          sourceHash:hash,legacyBaseline:item.legacyBaseline
        })
        :await processNewDay({
          incoming:item.analysis,imp,reportDate:item.reportDate,dayHash,dayName
        });
      results.push({reportDate:item.reportDate,...result,analysis:undefined});
    }catch(error){
      error.details={...(error.details||{}),committedDays:results};
      throw error;
    }
  }

  return{
    ok:true,aggregate:true,
    duplicate:results.every(row=>row.status==='duplicate'),
    upgraded:results.some(row=>row.upgraded),
    reportDate:split.sourceDates.at(-1),fileHash:hash,storagePath,
    baseline:split.baseline,sourceDates:split.sourceDates,days:results,
    totals:results.reduce((out,row)=>{
      out.matchedInvoices+=row.matchedInvoices||0;
      out.matchedCash+=row.matchedCash||0;
      out.added+=row.addedSales+row.addedCash;
      out.datesCorrected+=row.datesCorrected;
      return out;
    },{matchedInvoices:0,matchedCash:0,added:0,datesCorrected:0})
  };
}

export default async function handler(req,res){
  if(!method(req,res,['POST']))return;
  try{
    requireSyncToken(req);
    const buffer=await rawBody(req,config.maxImportFileBytes);
    if(!buffer.length){
      throw Object.assign(new Error('ملف التقرير غير موجود في الطلب'),{status:400,code:'ERP_SYNC_FILE_REQUIRED'});
    }
    if(buffer.length>config.maxImportFileBytes){
      throw Object.assign(new Error('حجم ملف التقرير يتجاوز الحد المسموح'),{status:413,code:'ERP_SYNC_FILE_TOO_LARGE'});
    }
    if(buffer[0]!==0x50||buffer[1]!==0x4b){
      throw Object.assign(new Error('الملف ليس XLSX صالحًا'),{status:415,code:'ERP_SYNC_XLSX_REQUIRED'});
    }

    const originalName=decodedFilename(req);
    const hash=sha256(buffer);
    const workbook=XLSX.read(buffer,{type:'buffer',cellDates:true});
    const analysis=parseDailyWorkbook(workbook,XLSX);
    const classification=resolveDailyReportType(req,workbook,originalName,analysis);
    const reportType=classification.reportType;
    const range=await processRange({buffer,originalName,hash,workbook,analysis,classification,reportType});
    if(range)return json(res,200,range);

    const reportDate=resolveReportDate(req,workbook,originalName,analysis);
    const storagePath=`erp-folder/${reportDate}/${hash.slice(0,16)}-${safeFile(originalName)}`;
    const existingImport=(await select('imports',`file_hash=eq.${hash}&select=id,file_path,status&limit=1`))?.[0]||null;
    if(!existingImport?.file_path){
      await uploadObject(storagePath,buffer,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    }
    const summary={sheetNames:workbook.SheetNames,daily:analysis.summary,source:{kind:'erp-folder',classification}};
    const imp=await ensureImport({
      fileHash:hash,storagePath:existingImport?.file_path||storagePath,
      originalName,reportType,summary,rowCount:analysis.rowCount
    });
    const batch=await postedBatch(reportDate);
    const shouldSendReports=String(req.headers?.['x-erp-send-reports']??'1')!=='0';

    if(batch){
      const result=await processExistingDay({
        batch,incoming:analysis,imp,reportDate,sourceHash:hash,legacyBaseline:false
      });
      const telegram=shouldSendReports
        ?await sendErpDuplicateNotice({
          reportDate,sourceFile:originalName,upgrade:{upgraded:result.upgraded,...result.upgrade}
        }).catch(error=>({errors:[String(error?.message||error)]}))
        :{disabled:true};
      return json(res,200,{
        ok:true,duplicate:result.status==='duplicate',upgraded:result.upgraded,
        reportDate,fileHash:hash,importId:imp.id,summary:analysis.summary,
        reconciliation:{...result,analysis:undefined},telegram
      });
    }

    const result=await processNewDay({incoming:analysis,imp,reportDate,dayHash:hash,dayName:originalName});
    let telegram;
    if(result.status==='duplicate'){
      telegram=await sendErpDuplicateNotice({reportDate,sourceFile:originalName})
        .catch(error=>({errors:[String(error?.message||error)]}));
    }else if(shouldSendReports){
      const prepared=await prepareErpSuccessDelivery({
        analysis:result.analysis,sourceFile:originalName,reportDate
      }).catch(error=>({recipients:[],collections:[],reports:[],errors:[String(error?.message||error)]}));
      telegram=await sendErpSuccessDelivery({
        analysis:result.analysis,sourceFile:originalName,reportDate,
        posting:result.posting,prepared
      }).catch(error=>({errors:[String(error?.message||error)]}));
    }else{
      telegram={disabled:true};
    }
    return json(res,200,{
      ok:true,duplicate:result.status==='duplicate',reportDate,fileHash:hash,
      importId:imp.id,storagePath,summary:result.analysis.summary,
      posting:result.posting,telegram
    });
  }catch(error){
    if(error?.code?.startsWith('ERP_')&&error.status>=400){
      const reportDate=clean(error?.details?.reportDate,10)||null;
      const sourceFile=decodedFilename(req);
      if(reportDate){
        await sendErpFailureNotice({reportDate,sourceFile,reason:error.message}).catch(()=>{});
      }
    }
    errorResponse(res,error);
  }
}
