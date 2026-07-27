import crypto from 'node:crypto';
import * as XLSX from 'xlsx';
import { config } from '../_lib/config.js';
import { classifyFile, sha256 } from '../_lib/domain.js';
import { errorResponse, json, method } from '../_lib/http.js';
import { parseDailyWorkbook } from '../_lib/daily-summary-parser.js';
import { commitDailyReportFromTelegram } from '../_lib/routes/daily-report.js';
import { insert, patch, rpc, select, uploadObject } from '../_lib/supabase.js';
import { erpSaleType, prepareErpSuccessDelivery, sendErpDuplicateNotice, sendErpFailureNotice, sendErpSuccessDelivery } from '../_lib/erp-telegram-delivery.js';

const SYNC_TOKEN_SHA256='b4ba6180ffc5d0ce658168f76b3362b69b7e930b998e8304fa6afe68da8289a0';
const DAILY_TYPES=new Set(['daily_movement','block_daily_movement','concrete_daily_movement']);
const clean=(value,max=1000)=>String(value??'').trim().slice(0,max);
const westernDigits=value=>String(value??'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
const safeFile=value=>{
  let name=clean(value,240).replace(/[^\x00-\x7F]/g,'_').replace(/[^A-Za-z0-9._-]/g,'_').replace(/_+/g,'_').replace(/^_+|_+$/g,'');
  if(!name||name.startsWith('.'))name='daily-report.xlsx';
  return name.slice(0,140);
};
const equal=(a,b)=>{const aa=Buffer.from(String(a||'')),bb=Buffer.from(String(b||''));return aa.length===bb.length&&aa.length>0&&crypto.timingSafeEqual(aa,bb);};

function requireSyncToken(req){
  const supplied=clean(req.headers?.['x-erp-sync-token'],300);
  const digest=crypto.createHash('sha256').update(supplied).digest('hex');
  if(!equal(digest,SYNC_TOKEN_SHA256))throw Object.assign(new Error('اعتماد جهاز مزامنة ERP غير صحيح'),{status:401,code:'ERP_SYNC_AUTH_REQUIRED'});
}

async function rawBody(req,limit){
  if(Buffer.isBuffer(req.body))return req.body;
  if(req.body instanceof Uint8Array)return Buffer.from(req.body);
  if(typeof req.body==='string')return Buffer.from(req.body,'binary');
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>limit)throw Object.assign(new Error('حجم ملف التقرير يتجاوز الحد المسموح'),{status:413,code:'ERP_SYNC_FILE_TOO_LARGE'});chunks.push(chunk);}
  return Buffer.concat(chunks);
}

function decodedFilename(req){
  const encoded=clean(req.headers?.['x-erp-filename-b64'],1000);
  if(encoded){try{const value=Buffer.from(encoded,'base64').toString('utf8');if(value)return clean(value,240);}catch{}}
  return clean(req.headers?.['x-erp-filename'],240)||'daily-report.xlsx';
}

function isoDate(year,month,day){
  const y=Number(year),m=Number(month),d=Number(day),value=`${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  if(y<2000||y>2100||m<1||m>12||d<1||d>31||Number.isNaN(new Date(`${value}T12:00:00Z`).getTime()))return'';
  return value;
}

function dateCandidate(value,allowSerial=false){
  if(value instanceof Date&&!Number.isNaN(value.getTime()))return`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
  const text=westernDigits(value).trim();
  const serial=Number(text);
  if(allowSerial&&Number.isFinite(serial)&&serial>=30000&&serial<=80000){
    const parsed=new Date(Date.UTC(1899,11,30)+Math.round(serial)*86400000);
    if(!Number.isNaN(parsed.getTime()))return parsed.toISOString().slice(0,10);
  }
  let match=text.match(/(20\d{2})[.\/_-](\d{1,2})[.\/_-](\d{1,2})/);if(match)return isoDate(match[1],match[2],match[3]);
  match=text.match(/(\d{1,2})[.\/_-](\d{1,2})[.\/_-](20\d{2})/);if(match)return isoDate(match[3],match[2],match[1]);
  return'';
}

