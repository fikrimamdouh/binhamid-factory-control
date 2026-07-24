import { createHash } from 'node:crypto';
import { body, errorResponse, json, method } from '../http.js';
import { requireCapability } from '../permissions.js';
import { config } from '../config.js';
import { htmlToPdf, pdfServiceStatus } from '../pdf-service.js';
import { uploadObject } from '../supabase.js';
import { sendDocumentBuffer } from '../telegram.js';

const clean=(value,max=200)=>String(value??'').trim().slice(0,max);
const safeFile=value=>{let base=String(value||'report').replace(/[^\x00-\x7F]/g,'_').replace(/[^A-Za-z0-9._-]/g,'_').replace(/_+/g,'_').replace(/^_+|_+$/g,'');if(!base||base.startsWith('.'))base='report'+base;return base.slice(0,120);};
const isoDate=value=>{const text=clean(value,10);return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';};
function safeBaseUrl(value){try{const url=new URL(String(value||''));return /^https?:$/.test(url.protocol)?url.href:'';}catch{return'';}}
function printMetadata(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return{};
  const type=['block','concrete'].includes(clean(value.portfolioType,20))?clean(value.portfolioType,20):'',documentType=clean(value.documentType,80),periodFrom=isoDate(value.periodFrom||value.reportDate),periodTo=isoDate(value.periodTo||value.reportDate),reportDate=isoDate(value.reportDate||periodTo),customerCount=Math.max(0,Math.trunc(Number(value.customerCount||0)));
  return{documentType,portfolioType:type,periodFrom,periodTo,reportDate,periodMode:periodFrom&&periodTo&&periodFrom!==periodTo?'range':'daily',employeeId:clean(value.employeeId,200),employeeName:clean(value.employeeName,300),employeeNationalId:clean(value.employeeNationalId,30),customerCount,sector:clean(value.sector,30),statusFilter:clean(value.statusFilter,40)};
}
async function archiveExactPortfolio(pdf,{contentHash,title,filename,capturedAt,metadata}){
  if(metadata.documentType!=='customer_portfolio'||!metadata.portfolioType||metadata.customerCount<=0)return null;
  const date=metadata.periodTo||metadata.reportDate||new Date().toISOString().slice(0,10),pdfPath=`portfolio-documents/${metadata.portfolioType}/${date}/${contentHash}.pdf`,pointerPath=`portfolio-documents/latest-${metadata.periodMode}-${metadata.portfolioType}.json`,record={version:1,documentType:'customer_portfolio',portfolioType:metadata.portfolioType,periodMode:metadata.periodMode,periodFrom:metadata.periodFrom||date,periodTo:metadata.periodTo||date,reportDate:metadata.reportDate||date,employeeId:metadata.employeeId||'',employeeName:metadata.employeeName||'',employeeNationalId:metadata.employeeNationalId||'',customerCount:metadata.customerCount,sector:metadata.sector||metadata.portfolioType,statusFilter:metadata.statusFilter||'',title,filename,pdfPath,contentHash,capturedAt:capturedAt||new Date().toISOString(),storedAt:new Date().toISOString(),source:'website-exact-print'};
  await uploadObject(pdfPath,pdf,'application/pdf');
  await uploadObject(pointerPath,Buffer.from(JSON.stringify(record),'utf8'),'application/json; charset=utf-8');
  if(metadata.periodMode==='range')await uploadObject(`portfolio-documents/ranges/${metadata.portfolioType}/${record.periodFrom}_${record.periodTo}.json`,Buffer.from(JSON.stringify(record),'utf8'),'application/json; charset=utf-8');
  return record;
}

// يستقبل لقطة HTML المجمدة عند لحظة window.print، لا يعيد بناء الإقرار.
export async function sendPrintedReport(req,res){
  if(!method(req,res,['GET','POST']))return;
  try{
    await requireCapability(req,'reports.send_telegram');
    if(req.method==='GET'){const pdf=pdfServiceStatus();return json(res,200,{ok:true,ready:Boolean(config.telegramOwnerId&&pdf.configured),telegramOwnerConfigured:Boolean(config.telegramOwnerId),pdf});}
    if(!config.telegramOwnerId)throw Object.assign(new Error('لم يتم ضبط TELEGRAM_OWNER_ID؛ لا توجد وجهة لإرسال النموذج.'),{status:503,code:'TELEGRAM_OWNER_NOT_CONFIGURED'});
    const input=await body(req,4_000_000),html=String(input.html||'');
    if(!html||html.length<20)throw Object.assign(new Error('محتوى النموذج فارغ.'),{status:400,code:'PRINT_DOCUMENT_EMPTY'});
    const title=clean(input.title,150)||'نموذج من نظام بن حامد',caption=clean(input.caption,900)||title,baseUrl=safeBaseUrl(input.baseUrl),documentId=clean(input.documentId,160),capturedAt=clean(input.capturedAt,80),contentHash=createHash('sha256').update(html,'utf8').digest('hex'),metadata=printMetadata(input.metadata);
    if(!/^[a-f0-9]{64}$/.test(clean(input.contentHash,64))||clean(input.contentHash,64)!==contentHash)throw Object.assign(new Error('محتوى الملف لا يطابق لقطة الطباعة المرسلة.'),{status:409,code:'PRINT_DOCUMENT_HASH_MISMATCH'});
    const printSetup=`<style>
      html,body{background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .no-print,.noprint,[data-bh-runtime-notice],button,.ops-btn{display:none!important;visibility:hidden!important}
    </style>`;
    const documentMetadata=`<!-- documentId:${documentId||'unknown'} capturedAt:${capturedAt||'unknown'} -->`;
    const pdf=await htmlToPdf(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">${baseUrl?`<base href="${baseUrl.replace(/"/g,'&quot;')}">`:''}${printSetup}</head><body>${documentMetadata}${html}</body></html>`,{filename:title,landscape:false}),filename=`${safeFile(title)}.pdf`;
    let archived=null;
    try{archived=await archiveExactPortfolio(pdf,{contentHash,title,filename,capturedAt,metadata});}
    catch(error){console.warn('[exact portfolio PDF archive]',{code:error?.code||null,message:String(error?.message||'').slice(0,300)});}
    await sendDocumentBuffer(config.telegramOwnerId,pdf,filename,'application/pdf',`📄 ${caption}`);
    json(res,200,{ok:true,sentTo:'owner',filename,documentId:documentId||null,capturedAt:capturedAt||null,contentHash,archived:Boolean(archived),portfolio:archived?{type:archived.portfolioType,periodFrom:archived.periodFrom,periodTo:archived.periodTo,customerCount:archived.customerCount,pdfPath:archived.pdfPath}:null});
  }catch(error){if(error?.code==='PDF_SERVICE_NOT_CONFIGURED')error.message='خدمة تحويل PDF غير مضبوطة على الخادم (PDF_API_URL/PDF_API_KEY).';errorResponse(res,error);}
}
