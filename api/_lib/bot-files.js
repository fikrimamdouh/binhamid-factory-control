import * as XLSX from 'xlsx';
import { config } from './config.js';
import { select, insert, patch, uploadObject } from './supabase.js';
import { sendMessage, sendDocumentBuffer, downloadTelegramFile } from './telegram.js';
import { classifyFile, sha256 } from './domain.js';
import { parseDailyWorkbook } from './daily-summary-parser.js';
import { reportTypeLabel, reportDestination } from './bot-profile.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeFile=v=>String(v||'file').replace(/[^A-Za-z0-9._\-\u0600-\u06FF]/g,'_').slice(0,140);
const number=value=>Number(value||0).toLocaleString('en-US',{maximumFractionDigits:3});
const dailyType=type=>['daily_movement','block_daily_movement','concrete_daily_movement'].includes(type);
async function excelStep(stage,operation){
  try{return await operation();}
  catch(error){const tagged=error instanceof Error?error:new Error(String(error||'Unknown error'));if(!tagged.excelStage)tagged.excelStage=stage;throw tagged;}
}
function excelFailureMessage(error){
  const stage=String(error?.excelStage||''),status=Number(error?.status||error?.upstreamStatus||0),text=String(error?.message||'');
  if(status===413||/too large|حجم.*يتجاوز|file is too big/i.test(text))return'حجم الملف أكبر من الحد المسموح.';
  if(status===415||/ليس XLSX|غير صالح|تالف/i.test(text))return'الملف ليس Excel صالحًا أو تالف.';
  if(status===401||status===403)return stage==='download'?'رفض Telegram تنزيل الملف. أرسل الملف من جديد كمستند.':'صلاحية خادم مركز الوارد مرفوضة.';
  if(/Supabase غير مضبوط|متغيرات الخادم الناقصة/i.test(text))return'اتصال مركز الوارد غير مضبوط على الخادم.';
  if(/bucket|storage|حاوية/i.test(text)||stage==='storage')return'تعذر حفظ النسخة الأصلية في مخزن الملفات.';
  if(/imports|relation|schema|table/i.test(text))return'تعذر تسجيل الملف في مركز الوارد؛ قاعدة بيانات الاستيراد غير جاهزة.';
  if(stage==='download')return'تعذر تنزيل الملف من Telegram بعد إعادة المحاولة.';
  if(stage==='lookup')return'تعذر الاتصال بمركز الوارد لفحص الملف.';
  if(stage==='registry')return'تعذر تسجيل الملف في مركز الوارد بعد حفظ النسخة الأصلية.';
  return'تعذر إكمال معالجة الملف في الخادم.';
}
function dailySummaryText(summary={}){
  if(!summary.invoiceCount&&!summary.collectionCount)return'';
  return `\n\n<b>ملخص القراءة:</b>\nالفواتير: <b>${number(summary.invoiceCount)}</b>\nإجمالي المبيعات: <b>${number(summary.salesTotal)} ر.س</b>\nالبلوك: <b>${number(summary.blockQuantity)} قطعة — ${number(summary.blockSales)} ر.س</b>\nالخرسانة: <b>${number(summary.concreteQuantity)} م³ — ${number(summary.concreteSales)} ر.س</b>\nالتحصيلات: <b>${number(summary.collectionCount)} حركة — ${number(summary.collectionTotal)} ر.س</b>`;
}
async function sendProcessingResult(chatId,text,name){
  try{return await sendMessage(chatId,text);}
  catch(error){
    console.error('[telegram excel result reply]',{status:Number(error?.status||0),message:String(error?.message||'').slice(0,300)});
    try{return await sendMessage(chatId,`تمت معالجة ملف <b>${esc(name)}</b> وحفظ نتيجته، لكن تعذر إرسال تفاصيل القراءة. افتح مركز الوارد لمراجعته.`);}
    catch(fallbackError){console.error('[telegram excel result fallback]',{status:Number(fallbackError?.status||0),message:String(fallbackError?.message||'').slice(0,300)});return null;}
  }
}
async function relayToOwner(sourceChatId,buffer,name,contentType,caption,actionPayload={}){
  const owner=String(config.telegramOwnerId||'');if(!owner||owner===String(sourceChatId)||!buffer?.length)return null;
  try{return await sendDocumentBuffer(owner,buffer,name,contentType,String(caption||'').slice(0,900));}
  catch(error){console.warn('[telegram owner file relay]',{name,status:Number(error?.status||0),message:String(error?.message||'').slice(0,300),actionPayload});return null;}
}
export async function handleExcel(message,group,identity,stored){
  const document=message.document,chatId=message.chat.id,name=document.file_name||'report.xlsx';
  await sendMessage(chatId,`تم استلام ملف <b>${esc(name)}</b>. جارٍ تنزيله وفحصه وحفظه في مركز الوارد.`);
  let resultText='',result=null,relay=null;
  try{
    const downloaded=await excelStep('download',()=>downloadTelegramFile(document.file_id,{expectedSize:document.file_size,maxBytes:config.maxImportFileBytes}));
    relay={buffer:downloaded.buffer,contentType:document.mime_type||downloaded.contentType};
    const hash=sha256(downloaded.buffer);
    const duplicate=(await excelStep('lookup',()=>select('imports',`file_hash=eq.${hash}&select=id,status,original_name,report_type,summary,file_path&limit=1`)))?.[0];
    const recheck=Boolean(duplicate&&(duplicate.report_type==='unknown_excel'||duplicate.status==='failed'||!duplicate.report_type));
    if(duplicate&&!recheck){
      resultText=`هذا الملف سبق استلامه.\nالملف: <b>${esc(duplicate.original_name)}</b>\nالنوع: <b>${esc(reportTypeLabel(duplicate.report_type))}</b>\nالحالة: <b>${esc(duplicate.status)}</b>${dailySummaryText(duplicate.summary?.daily||duplicate.summary||{})}`;
      result={duplicate:true,import:duplicate};
    }else{
      let sheetNames=[],rowCount=0,summary={},contentText='',status='ready',errorCount=0;
      try{const workbook=XLSX.read(downloaded.buffer,{type:'buffer',cellDates:true}),analysis=parseDailyWorkbook(workbook,XLSX);sheetNames=workbook.SheetNames;rowCount=analysis.rowCount;contentText=analysis.contentText;summary={sheetNames,daily:analysis.summary};}
      catch(error){status='failed';errorCount=1;summary={error:String(error?.message||'تعذر قراءة المصنف').slice(0,500)};}
      const reportType=classifyFile(name,group.department,sheetNames,contentText),path=duplicate?.file_path||`telegram/${group.department||'unassigned'}/${new Date().toISOString().slice(0,10)}/${hash.slice(0,16)}-${safeFile(name)}`,values={department:group.department||'unassigned',report_type:reportType,status,original_name:name,mime_type:document.mime_type||downloaded.contentType,file_path:path,file_hash:hash,row_count:rowCount,error_count:errorCount,warning_count:reportType==='unknown_excel'?1:0,summary,submitted_by:identity.user_id,source_chat_id:String(chatId),source_message_id:String(message.message_id),updated_at:new Date().toISOString()};
      if(!duplicate?.file_path)await excelStep('storage',()=>uploadObject(path,downloaded.buffer,document.mime_type||downloaded.contentType));
      const register=async()=>duplicate?await patch('imports',`id=eq.${encodeURIComponent(duplicate.id)}`,values):insert('imports',[{source:'telegram',...values}]);
      const rows=await excelStep('registry',register),imp=rows?.[0]||duplicate;
      if(stored?.id&&imp?.id)await patch('telegram_messages',`id=eq.${stored.id}`,{file_path:path,related_entity_type:'import',related_entity_id:imp.id,transcription:null}).catch(error=>console.warn('[telegram excel message link]',error?.message||error));
      const recognizedDaily=dailyType(reportType),state=status!=='ready'?'حُفظ لكن تعذر الفحص الآلي':recognizedDaily?'محفوظ وجاهز للمراجعة والاعتماد من شاشة التقرير اليومي':'جاهز للمراجعة',footer=recognizedDaily?'لم يتم اعتماد التقرير أو إنشاء أي قيود تلقائيًا؛ الاعتماد يتم من البرنامج بعد المراجعة.':'لم تُرحّل البيانات نهائيًا.',resultTitle=recheck?'تمت إعادة فحص الملف القديم وتحديث تصنيفه بنجاح.':status==='ready'?'تم فحص الملف وحفظه بنجاح.':'تم حفظ الملف، لكن تعذر فحص محتواه آليًا.';
      resultText=`${resultTitle}\n\nالاسم: ${esc(name)}\nالنوع: <b>${esc(reportTypeLabel(reportType))}</b>\nالمسار: <b>${esc(reportDestination(reportType,group.department))}</b>\nالأوراق: ${esc(sheetNames.join('، ')||'تعذر القراءة')}\nالصفوف: <b>${rowCount}</b>${recognizedDaily?dailySummaryText(summary.daily):''}\nالحالة: <b>${state}</b>\n\n${footer}`;
      result={duplicate:false,import:imp,reportType,status,path};
    }
  }catch(error){
    console.error('[telegram excel import]',{stage:error?.excelStage||'unknown',status:Number(error?.status||error?.upstreamStatus||0),message:String(error?.message||'').slice(0,500)});
    await sendMessage(chatId,`تعذر إكمال معالجة ملف <b>${esc(name)}</b>.\nالسبب: ${esc(excelFailureMessage(error))}\nلم تُرحّل أي بيانات من هذا الملف.`).catch(sendError=>console.error('[telegram excel failure reply]',sendError));
    return null;
  }
  await Promise.all([sendProcessingResult(chatId,resultText,name),relayToOwner(chatId,relay?.buffer,name,relay?.contentType,`ملف وارد من Telegram\n\n${resultText}`,{importId:result?.import?.id})]);
  return result;
}
export async function handleAttachment(message,group,identity,stored){
  const file=message.document||message.photo?.at(-1),downloaded=await downloadTelegramFile(file.file_id),hash=sha256(downloaded.buffer),name=message.document?.file_name||`photo-${message.message_id}.jpg`,path=`telegram/${group.department||'unassigned'}/${new Date().toISOString().slice(0,10)}/${hash.slice(0,16)}-${safeFile(name)}`;
  await uploadObject(path,downloaded.buffer,message.document?.mime_type||downloaded.contentType);
  const caption=message.caption||'',reportType=/عرض سعر/.test(caption+name)?'quotation':/فاتور/.test(caption+name)?'invoice':'unclassified_document',rows=await insert('imports',[{source:'telegram',department:group.department||'unassigned',report_type:reportType,status:'received',original_name:name,mime_type:message.document?.mime_type||downloaded.contentType,file_path:path,file_hash:hash,row_count:0,error_count:0,warning_count:reportType==='unclassified_document'?1:0,summary:{caption},submitted_by:identity.user_id,source_chat_id:String(message.chat.id),source_message_id:String(message.message_id)}]);
  if(stored?.id&&rows?.[0]?.id)await patch('telegram_messages',`id=eq.${stored.id}`,{file_path:path,related_entity_type:'import',related_entity_id:rows[0].id}).catch(error=>console.warn('[telegram attachment message link]',error?.message||error));
  const text=`فهمت المستند وحفظت نسخته الأصلية.\nالنوع: <b>${esc(reportTypeLabel(reportType))}</b>\nالمسار: <b>${esc(reportDestination(reportType,group.department))}</b>\nالحالة: محفوظ للمراجعة ولم يُعتمد نهائيًا.`;
  await Promise.all([sendMessage(message.chat.id,text),relayToOwner(message.chat.id,downloaded.buffer,name,message.document?.mime_type||downloaded.contentType,`مستند وارد من Telegram\n${text}`,{importId:rows?.[0]?.id})]);
  return rows?.[0]||null;
}
