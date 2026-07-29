import crypto from 'node:crypto';
import * as XLSX from 'xlsx';
import { commitDailyReportFromTelegram } from './routes/daily-report.js';
import { parseDailyWorkbook } from './daily-summary-parser.js';
import { payloadFromAnalysis } from './daily-report-v3.js';
import { planSingleDayRepair } from './daily-report-v7.js';
import { prepareErpSuccessDelivery,sendErpSuccessDelivery } from './erp-telegram-delivery.js';
import { sendThreeDaySalesCollectionsReport } from './erp-three-day-report.js';
import { downloadObject,insert,select } from './supabase.js';
import { errorResponse,json } from './http.js';

const REPORT_DATE='2026-07-28';
const ORIGINAL_FILE_HASH='171b4d74b4f049e563a371843e88d6dab151adc08b2b7a4993d0975ab41131c6';
const RESUME_TOKEN_HASH='3de09b27b92290eafe8f8dac70dc068ea7d47dddbebbd7aab6c5e97a5e83f25b';
const AUDIT_ACTION='erp_reviewed_resume_20260728_delivery';
const clean=(value,max=1000)=>String(value??'').trim().slice(0,max);
const money=value=>Math.round((Number(value||0)+Number.EPSILON)*100)/100;
const stable=value=>Array.isArray(value)?`[${value.map(stable).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`:JSON.stringify(value);

function verifyToken(req){
  const supplied=new URL(req.url||'/api/erp/daily-report',`https://${String(req.headers?.host||'localhost')}`).searchParams.get('token')||'';
  const digest=crypto.createHash('sha256').update(supplied).digest('hex');
  const left=Buffer.from(digest),right=Buffer.from(RESUME_TOKEN_HASH);
  if(left.length!==right.length||!crypto.timingSafeEqual(left,right))throw Object.assign(new Error('Reviewed ERP resume authorization failed'),{status:401,code:'ERP_REVIEWED_RESUME_AUTH_REQUIRED'});
}

export function validateReviewedAnalysis(analysis={}){
  const summary=analysis.summary||{};
  const actual={
    invoiceCount:Number(summary.invoiceCount||0),
    salesTotal:money(summary.salesTotal),
    blockSales:money(summary.blockSales),
    concreteSales:money(summary.concreteSales),
    collectionCount:Number(summary.collectionCount||0),
    collectionTotal:money(summary.collectionTotal),
    cashMovementCount:Number(summary.cashMovementCount||0)
  };
  const expected={invoiceCount:18,salesTotal:53721,blockSales:5920,concreteSales:47801,collectionCount:12,collectionTotal:24627,cashMovementCount:24};
  const mismatches=Object.keys(expected).filter(key=>actual[key]!==expected[key]);
  if(mismatches.length)throw Object.assign(new Error(`Reviewed ERP payload mismatch: ${mismatches.join(', ')}`),{status:409,code:'ERP_REVIEWED_PAYLOAD_MISMATCH',details:{actual,expected,mismatches}});
  const invalidBank=(analysis.cashMovements||[]).filter(row=>row.isBank&&row.treasuryCode!=='105');
  if(invalidBank.length)throw Object.assign(new Error('Reviewed ERP bank mapping is invalid'),{status:409,code:'ERP_REVIEWED_BANK_MAPPING_INVALID',details:{rows:invalidBank.map(row=>({row:row.row,treasuryCode:row.treasuryCode,accountCode:row.accountCode,voucherNo:row.voucherNo}))}});
  const missingDates=(analysis.cashMovements||[]).filter(row=>!row.movementDate&&!row.reportDate);
  if(missingDates.length)throw Object.assign(new Error('Reviewed ERP still contains undated movements'),{status:409,code:'ERP_REVIEWED_UNDATED_ROWS',details:{rows:missingDates.map(row=>row.row)}});
  return{actual,expected};
}

