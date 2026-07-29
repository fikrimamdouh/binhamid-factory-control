import crypto from 'node:crypto';
import * as XLSX from 'xlsx';
import currentDailyReport from './daily-report-v6.js';
import customerPaymentReconciliation from './customer-payment-reconciliation-handler.js';
import { config } from './config.js';
import { sha256 } from './domain.js';
import { json } from './http.js';
import { parseDailyWorkbook } from './daily-summary-parser.js';
import { resolveReportDate } from './daily-report-v3.js';
import { rpc,select } from './supabase.js';
import {
  prepareErpSuccessDelivery,
  sendErpDuplicateNotice,
  sendErpSuccessDelivery
} from './erp-telegram-delivery.js';

const SYNC_TOKEN_SHA256='b4ba6180ffc5d0ce658168f76b3362b69b7e930b998e8304fa6afe68da8289a0';
const clean=(value,max=1000)=>String(value??'').trim().slice(0,max);
const norm=value=>clean(value,1000).toLowerCase().replace(/[أإآٱ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ً-ْـ]/g,'').replace(/\s+/g,' ');
const money=value=>Math.round((Number(value||0)+Number.EPSILON)*100)/100;
const customerCode=row=>clean(row?.accountCode??row?.account_code??row?.customerCode??row?.customer_code,120);
const voucherNo=row=>clean(row?.voucherNo??row?.voucher_no??row?.receipt,120);
const movementDate=row=>clean(row?.movementDate??row?.movement_date_text??row?.reportDate,10);
const treasuryCode=row=>clean(row?.treasuryCode??row?.treasury_code,40);
const debit=row=>money(row?.debit??row?.amount);
const credit=row=>money(row?.credit);
const isCollection=row=>Boolean(row?.isCustomerCollection??row?.is_customer_collection);
const direction=row=>debit(row)>0&&credit(row)===0?'debit':credit(row)>0&&debit(row)===0?'credit':'mixed';
const paymentAmount=row=>Math.max(debit(row),credit(row));
const exactPaymentReference=row=>{
  const voucher=voucherNo(row);
  if(voucher)return['voucher',customerCode(row),voucher,direction(row)].join('|');
  return[
    'fallback',customerCode(row),direction(row),paymentAmount(row),
    norm(row?.movementType??row?.movement_type??row?.type),
    norm(row?.description??row?.notes)
  ].join('|');
};
const oldCollectionKey=row=>[movementDate(row),customerCode(row),debit(row),credit(row)].join('|');

function equal(a,b){
  const aa=Buffer.from(String(a||'')),bb=Buffer.from(String(b||''));
  return aa.length===bb.length&&aa.length>0&&crypto.timingSafeEqual(aa,bb);
}

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
    if(size>limit)throw Object.assign(new Error('حجم ملف التقرير يتجاوز الحد المسموح'),{status:413,code:'ERP_SYNC_FILE_TOO_LARGE'});
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function decodedFilename(req){
  const encoded=clean(req.headers?.['x-erp-filename-b64'],1000);
  if(encoded){
    try{const value=Buffer.from(encoded,'base64').toString('utf8');if(value)return clean(value,240);}catch{}
  }
  return clean(req.headers?.['x-erp-filename'],240)||'daily-report.xlsx';
}

function captureResponse(){
  return{
    statusCode:200,
    headers:{},
    body:'',
    setHeader(name,value){this.headers[String(name).toLowerCase()]=value;},
    end(value=''){this.body=Buffer.isBuffer(value)?value.toString('utf8'):String(value??'');}
  };
}

function forwardCaptured(res,captured){
  res.statusCode=captured.statusCode||200;
  for(const [name,value] of Object.entries(captured.headers||{}))res.setHeader(name,value);
  res.end(captured.body||'');
}

function summarizeAnalysis(analysis,cashMovements){
  const collections=cashMovements.filter(isCollection);
  return{
    ...(analysis.summary||{}),
    collectionCount:collections.length,
    collectionTotal:money(collections.reduce((sum,row)=>sum+debit(row),0)),
    cashMovementCount:cashMovements.length,
    cashDebitTotal:money(cashMovements.reduce((sum,row)=>sum+debit(row),0)),
    cashCreditTotal:money(cashMovements.reduce((sum,row)=>sum+credit(row),0)),
    bankMovementCount:cashMovements.filter(row=>row.isBank||row.paymentMethod==='bank'||treasuryCode(row)==='105').length
  };
}

