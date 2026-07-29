import crypto from 'node:crypto';
import * as XLSX from 'xlsx';
import { config } from './config.js';
import { sha256 } from './domain.js';
import { errorResponse,json,method } from './http.js';
import { parseDailyWorkbook } from './daily-summary-parser.js';
import { postingDateForTransaction,resolveReportDate } from './daily-report-v3.js';
import { insert,patch,rpc,select,uploadObject } from './supabase.js';
import {
  assignSettlementDate,
  buildCustomerPaymentCompletionPlan,
  isCustomerReceipt,
  paymentCompletionSummaryByCustomer,
  paymentCustomerCode,
  paymentMovementDate
} from './customer-payment-reconciliation.js';

const SYNC_TOKEN_SHA256='b4ba6180ffc5d0ce658168f76b3362b69b7e930b998e8304fa6afe68da8289a0';
const clean=(value,max=1000)=>String(value??'').trim().slice(0,max);
const money=value=>Math.round((Number(value||0)+Number.EPSILON)*100)/100;
const equal=(a,b)=>{
  const aa=Buffer.from(String(a||'')),bb=Buffer.from(String(b||''));
  return aa.length===bb.length&&aa.length>0&&crypto.timingSafeEqual(aa,bb);
};
const safeFile=value=>{
  let name=clean(value,240).replace(/[^\x00-\x7F]/g,'_').replace(/[^A-Za-z0-9._-]/g,'_').replace(/_+/g,'_').replace(/^_+|_+$/g,'');
  if(!name||name.startsWith('.'))name='customer-payments.xlsx';
  return name.slice(0,140);
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
  const chunks=[];let size=0;
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
  return clean(req.headers?.['x-erp-filename'],240)||'customer-payments.xlsx';
}

function validDate(value){
  const date=clean(value,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date)&&!Number.isNaN(new Date(`${date}T12:00:00Z`).getTime())?date:'';
}

function postgrestIn(values){
  return encodeURIComponent(`(${values.map(value=>`"${String(value).replaceAll('\\','\\\\').replaceAll('"','\\"')}"`).join(',')})`);
}

async function selectCollectionsForCustomers(codes){
  const unique=[...new Set(codes.map(value=>clean(value,120)).filter(Boolean))];
  const rows=[];
  for(let index=0;index<unique.length;index+=80){
    const chunk=unique.slice(index,index+80);
    rows.push(...await select('daily_report_cash_movements',
      `account_code=in.${postgrestIn(chunk)}&is_customer_collection=eq.true&select=id,batch_id,source_row_no,treasury_code,treasury_name,debit,credit,account_name,account_type,account_code,description,movement_type,voucher_no,movement_date_text,payment_method,is_customer_collection,line_identity&limit=10000`
    ));
  }
  return rows;
}

async function approvedBatch(reportDate){
  return(await select('daily_report_batches',`report_date=eq.${reportDate}&status=eq.approved&select=id,report_date,file_hash,status,summary&limit=1`))?.[0]||null;
}

export function groupCustomerPayments(analysis={},fallbackDate){
  const groups=new Map();
  const ignored=[];
  const invalid=[];
  for(const row of analysis.cashMovements||analysis.collections||[]){
    if(!isCustomerReceipt(row)){
      ignored.push({row:row.row||null,accountType:clean(row.accountType,120),accountCode:paymentCustomerCode(row)});
      continue;
    }
    const sourceDate=validDate(paymentMovementDate(row));
    const assigned=assignSettlementDate([row],sourceDate||fallbackDate);
    if(!assigned.accepted.length){
      invalid.push(...assigned.quarantined);
      continue;
    }
    const payment=assigned.accepted[0];
    const reportDate=postingDateForTransaction(payment.movementDate)||payment.movementDate;
    if(!groups.has(reportDate))groups.set(reportDate,[]);
    groups.get(reportDate).push({...payment,movementDate:reportDate,reportDate});
  }
  return{
    groups:[...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([reportDate,payments])=>({reportDate,payments})),
    ignored,invalid
  };
}

async function ensureImport({hash,storagePath,originalName,summary,rowCount}){
  let imp=(await select('imports',`file_hash=eq.${hash}&select=id,status,file_path,file_hash,summary&limit=1`))?.[0]||null;
  const values={
    source:'erp-folder',department:'finance',report_type:'customer_payment_reconciliation',
    status:'ready',original_name:originalName,
    mime_type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    file_path:storagePath,file_hash:hash,row_count:rowCount,error_count:0,warning_count:0,
    summary,last_error_code:null,last_error_message:null
  };
  if(!imp)imp=(await insert('imports',[values]))?.[0];
  else imp=(await patch('imports',`id=eq.${encodeURIComponent(imp.id)}`,values))?.[0]||{...imp,...values};
  if(!imp?.id)throw Object.assign(new Error('تعذر تسجيل ملف استكمال السداد'),{status:502,code:'ERP_PAYMENT_IMPORT_REGISTER_FAILED'});
  return imp;
}

