import { body, errorResponse, json, method } from '../http.js';
import { requireCapability } from '../permissions.js';
import { config } from '../config.js';
import { htmlToPdf } from '../pdf-service.js';
import { sendDocumentBuffer } from '../telegram.js';

const clean=(value,max=200)=>String(value??'').trim().slice(0,max);
const safeFile=value=>{
  let base=String(value||'report').replace(/[^\x00-\x7F]/g,'_').replace(/[^A-Za-z0-9._-]/g,'_').replace(/_+/g,'_').replace(/^_+|_+$/g,'');
  if(!base||base.startsWith('.'))base='report'+base;
  return base.slice(0,120);
};

// يحوّل أي نموذج مطبوع من البرنامج (إقرار محفظة عملاء، إقرار مبيعات يومي...)
// إلى PDF فعلي ويرسله لتيليجرام المصنع مباشرة من زر على الموقع، دون أي علاقة
// بمسار استقبال رسائل البوت (telegram-webhook-gateway.js) — إرسال صادر فقط.
export async function sendPrintedReport(req,res){
  if(!method(req,res,['POST']))return;
  try{
    await requireCapability(req,'daily_report.view');
    if(!config.telegramOwnerId)throw Object.assign(new Error('لم يتم ضبط TELEGRAM_OWNER_ID؛ لا توجد وجهة لإرسال النموذج.'),{status:503,code:'TELEGRAM_OWNER_NOT_CONFIGURED'});
    const input=await body(req,2_000_000),html=String(input.html||'');
    if(!html||html.length<20)throw Object.assign(new Error('محتوى النموذج فارغ.'),{status:400});
    const title=clean(input.title,150)||'نموذج من نظام بن حامد',caption=clean(input.caption,900)||title;
    const pdf=await htmlToPdf(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>body{font-family:Arial,Tahoma,sans-serif;color:#173746}</style></head><body>${html}</body></html>`,{filename:title,landscape:false});
    const filename=`${safeFile(title)}.pdf`;
    await sendDocumentBuffer(config.telegramOwnerId,pdf,filename,'application/pdf',`📄 ${caption}`);
    json(res,200,{ok:true,sentTo:'owner',filename});
  }catch(error){
    if(error?.code==='PDF_SERVICE_NOT_CONFIGURED')error.message='خدمة تحويل PDF غير مضبوطة على الخادم (PDF_API_URL/PDF_API_KEY).';
    errorResponse(res,error);
  }
}
