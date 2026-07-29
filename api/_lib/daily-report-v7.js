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
import { prepareErpSuccessDelivery,sendErpDuplicateNotice,sendErpSuccessDelivery } from './erp-telegram-delivery.js';

const TOKEN_SHA='b4ba6180ffc5d0ce658168f76b3362b69b7e930b998e8304fa6afe68da8289a0';
const ROW_ANCHOR='__ERP_ROW_ANCHOR__';
const clean=(value,max=1000)=>String(value??'').trim().slice(0,max);
const label=value=>clean(value,300).toLowerCase().replace(/[أإآٱ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ً-ْـ]/g,'').replace(/\s+/g,' ');
const round=value=>Math.round((Number(value||0)+Number.EPSILON)*100)/100;
const dateOf=row=>clean(row?.movementDate??row?.movement_date_text??row?.reportDate,10);
const customer=row=>clean(row?.accountCode??row?.account_code??row?.customerCode??row?.customer_code,120);
const voucher=row=>clean(row?.voucherNo??row?.voucher_no??row?.receipt,120);
const debit=row=>round(row?.debit??row?.amount);
const credit=row=>round(row?.credit);
const collection=row=>Boolean(row?.isCustomerCollection??row?.is_customer_collection);
const direction=row=>debit(row)>0&&credit(row)===0?'D':credit(row)>0&&debit(row)===0?'C':'M';
const exactRef=row=>voucher(row)?[customer(row),voucher(row),direction(row)].join('|'):[customer(row),direction(row),debit(row),credit(row),clean(row?.movementType??row?.movement_type,120),clean(row?.description,300)].join('|');
const oldKey=row=>[dateOf(row),customer(row),debit(row),credit(row)].join('|');

function auth(req){
  const supplied=clean(req.headers?.['x-erp-sync-token'],300);
  const digest=crypto.createHash('sha256').update(supplied).digest('hex');
  const a=Buffer.from(digest),b=Buffer.from(TOKEN_SHA);
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b))throw Object.assign(new Error('ERP sync authentication failed'),{status:401,code:'ERP_SYNC_AUTH_REQUIRED'});
}
async function body(req){
  if(Buffer.isBuffer(req.body))return req.body;
  if(req.body instanceof Uint8Array)return Buffer.from(req.body);
  if(typeof req.body==='string')return Buffer.from(req.body,'binary');
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>config.maxImportFileBytes)throw Object.assign(new Error('ERP file is too large'),{status:413,code:'ERP_SYNC_FILE_TOO_LARGE'});chunks.push(chunk);}
  return Buffer.concat(chunks);
}
function filename(req){
  const encoded=clean(req.headers?.['x-erp-filename-b64'],1000);
  if(encoded){try{const value=Buffer.from(encoded,'base64').toString('utf8');if(value)return clean(value,240);}catch{}}
  return clean(req.headers?.['x-erp-filename'],240)||'daily-report.xlsx';
}
function capture(){return{statusCode:200,headers:{},body:'',setHeader(name,value){this.headers[String(name).toLowerCase()]=value;},end(value=''){this.body=Buffer.isBuffer(value)?value.toString('utf8'):String(value??'');}};}
function forward(res,out){res.statusCode=out.statusCode||200;for(const [name,value] of Object.entries(out.headers||{}))res.setHeader(name,value);res.end(out.body||'');}

export function anchorBlankRows(workbook){
  for(const sheetName of workbook?.SheetNames||[]){
    const sheet=workbook.Sheets[sheetName];
    if(!sheet?.['!ref'])continue;
    const range=XLSX.utils.decode_range(sheet['!ref']);
    for(let row=range.s.r;row<=range.e.r;row++){
      let populated=false;
      for(let col=range.s.c;col<=range.e.c;col++){
        const cell=sheet[XLSX.utils.encode_cell({r:row,c:col})];
        if(cell&&cell.v!==null&&cell.v!==undefined&&String(cell.v).trim()!==''){populated=true;break;}
      }
      if(!populated)sheet[XLSX.utils.encode_cell({r:row,c:range.s.c})]={t:'s',v:ROW_ANCHOR};
    }
  }
  return workbook;
}

