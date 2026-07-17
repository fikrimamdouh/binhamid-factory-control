import * as XLSX from 'xlsx';
import { select, insert, patch, uploadObject } from './supabase.js';
import { sendMessage, downloadTelegramFile } from './telegram.js';
import { classifyFile, sha256 } from './domain.js';
import { parseDailyWorkbook } from './daily-summary-parser.js';
import { reportTypeLabel, reportDestination } from './bot-profile.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeFile=v=>String(v||'file').replace(/[^A-Za-z0-9._\-\u0600-\u06FF]/g,'_').slice(0,140);
const number=value=>Number(value||0).toLocaleString('en-US',{maximumFractionDigits:3});
const dailyType=type=>['daily_movement','block_daily_movement','concrete_daily_movement'].includes(type);
function excelFailureMessage(error){
  const status=Number(error?.status||error?.upstreamStatus||0),text=String(error?.message||'');
  if(status===413||/too large|حجم.*يتجاوز|file is too big/i.test(text))return'حجم الملف أكبر من الحد المسموح.';
  if(status===415||/ليس XLSX|غير صالح/i.test(text))return'الملف ليس Excel صالحًا أو تالف.';
  if(/bucket|storage|حاوية/i.test(text))return'تعذر حفظ النسخة الأصلية في مخزن الملفات.';
  if(/imports|relation|schema|table/i.test(text))return'تعذر تسجيل الملف في مركز الوارد؛ قاعدة بيانات الاستيراد غير جاهزة.';
  return'تعذر تنزيل الملف أو فحصه أو حفظه في مركز الوارد.';
}
function dailySummaryText(summary={}){
  if(!summary.invoiceCount&&!summary.collectionCount)return'';
  return `\n\n<b>ملخص القراءة:</b>\nالفواتير: <b>${number(summary.invoiceCount)}</b>\nإجمالي المبيعات: <b>${number(summary.salesTotal)} ر.س</b>\nالبلوك: <b>${number(summary.blockQuantity)} قطعة — ${number(summary.blockSales)} ر.س</b>\nالخرسانة: <b>${number(summary.concreteQuantity)} م³ — ${number(summary.concreteSales)} ر.س</b>\nالتحصيلات: <b>${number(summary.collectionCount)} حركة — ${number(summary.collectionTotal)} ر.س</b>`;
}
export async function handleExcel(message,group,identity,stored){
  const document=message.document,chatId=message.chat.id,name=document.file_name||'report.xlsx';
  await sendMessage(chatId,`تم استلام ملف <b>${esc(name)}</b>. جارٍ تنزيله وفحصه وحفظه في مركز الوارد.`);
  try{
    const downloaded=await downloadTelegramFile(document.file_id),hash=sha256(downloaded.buffer),duplicate=(await select('imports',`file_hash=eq.${hash}&select=id,status,original_name,report_type,summary,file_path&limit=1`))?.[0],recheck=Boolean(duplicate&&(duplicate.report_type==='unknown_excel'||duplicate.status==='failed'||!duplicate.report_type));
    if(duplicate&&!recheck)return sendMessage(chatId,`هذا الملف سبق استلامه.\nالملف: <b>${esc(duplicate.original_name)}</b>\nالنوع: <b>${esc(reportTypeLabel(duplicate.report_type))}</b>\nالحالة: <b>${esc(duplicate.status)}</b>${dailySummaryText(duplicate.summary?.daily||duplicate.summary||{})}`);
    let sheetNames=[],rowCount=0,summary={},contentText='',status='ready',errorCount=0;
    try{
      const workbook=XLSX.read(downloaded.buffer,{type:'buffer',cellDates:true}),analysis=parseDailyWorkbook(workbook,XLSX);
      sheetNames=workbook.SheetNames;rowCount=analysis.rowCount;contentText=analysis.contentText;summary={sheetNames,daily:analysis.summary};
    }catch(error){status='failed';errorCount=1;summary={error:error.message};}
    const reportType=classifyFile(name,group.department,sheetNames,contentText),path=duplicate?.file_path||`telegram/${group.department||'unassigned'}/${new Date().toISOString().slice(0,10)}/${hash.slice(0,16)}-${safeFile(name)}`,values={department:group.department||'unassigned',report_type:reportType,status,original_name:name,mime_type:document.mime_type||downloaded.contentType,file_path:path,file_hash:hash,row_count:rowCount,error_count:errorCount,warning_count:reportType==='unknown_excel'?1:0,summary,submitted_by:identity.user_id,source_chat_id:String(chatId),source_message_id:String(message.message_id),updated_at:new Date().toISOString()};
    if(!duplicate?.file_path)await uploadObject(path,downloaded.buffer,document.mime_type||downloaded.contentType);
    const rows=duplicate?await patch('imports',`id=eq.${encodeURIComponent(duplicate.id)}`,values):await insert('imports',[{source:'telegram',...values}]),imp=rows?.[0]||duplicate;
    if(stored?.id&&imp?.id)await patch('telegram_messages',`id=eq.${stored.id}`,{file_path:path,related_entity_type:'import',related_entity_id:imp.id,transcription:null}).catch(error=>console.warn('[telegram excel message link]',error?.message||error));
    const recognizedDaily=dailyType(reportType),state=status!=='ready'?'حُفظ لكن تعذر الفحص الآلي':recognizedDaily?'محفوظ وجاهز للمراجعة والاعتماد من شاشة التقرير اليومي':'جاهز للمراجعة',footer=recognizedDaily?'لم يتم اعتماد التقرير أو إنشاء أي قيود تلقائيًا؛ الاعتماد يتم من البرنامج بعد المراجعة.':'لم تُرحّل البيانات نهائيًا.',resultTitle=recheck?'تمت إعادة فحص الملف القديم وتحديث تصنيفه بنجاح.':'تم فحص الملف وحفظه بنجاح.';
    return sendMessage(chatId,`${resultTitle}\n\nالاسم: ${esc(name)}\nالنوع: <b>${esc(reportTypeLabel(reportType))}</b>\nالمسار: <b>${esc(reportDestination(reportType,group.department))}</b>\nالأوراق: ${esc(sheetNames.join('، ')||'تعذر القراءة')}\nالصفوف: <b>${rowCount}</b>${recognizedDaily?dailySummaryText(summary.daily):''}\nالحالة: <b>${state}</b>\n\n${footer}`);
  }catch(error){
    console.error('[telegram excel import]',error);
    await sendMessage(chatId,`تعذر إكمال معالجة ملف <b>${esc(name)}</b>.\nالسبب: ${esc(excelFailureMessage(error))}\nلم تُرحّل أي بيانات من هذا الملف.`).catch(sendError=>console.error('[telegram excel failure reply]',sendError));
    return null;
  }
}
export async function handleAttachment(message,group,identity,stored){
  const file=message.document||message.photo?.at(-1),downloaded=await downloadTelegramFile(file.file_id),hash=sha256(downloaded.buffer),name=message.document?.file_name||`photo-${message.message_id}.jpg`,path=`telegram/${group.department||'unassigned'}/${new Date().toISOString().slice(0,10)}/${hash.slice(0,16)}-${safeFile(name)}`;
  await uploadObject(path,downloaded.buffer,message.document?.mime_type||downloaded.contentType);
  const caption=message.caption||'',reportType=/عرض سعر/.test(caption+name)?'quotation':/فاتور/.test(caption+name)?'invoice':'unclassified_document',rows=await insert('imports',[{source:'telegram',department:group.department||'unassigned',report_type:reportType,status:'received',original_name:name,mime_type:message.document?.mime_type||downloaded.contentType,file_path:path,file_hash:hash,row_count:0,error_count:0,warning_count:reportType==='unclassified_document'?1:0,summary:{caption},submitted_by:identity.user_id,source_chat_id:String(message.chat.id),source_message_id:String(message.message_id)}]);
  if(stored?.id&&rows?.[0]?.id)await patch('telegram_messages',`id=eq.${stored.id}`,{file_path:path,related_entity_type:'import',related_entity_id:rows[0].id}).catch(error=>console.warn('[telegram attachment message link]',error?.message||error));
  return sendMessage(message.chat.id,`فهمت المستند وحفظت نسخته الأصلية.\nالنوع: <b>${esc(reportTypeLabel(reportType))}</b>\nالمسار: <b>${esc(reportDestination(reportType,group.department))}</b>\nالحالة: محفوظ للمراجعة ولم يُعتمد نهائيًا.`);
}