export async function previewCustomerPaymentReconciliation(analysis={},fallbackDate){
  const prepared=groupCustomerPayments(analysis,fallbackDate);
  const results=[];
  for(const group of prepared.groups){
    const batch=await approvedBatch(group.reportDate);
    if(!batch){
      results.push({reportDate:group.reportDate,status:'missing-batch',batchId:null,incoming:group.payments.length,matched:0,missing:0,conflicts:[],invalid:[],customers:[]});
      continue;
    }
    const existing=await selectCollectionsForCustomers(group.payments.map(paymentCustomerCode));
    const plan=buildCustomerPaymentCompletionPlan(existing,group.payments);
    results.push({
      reportDate:group.reportDate,status:'preview',batchId:batch.id,
      incoming:group.payments.length,matched:plan.matched.length,missing:plan.missing.length,
      missingAmount:plan.totals.missingAmount,conflicts:plan.conflicts,invalid:plan.invalid,
      customers:paymentCompletionSummaryByCustomer(plan.missing),payments:plan.missing
    });
  }
  return{prepared,results};
}

export default async function customerPaymentReconciliation(req,res){
  if(!method(req,res,['POST']))return;
  try{
    requireSyncToken(req);
    const buffer=await rawBody(req,config.maxImportFileBytes);
    if(!buffer.length)throw Object.assign(new Error('ملف السداد غير موجود في الطلب'),{status:400,code:'ERP_PAYMENT_FILE_REQUIRED'});
    if(buffer[0]!==0x50||buffer[1]!==0x4b)throw Object.assign(new Error('الملف ليس XLSX صالحًا'),{status:415,code:'ERP_SYNC_XLSX_REQUIRED'});

    const originalName=decodedFilename(req);
    const hash=sha256(buffer);
    const workbook=XLSX.read(buffer,{type:'buffer',cellDates:true});
    const analysis=parseDailyWorkbook(workbook,XLSX);
    const explicitFallback=validDate(req.headers?.['x-erp-settlement-date']);
    const fallbackDate=explicitFallback||validDate((analysis.reportDates||[]).at(-1))||resolveReportDate(req,workbook,originalName,analysis);
    const action=clean(req.headers?.['x-erp-action']??req.query?.action,20).toLowerCase()||'preview';
    if(!['preview','commit'].includes(action))throw Object.assign(new Error('إجراء استكمال السداد غير صحيح'),{status:400,code:'ERP_PAYMENT_ACTION_INVALID'});

    const preview=await previewCustomerPaymentReconciliation(analysis,fallbackDate);
    const missingBatch=preview.results.filter(row=>row.status==='missing-batch');
    if(missingBatch.length){
      throw Object.assign(new Error(`لا يوجد تقرير معتمد لتواريخ التسوية: ${missingBatch.map(row=>row.reportDate).join('، ')}`),{
        status:409,code:'ERP_PAYMENT_TARGET_BATCH_MISSING',details:missingBatch
      });
    }

    const previewTotals=preview.results.reduce((out,row)=>{
      out.incoming+=row.incoming;out.matched+=row.matched;out.missing+=row.missing;
      out.missingAmount=money(out.missingAmount+row.missingAmount);out.conflicts+=row.conflicts.length;
      return out;
    },{incoming:0,matched:0,missing:0,missingAmount:0,conflicts:0});

    if(action==='preview'){
      return json(res,200,{
        ok:true,action,committed:false,originalName,fileHash:hash,fallbackDate,
        totals:previewTotals,days:preview.results.map(row=>({...row,payments:undefined})),
        ignoredCount:preview.prepared.ignored.length,invalidCount:preview.prepared.invalid.length
      });
    }

    const storagePath=`erp-folder/customer-payment-reconciliation/${fallbackDate}/${hash.slice(0,16)}-${safeFile(originalName)}`;
    const existingImport=(await select('imports',`file_hash=eq.${hash}&select=id,file_path,status&limit=1`))?.[0]||null;
    if(!existingImport?.file_path)await uploadObject(storagePath,buffer,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const imp=await ensureImport({
      hash,storagePath:existingImport?.file_path||storagePath,originalName,rowCount:analysis.rowCount,
      summary:{source:{kind:'customer-payment-reconciliation',fallbackDate},preview:previewTotals}
    });

    const committed=[];
    for(const row of preview.results){
      const resultRaw=await rpc('append_daily_report_customer_payments',{
        p_report_date:row.reportDate,p_file_hash:hash,p_payments:row.payments,
        p_actor:'erp-customer-payment-reconciliation',p_source_name:originalName
      });
      const result=Array.isArray(resultRaw)?resultRaw[0]:resultRaw;
      committed.push({reportDate:row.reportDate,...result});
    }

    const totals=committed.reduce((out,row)=>{
      out.inserted+=Number(row.inserted||0);out.matched+=Number(row.matched||0);
      out.conflicts+=Number(row.conflictCount||0);out.insertedAmount=money(out.insertedAmount+Number(row.insertedAmount||0));
      return out;
    },{inserted:0,matched:0,conflicts:0,insertedAmount:0});
    await patch('imports',`id=eq.${encodeURIComponent(imp.id)}`,{
      status:'posted',warning_count:totals.conflicts,
      summary:{source:{kind:'customer-payment-reconciliation',fallbackDate,committedAt:new Date().toISOString()},preview:previewTotals,commit:totals,days:committed},
      last_error_code:null,last_error_message:null
    });

    return json(res,200,{
      ok:true,action,committed:true,originalName,fileHash:hash,importId:imp.id,
      fallbackDate,totals,days:committed,
      ignoredCount:preview.prepared.ignored.length,invalidCount:preview.prepared.invalid.length,
      partial:totals.conflicts>0
    });
  }catch(error){
    errorResponse(res,error);
  }
}
