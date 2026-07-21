import * as XLSX from 'xlsx';
import { config } from './config.js';
import { select, patch, rpc, downloadObject, insert } from './supabase.js';
import { sendMessage, sendDocumentBuffer, keyboard } from './telegram.js';
import { parseDailyWorkbook } from './daily-summary-parser.js';
import { commitDailyReportFromTelegram } from './routes/daily-report.js';
import { capabilityAllowed } from './permissions.js';
import { generateCustomerMovementPdf } from './daily-customer-movement-pdf.js';
import { generateCumulativeDailyPdfs } from './daily-cumulative-pdf.js';
import { requestDailyBackup } from './daily-backup-trigger.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const num=value=>Number(value||0).toLocaleString('en-US',{maximumFractionDigits:3});
const dateFromName=name=>{const value=String(name||'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d));let match=value.match(/(20\d{2})[./_-](\d{1,2})[./_-](\d{1,2})/);if(match)return`${match[1]}-${String(match[2]).padStart(2,'0')}-${String(match[3]).padStart(2,'0')}`;match=value.match(/(\d{1,2})[./_-](\d{1,2})[./_-](20\d{2})/);return match?`${match[3]}-${String(match[2]).padStart(2,'0')}-${String(match[1]).padStart(2,'0')}`:'';};

export function dailyReportReviewKeyboard(importId,{canApprove=false,allowGap=false}={}){
  const id=String(importId||'');if(!id)return{};
  const rows=[];
  if(canApprove)rows.push([{text:allowGap?'اعتماد رغم فجوة التواريخ':'اعتماد التقرير',callback_data:`dr:${allowGap?'force':'approve'}:${id}`}]);
  rows.push([{text:'رفض الملف وعدم ترحيله',callback_data:`dr:reject:${id}`}]);
  return keyboard(rows);
}

async function canApprove(identity){
  if(!identity?.active||!identity?.user_id)return false;
  const role=String(identity.role||'pending'),userId=String(identity.user_id),[roleRows,userRows]=await Promise.all([
    select('role_capabilities',`role=eq.${encodeURIComponent(role)}&select=capability,allowed&limit=500`).catch(()=>[]),
    select('user_capabilities',`app_user_id=eq.${encodeURIComponent(userId)}&select=capability,allowed&limit=500`).catch(()=>[])
  ]);
  return capabilityAllowed(role,'daily_report.approve',roleRows,userRows);
}
function payloadFromAnalysis(analysis,reportDate,importId){
  const inventory=[...(analysis?.finishedGoods||[]).map((row,index)=>({sourceRowNo:row.row||index+1,inventoryType:'finished_goods',itemCode:row.itemCode,itemName:row.itemName,unit:row.unit||null,opening:row.opening,received:row.received,issued:row.issued,closing:row.closing})),...(analysis?.rawMaterials||[]).map((row,index)=>({sourceRowNo:row.row||index+1,inventoryType:'raw_material',itemCode:row.itemCode,itemName:row.itemName,unit:row.unit||null,opening:row.opening,received:row.received,issued:row.issued,closing:row.closing}))];
  return{sales:(analysis?.sales||[]).map((row,index)=>({sourceRowNo:row.row||index+1,invoiceNo:row.invoice,salesType:row.kind==='بلوك'?'block':row.kind==='خرسانة'?'concrete':'',customerCode:row.customerCode,customerName:row.customer,item:row.item,quantity:row.quantity,amount:row.amount,paymentTerms:null})),cashMovements:(analysis?.collections||[]).map((row,index)=>({sourceRowNo:row.row||index+1,treasuryCode:row.treasuryCode,treasuryName:row.treasuryName,debit:row.amount,credit:0,accountName:row.customer,accountCode:row.customerCode,movementType:'استلام عميل',voucherNo:`TG-${String(importId||'file').slice(0,12)}-${row.row||index+1}`,movementDate:reportDate,isCustomerCollection:true})),treasuries:[],inventory,summary:{totalSales:analysis?.summary?.salesTotal||0}};
}
async function loadImport(importId){
  const row=(await select('imports',`id=eq.${encodeURIComponent(importId)}&select=id,status,original_name,file_path,file_hash,summary,source_chat_id,report_type,submitted_by,posted_batch_id&limit=1`))?.[0];
  if(!row)throw Object.assign(new Error('ملف التقرير غير موجود في مركز الوارد.'),{code:'IMPORT_NOT_FOUND'});
  return row;
}
async function readImport(row){
  if(!row.file_path)throw Object.assign(new Error('النسخة الأصلية للملف غير محفوظة؛ أعد إرسال Excel.'),{code:'ORIGINAL_FILE_REQUIRED'});
  const downloaded=await downloadObject(row.file_path),workbook=XLSX.read(downloaded.buffer,{type:'buffer',cellDates:true}),analysis=parseDailyWorkbook(workbook,XLSX),reportDate=analysis.reportDate||row.summary?.daily?.reportDate||dateFromName(row.original_name);
  if(!reportDate)throw Object.assign(new Error('تعذر تحديد تاريخ الحركة من داخل الملف أو اسمه. أعد إرسال Excel مع كتابة التاريخ في التعليق مثل: تاريخ 20/07/2026.'),{code:'REPORT_DATE_REQUIRED'});
  analysis.reportDate=reportDate;
  return{analysis,reportDate};
}
async function rejectImport(row,identity){
  const actor=String(identity?.user_id||identity?.external_id||'telegram');
  try{await rpc('transition_import_status',{p_import_id:row.id,p_next_status:'rejected',p_actor:actor,p_note:'رفض التقرير من Telegram قبل الترحيل',p_posted_batch_id:null,p_result:{rejectedFrom:'telegram'}});}
  catch(error){if(!/TRANSITION_INVALID/i.test(String(error?.message||'')))throw error;await patch('imports',`id=eq.${encodeURIComponent(row.id)}`,{status:'rejected',last_error_code:null,last_error_message:null,updated_at:new Date().toISOString()});}
  await insert('audit_log',[{actor_type:'telegram',actor_id:actor,action:'daily_report_rejected_before_posting',entity_type:'import',entity_id:row.id,details:{original_name:row.original_name}}],{prefer:'return=minimal'}).catch(()=>{});
}
async function sendOfficialReports(chatId,analysis,reportDate,name){
  const movement=await generateCustomerMovementPdf(analysis,reportDate,name);await sendDocumentBuffer(chatId,movement.pdf,movement.filename,'application/pdf',`معتمد — ${movement.caption.replace(' — مسودة','')}`);
  const departments=await generateCumulativeDailyPdfs(analysis,name,reportDate);for(const report of departments)await sendDocumentBuffer(chatId,report.pdf,report.filename,'application/pdf',`معتمد — ${report.caption.replace('مسودة','نهائي')}`);
}
function approvalSummary(result,reportDate){const p=result.preview||{},a=result.accounting||{};return`<b>تم اعتماد وترحيل تقرير ${esc(reportDate)}.</b>\nالفواتير: <b>${num(p.invoiceCount)}</b>\nالمبيعات: <b>${num(p.salesTotal)} ر.س</b>\nالتحصيلات: <b>${num(p.collectionTotal)} ر.س</b>\nحركات المخزون: <b>${num(p.inventoryRows)}</b>\nالقيود: <b>${num(a.entryCount)}</b> — ${a.balanced?'متوازنة':'تحتاج مراجعة'}`;}

export async function handleDailyReportCallback(message,from,identity,action,importId){
  const row=await loadImport(importId),chatId=message.chat.id;
  if(action==='reject'){
    if(!await canApprove(identity)){await sendMessage(chatId,'ليست لديك صلاحية رفض أو اعتماد التقرير.');return true;}
    if(['posted','approved'].includes(row.status)){await sendMessage(chatId,'التقرير مرحّل بالفعل؛ لا يستخدم الرفض بعد الاعتماد. يلزم إجراء عكس رسمي.');return true;}
    await rejectImport(row,identity);await sendMessage(chatId,`تم رفض ملف <b>${esc(row.original_name)}</b>. بقيت النسخة الأصلية محفوظة للمراجعة، ولم تُنشأ قيود أو حركات.`);return true;
  }
  if(!['approve','force'].includes(action))return false;
  if(!await canApprove(identity)){await sendMessage(chatId,'ليست لديك صلاحية اعتماد التقرير اليومي.');return true;}
  if(action==='force'&&!['admin','manager'].includes(String(identity.role||''))){await sendMessage(chatId,'اعتماد فجوة التواريخ متاح لمدير النظام أو مدير المصنع فقط.');return true;}
  if(['posted','approved'].includes(row.status)){await sendMessage(chatId,'هذا التقرير معتمد ومرحّل بالفعل.');return true;}
  await sendMessage(chatId,`جارٍ التحقق النهائي من <b>${esc(row.original_name)}</b> قبل الترحيل...`);
  try{
    const{analysis,reportDate}=await readImport(row),result=await commitDailyReportFromTelegram({reportDate,originalName:row.original_name,fileHash:row.file_hash,contentHash:row.file_hash,idempotencyKey:`telegram-daily:${reportDate}:${row.file_hash}`,importId:row.id,allowDateGap:action==='force',payload:payloadFromAnalysis(analysis,reportDate,row.id)},String(identity.user_id||identity.external_id||from?.id||'telegram'));
    if(!result.ok&&result.timeline?.missingDates?.length){await sendMessage(chatId,`توجد أيام غير معتمدة قبل ${esc(reportDate)}: <b>${esc(result.timeline.missingDates.join('، '))}</b>. لم يُرحّل شيء.`,dailyReportReviewKeyboard(row.id,{canApprove:true,allowGap:true}));return true;}
    if(!result.ok){await sendMessage(chatId,`لم يعتمد التقرير.\n${(result.errors||[]).slice(0,8).map((error,index)=>`${index+1}. ${esc(error.message||error.code)}`).join('\n')||esc(result.reason||'فشل التحقق')}`);return true;}
    requestDailyBackup('daily-report-approved').catch(()=>null);
    const recipients=[String(chatId),String(row.source_chat_id||''),String(config.telegramOwnerId||'')].filter((value,index,array)=>value&&array.indexOf(value)===index);
    for(const target of recipients){await sendMessage(target,approvalSummary(result,reportDate));await sendOfficialReports(target,analysis,reportDate,row.original_name).catch(error=>sendMessage(target,`تم الاعتماد، لكن تعذر إنشاء ملفات PDF النهائية: ${esc(error.message)}`).catch(()=>null));}
    return true;
  }catch(error){
    const text=String(error?.message||'تعذر اعتماد التقرير').slice(0,700);await sendMessage(chatId,`لم يُرحّل التقرير.\nالسبب: ${esc(text)}`);return true;
  }
}
