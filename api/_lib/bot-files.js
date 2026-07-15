import * as XLSX from 'xlsx';
import { select, insert, patch, uploadObject } from './supabase.js';
import { sendMessage, downloadTelegramFile } from './telegram.js';
import { classifyFile, sha256 } from './domain.js';
import { reportTypeLabel, reportDestination } from './bot-profile.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeFile=v=>String(v||'file').replace(/[^A-Za-z0-9._\-\u0600-\u06FF]/g,'_').slice(0,140);
export async function handleExcel(message,group,identity,stored){
  const document=message.document,downloaded=await downloadTelegramFile(document.file_id),hash=sha256(downloaded.buffer),duplicate=(await select('imports',`file_hash=eq.${hash}&select=id,status,original_name&limit=1`))?.[0];
  if(duplicate)return sendMessage(message.chat.id,`هذا الملف سبق استلامه.\nالملف: <b>${esc(duplicate.original_name)}</b>\nالحالة: <b>${esc(duplicate.status)}</b>`);
  const name=document.file_name||'report.xlsx';let sheetNames=[],rowCount=0,summary={},status='ready',errorCount=0;
  try{const workbook=XLSX.read(downloaded.buffer,{type:'buffer',cellDates:true});sheetNames=workbook.SheetNames;for(const sn of sheetNames)rowCount+=XLSX.utils.sheet_to_json(workbook.Sheets[sn],{defval:'',raw:false}).length;summary={sheetNames};}catch(error){status='failed';errorCount=1;summary={error:error.message};}
  const reportType=classifyFile(name,group.department,sheetNames),path=`telegram/${group.department||'unassigned'}/${new Date().toISOString().slice(0,10)}/${hash.slice(0,16)}-${safeFile(name)}`;
  await uploadObject(path,downloaded.buffer,document.mime_type||downloaded.contentType);
  const rows=await insert('imports',[{source:'telegram',department:group.department||'unassigned',report_type:reportType,status,original_name:name,mime_type:document.mime_type||downloaded.contentType,file_path:path,file_hash:hash,row_count:rowCount,error_count:errorCount,warning_count:reportType==='unknown_excel'?1:0,summary,submitted_by:identity.user_id,source_chat_id:String(message.chat.id),source_message_id:String(message.message_id)}]),imp=rows?.[0];
  await patch('telegram_messages',`id=eq.${stored.id}`,{file_path:path,related_entity_type:'import',related_entity_id:imp.id,transcription:null});
  return sendMessage(message.chat.id,`فهمت الملف وصنفته مبدئيًا.\n\nالاسم: ${esc(name)}\nالنوع: <b>${esc(reportTypeLabel(reportType))}</b>\nالمسار: <b>${esc(reportDestination(reportType,group.department))}</b>\nالأوراق: ${esc(sheetNames.join('، ')||'تعذر القراءة')}\nالصفوف: <b>${rowCount}</b>\nالحالة: <b>${status==='ready'?'جاهز للمراجعة':'تعذر الفحص الآلي'}</b>\n\nلم تُرحّل البيانات نهائيًا.`);
}
export async function handleAttachment(message,group,identity,stored){
  const file=message.document||message.photo?.at(-1),downloaded=await downloadTelegramFile(file.file_id),hash=sha256(downloaded.buffer),name=message.document?.file_name||`photo-${message.message_id}.jpg`,path=`telegram/${group.department||'unassigned'}/${new Date().toISOString().slice(0,10)}/${hash.slice(0,16)}-${safeFile(name)}`;
  await uploadObject(path,downloaded.buffer,message.document?.mime_type||downloaded.contentType);
  const caption=message.caption||'',reportType=/عرض سعر/.test(caption+name)?'quotation':/فاتور/.test(caption+name)?'invoice':'unclassified_document',rows=await insert('imports',[{source:'telegram',department:group.department||'unassigned',report_type:reportType,status:'received',original_name:name,mime_type:message.document?.mime_type||downloaded.contentType,file_path:path,file_hash:hash,row_count:0,error_count:0,warning_count:reportType==='unclassified_document'?1:0,summary:{caption},submitted_by:identity.user_id,source_chat_id:String(message.chat.id),source_message_id:String(message.message_id)}]);
  await patch('telegram_messages',`id=eq.${stored.id}`,{file_path:path,related_entity_type:'import',related_entity_id:rows?.[0]?.id});
  return sendMessage(message.chat.id,`فهمت المستند وحفظت نسخته الأصلية.\nالنوع: <b>${esc(reportTypeLabel(reportType))}</b>\nالمسار: <b>${esc(reportDestination(reportType,group.department))}</b>\nالحالة: محفوظ للمراجعة ولم يُعتمد نهائيًا.`);
}