async function rawImport(){
  const row=(await select('imports',`file_hash=eq.${ORIGINAL_FILE_HASH}&select=id,file_path,original_name,file_hash,status,posted_batch_id&limit=1`))?.[0]||null;
  if(!row?.id||!row?.file_path)throw Object.assign(new Error('Stored original ERP file was not found'),{status:404,code:'ERP_REVIEWED_ORIGINAL_MISSING'});
  return row;
}
async function existingBatch(){return(await select('daily_report_batches',`report_date=eq.${REPORT_DATE}&status=eq.approved&select=id,report_date,status,file_hash,summary,committed_at&limit=1`))?.[0]||null;}
async function deliveryMarker(){return(await select('audit_log',`action=eq.${AUDIT_ACTION}&entity_id=eq.${REPORT_DATE}&select=id,details,created_at&order=created_at.desc&limit=1`))?.[0]||null;}

async function loadReviewedAnalysis(importRow){
  const stored=await downloadObject(importRow.file_path),workbook=XLSX.read(stored.buffer,{type:'buffer',cellDates:true}),parsed=parseDailyWorkbook(workbook,XLSX),analysis=planSingleDayRepair(parsed,REPORT_DATE).analysis;
  const validation=validateReviewedAnalysis(analysis);
  return{analysis,validation,storedBytes:stored.buffer.length};
}

async function deliver({analysis,sourceFile,batchId,posting}){
  const prepared=await prepareErpSuccessDelivery({analysis,sourceFile,reportDate:REPORT_DATE});
  const telegram=await sendErpSuccessDelivery({analysis,sourceFile,reportDate:REPORT_DATE,posting:{...posting,batchId},prepared});
  const threeDay=await sendThreeDaySalesCollectionsReport(REPORT_DATE);
  await insert('audit_log',[{actor_type:'system',actor_id:'reviewed-erp-resume',action:AUDIT_ACTION,entity_type:'daily_report',entity_id:REPORT_DATE,details:{batchId,sourceFile,telegram,threeDay,completedAt:new Date().toISOString()}}],{prefer:'return=minimal'});
  return{telegram,threeDay};
}

export async function resumeReviewedReport20260728(req,res){
  try{
    verifyToken(req);
    const importRow=await rawImport(),loaded=await loadReviewedAnalysis(importRow);
    let batch=await existingBatch(),posting=null;
    if(!batch){
      const payload=payloadFromAnalysis(loaded.analysis,REPORT_DATE),contentHash=crypto.createHash('sha256').update(stable(payload)).digest('hex');
      posting=await commitDailyReportFromTelegram({
        reportDate:REPORT_DATE,
        originalName:importRow.original_name||'Daily-Report-2026-07-28.xlsx',
        fileHash:ORIGINAL_FILE_HASH,
        contentHash,
        idempotencyKey:`reviewed-resume:${REPORT_DATE}:${ORIGINAL_FILE_HASH}`,
        importId:importRow.id,
        payload
      },'reviewed-erp-resume');
      if(!posting?.ok)throw Object.assign(new Error(clean(posting?.reason,500)||'Reviewed ERP posting failed'),{status:422,code:'ERP_REVIEWED_POSTING_FAILED',details:{posting}});
      batch=await existingBatch();
    }
    if(!batch?.id)throw Object.assign(new Error('Reviewed ERP batch was not created'),{status:502,code:'ERP_REVIEWED_BATCH_MISSING'});
    const marker=await deliveryMarker();
    if(marker)return json(res,200,{ok:true,alreadyCompleted:true,reportDate:REPORT_DATE,batch,validation:loaded.validation,delivery:marker.details});
    const delivery=await deliver({analysis:loaded.analysis,sourceFile:importRow.original_name||'Daily-Report-2026-07-28.xlsx',batchId:batch.id,posting:posting||{ok:true,duplicate:true}});
    return json(res,200,{ok:true,alreadyCompleted:false,reportDate:REPORT_DATE,batch,posting,validation:loaded.validation,storedBytes:loaded.storedBytes,delivery});
  }catch(error){
    console.error('[ERP_REVIEWED_RESUME_20260728]',{code:error?.code||null,message:String(error?.message||error),details:error?.details||null});
    return errorResponse(res,error);
  }
}
