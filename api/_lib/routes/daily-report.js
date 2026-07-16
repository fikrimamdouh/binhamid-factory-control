import crypto from 'node:crypto';
import * as XLSX from 'xlsx';
import { requireAdmin } from '../auth.js';
import { json, method, body, errorResponse } from '../http.js';
import { select, rpc } from '../supabase.js';
import { parseDailyReportRows, summarizeDailyReport, canonicalDailyReport } from '../daily-report-parser.js';

const MAX_FILE_BYTES=3_000_000;
const clean=(value,max=1000)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const dateIso=value=>/^\d{4}-\d{2}-\d{2}$/.test(clean(value,10))?clean(value,10):'';

function decodeBase64(value){
  const raw=String(value||'').replace(/^data:.*?;base64,/, '').replace(/\s+/g,'');
  if(!raw)throw Object.assign(new Error('ملف Excel مطلوب'),{status:400});
  const buffer=Buffer.from(raw,'base64');
  if(!buffer.length)throw Object.assign(new Error('تعذر قراءة ملف Excel'),{status:400});
  if(buffer.length>MAX_FILE_BYTES)throw Object.assign(new Error('حجم ملف التقرير أكبر من الحد المسموح'),{status:413});
  return buffer;
}

export function parseDailyReport(buffer){
  let workbook;
  try{workbook=XLSX.read(buffer,{type:'buffer',cellDates:true,raw:true});}catch{throw Object.assign(new Error('الملف ليس Excel صالحًا'),{status:400});}
  const sheetName=workbook.SheetNames[0];
  if(!sheetName)throw Object.assign(new Error('ملف Excel لا يحتوي ورقة عمل'),{status:400});
  const rows=XLSX.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,raw:true,defval:null,blankrows:false});
  return parseDailyReportRows(rows,sheetName);
}

export async function dailyReport(req,res){
  if(!method(req,res,['POST']))return;
  try{
    const actor=requireAdmin(req),input=await body(req),action=clean(input.action,20)||'preview';
    if(!['preview','commit'].includes(action))throw Object.assign(new Error('إجراء الاستيراد غير صحيح'),{status:400});
    const buffer=decodeBase64(input.fileBase64),fileHash=crypto.createHash('sha256').update(buffer).digest('hex'),parsed=parseDailyReport(buffer),summary=summarizeDailyReport(parsed),contentHash=crypto.createHash('sha256').update(JSON.stringify(canonicalDailyReport(parsed))).digest('hex');
    const result={ok:true,action,fileName:clean(input.fileName,240)||'daily-report.xlsx',fileHash,contentHash,summary,preview:{sales:parsed.sales,collections:parsed.collections,cashMovements:parsed.cashMovements,treasuries:parsed.treasuries,inventory:parsed.inventory,issues:parsed.issues}};
    if(action==='preview')return json(res,200,result);
    const reportDate=dateIso(input.reportDate);if(!reportDate)throw Object.assign(new Error('تاريخ التقرير مطلوب بصيغة صحيحة'),{status:400});
    if(!parsed.sales.length&&!parsed.cashMovements.length)throw Object.assign(new Error('لم يتم العثور على مبيعات أو حركات خزينة قابلة للترحيل'),{status:422});
    if(summary.blockedSalesLines)throw Object.assign(new Error(`يوجد ${summary.blockedSalesLines} سطر مبيعات يحتاج مراجعة قبل الاعتماد`),{status:422});
    let existing;
    try{existing=await select('daily_report_batches',`report_date=eq.${encodeURIComponent(reportDate)}&select=id,content_hash,status,summary,committed_at&limit=1`);}
    catch{throw Object.assign(new Error('مستورد التقرير اليومي غير مفعّل في قاعدة البيانات. شغّل Migration 010 أولًا.'),{status:503});}
    if(existing?.[0]){
      if(existing[0].content_hash===contentHash)return json(res,200,{...result,reportDate,committed:true,duplicate:true,batch:existing[0]});
      throw Object.assign(new Error('يوجد تقرير يومي معتمد لنفس التاريخ. لا يمكن مضاعفة المبيعات والتحصيلات.'),{status:409});
    }
    const committed=await rpc('commit_daily_report',{p_report_date:reportDate,p_original_name:result.fileName,p_file_hash:fileHash,p_content_hash:contentHash,p_payload:{...parsed,summary},p_actor:actor.actor});
    return json(res,200,{...result,reportDate,committed:true,duplicate:false,batch:Array.isArray(committed)?committed[0]||committed:committed});
  }catch(error){errorResponse(res,error);}
}