function dateFromWorkbook(workbook){
  for(const sheetName of workbook.SheetNames||[]){
    const rows=XLSX.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,defval:'',raw:true,cellDates:true,blankrows:false}).slice(0,120);
    for(const row of rows){
      for(let index=0;index<row.length;index++){
        const label=String(row[index]??'').replace(/\s+/g,' ').trim();
        if(!/تاريخ(?:\s+التقرير|\s+الحركه|\s+الحركة)?|report\s*date/i.test(label))continue;
        for(const candidate of [row[index],row[index+1],row[index+2],row[index+3]]){const parsed=dateCandidate(candidate,true);if(parsed)return parsed;}
      }
    }
  }
  return'';
}

export function resolveReportDate(req,workbook,name,analysis={}){
  const explicit=dateCandidate(req.headers?.['x-erp-report-date']);if(explicit)return explicit;
  const fromWorkbook=dateFromWorkbook(workbook);if(fromWorkbook)return fromWorkbook;
  const parsedDates=[...new Set(analysis?.reportDates||[])].filter(value=>/^\d{4}-\d{2}-\d{2}$/.test(value)).sort();if(parsedDates.length)return parsedDates.at(-1);
  const fromName=dateCandidate(name);if(fromName)return fromName;
  const modified=dateCandidate(req.headers?.['x-erp-file-date']);if(modified)return modified;
  throw Object.assign(new Error('تعذر تحديد تاريخ التقرير. ضع التاريخ داخل اسم الملف أو في خانة تاريخ التقرير داخل Excel.'),{status:422,code:'ERP_REPORT_DATE_REQUIRED'});
}

export function dailyParserEvidence(analysis={}){
  const counts={
    sales:Number(analysis?.sales?.length||0),
    collections:Number(analysis?.collections?.length||0),
    cashMovements:Number(analysis?.cashMovements?.length||0),
    treasuries:Number(analysis?.treasuries?.length||0),
    finishedGoods:Number(analysis?.finishedGoods?.length||0),
    rawMaterials:Number(analysis?.rawMaterials?.length||0)
  };
  return{recognized:Object.values(counts).some(value=>value>0),counts};
}

function resolveDailyReportType(req,workbook,name,analysis){
  const classified=classifyFile(name,'finance',workbook.SheetNames,analysis.contentText),requested=clean(req.headers?.['x-erp-report-type'],40),evidence=dailyParserEvidence(analysis);
  if(DAILY_TYPES.has(classified))return{reportType:classified,classified,requested,evidence};
  if(evidence.recognized)return{reportType:DAILY_TYPES.has(requested)?requested:'daily_movement',classified,requested,evidence};
  const sheets=(workbook.SheetNames||[]).join('، ')||'لا توجد أوراق';
  const counts=evidence.counts;
  throw Object.assign(new Error(`الملف لا يطابق تنسيق التقرير اليومي المعتمد في مصنع بن حامد. نتيجة القارئ: مبيعات ${counts.sales}، تحصيلات ${counts.collections}، حركات مالية ${counts.cashMovements}، منتجات تامة ${counts.finishedGoods}، خامات ${counts.rawMaterials}. الأوراق: ${sheets}`),{status:422,code:'ERP_SYNC_NOT_DAILY_REPORT'});
}