export function planSingleDayRepair(analysis={},reportDate){
  const cash=(analysis.cashMovements||[]).map(row=>dateOf(row)?row:{...row,movementDate:reportDate,reportDate});
  const refs=new Map(),old=new Map(),kept=[],appendRows=[],removeRows=[],duplicates=[],conflicts=[];
  for(const row of cash){
    if(!collection(row)){kept.push(row);continue;}
    const ref=exactRef(row),prior=refs.get(ref);
    if(prior){
      if(debit(prior)!==debit(row)||credit(prior)!==credit(row))conflicts.push({customerCode:customer(row),voucherNo:voucher(row),existingAmount:Math.max(debit(prior),credit(prior)),incomingAmount:Math.max(debit(row),credit(row)),reason:'same customer voucher has different amounts'});
      else{duplicates.push(row);removeRows.push(row);}
      continue;
    }
    refs.set(ref,row);
    const legacy=oldKey(row),priorLegacy=old.get(legacy);
    if(priorLegacy&&voucher(priorLegacy)!==voucher(row)){appendRows.push(row);removeRows.push(row);kept.push(row);continue;}
    old.set(legacy,row);kept.push(row);
  }
  const normalized={...analysis,cashMovements:kept,collections:kept.filter(collection),reportDates:[...new Set([...(analysis.reportDates||[]),reportDate])].filter(Boolean).sort()};
  normalized.summary={...(analysis.summary||{}),collectionCount:normalized.collections.length,collectionTotal:round(normalized.collections.reduce((sum,row)=>sum+debit(row),0)),cashMovementCount:kept.length,cashDebitTotal:round(kept.reduce((sum,row)=>sum+debit(row),0)),cashCreditTotal:round(kept.reduce((sum,row)=>sum+credit(row),0))};
  normalized.rowCount=(analysis.sales||[]).length+kept.length+(analysis.finishedGoods||[]).length+(analysis.rawMaterials||[]).length;
  return{analysis:normalized,appendRows,removeRows,exactDuplicates:duplicates,conflicts,undatedRows:(analysis.cashMovements||[]).filter(row=>!dateOf(row))};
}
function blankRow(workbook,row){
  const sheet=workbook.Sheets[clean(row?.sheet,200)],rowNo=Number(row?.row||0);
  if(!sheet||!sheet['!ref']||!Number.isInteger(rowNo)||rowNo<1)return;
  const range=XLSX.utils.decode_range(sheet['!ref']);
  for(let col=range.s.c;col<=range.e.c;col++)delete sheet[XLSX.utils.encode_cell({r:rowNo-1,c:col})];
}
function detectedDateColumn(workbook,row){
  const sheet=workbook.Sheets[clean(row?.sheet,200)],rowNo=Number(row?.row||0);
  if(!sheet||!Number.isInteger(rowNo)||rowNo<1)return 8;
  const rows=XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:true,cellDates:true,blankrows:true});
  for(let index=rowNo-2;index>=Math.max(0,rowNo-42);index--){
    const normalized=(rows[index]||[]).map(label);
    if(!normalized.some(value=>value==='مدين')||!normalized.some(value=>value==='دائن'))continue;
    const column=normalized.findIndex(value=>value==='التاريخ'||value==='تاريخ الحركه'||value.includes('تاريخ الحرك'));
    if(column>=0)return column;
  }
  return 8;
}
function putDate(workbook,row,reportDate){
  const sheet=workbook.Sheets[clean(row?.sheet,200)],rowNo=Number(row?.row||0);
  if(!sheet||!Number.isInteger(rowNo)||rowNo<1)return;
  const column=detectedDateColumn(workbook,row);
  sheet[XLSX.utils.encode_cell({r:rowNo-1,c:column})]={t:'s',v:reportDate};
}
export function repairSingleDayWorkbook(workbook,plan,reportDate){
  const removed=new Set(plan.removeRows.map(row=>`${row.sheet}|${row.row}`));
  for(const row of plan.undatedRows)if(!removed.has(`${row.sheet}|${row.row}`))putDate(workbook,row,reportDate);
  for(const row of plan.removeRows)blankRow(workbook,row);
  return XLSX.write(workbook,{type:'buffer',bookType:'xlsx',compression:true});
}
async function migrationReady(){return Boolean((await select('migration_history','version=eq.32&select=version&limit=1'))?.[0]);}
function paymentPayload(row,reportDate){return{...row,accountCode:customer(row),voucherNo:voucher(row),debit:debit(row),credit:credit(row),movementDate:reportDate,reportDate,isCustomerCollection:true};}
async function notify({analysis,sourceFile,reportDate,payload,appendResult,enabled}){
  if(!enabled)return{disabled:true};
  const posting=payload?.posting;
  if(posting&&!posting.duplicate){
    const prepared=await prepareErpSuccessDelivery({analysis,sourceFile,reportDate}).catch(error=>({recipients:[],collections:[],reports:[],errors:[String(error?.message||error)]}));
    return sendErpSuccessDelivery({analysis,sourceFile,reportDate,posting:{...posting,paymentRepair:appendResult},prepared});
  }
  return sendErpDuplicateNotice({reportDate,sourceFile,upgrade:{upgraded:Boolean(payload?.upgraded||payload?.reconciliation?.upgraded),paymentRepair:appendResult}});
}
async function repaired(req,res,buffer){
  auth(req);
  if(!buffer.length)throw Object.assign(new Error('ERP file is missing'),{status:400,code:'ERP_SYNC_FILE_REQUIRED'});
  if(buffer[0]!==0x50||buffer[1]!==0x4b)throw Object.assign(new Error('ERP file is not valid XLSX'),{status:415,code:'ERP_SYNC_XLSX_REQUIRED'});
  const sourceFile=filename(req);
  const workbook=XLSX.read(buffer,{type:'buffer',cellDates:true});
  const coordinateWorkbook=anchorBlankRows(XLSX.read(buffer,{type:'buffer',cellDates:true}));
  const analysis=parseDailyWorkbook(coordinateWorkbook,XLSX);
  const explicit=[...new Set((analysis.reportDates||[]).filter(value=>/^\d{4}-\d{2}-\d{2}$/.test(value)))];
  if(explicit.length>1){req.body=buffer;return currentDailyReport(req,res);}
  const reportDate=resolveReportDate(req,workbook,sourceFile,analysis),plan=planSingleDayRepair(analysis,reportDate);
  if(plan.conflicts.length)return json(res,409,{ok:false,code:'ERP_TRANSACTION_CONFLICT',error:`Payment conflicts: ${plan.conflicts.length}`,reportDate,conflicts:plan.conflicts});
  const needsRepair=plan.undatedRows.length>0||plan.removeRows.length>0;
  if(!needsRepair){req.body=buffer;return currentDailyReport(req,res);}
  if(plan.appendRows.length&&!await migrationReady())return json(res,503,{ok:false,code:'ERP_PAYMENT_MIGRATION_REQUIRED',error:'Payment reconciliation migration 32 is not ready',reportDate});
  const repairedBuffer=repairSingleDayWorkbook(workbook,plan,reportDate),forwarded=Object.create(req);
  forwarded.body=repairedBuffer;forwarded.headers={...(req.headers||{}),'x-erp-send-reports':'0'};
  const captured=capture();await currentDailyReport(forwarded,captured);if(captured.statusCode>=400)return forward(res,captured);
  let payload={};try{payload=JSON.parse(captured.body||'{}');}catch{}
  let appendResult={ok:true,inserted:0,matched:0,conflictCount:0,insertedAmount:0};
  if(plan.appendRows.length){
    const raw=await rpc('append_daily_report_customer_payments',{p_report_date:reportDate,p_file_hash:sha256(buffer),p_payments:plan.appendRows.map(row=>paymentPayload(row,reportDate)),p_actor:'erp-daily-report-v7-repair',p_source_name:sourceFile});
    appendResult=Array.isArray(raw)?raw[0]:raw;
  }
  const enabled=String(req.headers?.['x-erp-send-reports']??'1')!=='0';
  const telegram=await notify({analysis:plan.analysis,sourceFile,reportDate,payload,appendResult,enabled}).catch(error=>({errors:[String(error?.message||error)]}));
  return json(res,200,{...payload,ok:true,reportDate,summary:plan.analysis.summary,telegram,repair:{applied:true,dateRule:'single-day-report-date',undatedRowsAssigned:plan.undatedRows.length,voucherSeparated:plan.appendRows.length,exactDuplicatesIgnored:plan.exactDuplicates.length,append:appendResult}});
}
export default async function handler(req,res){
  const mode=clean(req?.headers?.['x-erp-mode']??req?.query?.mode,80).toLowerCase();
  if(mode==='customer-payments'||mode==='customer-payment-reconciliation')return customerPaymentReconciliation(req,res);
  if(req.method!=='POST')return currentDailyReport(req,res);
  try{return repaired(req,res,await body(req));}catch(error){console.error(error);return json(res,Number(error?.status||500),{error:Number(error?.status||500)>=500?'Server operation failed':error.message,code:clean(error?.code,120)||undefined});}
}
export * from './daily-report-v6.js';
