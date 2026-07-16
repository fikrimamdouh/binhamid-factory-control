import crypto from 'node:crypto';
import { body, errorResponse, json, method } from '../http.js';
import { config } from '../config.js';
import { requireCapability } from '../permissions.js';
import { insert, patch, rpc, select, uploadObject } from '../supabase.js';

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
  const errors=[],warnings=[],customers=await select('customers','active=eq.true&select=external_id,customer_code,customer_name,credit_limit,payment_days&limit=10000').catch(()=>[]),customerMap=new Map();
  for(const customer of customers)for(const key of [customer.external_id,customer.customer_code].filter(Boolean))customerMap.set(String(key),customer);
  const localSales=new Set(),localCash=new Set();
  payload.sales.forEach((row,index)=>{
    const prefix=`sales[${index}]`;
    if(!row.invoiceNo)errors.push({code:'INVOICE_REQUIRED',path:prefix,message:'رقم الفاتورة مطلوب'});
    if(!['block','concrete'].includes(row.salesType))errors.push({code:'SALES_TYPE_INVALID',path:prefix,message:'نوع البيع يجب أن يكون block أو concrete'});
    if(!row.customerCode)errors.push({code:'CUSTOMER_CODE_REQUIRED',path:prefix,message:'كود العميل مطلوب'});
    const customer=customerMap.get(row.customerCode);if(row.customerCode&&!customer)errors.push({code:'UNKNOWN_CUSTOMER',path:prefix,message:`كود العميل غير موجود: ${row.customerCode}`});
    if(customer&&row.customerName&&clean(customer.customer_name,500)!==row.customerName)warnings.push({code:'CUSTOMER_NAME_MISMATCH',path:prefix,message:`اسم العميل لا يطابق الكود ${row.customerCode}`,expected:customer.customer_name,actual:row.customerName});
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
      if(row.accountCode&&!customerMap.has(row.accountCode))errors.push({code:'UNKNOWN_COLLECTION_CUSTOMER',path:prefix,message:`عميل التحصيل غير موجود: ${row.accountCode}`});
      if(!(row.debit>0)||row.credit>0)errors.push({code:'COLLECTION_VALUE_INVALID',path:prefix,message:'تحصيل العميل يجب أن يكون مدينًا بقيمة موجبة'});
      collectionsByCustomer.set(row.accountCode,(collectionsByCustomer.get(row.accountCode)||0)+row.debit);
    }
    const identity=cashIdentity(row);if(localCash.has(identity))errors.push({code:'DUPLICATE_CASH_IN_FILE',path:prefix,message:'حركة خزينة مكررة داخل الملف'});localCash.add(identity);
  });
  for(const [customerCode,collected] of collectionsByCustomer){const available=(outstanding.get(customerCode)||0)+payload.sales.filter(row=>row.customerCode===customerCode).reduce((sum,row)=>sum+row.amount,0);if(collected>available+0.01)errors.push({code:'COLLECTION_EXCEEDS_BALANCE',path:`customer:${customerCode}`,message:`التحصيل ${collected} أكبر من المديونية المتاحة ${money(available)}`});}
  payload.inventory.forEach((row,index)=>{if(!row.itemCode||!row.itemName)errors.push({code:'INVENTORY_ITEM_REQUIRED',path:`inventory[${index}]`,message:'كود واسم صنف المخزون مطلوبان'});for(const field of ['opening','received','issued','closing'])if(row[field]<0)errors.push({code:'NEGATIVE_INVENTORY',path:`inventory[${index}].${field}`,message:'كمية المخزون لا يمكن أن تكون سالبة'});});
  const database=await databaseDuplicates(payload);for(const row of database.sales)errors.push({code:'DUPLICATE_INVOICE',path:`invoice:${row.invoice_no}`,message:`الفاتورة ${row.invoice_no} مرحّلة سابقًا`,existingBatchId:row.batch_id});for(const row of database.cash)errors.push({code:'DUPLICATE_CASH_MOVEMENT',path:`voucher:${row.voucher_no||row.id}`,message:'حركة الخزينة مرحّلة سابقًا',existingBatchId:row.batch_id});
  const salesTotal=money(payload.sales.reduce((sum,row)=>sum+row.amount,0)),collectionTotal=money(payload.cashMovements.filter(row=>row.isCustomerCollection).reduce((sum,row)=>sum+row.debit,0)),declared=num(payload.summary.totalDebt??payload.summary.totalSales),reconciliationDifference=declared===null?0:money(declared-salesTotal),treasury101=money(payload.cashMovements.filter(row=>row.isCustomerCollection&&row.treasuryCode==='101').reduce((sum,row)=>sum+row.debit,0)),treasury104=money(payload.cashMovements.filter(row=>row.isCustomerCollection&&row.treasuryCode==='104').reduce((sum,row)=>sum+row.debit,0));
  if(declared!==null&&Math.abs(reconciliationDifference)>0.01)errors.push({code:'RECONCILIATION_DIFFERENCE',path:'summary',message:`إجمالي الملف لا يساوي السطور. الفرق ${reconciliationDifference}`});
  const preview={reportDate,invoiceCount:payload.sales.length,salesTotal,blockSales:money(payload.sales.filter(row=>row.salesType==='block').reduce((sum,row)=>sum+row.amount,0)),concreteSales:money(payload.sales.filter(row=>row.salesType==='concrete').reduce((sum,row)=>sum+row.amount,0)),blockQuantity:qty(payload.sales.filter(row=>row.salesType==='block').reduce((sum,row)=>sum+row.quantity,0)),concreteQuantity:qty(payload.sales.filter(row=>row.salesType==='concrete').reduce((sum,row)=>sum+row.quantity,0)),collectionCount:payload.cashMovements.filter(row=>row.isCustomerCollection).length,collectionTotal,treasury101,treasury104,inventoryRows:payload.inventory.length,reconciliationDifference,errorCount:errors.length,warningCount:warnings.length};
  return{errors,warnings,preview};
}

