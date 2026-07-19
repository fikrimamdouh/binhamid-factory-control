import * as XLSX from 'xlsx';
import { config } from './config.js';
import { select, insert, patch, uploadObject } from './supabase.js';
import { sendMessage, sendDocumentBuffer, downloadTelegramFile } from './telegram.js';
import { classifyFile, sha256 } from './domain.js';
import { parseDailyWorkbook } from './daily-summary-parser.js';
import { generateCumulativeDailyPdfs } from './daily-cumulative-pdf.js';
import { generateFuelReportPdf } from './fuel-report-pdf.js';
import { generateCustomerPortfolioPdfs } from './customer-portfolio-pdf.js';
import { commitDailyReportFromTelegram } from './routes/daily-report.js';
import { reportTypeLabel, reportDestination } from './bot-profile.js';
import { capabilityAllowed } from './permissions.js';
import { handleProductImage } from './bot-product-assistant.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const plain=v=>String(v??'').replace(/<[^>]+>/g,'');
// Supabase Storage object keys must be ASCII-safe. Arabic (or any non-ASCII)
// characters in the original Telegram file name used to be kept here, which
// produced keys like ".../ملخص_العمل_اليومي2.xlsx" and Supabase rejected the
// upload with "Invalid key" — the file was read correctly but never saved,
// and every later "فتح في المستورد" attempt failed with it. The human-
// readable name is preserved separately in imports.original_name for the UI
// and downloads; this value is only used inside the storage path itself.
const safeFile=v=>{
  let base=String(v||'file').replace(/[^\x00-\x7F]/g,'_').replace(/[^A-Za-z0-9._-]/g,'_').replace(/_+/g,'_').replace(/^_+|_+$/g,'');
  if(!base||base.startsWith('.'))base='file'+base;
  return base.slice(0,140);
};
const number=value=>Number(value||0).toLocaleString('en-US',{maximumFractionDigits:3});
const dailyType=type=>['daily_movement','block_daily_movement','concrete_daily_movement'].includes(type);
const DAILY_APPROVE_CAPABILITY='daily_report.approve';
export function dailyReportApprovalDecision(recognizedDaily,status,canApprove){const ready=Boolean(recognizedDaily&&status==='ready');return{shouldPost:ready&&Boolean(canApprove),waitingApproval:ready&&!canApprove};}
async function identityCanApproveDailyReport(identity){
  if(!identity?.active||!identity?.user_id)return false;
  const role=String(identity.role||'pending'),userId=String(identity.user_id);
  const[roleRows,userRows]=await Promise.all([select('role_capabilities',`role=eq.${encodeURIComponent(role)}&select=capability,allowed&limit=500`).catch(()=>[]),select('user_capabilities',`app_user_id=eq.${encodeURIComponent(userId)}&select=capability,allowed&limit=500`).catch(()=>[])]);
  return capabilityAllowed(role,DAILY_APPROVE_CAPABILITY,roleRows,userRows);
}
async function dailyReportApproverChats(excludeChatIds=[]){
  const excluded=new Set((excludeChatIds||[]).map(value=>String(value||'')).filter(Boolean)),chats=new Set();
  if(config.telegramOwnerId&&!excluded.has(String(config.telegramOwnerId)))chats.add(String(config.telegramOwnerId));
  try{
    const[users,roleRows,userRows]=await Promise.all([select('app_users','active=eq.true&select=id,role&limit=500').catch(()=>[]),select('role_capabilities','select=role,capability,allowed&limit=2000').catch(()=>[]),select('user_capabilities','select=app_user_id,capability,allowed&limit=5000').catch(()=>[])]);
    const approverIds=(users||[]).filter(user=>capabilityAllowed(user.role,DAILY_APPROVE_CAPABILITY,(roleRows||[]).filter(row=>String(row.role)===String(user.role)),(userRows||[]).filter(row=>String(row.app_user_id)===String(user.id)))).map(user=>String(user.id)).filter(Boolean);
    if(approverIds.length){const channels=await select('user_channels',`active=eq.true&channel=eq.telegram&user_id=in.(${approverIds.join(',')})&select=external_id&limit=1000`).catch(()=>[]);for(const row of channels||[]){const chatId=String(row.external_id||'');if(chatId&&!excluded.has(chatId))chats.add(chatId);}}
  }catch(error){console.warn('[telegram daily approvers lookup]',{message:String(error?.message||'').slice(0,300)});}
  return[...chats];
}
async function notifyDailyReportApprovers(details,excludeChatIds=[]){
  const chats=await dailyReportApproverChats(excludeChatIds);if(!chats.length)return{recipients:0,delivered:0,failed:0};
  const text=`<b>ملف يومي جاهز وينتظر الاعتماد</b>\n\nالملف: <b>${esc(details.name)}</b>\nالنوع: <b>${esc(reportTypeLabel(details.reportType))}</b>\nالتاريخ التشغيلي: <b>${esc(details.reportDate)}</b>\nأرسله: <b>${esc(details.senderName||'مستخدم Telegram')}</b>\nالحالة: <b>بانتظار الاعتماد</b>${dailySummaryText(details.summary||{})}\n\nلم تُرحّل أي مبيعات أو تحصيلات. افتح مركز الوارد للمراجعة والاعتماد.`;
  const sent=await Promise.allSettled(chats.map(chatId=>sendMessage(chatId,text,{action_name:'daily_report_pending_approval',action_payload:{import_id:details.importId,report_date:details.reportDate}}))),delivered=sent.filter(item=>item.status==='fulfilled').length,failed=sent.length-delivered;
  if(failed)console.warn('[telegram daily approvers notification]',{recipients:chats.length,delivered,failed,importId:details.importId});return{recipients:chats.length,delivered,failed};
}
async function excelStep(stage,operation){try{return await operation();}catch(error){const tagged=error instanceof Error?error:new Error(String(error||'Unknown error'));if(!tagged.excelStage)tagged.excelStage=stage;throw tagged;}}
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
function importStatusText(status){
  const map={
    ready:'جاهز — لم يُعتمد بعد',
    ready_for_review:'ينتظر المراجعة — لم يُعتمد بعد',
    opened_in_program:'فُتح في المستورد لكن لم يُعتمد بعد',
    validating:'قيد التحقق',
    validation_failed:'فشل التحقق — يحتاج مراجعة',
    failed:'فشلت القراءة — يحتاج مراجعة',
    posted:'مُعتمد ومُرحّل نهائيًا ✅',
    approved:'مُعتمد ومُرحّل نهائيًا ✅'
  };
  const posted=status==='posted'||status==='approved';
  return{label:map[status]||esc(status)||'غير معروف',posted,callToAction:posted?'':'\nلم يُعتمد بعد. افتح مركز الوارد على الموقع وادخل عليه من "فتح في المستورد" ثم اضغط اعتماد ليصبح نهائيًا.'};
}
function dailySummaryText(summary={}){
  if(!summary.invoiceCount&&!summary.collectionCount&&!summary.finishedGoodsCount&&!summary.rawMaterialsCount)return'';
  const inventoryLine=(summary.finishedGoodsCount||summary.rawMaterialsCount)?`\nالمنتجات التامة: <b>${number(summary.finishedGoodsCount||0)} صنف — منصرف ${number(summary.finishedGoodsIssued||0)}</b>\nالخامات: <b>${number(summary.rawMaterialsCount||0)} صنف — وارد ${number(summary.rawMaterialsReceived||0)}</b>`:'';
  return`\n\n<b>ملخص القراءة:</b>\nالفواتير: <b>${number(summary.invoiceCount)}</b>\nإجمالي المبيعات: <b>${number(summary.salesTotal)} ر.س</b>\nالبلوك: <b>${number(summary.blockQuantity)} قطعة — ${number(summary.blockSales)} ر.س</b>\nالخرسانة: <b>${number(summary.concreteQuantity)} م³ — ${number(summary.concreteSales)} ر.س</b>\nالتحصيلات: <b>${number(summary.collectionCount)} حركة — ${number(summary.collectionTotal)} ر.س</b>${inventoryLine}`;
}
function reportDateFromFile(name,messageDate){
  const value=String(name||'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d));let match=value.match(/(20\d{2})[./_-](\d{1,2})[./_-](\d{1,2})/);if(match)return`${match[1]}-${String(match[2]).padStart(2,'0')}-${String(match[3]).padStart(2,'0')}`;match=value.match(/(\d{1,2})[./_-](\d{1,2})[./_-](20\d{2})/);if(match)return`${match[3]}-${String(match[2]).padStart(2,'0')}-${String(match[1]).padStart(2,'0')}`;const epoch=Number(messageDate||0)*1000;return new Date(epoch||Date.now()).toLocaleDateString('en-CA',{timeZone:'Asia/Riyadh'});
}
function autoPayload(analysis,reportDate,importId){return{sales:(analysis?.sales||[]).map((row,index)=>({sourceRowNo:row.row||index+1,invoiceNo:row.invoice,salesType:row.kind==='بلوك'?'block':row.kind==='خرسانة'?'concrete':'',customerCode:row.customerCode,customerName:row.customer,item:row.item,quantity:row.quantity,amount:row.amount,paymentTerms:null})),cashMovements:(analysis?.collections||[]).map((row,index)=>({sourceRowNo:row.row||index+1,treasuryCode:row.treasuryCode,treasuryName:row.treasuryName,debit:row.amount,credit:0,accountName:row.customer,accountCode:row.customerCode,movementType:'استلام عميل',voucherNo:`TG-${String(importId||'file').slice(0,12)}-${row.row||index+1}`,movementDate:reportDate,isCustomerCollection:true})),treasuries:[],inventory:[],summary:{totalSales:analysis?.summary?.salesTotal||0}};}
function autoPostingText(result={}){const preview=result.preview||{},errors=(result.errors||[]).slice(0,5),warnings=(result.warnings||[]).slice(0,5),balances=(result.affectedBalances||[]).slice(0,5);if(result.duplicate)return`<b>لم يُسجل تكرار.</b> هذا الملف مرحّل سابقًا بنفس البصمة.\nالمرجع: <b>${esc(result.existingImportId||'—')}</b>`;if(!result.ok)return`<b>حُفظ الملف ولم يُرحّل.</b>\nالأخطاء: <b>${number(errors.length||preview.errorCount||0)}</b>\n${errors.map((error,index)=>`${index+1}. ${esc(error.message||error.code||'خطأ تحقق')}`).join('\n')}\n\nافتح مركز الوارد لمراجعة الأخطاء؛ لم يُنشأ أي قيد أو مبيعات جزئية.`;const accounting=result.accounting||{};return`<b>تم ترحيل التقرير تلقائيًا بنجاح.</b>\nالفواتير: <b>${number(preview.invoiceCount)}</b>\nالمبيعات: <b>${number(preview.salesTotal)} ر.س</b>\nالتحصيلات: <b>${number(preview.collectionTotal)} ر.س</b>\nالخزينة 101: <b>${number(preview.treasury101)} ر.س</b> — الخزينة 104: <b>${number(preview.treasury104)} ر.س</b>\nالقيود: <b>${number(accounting.entryCount)}</b> ${accounting.balanced?'ومتوازنة':'تحتاج مراجعة'}\n${balances.length?`\n<b>الأرصدة المتأثرة:</b>\n${balances.map(row=>`• ${esc(row.customerName)} (${esc(row.customerCode)}): <b>${number(row.balance)} ر.س</b>`).join('\n')}`:''}${warnings.length?`\n\n💰 <b>ملاحظات (لا تمنع الترحيل):</b>\n${warnings.map((warning,index)=>`${index+1}. ${esc(warning.message||warning.code||'')}`).join('\n')}`:''}`;}
async function sendProcessingResult(chatId,text,name){try{return await sendMessage(chatId,text);}catch(error){console.error('[telegram excel result reply]',{status:Number(error?.status||0),message:String(error?.message||'').slice(0,300)});try{return await sendMessage(chatId,`تمت معالجة ملف <b>${esc(name)}</b> وحفظ نتيجته، لكن تعذر إرسال تفاصيل القراءة. افتح مركز الوارد لمراجعته.`);}catch(fallbackError){console.error('[telegram excel result fallback]',{status:Number(fallbackError?.status||0),message:String(fallbackError?.message||'').slice(0,300)});return null;}}}
async function relayToOwner(sourceChatId,buffer,name,contentType,caption,actionPayload={}){const owner=String(config.telegramOwnerId||'');if(!owner||owner===String(sourceChatId)||!buffer?.length)return null;try{return await sendDocumentBuffer(owner,buffer,name,contentType,plain(caption).slice(0,900));}catch(error){console.warn('[telegram owner file relay]',{name,status:Number(error?.status||0),message:String(error?.message||'').slice(0,300),actionPayload});return null;}}
async function sendCumulativeDailyReports(chatId,analysis,name){
  try{
    await sendMessage(chatId,'جارٍ إعداد تقرير البلوك وتقرير الخرسانة من الأرصدة السابقة وحركة الملف الحالي.');
    const reports=await generateCumulativeDailyPdfs(analysis||{},name);
    for(const report of reports)await sendDocumentBuffer(chatId,report.pdf,report.filename,'application/pdf',report.caption);
    // نفس إقرار "مسؤولية محفظة عملاء" الموجود في الموقع (المندوب، القطاع،
    // قيمة التوريدات، المدفوع، المتبقي) — يُبنى هنا من نفس نص البنود المحفوظ
    // ونفس أرصدة العملاء، فتخرج نتيجة تليجرام مطابقة لنتيجة الموقع.
    try{
      const portfolios=await generateCustomerPortfolioPdfs(analysis||{},name);
      for(const portfolio of portfolios)await sendDocumentBuffer(chatId,portfolio.pdf,portfolio.filename,'application/pdf',portfolio.caption);
    }catch(portfolioError){
      console.error('[telegram customer portfolio pdf]',{code:portfolioError?.code||null,message:String(portfolioError?.message||'').slice(0,500)});
      await sendMessage(chatId,'تم إرسال تقريري البلوك والخرسانة، لكن تعذر إنشاء إقراري محفظة العملاء.\nالسبب: '+esc(String(portfolioError?.message||'').slice(0,300))).catch(()=>null);
    }
    await sendMessage(chatId,'تم إرسال التقارير كمسودة تراكميّة. بعد اعتماد الملف تصبح الحركة جزءًا من الرصيد الرسمي لليوم التالي.');
    return reports;
  }catch(error){
    console.error('[telegram daily cumulative pdf]',{code:error?.code||null,status:Number(error?.status||error?.upstreamStatus||0),message:String(error?.message||'').slice(0,500)});
    const reason=error?.code==='PDF_SERVICE_NOT_CONFIGURED'?'خدمة PDF غير مضبوطة. يلزم ضبط PDF_PROVIDER وPDF_API_URL في Vercel.':String(error?.message||'تعذر إنشاء ملفات PDF').slice(0,300);
    await sendMessage(chatId,`تم حفظ ملف Excel وقراءته، لكن تعذر إنشاء تقريري PDF.\nالسبب: ${esc(reason)}`).catch(()=>null);
    return[];
  }
}
// تقرير الديزل: يقرأ الملف برقم اللوحة ويرسل PDF فيه استهلاك كل لوحة وكل
// التحذيرات (إيصال مكرر، عداد غير منطقي، تعبئة متقاربة، كمية/سعر شاذ).
async function sendFuelReport(chatId,buffer,name){
  try{
    const workbook=XLSX.read(buffer,{type:'buffer',cellDates:true});
    const{pdf,filename,caption,report,rowCount}=await generateFuelReportPdf(workbook,XLSX,name);
    if(!rowCount){await sendMessage(chatId,'لم أجد صفوف ديزل صالحة (برقم لوحة ومبلغ أو كمية) في هذا الملف.');return null;}
    await sendDocumentBuffer(chatId,pdf,filename,'application/pdf',caption);
    const t=report.totals;
    await sendMessage(chatId,`⛽ تم تحليل ${t.fillCount} تعبئة على ${t.plateCount} لوحة.\nإجمالي اللترات: ${t.liters}\nإجمالي المبلغ: ${t.amount} ر.س\nالملاحظات: ${t.danger} حرجة، ${t.warn} تنبيه.`);
    return report;
  }catch(error){
    console.error('[telegram fuel report]',{code:error?.code||null,status:Number(error?.status||error?.upstreamStatus||0),message:String(error?.message||'').slice(0,500)});
    const reason=error?.code==='PDF_SERVICE_NOT_CONFIGURED'?'خدمة PDF غير مضبوطة. يلزم ضبط PDF_PROVIDER وPDF_API_URL في Vercel.':String(error?.message||'تعذر إنشاء تقرير الديزل').slice(0,300);
    await sendMessage(chatId,`تم حفظ ملف الديزل وقراءته، لكن تعذر إنشاء تقرير PDF.\nالسبب: ${esc(reason)}`).catch(()=>null);
    return null;
  }
}

export async function handleExcel(message,group,identity,stored){
  const document=message.document,chatId=message.chat.id,name=document.file_name||'report.xlsx';await sendMessage(chatId,`تم استلام ملف <b>${esc(name)}</b>. جارٍ تنزيله وفحصه وحفظه في مركز الوارد.`);let resultText='',result=null,relay=null,dailyAnalysis=null;
  try{
    const downloaded=await excelStep('download',()=>downloadTelegramFile(document.file_id,{expectedSize:document.file_size,maxBytes:config.maxImportFileBytes}));relay={buffer:downloaded.buffer,contentType:document.mime_type||downloaded.contentType};const hash=sha256(downloaded.buffer);
    const duplicate=(await excelStep('lookup',()=>select('imports',`file_hash=eq.${hash}&select=id,status,original_name,report_type,summary,file_path&limit=1`)))?.[0],storagePending=duplicate?.summary?.storage?.saved===false,recheck=Boolean(duplicate&&(duplicate.report_type==='unknown_excel'||duplicate.status==='failed'||!duplicate.report_type||storagePending));
    if(duplicate&&!recheck){
      const recognizedDaily=dailyType(duplicate.report_type),statusInfo=importStatusText(duplicate.status);
      try{const workbook=XLSX.read(downloaded.buffer,{type:'buffer',cellDates:true});dailyAnalysis=parseDailyWorkbook(workbook,XLSX);}catch{dailyAnalysis=null;}
      resultText=`هذا الملف سبق استلامه.\nالملف: <b>${esc(duplicate.original_name)}</b>\nالنوع: <b>${esc(reportTypeLabel(duplicate.report_type))}</b>\nحالة الاعتماد: <b>${statusInfo.label}</b>${statusInfo.callToAction}${dailySummaryText(duplicate.summary?.daily||duplicate.summary||{})}`;
      result={ok:statusInfo.posted,duplicate:true,import:duplicate,reportType:duplicate.report_type,status:duplicate.status==='failed'?'failed':'ready',recognizedDaily};
    }
    else{
      let sheetNames=[],rowCount=0,summary={},contentText='',status='ready',errorCount=0;
      try{const workbook=XLSX.read(downloaded.buffer,{type:'buffer',cellDates:true});dailyAnalysis=parseDailyWorkbook(workbook,XLSX);sheetNames=workbook.SheetNames;rowCount=dailyAnalysis.rowCount;contentText=dailyAnalysis.contentText;summary={sheetNames,daily:dailyAnalysis.summary};}catch(error){status='failed';errorCount=1;summary={error:String(error?.message||'تعذر قراءة المصنف').slice(0,500)};}
      const reportType=classifyFile(name,group.department,sheetNames,contentText),path=duplicate?.file_path||`telegram/${group.department||'unassigned'}/${new Date().toISOString().slice(0,10)}/${hash.slice(0,16)}-${safeFile(name)}`;
      let storageSaved=Boolean(duplicate?.file_path&&!storagePending),storageFailure='';
      if(!storageSaved){
        try{await uploadObject(path,downloaded.buffer,document.mime_type||downloaded.contentType);storageSaved=true;}
        catch(error){storageFailure=String(error?.message||'تعذر حفظ النسخة الأصلية').slice(0,500);console.error('[telegram excel storage fallback]',{status:Number(error?.status||error?.upstreamStatus||0),message:storageFailure,path});}
      }
      summary={...summary,storage:{saved:storageSaved,path,telegram_file_id:String(document.file_id||''),...(storageFailure?{error:storageFailure,failed_at:new Date().toISOString()}:{})}};
      const importStatus=status==='ready'&&!storageSaved?'ready_for_review':status,values={department:group.department||'unassigned',report_type:reportType,status:importStatus,original_name:name,mime_type:document.mime_type||downloaded.contentType,file_path:path,file_hash:hash,row_count:rowCount,error_count:errorCount,warning_count:(reportType==='unknown_excel'?1:0)+(storageSaved?0:1),summary,submitted_by:identity.user_id,source_chat_id:String(chatId),source_message_id:String(message.message_id),last_error_code:storageSaved?null:'ORIGINAL_STORAGE_FAILED',last_error_message:storageSaved?null:storageFailure,updated_at:new Date().toISOString()};
      const register=async()=>duplicate?await patch('imports',`id=eq.${encodeURIComponent(duplicate.id)}`,values):insert('imports',[{source:'telegram',...values}]);const rows=await excelStep('registry',register),imp=rows?.[0]||duplicate;
      if(stored?.id&&imp?.id)await patch('telegram_messages',`id=eq.${stored.id}`,{file_path:storageSaved?path:null,related_entity_type:'import',related_entity_id:imp.id,transcription:null}).catch(error=>console.warn('[telegram excel message link]',error?.message||error));
      const recognizedDaily=dailyType(reportType),reportDate=reportDateFromFile(name,message.date),resultTitle=recheck?'تمت إعادة فحص الملف القديم وتحديث تصنيفه بنجاح.':status!=='ready'?'تم تسجيل الملف، لكن تعذر فحص محتواه آليًا.':storageSaved?'تم فحص الملف وحفظه بنجاح.':'تمت قراءة الملف وتسجيل بياناته؛ نسخة التخزين السحابي فقط معلقة.';let posting=null,senderCanApprove=false,postingFailure=null;
      if(recognizedDaily&&status==='ready')senderCanApprove=await identityCanApproveDailyReport(identity).catch(error=>{console.warn('[telegram excel authorization]',{message:String(error?.message||'').slice(0,300)});return false;});
      const approval=dailyReportApprovalDecision(recognizedDaily,status,senderCanApprove);
      if(approval.shouldPost){try{posting=await commitDailyReportFromTelegram({reportDate,originalName:name,fileHash:hash,contentHash:hash,idempotencyKey:`telegram-daily:${reportDate}:${hash}`,importId:imp.id,payload:autoPayload(dailyAnalysis,reportDate,imp.id)},String(identity.user_id||identity.external_id||'telegram-bot'));}catch(error){postingFailure=String(error?.message||'تعذر الترحيل التلقائي').slice(0,500);console.error('[telegram excel posting]',{status:Number(error?.status||error?.upstreamStatus||0),message:postingFailure});await patch('imports',`id=eq.${encodeURIComponent(imp.id)}`,{status:'ready_for_review',last_error_code:String(error?.code||'AUTO_POSTING_FAILED').slice(0,120),last_error_message:postingFailure}).catch(()=>{});}}
      const state=status!=='ready'?'مسجل لكن تعذر الفحص الآلي':posting?.ok?(storageSaved?'مرحّل تلقائيًا ومربوط بسجل المستخدم':'مرحّل تلقائيًا — نسخة التخزين السحابي معلقة'):posting?.duplicate?'ملف مكرر — لم تُكرر أي قيود':postingFailure?'قُرئ وسُجل — تعذر الترحيل التلقائي فقط':approval.waitingApproval?(storageSaved?'بانتظار الاعتماد':'بانتظار الاعتماد — نسخة التخزين معلقة'):recognizedDaily?(storageSaved?'جاهز للمراجعة':'جاهز للمراجعة — نسخة التخزين معلقة'):'جاهز للمراجعة';
      const storageText=storageSaved?'':`\n\n<b>تنبيه التخزين:</b> تعذر نسخ الملف إلى Supabase Storage، لكن المصنف قُرئ وسُجل واحتُفظ بمعرف ملف Telegram لإعادة المحاولة. لم تُهمل نتيجة القراءة.`;
      const noPostingText=postingFailure?`الملف مسجل ولم تُفقد نتيجة القراءة. تعذر الترحيل التلقائي فقط: ${esc(postingFailure)}\nافتح مركز الوارد للمراجعة والاعتماد.`:approval.waitingApproval?'سُجل الملف دون ترحيل، وسيُخطر مالك النظام والمستخدمون المخولون بالاعتماد.':recognizedDaily?'سُجل الملف وأصبح جاهزًا للمراجعة دون إنشاء قيود جزئية.':'لم تُرحّل البيانات نهائيًا.';
      resultText=`${resultTitle}\n\nالاسم: <b>${esc(name)}</b>\nالنوع: <b>${esc(reportTypeLabel(reportType))}</b>\nالتاريخ التشغيلي: <b>${esc(reportDate)}</b>\nالأوراق: ${esc(sheetNames.join('، ')||'تعذر القراءة')}\nالصفوف: <b>${rowCount}</b>${recognizedDaily?dailySummaryText(summary.daily):''}\nالحالة: <b>${state}</b>${posting?`\n\n${autoPostingText(posting)}`:`\n\n${noPostingText}`}${storageText}`;
      result={duplicate:false,import:imp,reportType,status,path,recognizedDaily,posting,postingFailure,storageSaved,storageFailure,reportDate,pendingApproval:approval.waitingApproval||Boolean(postingFailure),pendingApprovalNotice:(approval.waitingApproval||postingFailure)?{importId:imp.id,name,reportType,reportDate,summary:summary.daily||{},senderName:identity.full_name||identity.external_id}:null};
    }
  }catch(error){console.error('[telegram excel import]',{stage:error?.excelStage||'unknown',status:Number(error?.status||error?.upstreamStatus||0),message:String(error?.message||'').slice(0,500)});await sendMessage(chatId,`تعذر إكمال معالجة ملف <b>${esc(name)}</b>.\nالسبب: ${esc(excelFailureMessage(error))}\nلم تُرحّل أي بيانات من هذا الملف.`).catch(sendError=>console.error('[telegram excel failure reply]',sendError));return null;}
  const ownerRelay=await relayToOwner(chatId,relay?.buffer,name,relay?.contentType,`ملف وارد من Telegram\n\n${resultText}`,{importId:result?.import?.id});if(result?.pendingApproval&&result.pendingApprovalNotice){const excluded=[String(chatId)];if(ownerRelay&&config.telegramOwnerId)excluded.push(String(config.telegramOwnerId));result.approvalNotification=await notifyDailyReportApprovers(result.pendingApprovalNotice,excluded);}  await sendProcessingResult(chatId,resultText,name);
  // تقريرا البلوك والخرسانة التراكميان "مسودة" وليسا مرتبطين بنجاح الترحيل
  // التلقائي — أغلب مرسلي الملف اليومي مندوبو مبيعات وليسوا معتمدين، فكان
  // الشرط القديم (posting?.ok) يمنع إرسالهما في كل تلك الحالات. الآن يُرسلان
  // فورًا لأي ملف يومي جديد قُرئ بنجاح، سواء رُحّل تلقائيًا أو ينتظر الاعتماد.
  if(result?.recognizedDaily&&result?.status!=='failed')result.pdfReports=await sendCumulativeDailyReports(chatId,dailyAnalysis,name);
  else if(result?.reportType==='fuel'&&result?.status!=='failed'&&relay?.buffer)result.fuelReport=await sendFuelReport(chatId,relay.buffer,name);
  return result;
}

export async function handleAttachment(message,group,identity,stored){
  const file=message.document||message.photo?.at(-1),downloaded=await downloadTelegramFile(file.file_id),caption=message.caption||'',session=message.photo?.length?(await select('bot_sessions',`channel=eq.telegram&chat_id=eq.${encodeURIComponent(String(message.chat.id))}&external_user_id=eq.${encodeURIComponent(String(identity.external_id||message.from.id))}&select=state&limit=1`).catch(()=>[]))?.[0]:null;
  if(message.photo?.length&&(session?.state==='product_image_waiting'||/(بحث|ابحث).*(صوره|صورة).*(قطعه|قطعة|منتج)|قطعه.*بحث|قطعة.*بحث/i.test(caption))){return handleProductImage(message,identity,downloaded.buffer,message.document?.mime_type||downloaded.contentType);}
  const hash=sha256(downloaded.buffer),name=message.document?.file_name||`photo-${message.message_id}.jpg`,path=`telegram/${group.department||'unassigned'}/${new Date().toISOString().slice(0,10)}/${hash.slice(0,16)}-${safeFile(name)}`;await uploadObject(path,downloaded.buffer,message.document?.mime_type||downloaded.contentType);
  const reportType=/عرض سعر/.test(caption+name)?'quotation':/فاتور/.test(caption+name)?'invoice':'unclassified_document',rows=await insert('imports',[{source:'telegram',department:group.department||'unassigned',report_type:reportType,status:'received',original_name:name,mime_type:message.document?.mime_type||downloaded.contentType,file_path:path,file_hash:hash,row_count:0,error_count:0,warning_count:reportType==='unclassified_document'?1:0,summary:{caption},submitted_by:identity.user_id,source_chat_id:String(message.chat.id),source_message_id:String(message.message_id)}]);
  if(stored?.id&&rows?.[0]?.id)await patch('telegram_messages',`id=eq.${stored.id}`,{file_path:path,related_entity_type:'import',related_entity_id:rows[0].id}).catch(error=>console.warn('[telegram attachment message link]',error?.message||error));const text=`فهمت المستند وحفظت نسخته الأصلية.\nالنوع: <b>${esc(reportTypeLabel(reportType))}</b>\nالمسار: <b>${esc(reportDestination(reportType,group.department))}</b>\nالحالة: محفوظ للمراجعة ولم يُعتمد نهائيًا.`;await Promise.all([sendMessage(message.chat.id,text),relayToOwner(message.chat.id,downloaded.buffer,name,message.document?.mime_type||downloaded.contentType,`مستند وارد من Telegram\n${text}`,{importId:rows?.[0]?.id})]);return rows?.[0]||null;
}
