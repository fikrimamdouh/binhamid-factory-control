import { select, downloadObject } from './supabase.js';
import { sendMessage, sendDocumentBuffer, keyboard } from './telegram.js';
import { allowed } from './domain.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const norm=value=>String(value||'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/[؟?!.,،؛:]+/g,' ').replace(/\s+/g,' ').trim();
const number=value=>Number(value||0).toLocaleString('en-US',{maximumFractionDigits:2});
const isoToday=()=>new Date().toISOString().slice(0,10);

function isoDate(value){
  const text=String(value||'').trim().replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  if(/^\d{4}-\d{2}-\d{2}$/.test(text))return text;
  const match=text.match(/^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?$/);
  if(!match)return'';
  const year=match[3]?Number(match[3])<100?2000+Number(match[3]):Number(match[3]):Number(isoToday().slice(0,4));
  const month=Number(match[2]),day=Number(match[1]);
  const candidate=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  return Number.isNaN(new Date(`${candidate}T12:00:00Z`).getTime())?'':candidate;
}

function requestKind(text=''){
  const value=norm(text);
  if(/خرسان/.test(value))return'concrete';
  if(/بلوك|بلك/.test(value))return'block';
  if(/تقرير يومي|التقرير اليومي|ملف التقرير|تقارير يوميه|تقارير يومية/.test(value))return'daily';
  return'';
}

function datesFromText(text=''){
  const normalized=String(text||'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  const matches=normalized.match(/\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?/g)||[];
  return matches.map(isoDate).filter(Boolean).slice(0,2);
}

function summaryOf(row){return row?.preview_summary||row?.summary||{};}
function matchesKind(row,kind){
  const summary=summaryOf(row);
  if(kind==='concrete')return Number(summary.concreteSales||summary.concrete_sales||0)>0||Number(summary.concreteQuantity||summary.concrete_quantity||0)>0;
  if(kind==='block')return Number(summary.blockSales||summary.block_sales||0)>0||Number(summary.blockQuantity||summary.block_quantity||0)>0;
  return true;
}
function kindLabel(kind){return kind==='concrete'?'تقرير الخرسانة':kind==='block'?'تقرير البلوك':'التقرير اليومي';}
function canRead(identity,kind){
  const role=identity?.role||'pending';
  if(role==='admin'||role==='manager'||role==='accountant')return true;
  if(kind==='concrete'&&role==='concrete_sales')return true;
  if(kind==='block'&&role==='block_sales')return true;
  return allowed(role,'report');
}
function caption(row,kind){
  const s=summaryOf(row),lines=[kindLabel(kind),`التاريخ: ${row.report_date||'—'}`,`الملف: ${row.original_name||'daily-report.xlsx'}`];
  if(kind==='concrete'||kind==='daily')lines.push(`الخرسانة: ${number(s.concreteQuantity||s.concrete_quantity)} م³ — ${number(s.concreteSales||s.concrete_sales)} ر.س`);
  if(kind==='block'||kind==='daily')lines.push(`البلوك: ${number(s.blockQuantity||s.block_quantity)} قطعة — ${number(s.blockSales||s.block_sales)} ر.س`);
  if(kind==='daily')lines.push(`التحصيلات: ${number(s.collectionTotal||s.collection_total)} ر.س`);
  return lines.join('\n');
}

async function reportRows(){
  return await select('daily_report_batches','file_storage_path=not.is.null&select=id,report_date,original_name,file_storage_path,status,preview_summary,summary,approved_at,committed_at&order=report_date.desc&limit=120').catch(()=>[]);
}

export async function sendStoredReportFile(chatId,id,identity,kind='daily'){
  if(!canRead(identity,kind))return sendMessage(chatId,'ليست لديك صلاحية تنزيل هذا التقرير.');
  const row=(await select('daily_report_batches',`id=eq.${encodeURIComponent(String(id))}&file_storage_path=not.is.null&select=id,report_date,original_name,file_storage_path,status,preview_summary,summary&limit=1`))?.[0];
  if(!row)return sendMessage(chatId,'ملف التقرير غير موجود أو لم يُحفظ في التخزين السحابي.');
  if(!matchesKind(row,kind))return sendMessage(chatId,`هذا الملف لا يحتوي على بيانات ${kind==='concrete'?'خرسانة':kind==='block'?'بلوك':'تقرير يومي'} قابلة للعرض.`);
  const object=await downloadObject(row.file_storage_path);
  return sendDocumentBuffer(chatId,object.buffer,row.original_name||`daily-report-${row.report_date}.xlsx`,object.contentType,caption(row,kind));
}

async function showChoices(chatId,rows,kind,title){
  const buttons=rows.slice(0,20).map(row=>[{text:`${row.report_date} — ${kindLabel(kind)}`,callback_data:`reportfile:${kind}|${row.id}`}]);
  return sendMessage(chatId,`${title}\nالنتائج: <b>${rows.length}</b>\nاختر التاريخ المطلوب:`,keyboard(buttons));
}

export async function sendStoredReportRequest(chatId,identity,kind,options={}){
  if(!canRead(identity,kind))return sendMessage(chatId,'ليست لديك صلاحية عرض أو تنزيل هذا النوع من التقارير.');
  const rows=(await reportRows()).filter(row=>matchesKind(row,kind));
  if(!rows.length)return sendMessage(chatId,`لا توجد ملفات معتمدة تحتوي على ${kindLabel(kind)} حتى الآن.`);
  const from=options.from||'',to=options.to||'',date=options.date||'';
  const matching=rows.filter(row=>date?row.report_date===date:from&&to?row.report_date>=from&&row.report_date<=to:true);
  if(!matching.length)return sendMessage(chatId,`لا يوجد ${kindLabel(kind)} مطابق للتاريخ أو المدة المطلوبة.`);
  if(date||(!from&&!to))return sendStoredReportFile(chatId,matching[0].id,identity,kind);
  if(matching.length===1)return sendStoredReportFile(chatId,matching[0].id,identity,kind);
  return showChoices(chatId,matching,kind,`وجدت ملفات ${kindLabel(kind)} من <b>${esc(from)}</b> إلى <b>${esc(to)}</b>.`);
}

export async function handleStoredReportTextCommand(message,identity,text){
  const kind=requestKind(text);if(!kind)return false;
  const normalized=norm(text);if(!/تقرير|تقارير|ملف|تحميل|نزل|نزّل|ارسل|أرسل/.test(normalized))return false;
  const dates=datesFromText(text),options=dates.length>=2?{from:dates[0]<=dates[1]?dates[0]:dates[1],to:dates[0]<=dates[1]?dates[1]:dates[0]}:dates.length===1?{date:dates[0]}:{};
  await sendStoredReportRequest(message.chat.id,identity,kind,options);return true;
}