async function storeOriginal(input,reportDate,fileHash){
  const encoded=clean(input.fileBase64,Math.ceil(config.maxImportFileBytes*1.4)+100);if(!encoded)return null;
  const buffer=Buffer.from(encoded,'base64');if(!buffer.length||buffer.length>config.maxImportFileBytes)throw Object.assign(new Error('حجم ملف التقرير يتجاوز الحد المسموح'),{status:413});
  if(buffer[0]!==0x50||buffer[1]!==0x4b)throw Object.assign(new Error('ملف التقرير ليس XLSX صالحًا'),{status:415});
  const name=clean(input.originalName,240).replace(/[^\p{L}\p{N}_. -]/gu,'-')||'daily-report.xlsx',path=`daily-reports/${reportDate}/${fileHash}-${name}`;await uploadObject(path,buffer,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');return path;
}
async function registerAttempt(values){try{const result=await rpc('register_daily_report_attempt',values);return Array.isArray(result)?result[0]:result;}catch{return null;}}

async function previewOrCommit(req,res,input){
  const action=clean(input.action,30)||'preview',identity=await requireCapability(req,action==='commit'?'daily_report.approve':'daily_report.import'),actor=identity.appUserId||identity.actor,reportDate=date(input.reportDate),originalName=clean(input.originalName,240)||'daily-report.xlsx',payload=normalizePayload(input.payload||{}),contentHash=clean(input.contentHash,64)||sha(stable(payload)),providedFile=clean(input.fileBase64,Math.ceil(config.maxImportFileBytes*1.4)+100),fileHash=clean(input.fileHash,64)||(providedFile?sha(Buffer.from(providedFile,'base64')):contentHash),idempotencyKey=clean(input.idempotencyKey,200)||sha(`${reportDate}|${contentHash}`);
  const existing=(await select('daily_report_batches',`report_date=eq.${reportDate}&select=id,report_date,file_hash,content_hash,status,summary,committed_at&limit=1`))?.[0]||null;
  if(existing){const duplicate=existing.content_hash===contentHash||existing.file_hash===fileHash;await registerAttempt({p_report_date:reportDate,p_original_name:originalName,p_file_hash:fileHash,p_content_hash:contentHash,p_idempotency_key:idempotencyKey,p_status:duplicate?'duplicate':'rejected',p_existing_batch_id:existing.id,p_summary:existing.summary||{},p_errors:duplicate?[]:[{code:'DATE_ALREADY_COMMITTED'}],p_warnings:[],p_actor:actor});return json(res,duplicate?200:409,{ok:duplicate,duplicate,reason:duplicate?'نفس التقرير معتمد سابقًا':'يوجد تقرير مختلف معتمد لنفس التاريخ',existingImportId:existing.id,status:existing.status,committedAt:existing.committed_at});}
  const validation=await validatePayload(reportDate,payload),attemptStatus=validation.errors.length?'rejected':'previewed';
  if(action==='preview'||validation.errors.length){await registerAttempt({p_report_date:reportDate,p_original_name:originalName,p_file_hash:fileHash,p_content_hash:contentHash,p_idempotency_key:idempotencyKey,p_status:attemptStatus,p_existing_batch_id:null,p_summary:validation.preview,p_errors:validation.errors,p_warnings:validation.warnings,p_actor:actor});if(validation.errors.length)await insert('audit_log',[{actor_type:'web',actor_id:actor,action:'daily_report_rejected',entity_type:'daily_report',entity_id:idempotencyKey,details:{report_date:reportDate,file_hash:fileHash,error_count:validation.errors.length,warning_count:validation.warnings.length,errors:validation.errors.slice(0,50)}}],{prefer:'return=minimal'}).catch(()=>{});return json(res,validation.errors.length?422:200,{ok:validation.errors.length===0,duplicate:false,valid:validation.errors.length===0,contentHash,fileHash,idempotencyKey,...validation});}
  const storagePath=await storeOriginal(input,reportDate,fileHash),resultRaw=await rpc('commit_daily_report',{p_report_date:reportDate,p_original_name:originalName,p_file_hash:fileHash,p_content_hash:contentHash,p_payload:{...payload,summary:{...payload.summary,...validation.preview}},p_actor:actor}),result=Array.isArray(resultRaw)?resultRaw[0]:resultRaw;
  if(result?.id)await patch('daily_report_batches',`id=eq.${encodeURIComponent(result.id)}`,{file_storage_path:storagePath,uploaded_by:actor,approved_by:actor,approved_at:new Date().toISOString(),preview_summary:validation.preview,validation_errors:[],validation_warnings:validation.warnings});
  await registerAttempt({p_report_date:reportDate,p_original_name:originalName,p_file_hash:fileHash,p_content_hash:contentHash,p_idempotency_key:idempotencyKey,p_status:result?.duplicate?'duplicate':'approved',p_existing_batch_id:result?.id||null,p_summary:validation.preview,p_errors:[],p_warnings:validation.warnings,p_actor:actor});
  return json(res,200,{ok:true,duplicate:Boolean(result?.duplicate),existingImportId:result?.duplicate?result.id:null,importId:result?.id,status:result?.status||'approved',storagePath,...validation,result});
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
