import crypto from 'node:crypto';
import * as XLSX from 'xlsx';
import currentDailyReport from './daily-report-v8.js';
import { parseDailyWorkbook } from './daily-summary-parser.js';
import { splitAggregatedAnalysis } from './daily-report-v3.js';
import { anchorBlankRows,repairSingleDayWorkbook } from './daily-report-v7.js';

const TOKEN_SHA='b4ba6180ffc5d0ce658168f76b3362b69b7e930b998e8304fa6afe68da8289a0';
const clean=(value,max=1000)=>String(value??'').trim().slice(0,max);
const rowDate=row=>clean(row?.movementDate??row?.movement_date_text??row?.reportDate,10);
const saleDate=row=>clean(row?.reportDate??row?.transactionDate??row?.transaction_date,10);
const label=value=>clean(value,300).toLowerCase().replace(/[أإآٱ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ً-ْـ]/g,'').replace(/\s+/g,' ');

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

export function undatedNamedDailyRows(analysis={}){
  const sales=(analysis.sales||[]).filter(row=>!saleDate(row)).map(row=>({...row,_erpUndatedKind:'sale'}));
  const cash=(analysis.cashMovements||analysis.collections||[]).filter(row=>!rowDate(row)).map(row=>({...row,_erpUndatedKind:'cash'}));
  return[...sales,...cash];
}

export function shouldRepairNamedSingleDay(analysis={},reportDate=''){
  if(!/^20\d{2}-\d{2}-\d{2}$/.test(reportDate))return false;
  const split=splitAggregatedAnalysis(analysis);
  return split.sourceDates.length>1&&undatedNamedDailyRows(analysis).length>0;
}

function isoCellDate(value){
  if(value instanceof Date&&!Number.isNaN(value.getTime()))return`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
  if(typeof value==='number'&&Number.isFinite(value)&&value>=30000&&value<=80000){const parsed=XLSX.SSF.parse_date_code(value);if(parsed)return`${String(parsed.y).padStart(4,'0')}-${String(parsed.m).padStart(2,'0')}-${String(parsed.d).padStart(2,'0')}`;}
  const text=clean(value,80).replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  let match=text.match(/(20\d{2})[./_-](\d{1,2})[./_-](\d{1,2})/);if(match)return`${match[1]}-${String(match[2]).padStart(2,'0')}-${String(match[3]).padStart(2,'0')}`;
  match=text.match(/(\d{1,2})[./_-](\d{1,2})[./_-](20\d{2})/);return match?`${match[3]}-${String(match[2]).padStart(2,'0')}-${String(match[1]).padStart(2,'0')}`:'';
}

function peerDateColumn(workbook,row,analysis){
  const sheetName=clean(row?.sheet,200),sheet=workbook.Sheets[sheetName],rowNo=Number(row?.row||0);
  if(!sheet||!sheet['!ref']||!Number.isInteger(rowNo)||rowNo<1)return-1;
  const peers=row?._erpUndatedKind==='sale'?(analysis.sales||[]):(analysis.cashMovements||analysis.collections||[]);
  const range=XLSX.utils.decode_range(sheet['!ref']);
  for(const peer of peers){
    if(clean(peer?.sheet,200)!==sheetName)continue;
    const peerDate=row?._erpUndatedKind==='sale'?saleDate(peer):rowDate(peer),peerRow=Number(peer?.row||0);
    if(!peerDate||!Number.isInteger(peerRow)||peerRow<1)continue;
    for(let col=range.s.c;col<=range.e.c;col++){
      const cell=sheet[XLSX.utils.encode_cell({r:peerRow-1,c:col})];
      if(cell&&isoCellDate(cell.v)===peerDate)return col;
    }
  }
  return-1;
}

function headerDateColumn(workbook,row){
  const sheet=workbook.Sheets[clean(row?.sheet,200)],rowNo=Number(row?.row||0);
  if(!sheet||!sheet['!ref']||!Number.isInteger(rowNo)||rowNo<1)return-1;
  const rows=XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:true,cellDates:true,blankrows:true});
  let best={score:-1,column:-1};
  for(let index=rowNo-2;index>=Math.max(0,rowNo-60);index--){
    const normalized=(rows[index]||[]).map(label),dateColumns=[];
    normalized.forEach((value,column)=>{if(value==='التاريخ'||value.includes('تاريخ الحرك')||value.includes('تاريخ الفاتور')||value.includes('تاريخ التقرير')||/report date|transaction date|invoice date/.test(value))dateColumns.push(column);});
    if(!dateColumns.length)continue;
    let score=60-(rowNo-2-index);
    if(row?._erpUndatedKind==='cash'){
      if(normalized.some(value=>value==='مدين')&&normalized.some(value=>value==='دائن'))score+=100;
      if(normalized.some(value=>value.includes('الخزين')||value.includes('الحساب')||value.includes('السند')))score+=25;
    }else{
      if(normalized.some(value=>value.includes('الفاتور'))&&normalized.some(value=>value.includes('العميل')))score+=100;
      if(normalized.some(value=>value.includes('الصنف')||value.includes('الكمي')||value.includes('المبلغ')))score+=25;
    }
    if(score>best.score)best={score,column:dateColumns[0]};
  }
  return best.column;
}

function putNamedDate(workbook,row,analysis,reportDate){
  const sheet=workbook.Sheets[clean(row?.sheet,200)],rowNo=Number(row?.row||0);
  if(!sheet||!Number.isInteger(rowNo)||rowNo<1)return false;
  const column=peerDateColumn(workbook,row,analysis)>=0?peerDateColumn(workbook,row,analysis):headerDateColumn(workbook,row);
  if(column<0)return false;
  sheet[XLSX.utils.encode_cell({r:rowNo-1,c:column})]={t:'s',v:reportDate};
  return true;
}

export function repairNamedSingleDayWorkbook(workbook,analysis,reportDate){
  const rows=undatedNamedDailyRows(analysis),sales=rows.filter(row=>row._erpUndatedKind==='sale'),cash=rows.filter(row=>row._erpUndatedKind==='cash');
  let salesAssigned=0;
  for(const row of sales)if(putNamedDate(workbook,row,analysis,reportDate))salesAssigned++;
  const buffer=repairSingleDayWorkbook(workbook,{undatedRows:cash,removeRows:[]},reportDate);
  return{buffer,salesAssigned,cashAssigned:cash.length,totalRequested:rows.length};
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
    const repaired=repairNamedSingleDayWorkbook(workbook,analysis,reportDate);
    const forwarded=Object.create(req);
    forwarded.body=repaired.buffer;
    forwarded.headers={...(req.headers||{}),'x-erp-single-day-filename-date':reportDate};
    console.info('ERP named single-day repair applied',{sourceFile,reportDate,salesAssigned:repaired.salesAssigned,cashAssigned:repaired.cashAssigned,totalRequested:repaired.totalRequested,explicitDates:[...new Set(analysis.reportDates||[])]});
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
