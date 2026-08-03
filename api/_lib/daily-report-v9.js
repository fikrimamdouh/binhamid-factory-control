import crypto from 'node:crypto';
import * as XLSX from 'xlsx';
import currentDailyReport from './daily-report-v8.js';
import { parseDailyWorkbook } from './daily-summary-parser.js';
import { anchorBlankRows,repairSingleDayWorkbook } from './daily-report-v7.js';

const TOKEN_SHA='b4ba6180ffc5d0ce658168f76b3362b69b7e930b998e8304fa6afe68da8289a0';
const clean=(value,max=1000)=>String(value??'').trim().slice(0,max);
const rowDate=row=>clean(row?.movementDate??row?.movement_date_text??row?.reportDate,10);

function auth(req){
  const supplied=clean(req.headers?.['x-erp-sync-token'],300);
  const digest=crypto.createHash('sha256').update(supplied).digest('hex');
  const left=Buffer.from(digest),right=Buffer.from(TOKEN_SHA);
  if(left.length!==right.length||!crypto.timingSafeEqual(left,right))throw Object.assign(new Error('ERP sync authentication failed'),{status:401,code:'ERP_SYNC_AUTH_REQUIRED'});
}

async function body(req){
  if(Buffer.isBuffer(req.body))return req.body;
  if(req.body instanceof Uint8Array)return Buffer.from(req.body);
  if(typeof req.body==='string')return Buffer.from(req.body,'binary');
  const chunks=[];
  for await(const chunk of req)chunks.push(chunk);
  return Buffer.concat(chunks);
}

function filename(req){
  const encoded=clean(req.headers?.['x-erp-filename-b64'],1000);
  if(encoded){try{const value=Buffer.from(encoded,'base64').toString('utf8');if(value)return clean(value,240);}catch{}}
  return clean(req.headers?.['x-erp-filename'],240)||'daily-report.xlsx';
}

export function singleDayFilenameDate(value){
  const match=clean(value,240).match(/^Daily-Report-(20\d{2}-\d{2}-\d{2})(?:\.|-|_|$)/i);
  return match?.[1]||'';
}

export function shouldRepairNamedSingleDay(analysis={},reportDate=''){
  if(!/^20\d{2}-\d{2}-\d{2}$/.test(reportDate))return false;
  const explicit=[...new Set((analysis.reportDates||[]).filter(value=>/^20\d{2}-\d{2}-\d{2}$/.test(value)))];
  const undated=(analysis.cashMovements||[]).filter(row=>!rowDate(row));
  return explicit.length>1&&undated.length>0;
}

async function guarded(req,res){
  auth(req);
  const buffer=await body(req);
  if(buffer.length<2||buffer[0]!==0x50||buffer[1]!==0x4b){req.body=buffer;return currentDailyReport(req,res);}
  const sourceFile=filename(req),reportDate=singleDayFilenameDate(sourceFile);
  if(!reportDate){req.body=buffer;return currentDailyReport(req,res);}
  try{
    const workbook=XLSX.read(buffer,{type:'buffer',cellDates:true});
    const coordinateWorkbook=anchorBlankRows(XLSX.read(buffer,{type:'buffer',cellDates:true}));
    const analysis=parseDailyWorkbook(coordinateWorkbook,XLSX);
    if(!shouldRepairNamedSingleDay(analysis,reportDate)){req.body=buffer;return currentDailyReport(req,res);}
    const undatedRows=(analysis.cashMovements||[]).filter(row=>!rowDate(row));
    const repairedBuffer=repairSingleDayWorkbook(workbook,{undatedRows,removeRows:[]},reportDate);
    const forwarded=Object.create(req);
    forwarded.body=repairedBuffer;
    forwarded.headers={...(req.headers||{}),'x-erp-single-day-filename-date':reportDate};
    console.info('ERP named single-day repair applied',{sourceFile,reportDate,undatedRows:undatedRows.length,explicitDates:[...new Set(analysis.reportDates||[])]});
    return currentDailyReport(forwarded,res);
  }catch(error){
    console.warn('ERP named single-day pre-repair skipped',error);
    req.body=buffer;
    return currentDailyReport(req,res);
  }
}

export default async function handler(req,res){
  if(req.method!=='POST')return currentDailyReport(req,res);
  try{return await guarded(req,res);}catch(error){
    res.statusCode=Number(error?.status||500);
    res.setHeader('content-type','application/json; charset=utf-8');
    return res.end(JSON.stringify({ok:false,error:res.statusCode>=500?'Server operation failed':error.message,code:clean(error?.code,120)||undefined}));
  }
}

export * from './daily-report-v8.js';
