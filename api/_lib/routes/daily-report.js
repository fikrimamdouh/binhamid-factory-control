import crypto from 'node:crypto';
import { body, errorResponse, json, method } from '../http.js';
import { config } from '../config.js';
import { requireCapability } from '../permissions.js';
import { downloadObject, insert, rpc, select, uploadObject } from '../supabase.js';
import { buildDailyReportCustomerContext } from '../daily-report-customers.js';

const clean=(value,max=1000)=>String(value??'').trim().slice(0,max);
const num=value=>{const parsed=Number(value);return Number.isFinite(parsed)?parsed:null;};
const money=value=>Math.round((Number(value||0)+Number.EPSILON)*100)/100;
const qty=value=>Math.round((Number(value||0)+Number.EPSILON)*1000)/1000;
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const date=value=>{const text=clean(value,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||Number.isNaN(new Date(`${text}T12:00:00Z`).getTime()))throw Object.assign(new Error('تاريخ التقرير غير صحيح'),{status:400});return text;};
function params(req){return new URL(req.url||'/api/router',`https://${String(req.headers.host||'localhost')}`).searchParams;}
function stable(value){if(Array.isArray(value))return`[${value.map(stable).join(',')}]`;if(value&&typeof value==='object')return`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;return JSON.stringify(value);}
function saleIdentity(row){return sha([row.invoiceNo,row.customerCode,row.salesType,qty(row.quantity),money(row.amount)].join('|'));}
function cashIdentity(row){return sha([row.treasuryCode,row.accountCode,row.voucherNo,row.movementType,money(row.debit),money(row.credit),row.movementDate].join('|'));}
function ensureArray(value,name,max){if(!Array.isArray(value))throw Object.assign(new Error(`${name} يجب أن يكون قائمة`),{status:400});if(value.length>max)throw Object.assign(new Error(`${name} يتجاوز الحد المسموح`),{status:413});return value;}
function optionalBase64(value){
  const encoded=String(value??'').trim();
  if(!encoded)return'';
  const maxEncoded=Math.ceil(config.maxImportFileBytes*4/3)+16;
  if(encoded.length>maxEncoded)throw Object.assign(new Error('حجم ملف التقرير يتجاوز الحد المسموح'),{status:413});
  if(!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)||encoded.length%4===1)throw Object.assign(new Error('ترميز ملف التقرير غير صحيح'),{status:400});
  return encoded;
}
function one(value){return Array.isArray(value)?value[0]:value;}

function normalizePayload(raw={}){
  const sales=ensureArray(raw.sales||[],'سطور المبيعات',10000).map((row,index)=>({sourceRowNo:Number.isInteger(Number(row.sourceRowNo))?Number(row.sourceRowNo):index+1,invoiceNo:clean(row.invoiceNo??row.invoice,120),salesType:clean(row.salesType,20),customerCode:clean(row.customerCode,120),customerName:clean(row.customerName??row.customer,500),item:clean(row.item,500),quantity:qty(row.quantity),unit:clean(row.unit,50)||null,amount:money(row.amount),paymentTerms:clean(row.paymentTerms,100)||null,issues:Array.isArray(row.issues)?row.issues.slice(0,20):[]}));
  const cashMovements=ensureArray(raw.cashMovements||raw.collections||[],'حركات الخزينة',10000).map((row,index)=>({sourceRowNo:Number.isInteger(Number(row.sourceRowNo))?Number(row.sourceRowNo):index+1,treasuryCode:clean(row.treasuryCode,20),treasuryName:clean(row.treasuryName,200)||null,debit:money(row.debit??(row.isCustomerCollection?row.amount:0)),credit:money(row.credit),accountName:clean(row.accountName??row.customer,500),accountType:clean(row.accountType,120)||null,accountCode:clean(row.accountCode??row.customerCode,120),description:clean(row.description??row.notes,1000)||null,movementType:clean(row.movementType??row.type,120)||null,voucherNo:clean(row.voucherNo??row.receipt,120)||null,movementDate:clean(row.movementDate??row.date,80)||null,paymentMethod:clean(row.paymentMethod??row.method,100)||null,isCustomerCollection:Boolean(row.isCustomerCollection??row.customerCode)}));
  const treasuries=ensureArray(raw.treasuries||[],'أرصدة الخزائن',100).map(row=>({treasuryCode:clean(row.treasuryCode,20),treasuryName:clean(row.treasuryName,200)||null,opening:money(row.opening),closing:money(row.closing)}));
  const inventory=ensureArray(raw.inventory||[],'حركات المخزون',20000).map((row,index)=>({sourceRowNo:Number.isInteger(Number(row.sourceRowNo))?Number(row.sourceRowNo):index+1,inventoryType:['finished_goods','raw_material'].includes(clean(row.inventoryType,30))?clean(row.inventoryType,30):'raw_material',itemCode:clean(row.itemCode??row.code,120),itemName:clean(row.itemName??row.item,500),unit:clean(row.unit,50)||null,opening:qty(row.opening),received:qty(row.received),issued:qty(row.issued),closing:qty(row.closing)}));
  return{sales,cashMovements,treasuries,inventory,summary:raw.summary&&typeof raw.summary==='object'?raw.summary:{}};
}

async function databaseDuplicates(payload){
  const saleIds=[...new Set(payload.sales.map(saleIdentity))],cashIds=[...new Set(payload.cashMovements.map(cashIdentity))],sales=[],cash=[];
  for(let i=0;i<saleIds.length;i+=100){const part=saleIds.slice(i,i+100);if(part.length)sales.push(...await select('daily_report_sales_lines',`line_identity=in.(${part.join(',')})&select=id,batch_id,invoice_no,customer_code,amount,line_identity&limit=1000`).catch(()=>[]));}
  for(let i=0;i<cashIds.length;i+=100){const part=cashIds.slice(i,i+100);if(part.length)cash.push(...await select('daily_report_cash_movements',`line_identity=in.(${part.join(',')})&select=id,batch_id,treasury_code,account_code,voucher_no,line_identity&limit=1000`).catch(()=>[]));}
  return{sales,cash};
}

async function validatePayload(reportDate,payload){
  const customers=await select('customers','select=id,external_id,customer_code,customer_name,credit_limit,payment_days,active&limit=10000').catch(()=>[]),customerContext=buildDailyReportCustomerContext(payload,customers),errors=[...customerContext.errors],warnings=[...customerContext.warnings],customerMap=customerContext.customerMap;
  const localSales=new Set(),localCash=new Set();
  payload.sales.forEach((row,index)=>{
    const prefix=`sales[${index}]`;
    if(!row.invoiceNo)errors.push({code:'INVOICE_REQUIRED',path:prefix,message:'رقم الفاتورة مطلوب'});
    if(!['block','concrete'].includes(row.salesType))errors.push({code:'SALES_TYPE_INVALID',path:prefix,message:'نوع البيع يجب أن يكون block أو concrete'});
    if(!row.customerCode)errors.push({code:'CUSTOMER_CODE_REQUIRED',path:prefix,message:'كود العميل مطلوب'});
    if(row.customerCode&&!customerMap.has(row.customerCode)&&!errors.some(error=>error.path===`customer:${row.customerCode}`))errors.push({code:'UNKNOWN_CUSTOMER',path:prefix,message:`تعذر تجهيز كود العميل: ${row.customerCode}`});
    if(!row.customerName||!row.item)errors.push({code:'SALE_TEXT_REQUIRED',path:prefix,message:'اسم العميل والصنف مطلوبان'});
    if(!(row.quantity>0))errors.push({code:'QUANTITY_INVALID',path:prefix,message:'الكمية يجب أن تكون أكبر من صفر'});
    if(!(row.amount>0))errors.push({code:'AMOUNT_INVALID',path:prefix,message:'المبلغ يجب أن يكون أكبر من صفر'});
    const identity=saleIdentity(row);if(localSales.has(identity))errors.push({code:'DUPLICATE_SALE_IN_FILE',path:prefix,message:'سطر مبيعات مكرر داخل الملف'});localSales.add(identity);
  });
  const openOrders=await select('sales_orders','status=not.in.(cancelled,rejected,collected)&select=customer_external_id,total_amount,paid_amount&limit=20000').catch(()=>[]),outstanding=new Map();
  for(const order of openOrders){const key=clean(order.customer_external_id,120);outstanding.set(key,(outstanding.get(key)||0)+Math.max(0,Number(order.total_amount||0)-Number(order.paid_amount||0)));}
  const collectionsByCustomer=new Map();
  payload.cashMovements.forEach((row,index)=>{
    const prefix=`cashMovements[${index}]`;
    if(row.debit<0||row.credit<0)errors.push({code:'NEGATIVE_CASH_VALUE',path:prefix,message:'لا يسمح بقيمة خزينة سالبة'});
    if(row.isCustomerCollection){
      if(!['101','104'].includes(row.treasuryCode))errors.push({code:'COLLECTION_TREASURY_INVALID',path:prefix,message:'تحصيل العميل يجب أن يكون في الخزينة 101 أو 104'});
      if(!row.accountCode)errors.push({code:'COLLECTION_CUSTOMER_REQUIRED',path:prefix,message:'كود عميل التحصيل مطلوب'});
      if(row.accountCode&&!customerMap.has(row.accountCode)&&!errors.some(error=>error.path===`customer:${row.accountCode}`))errors.push({code:'UNKNOWN_COLLECTION_CUSTOMER',path:prefix,message:`تعذر تجهيز عميل التحصيل: ${row.accountCode}`});
      if(!(row.debit>0)||row.credit>0)errors.push({code:'COLLECTION_VALUE_INVALID',path:prefix,message:'تحصيل العميل يجب أن يكون مدينًا بقيمة موجبة'});
      if(row.accountCode)collectionsByCustomer.set(row.accountCode,(collectionsByCustomer.get(row.accountCode)||0)+row.debit);
    }
    const identity=cashIdentity(row);if(localCash.has(identity))errors.push({code:'DUPLICATE_CASH_IN_FILE',path:prefix,message:'حركة خزينة مكررة داخل الملف'});localCash.add(identity);
  });
  for(const [customerCode,collected] of collectionsByCustomer){const available=(outstanding.get(customerCode)||0)+payload.sales.filter(row=>row.customerCode===customerCode).reduce((sum,row)=>sum+row.amount,0);if(collected>available+0.01)errors.push({code:'COLLECTION_EXCEEDS_BALANCE',path:`customer:${customerCode}`,message:`التحصيل ${collected} أكبر من المديونية المتاحة ${money(available)}`});}
  payload.inventory.forEach((row,index)=>{if(!row.itemCode||!row.itemName)errors.push({code:'INVENTORY_ITEM_REQUIRED',path:`inventory[${index}]`,message:'كود واسم صنف المخزون مطلوبان'});for(const field of ['opening','received','issued','closing'])if(row[field]<0)errors.push({code:'NEGATIVE_INVENTORY',path:`inventory[${index}].${field}`,message:'كمية المخزون لا يمكن أن تكون سالبة'});});
  const database=await databaseDuplicates(payload);for(const row of database.sales)errors.push({code:'DUPLICATE_INVOICE',path:`invoice:${row.invoice_no}`,message:`الفاتورة ${row.invoice_no} مرحّلة سابقًا`,existingBatchId:row.batch_id});for(const row of database.cash)errors.push({code:'DUPLICATE_CASH_MOVEMENT',path:`voucher:${row.voucher_no||row.id}`,message:'حركة الخزينة مرحّلة سابقًا',existingBatchId:row.batch_id});
  const salesTotal=money(payload.sales.reduce((sum,row)=>sum+row.amount,0)),collectionTotal=money(payload.cashMovements.filter(row=>row.isCustomerCollection).reduce((sum,row)=>sum+row.debit,0)),declared=num(payload.summary.totalDebt??payload.summary.totalSales),reconciliationDifference=declared===null?0:money(declared-salesTotal),treasury101=money(payload.cashMovements.filter(row=>row.isCustomerCollection&&row.treasuryCode==='101').reduce((sum,row)=>sum+row.debit,0)),treasury104=money(payload.cashMovements.filter(row=>row.isCustomerCollection&&row.treasuryCode==='104').reduce((sum,row)=>sum+row.debit,0));
  if(declared!==null&&Math.abs(reconciliationDifference)>0.01)errors.push({code:'RECONCILIATION_DIFFERENCE',path:'summary',message:`إجمالي الملف لا يساوي السطور. الفرق ${reconciliationDifference}`});
  const preview={reportDate,invoiceCount:payload.sales.length,salesTotal,blockSales:money(payload.sales.filter(row=>row.salesType==='block').reduce((sum,row)=>sum+row.amount,0)),concreteSales:money(payload.sales.filter(row=>row.salesType==='concrete').reduce((sum,row)=>sum+row.amount,0)),blockQuantity:qty(payload.sales.filter(row=>row.salesType==='block').reduce((sum,row)=>sum+row.quantity,0)),concreteQuantity:qty(payload.sales.filter(row=>row.salesType==='concrete').reduce((sum,row)=>sum+row.quantity,0)),collectionCount:payload.cashMovements.filter(row=>row.isCustomerCollection).length,collectionTotal,treasury101,treasury104,inventoryRows:payload.inventory.length,pendingCustomerCount:customerContext.pendingCustomers.length,reconciliationDifference,errorCount:errors.length,warningCount:warnings.length};
  return{errors,warnings,preview,pendingCustomers:customerContext.pendingCustomers.map(customer=>({customerCode:customer.customer_code,customerName:customer.customer_name}))};
}

async function storeUploadedOriginal(input,reportDate,fileHash){
  const encoded=optionalBase64(input.fileBase64);if(!encoded)throw Object.assign(new Error('النسخة الأصلية من ملف Excel مطلوبة قبل الاعتماد.'),{status:422,code:'ORIGINAL_FILE_REQUIRED'});
  const buffer=Buffer.from(encoded,'base64');if(!buffer.length||buffer.length>config.maxImportFileBytes)throw Object.assign(new Error('حجم ملف التقرير يتجاوز الحد المسموح'),{status:413});
  if(buffer[0]!==0x50||buffer[1]!==0x4b)throw Object.assign(new Error('ملف التقرير ليس XLSX صالحًا'),{status:415});
  const name=clean(input.originalName,240).replace(/[^\p{L}\p{N}_. -]/gu,'-')||'daily-report.xlsx',path=`daily-reports/${reportDate}/${fileHash}-${name}`;await uploadObject(path,buffer,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');return{path,importRow:null};
}

async function resolveStoredOriginal(input,reportDate,fileHash){
  const importId=clean(input.importId,100);
  if(!importId)return storeUploadedOriginal(input,reportDate,fileHash);
  const row=(await select('imports',`id=eq.${encodeURIComponent(importId)}&select=id,file_hash,file_path,original_name,status,source_chat_id,report_type&limit=1`))?.[0];
  if(!row?.file_path)throw Object.assign(new Error('النسخة الأصلية المرتبطة بعملية الاستيراد غير موجودة.'),{status:422,code:'ORIGINAL_FILE_REQUIRED'});
  if(row.file_hash&&fileHash&&String(row.file_hash)!==String(fileHash))throw Object.assign(new Error('بصمة الملف لا تطابق عملية الاستيراد.'),{status:409,code:'IMPORT_FILE_HASH_MISMATCH'});
  await downloadObject(row.file_path);
  return{path:row.file_path,importRow:row};
}

async function registerAttempt(values){try{const result=await rpc('register_daily_report_attempt',values);return one(result);}catch{return null;}}
async function transitionImport(importId,status,actor,note='',postedBatchId=null,result={}){if(!importId)return null;return one(await rpc('transition_import_status',{p_import_id:importId,p_next_status:status,p_actor:actor,p_note:note||null,p_posted_batch_id:postedBatchId,p_result:result}));}
async function accountingEvidence(batchId){
  const entries=await select('journal_entries',`source_batch_id=eq.${encodeURIComponent(batchId)}&select=id,reference_no,status,journal_entry_lines(debit,credit)&order=reference_no.asc&limit=20000`),summary=(entries||[]).reduce((out,entry)=>{out.entryCount++;for(const line of entry.journal_entry_lines||[]){out.totalDebit+=Number(line.debit||0);out.totalCredit+=Number(line.credit||0);}if(entry.status!=='posted')out.unposted++;return out;},{entryCount:0,totalDebit:0,totalCredit:0,unposted:0});
  summary.totalDebit=money(summary.totalDebit);summary.totalCredit=money(summary.totalCredit);summary.balanced=summary.unposted===0&&summary.entryCount>0&&summary.totalDebit===summary.totalCredit;return summary;
}

async function previewOrCommit(req,res,input){
  const action=clean(input.action,30)||'preview',identity=await requireCapability(req,action==='commit'?'daily_report.approve':'daily_report.import'),actor=identity.appUserId||identity.actor,reportDate=date(input.reportDate),originalName=clean(input.originalName,240)||'daily-report.xlsx',payload=normalizePayload(input.payload||{}),contentHash=clean(input.contentHash,64)||sha(stable(payload)),fileHash=clean(input.fileHash,64)||contentHash,idempotencyKey=clean(input.idempotencyKey,200)||`daily:${reportDate}:${fileHash}`,importId=clean(input.importId,100);
  const existing=(await select('daily_report_batches',`report_date=eq.${reportDate}&select=id,report_date,file_hash,content_hash,status,summary,committed_at&limit=1`))?.[0]||null;
  if(existing){const duplicate=existing.content_hash===contentHash||existing.file_hash===fileHash;await registerAttempt({p_report_date:reportDate,p_original_name:originalName,p_file_hash:fileHash,p_content_hash:contentHash,p_idempotency_key:idempotencyKey,p_status:duplicate?'duplicate':'rejected',p_existing_batch_id:existing.id,p_summary:existing.summary||{},p_errors:duplicate?[]:[{code:'DATE_ALREADY_COMMITTED'}],p_warnings:[],p_actor:actor});if(importId&&duplicate)await transitionImport(importId,'posted',actor,'نفس التقرير مرحّل سابقًا',existing.id,{duplicate:true}).catch(()=>{});return json(res,duplicate?200:409,{ok:duplicate,duplicate,reason:duplicate?'نفس التقرير معتمد سابقًا':'يوجد تقرير مختلف معتمد لنفس التاريخ',existingImportId:existing.id,status:existing.status,committedAt:existing.committed_at,accounting:duplicate?await accountingEvidence(existing.id):null});}
  if(importId)await transitionImport(importId,'validating',actor,'بدء التحقق من التقرير').catch(error=>{if(!/TRANSITION_INVALID/i.test(String(error?.message||'')))throw error;});
  const validation=await validatePayload(reportDate,payload),attemptStatus=validation.errors.length?'rejected':'previewed';
  if(action==='preview'||validation.errors.length){
    await registerAttempt({p_report_date:reportDate,p_original_name:originalName,p_file_hash:fileHash,p_content_hash:contentHash,p_idempotency_key:idempotencyKey,p_status:attemptStatus,p_existing_batch_id:null,p_summary:validation.preview,p_errors:validation.errors,p_warnings:validation.warnings,p_actor:actor});
    if(importId)await transitionImport(importId,validation.errors.length?'validation_failed':'ready_for_review',actor,validation.errors.length?'فشل تحقق الملف':'اكتمل التحقق والملف جاهز للمراجعة',null,{preview:validation.preview,errors:validation.errors.slice(0,100),warnings:validation.warnings.slice(0,100)}).catch(()=>{});
    if(validation.errors.length)await insert('audit_log',[{actor_type:'web',actor_id:actor,action:'daily_report_rejected',entity_type:'daily_report',entity_id:idempotencyKey,details:{report_date:reportDate,file_hash:fileHash,error_count:validation.errors.length,warning_count:validation.warnings.length,errors:validation.errors.slice(0,50)}}],{prefer:'return=minimal'}).catch(()=>{});
    return json(res,validation.errors.length?422:200,{ok:validation.errors.length===0,duplicate:false,valid:validation.errors.length===0,contentHash,fileHash,idempotencyKey,importId:importId||null,...validation});
  }
  const original=await resolveStoredOriginal(input,reportDate,fileHash);
  try{
    const resultRaw=await rpc('commit_daily_report_acceptance',{p_report_date:reportDate,p_original_name:originalName,p_file_hash:fileHash,p_content_hash:contentHash,p_payload:{...payload,summary:{...payload.summary,...validation.preview}},p_actor:actor,p_file_storage_path:original.path,p_preview_summary:validation.preview,p_validation_warnings:validation.warnings,p_idempotency_key:idempotencyKey,p_import_id:importId||null}),result=one(resultRaw),accounting=result?.accounting||{entryCount:0,totalDebit:0,totalCredit:0,balanced:false};
    return json(res,200,{ok:true,duplicate:Boolean(result?.duplicate),existingImportId:result?.duplicate?result.id:null,importId:result?.id,status:result?.status||'approved',storagePath:original.path,sourceImportId:importId||null,postedBatchId:result?.id||null,accounting,...validation,result});
  }catch(error){
    if(importId)await transitionImport(importId,'failed',actor,'فشل الترحيل ولم يُسجل اعتماد جزئي',null,{errorCode:String(error?.code||'POSTING_FAILED'),errorMessage:String(error?.message||'').slice(0,1000)}).catch(()=>{});
    throw error;
  }
}

export async function dailyReport(req,res){
  if(!method(req,res,['GET','POST']))return;
  try{
    if(req.method==='GET'){
      await requireCapability(req,'daily_report.view');const p=params(req),reportDate=clean(p.get('date'),10),query=reportDate?`report_date=eq.${date(reportDate)}&select=*&limit=1`:'select=*&order=report_date.desc&limit=60',batches=await select('daily_report_batches',query);return json(res,200,{ok:true,batches:batches||[]});
    }
    const input=await body(req,Math.ceil(config.maxImportFileBytes*1.5)+1_000_000);return await previewOrCommit(req,res,input);
  }catch(error){errorResponse(res,error);}
}