export function planSingleDayRepair(analysis={},reportDate){
  const date=clean(reportDate,10);
  const normalizedCash=(analysis.cashMovements||[]).map(row=>
    movementDate(row)?row:{...row,movementDate:date,reportDate:date}
  );
  const seenReferences=new Map();
  const seenOldKeys=new Map();
  const kept=[];
  const appendRows=[];
  const removeRows=[];
  const exactDuplicates=[];
  const conflicts=[];

  for(const row of normalizedCash){
    if(!isCollection(row)){
      kept.push(row);
      continue;
    }
    const reference=exactPaymentReference(row);
    const previousReference=seenReferences.get(reference);
    if(previousReference){
      if(paymentAmount(previousReference)!==paymentAmount(row)){
        conflicts.push({
          customerCode:customerCode(row),voucherNo:voucherNo(row),
          existingAmount:paymentAmount(previousReference),incomingAmount:paymentAmount(row),
          reason:'نفس العميل ورقم السند داخل الملف يحملان مبلغين مختلفين'
        });
      }else{
        exactDuplicates.push(row);
        removeRows.push(row);
      }
      continue;
    }
    seenReferences.set(reference,row);

    const oldKey=oldCollectionKey(row);
    const previousOld=seenOldKeys.get(oldKey);
    if(previousOld&&voucherNo(previousOld)!==voucherNo(row)){
      appendRows.push(row);
      removeRows.push(row);
      kept.push(row);
      continue;
    }
    seenOldKeys.set(oldKey,row);
    kept.push(row);
  }

  const normalized={
    ...analysis,
    cashMovements:kept,
    collections:kept.filter(isCollection),
    reportDates:[...new Set([...(analysis.reportDates||[]),date])].filter(Boolean).sort()
  };
  normalized.summary=summarizeAnalysis(normalized,kept);
  normalized.rowCount=(analysis.sales||[]).length+kept.length+(analysis.finishedGoods||[]).length+(analysis.rawMaterials||[]).length;
  return{
    analysis:normalized,
    appendRows,
    removeRows,
    exactDuplicates,
    conflicts,
    undatedRows:(analysis.cashMovements||[]).filter(row=>!movementDate(row))
  };
}

function rowsForSheet(workbook,sheetName){
  const sheet=workbook.Sheets[sheetName];
  return sheet?XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:true,cellDates:true,blankrows:true}):[];
}

function findDateColumn(rows,rowIndex){
  for(let index=rowIndex-1;index>=Math.max(0,rowIndex-40);index--){
    const row=rows[index]||[];
    const normalized=row.map(value=>norm(value));
    const hasCash=normalized.some(value=>value==='مدين')&&normalized.some(value=>value==='دائن');
    if(!hasCash)continue;
    const column=normalized.findIndex(value=>value==='التاريخ'||value.includes('تاريخ الحركه'));
    if(column>=0)return column;
  }
  return 8;
}

function writeDateToSourceRow(workbook,row,reportDate,cache){
  const sheetName=clean(row?.sheet,200);
  const rowNo=Number(row?.row||0);
  const sheet=workbook.Sheets[sheetName];
  if(!sheet||!Number.isInteger(rowNo)||rowNo<1)return;
  if(!cache.has(sheetName))cache.set(sheetName,rowsForSheet(workbook,sheetName));
  const column=findDateColumn(cache.get(sheetName),rowNo-1);
  const address=XLSX.utils.encode_cell({r:rowNo-1,c:column});
  sheet[address]={t:'s',v:reportDate};
}

function blankSourceRow(workbook,row){
  const sheetName=clean(row?.sheet,200);
  const rowNo=Number(row?.row||0);
  const sheet=workbook.Sheets[sheetName];
  if(!sheet||!sheet['!ref']||!Number.isInteger(rowNo)||rowNo<1)return;
  const range=XLSX.utils.decode_range(sheet['!ref']);
  for(let column=range.s.c;column<=range.e.c;column++){
    delete sheet[XLSX.utils.encode_cell({r:rowNo-1,c:column})];
  }
}

export function repairSingleDayWorkbook(workbook,plan,reportDate){
  const cache=new Map();
  const removed=new Set(plan.removeRows.map(row=>`${row.sheet}|${row.row}`));
  for(const row of plan.undatedRows){
    if(!removed.has(`${row.sheet}|${row.row}`))writeDateToSourceRow(workbook,row,reportDate,cache);
  }
  for(const row of plan.removeRows)blankSourceRow(workbook,row);
  return XLSX.write(workbook,{type:'buffer',bookType:'xlsx',compression:true});
}

function paymentPayload(row,reportDate){
  return{
    ...row,
    accountCode:customerCode(row),
    voucherNo:voucherNo(row),
    debit:debit(row),
    credit:credit(row),
    movementDate:reportDate,
    reportDate,
    isCustomerCollection:true
  };
}

async function migrationReady(){
  return Boolean((await select('migration_history','version=eq.32&select=version&limit=1'))?.[0]);
}

async function deliverRepairedReport({analysis,sourceFile,reportDate,capturedPayload,appendResult,shouldSendReports}){
  if(!shouldSendReports)return{disabled:true};
  const posting=capturedPayload?.posting;
  if(posting&&!posting.duplicate){
    const prepared=await prepareErpSuccessDelivery({analysis,sourceFile,reportDate})
      .catch(error=>({recipients:[],collections:[],reports:[],errors:[String(error?.message||error)]}));
    return sendErpSuccessDelivery({
      analysis,sourceFile,reportDate,
      posting:{...posting,paymentRepair:appendResult},prepared
    });
  }
  return sendErpDuplicateNotice({
    reportDate,sourceFile,
    upgrade:{upgraded:Boolean(capturedPayload?.upgraded||capturedPayload?.reconciliation?.upgraded),paymentRepair:appendResult}
  });
}