export function payloadFromAnalysis(analysis,reportDate){
  const inventory=[
    ...(analysis.finishedGoods||[]).map((row,index)=>({sourceRowNo:row.row||index+1,inventoryType:'finished_goods',itemCode:row.itemCode,itemName:row.itemName,unit:row.unit,opening:row.opening,received:row.received,issued:row.issued,closing:row.closing})),
    ...(analysis.rawMaterials||[]).map((row,index)=>({sourceRowNo:row.row||index+1,inventoryType:'raw_material',itemCode:row.itemCode,itemName:row.itemName,unit:row.unit,opening:row.opening,received:row.received,issued:row.issued,closing:row.closing}))
  ];
  return{
    sales:(analysis.sales||[]).map((row,index)=>({sourceRowNo:row.row||index+1,invoiceNo:row.invoice,salesType:erpSaleType(row),customerCode:row.customerCode,customerName:row.customer,item:row.item,quantity:row.quantity,amount:row.amount,paymentTerms:row.paymentTerms||null})),
    cashMovements:(analysis.cashMovements||analysis.collections||[]).map((row,index)=>({sourceRowNo:row.row||index+1,treasuryCode:row.treasuryCode,treasuryName:row.treasuryName,debit:row.debit??row.amount??0,credit:row.credit??0,accountName:row.accountName??row.customer,accountType:row.accountType||null,accountCode:row.accountCode??row.customerCode,description:row.description||null,movementType:row.movementType??row.type??null,voucherNo:row.voucherNo??row.receipt??null,movementDate:row.movementDate||row.reportDate||reportDate,paymentMethod:row.paymentMethod||null,isCustomerCollection:Boolean(row.isCustomerCollection??row.customerCode)})),
    treasuries:(analysis.treasuries||[]).map(row=>({treasuryCode:row.treasuryCode,treasuryName:row.treasuryName,opening:row.opening,closing:row.closing})),inventory,summary:{...analysis.summary,totalSales:analysis.summary?.salesTotal||0,parserVersion:'daily-report-v2'}
  };
}

async function upgradePostedImport(existing,analysis,reportDate,hash){
  const payload=payloadFromAnalysis(analysis,reportDate);
  try{
    const upgraded=await rpc('upgrade_daily_report_details',{p_report_date:reportDate,p_file_hash:hash,p_payload:payload,p_actor:'erp-folder-sync-v2'});
    const summary={sheetNames:[],daily:analysis.summary,source:{kind:'erp-folder',parserVersion:'daily-report-v2',upgradedAt:new Date().toISOString()}};
    await patch('imports',`id=eq.${encodeURIComponent(existing.id)}`,{summary,last_error_code:null,last_error_message:null}).catch(()=>{});
    return Array.isArray(upgraded)?upgraded[0]:upgraded;
  }catch(error){
    const text=[error?.message,error?.data?.message,error?.data?.code,error?.code].filter(Boolean).join(' ');
    if(/upgrade_daily_report_details|PGRST202|42883/i.test(text))return{available:false,reason:'MIGRATION_029_REQUIRED'};
    throw error;
  }
}

