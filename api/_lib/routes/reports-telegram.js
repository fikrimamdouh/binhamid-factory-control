import { body, errorResponse, json, method } from '../http.js';
import { requireCapability } from '../permissions.js';
import { config } from '../config.js';
import { htmlToPdf } from '../pdf-service.js';
import { sendDocumentBuffer } from '../telegram.js';

const clean=(value,max=200)=>String(value??'').trim().slice(0,max);
const safeFile=value=>{let base=String(value||'report').replace(/[^\x00-\x7F]/g,'_').replace(/[^A-Za-z0-9._-]/g,'_').replace(/_+/g,'_').replace(/^_+|_+$/g,'');if(!base||base.startsWith('.'))base='report'+base;return base.slice(0,120);};
function safeBaseUrl(value){try{const url=new URL(String(value||''));return /^https?:$/.test(url.protocol)?url.href:'';}catch{return'';}}

// يستقبل لقطة HTML المجمدة عند لحظة window.print، لا يعيد بناء الإقرار.
export async function sendPrintedReport(req,res){
  if(!method(req,res,['POST']))return;
  try{
    await requireCapability(req,'reports.send_telegram');
    if(!config.telegramOwnerId)throw Object.assign(new Error('لم يتم ضبط TELEGRAM_OWNER_ID؛ لا توجد وجهة لإرسال النموذج.'),{status:503,code:'TELEGRAM_OWNER_NOT_CONFIGURED'});
    const input=await body(req,2_000_000),html=String(input.html||'');
    if(!html||html.length<20)throw Object.assign(new Error('محتوى النموذج فارغ.'),{status:400,code:'PRINT_DOCUMENT_EMPTY'});
    const title=clean(input.title,150)||'نموذج من نظام بن حامد',caption=clean(input.caption,900)||title,baseUrl=safeBaseUrl(input.baseUrl),documentId=clean(input.documentId,160),capturedAt=clean(input.capturedAt,80);
    const printSetup=`<style>
      @page{size:A4;margin:10mm}
      html,body{margin:0;padding:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      *{-webkit-print-color-adjust:exact;print-color-adjust:exact;box-sizing:border-box}
      tr,img,.sheet,.doc,.card{page-break-inside:avoid}
      thead{display:table-header-group}
      .no-print,.noprint,button,.ops-btn{display:none!important}
    </style>`;
    const metadata=`<!-- documentId:${documentId||'unknown'} capturedAt:${capturedAt||'unknown'} -->`;
    const pdf=await htmlToPdf(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">${baseUrl?`<base href="${baseUrl.replace(/"/g,'&quot;')}">`:''}${printSetup}</head><body>${metadata}${html}</body></html>`,{filename:title,landscape:false});
    const filename=`${safeFile(title)}.pdf`;
    await sendDocumentBuffer(config.telegramOwnerId,pdf,filename,'application/pdf',`📄 ${caption}`);
    json(res,200,{ok:true,sentTo:'owner',filename,documentId:documentId||null,capturedAt:capturedAt||null});
  }catch(error){if(error?.code==='PDF_SERVICE_NOT_CONFIGURED')error.message='خدمة تحويل PDF غير مضبوطة على الخادم (PDF_API_URL/PDF_API_KEY).';errorResponse(res,error);}
}