async function repairedDailyReport(req,res,buffer){
  requireSyncToken(req);
  if(!buffer.length)throw Object.assign(new Error('ملف التقرير غير موجود في الطلب'),{status:400,code:'ERP_SYNC_FILE_REQUIRED'});
  if(buffer.length>config.maxImportFileBytes)throw Object.assign(new Error('حجم ملف التقرير يتجاوز الحد المسموح'),{status:413,code:'ERP_SYNC_FILE_TOO_LARGE'});
  if(buffer[0]!==0x50||buffer[1]!==0x4b)throw Object.assign(new Error('الملف ليس XLSX صالحًا'),{status:415,code:'ERP_SYNC_XLSX_REQUIRED'});

  const originalName=decodedFilename(req);
  const workbook=XLSX.read(buffer,{type:'buffer',cellDates:true});
  const analysis=parseDailyWorkbook(workbook,XLSX);
  const explicitDates=[...new Set((analysis.reportDates||[]).filter(value=>/^\d{4}-\d{2}-\d{2}$/.test(value)))];
  if(explicitDates.length>1){
    req.body=buffer;
    return currentDailyReport(req,res);
  }
  const reportDate=resolveReportDate(req,workbook,originalName,analysis);
  const plan=planSingleDayRepair(analysis,reportDate);
  if(plan.conflicts.length){
    return json(res,409,{
      ok:false,code:'ERP_TRANSACTION_CONFLICT',
      error:`تعارض في ${plan.conflicts.length} سداد؛ لم يتم ترحيل يوم ${reportDate}.`,
      reportDate,conflicts:plan.conflicts
    });
  }
  const needsRepair=plan.undatedRows.length>0||plan.removeRows.length>0;
  if(!needsRepair){
    req.body=buffer;
    return currentDailyReport(req,res);
  }
  if(plan.appendRows.length&&!await migrationReady()){
    return json(res,503,{
      ok:false,code:'ERP_PAYMENT_MIGRATION_REQUIRED',
      error:'تحديx� استكمال السداد لم يطبق بعد على قاعدة البيانات؛ لم تُرحّل أي حركة.',
      reportDate
    });
  }

  const repairedBuffer=repairSingleDayWorkbook(workbook,plan,reportDate);
  const forwarded=Object.create(req);
  forwarded.body=repairedBuffer;
  forwarded.headers={...(req.headers||{}),'x-erp-send-reports':'0'};
  const captured=captureResponse();
  await currentDailyReport(forwarded,captured);
  if(captured.statusCode>=400)return forwardCaptured(res,captured);

  let capturedPayload={};
  try{capturedPayload=JSON.parse(captured.body||'{}');}catch{}
  let appendResult={ok:true,inserted:0,matched:0,conflictCount:0,insertedAmount:0};
  if(plan.appendRows.length){
    const raw=await rpc('append_daily_report_customer_payments',{
      p_report_date:reportDate,
      p_file_hash:sha256(buffer),
      p_payments:plan.appendRows.map(row=>paymentPayload(row,reportDate)),
      p_actor:'erp-daily-report-v7-repair',
      p_source_name:originalName
    });
    appendResult=Array.isArray(raw)?raw[0]:raw;
  }

  const shouldSendReports=String(req.headers?.['x-erp-send-reports']??'1')!=='0';
  const telegram=await deliverRepairedReport({
    analysis:plan.analysis,sourceFile:originalName,reportDate,
    capturedPayload,appendResult,shouldSendReports
  }).catch(error=>({errors:[String(error?.message||error)]}));

  return json(res,200,{
    ...capturedPayload,
    ok:true,
    reportDate,
    summary:plan.analysis.summary,
    telegram,
    repair:{
      applied:true,
      undatedRowsAssigned:plan.undatedRows.length,
      voucherSeparated:plan.appendRows.length,
      exactDuplicatesIgnored:plan.exactDuplicates.length,
      append:appendResult
    }
  });
}

export default async function handler(req,res){
  const mode=clean(req?.headers?.['x-erp-mode']??req?.query?.mode,80).toLowerCase();
  if(mode==='customer-payments'||mode==='customer-payment-reconciliation'){
    return customerPaymentReconciliation(req,res);
  }
  if(req.method!=='POST')return currentDailyReport(req,res);
  try{
    const buffer=await rawBody(req,config.maxImportFileBytes);
    return repairedDailyReport(req,res,buffer);
  }catch(error){
    console.error(error);
    return json(res,Number(error?.status||500),{
      error:Number(error?.status||500)>=500?'تعذر تنفيذ العملية على الخادم':error.message,
      code:clean(error?.code,120)||undefined
    });
  }
}

export * from './daily-report-v6.js';