export default async function handler(req,res){
  if(!method(req,res,['POST']))return;
  try{
    requireSyncToken(req);
    const buffer=await rawBody(req,config.maxImportFileBytes);
    if(!buffer.length)throw Object.assign(new Error('ملف التقرير غير موجود في الطلب'),{status:400,code:'ERP_SYNC_FILE_REQUIRED'});
    if(buffer.length>config.maxImportFileBytes)throw Object.assign(new Error('حجم ملف التقرير يتجاوز الحد المسموح'),{status:413,code:'ERP_SYNC_FILE_TOO_LARGE'});
    if(buffer[0]!==0x50||buffer[1]!==0x4b)throw Object.assign(new Error('الملف ليس XLSX صالحًا'),{status:415,code:'ERP_SYNC_XLSX_REQUIRED'});

    const originalName=decodedFilename(req),hash=sha256(buffer),workbook=XLSX.read(buffer,{type:'buffer',cellDates:true}),analysis=parseDailyWorkbook(workbook,XLSX),classification=resolveDailyReportType(req,workbook,originalName,analysis),reportType=classification.reportType;
    const reportDate=resolveReportDate(req,workbook,originalName,analysis),existing=(await select('imports',`file_hash=eq.${hash}&select=id,status,original_name,report_type,file_path,file_hash,summary&limit=1`))?.[0]||null;
    if(existing&&['posted','approved'].includes(existing.status)){
      const upgrade=await upgradePostedImport(existing,analysis,reportDate,hash);
      const telegram=await sendErpDuplicateNotice({reportDate,sourceFile:originalName,upgrade}).catch(error=>({errors:[String(error?.message||error)]}));
      return json(res,200,{ok:true,duplicate:true,upgraded:Boolean(upgrade?.upgraded),upgrade,reportDate,fileHash:hash,importId:existing.id,status:existing.status,summary:analysis.summary,telegram});
    }

    const storagePath=existing?.file_path||`erp-folder/${reportDate}/${hash.slice(0,16)}-${safeFile(originalName)}`;
    if(!existing?.file_path)await uploadObject(storagePath,buffer,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const summary={sheetNames:workbook.SheetNames,daily:analysis.summary,source:{kind:'erp-folder',receivedAt:new Date().toISOString(),classification}};
    let imp=existing;
    if(!imp){
      const rows=await insert('imports',[{source:'erp-folder',department:'finance',report_type:reportType,status:'ready',original_name:originalName,mime_type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',file_path:storagePath,file_hash:hash,row_count:analysis.rowCount,error_count:0,warning_count:0,summary,last_error_code:null,last_error_message:null}]);
      imp=rows?.[0];
    }else if(!imp.file_path){
      const rows=await patch('imports',`id=eq.${encodeURIComponent(imp.id)}`,{file_path:storagePath,report_type:reportType,summary,last_error_code:null,last_error_message:null});
      imp=rows?.[0]||{...imp,file_path:storagePath,report_type:reportType,summary};
    }
    if(!imp?.id)throw Object.assign(new Error('تعذر تسجيل ملف ERP في مركز الوارد'),{status:502,code:'ERP_SYNC_IMPORT_REGISTER_FAILED'});

    const shouldSendReports=String(req.headers?.['x-erp-send-reports']??'1')!=='0',preparedTelegram=shouldSendReports?await prepareErpSuccessDelivery({analysis,sourceFile:originalName,reportDate}).catch(error=>({recipients:[],collections:[],reports:[],errors:[String(error?.message||error)]})):null;
    const posting=await commitDailyReportFromTelegram({reportDate,originalName,fileHash:hash,contentHash:hash,idempotencyKey:`erp-folder:${reportDate}:${hash}`,importId:imp.id,payload:payloadFromAnalysis(analysis,reportDate)},'erp-folder-sync');
    if(!posting?.ok){
      const errors=(posting?.errors||[]).slice(0,5),reason=errors.map((item,index)=>`${index+1}. ${clean(item?.message||item?.code,300)}`).join('\n')||'فشل تحقق التقرير على الخادم.';
      const telegram=await sendErpFailureNotice({reportDate,sourceFile:originalName,reason}).catch(error=>({errors:[String(error?.message||error)]}));
      return json(res,422,{ok:false,duplicate:false,reportDate,fileHash:hash,importId:imp.id,storagePath,summary:analysis.summary,posting,telegram});
    }
    let telegram;
    if(posting?.duplicate)telegram=await sendErpDuplicateNotice({reportDate,sourceFile:originalName}).catch(error=>({errors:[String(error?.message||error)]}));
    else if(shouldSendReports)telegram=await sendErpSuccessDelivery({analysis,sourceFile:originalName,reportDate,posting,prepared:preparedTelegram}).catch(error=>({errors:[String(error?.message||error)]}));
    else telegram={disabled:true};
    return json(res,200,{ok:Boolean(posting?.ok),duplicate:Boolean(posting?.duplicate),reportDate,fileHash:hash,importId:imp.id,storagePath,summary:analysis.summary,posting,telegram});
  }catch(error){errorResponse(res,error);}
}
