(function(){
'use strict';
const VERSION='2026.07.23-import-file-validation-v3-parser-overlap-safe';
const ALLOWED_EXT=/\.(xlsx|xls)$/i;
const MAX_BYTES=25*1024*1024;
let installed=false,pending=null;
const clean=value=>String(value??'').trim();
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=value=>{const parsed=Number(String(value??0).replace(/,/g,''));return Number.isFinite(parsed)?parsed:0;};
function validateFile(file){
  if(!file)throw new Error('اختر ملف Excel أولًا. لم يتم حفظ أي بيانات.');
  if(!ALLOWED_EXT.test(clean(file.name)))throw new Error('نوع الملف غير مسموح. استخدم XLSX أو XLS فقط. لم يتم حفظ أي بيانات.');
  if(!Number(file.size))throw new Error('الملف فارغ. لم يتم حذف أو استبدال أي بيانات سابقة.');
  if(file.size>MAX_BYTES)throw new Error('حجم ملف Excel يتجاوز 25 ميجابايت. لم يتم حفظ أي بيانات.');
}
async function fingerprint(file){
  const bytes=await file.arrayBuffer();
  if(!crypto?.subtle)return `${file.name}|${file.size}|${file.lastModified||0}`;
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
function uniqueQuality(rows,keyFn,missingFn){
  const seen=new Set();let accepted=0,duplicate=0,missing=0;
  for(const row of rows||[]){
    if(missingFn(row)){missing++;continue;}
    const key=keyFn(row);if(seen.has(key)){duplicate++;continue;}seen.add(key);accepted++;
  }
  return{accepted,duplicate,missing,total:(rows||[]).length};
}
function parserSourceKey(row,type){
  const sheet=clean(row?.sheet),sourceRow=clean(row?.row);
  if(sheet&&sourceRow)return`${type}|${sheet}|${sourceRow}`;
  if(type==='sale')return[type,row?.invoice,row?.customerCode,row?.customer,row?.item,num(row?.quantity),num(row?.amount)].join('|');
  return[type,row?.treasuryCode,row?.date,row?.customerCode,row?.customer,row?.receipt,num(row?.amount),row?.method].join('|');
}
function mergeParserRows(base,extra,type){
  const result=[...(base||[])],seen=new Set(result.map(row=>parserSourceKey(row,type)));
  for(const row of extra||[]){const key=parserSourceKey(row,type);if(seen.has(key))continue;seen.add(key);result.push(row);}
  return result;
}
function composePlan(base,extra){
  return{
    sales:mergeParserRows(base?.sales,extra?.sales,'sale'),
    collections:mergeParserRows(base?.collections,extra?.collections,'collection'),
    stock:[...(base?.stock||[])],
    warnings:[...new Set([...(base?.warnings||[]),...(extra?.warnings||[])].map(clean).filter(Boolean))]
  };
}
function dataWarnings(plan){
  const warnings=[],receiptOwners=new Map();
  for(const row of plan.collections||[]){
    const receipt=clean(row.receipt),customer=clean(row.customerCode||row.customer);
    if(!receipt||!customer)continue;
    const key=[clean(row.treasuryCode),receipt].join('|'),owners=receiptOwners.get(key)||new Set();owners.add(customer);receiptOwners.set(key,owners);
  }
  const sharedReceipts=[...receiptOwners.entries()].filter(([,owners])=>owners.size>1).map(([key])=>key.split('|')[1]);
  if(sharedReceipts.length)warnings.push(`أرقام أذونات مستخدمة لأكثر من عميل: ${sharedReceipts.join('، ')}؛ راجعها قبل الاعتماد.`);
  const negativeStock=[...new Set((plan.stock||[]).filter(row=>num(row.opening)<0||num(row.closing)<0).map(row=>clean(row.code||row.item)).filter(Boolean))];
  if(negativeStock.length)warnings.push(`يوجد رصيد مخزون سالب في: ${negativeStock.join('، ')}؛ راجع رصيد البداية قبل الاعتماد.`);
  return warnings;
}
function buildQuality(plan,file,hash){
  const sales=uniqueQuality(plan.sales||[],row=>[row.invoice,row.customerCode,row.customer,row.item,num(row.quantity),num(row.amount)].join('|'),row=>!clean(row.customerCode||row.customer)||!clean(row.item)||num(row.quantity)<=0);
  const collections=uniqueQuality(plan.collections||[],row=>[row.date,row.customerCode,row.customer,row.receipt,num(row.amount),row.method].join('|'),row=>!clean(row.customerCode||row.customer)||num(row.amount)<=0);
  const stock=uniqueQuality(plan.stock||[],row=>[row.code,row.item,row.direction,num(row.quantity),num(row.opening),num(row.closing)].join('|'),row=>!clean(row.code||row.item)||(!num(row.quantity)&&!num(row.opening)&&!num(row.closing)));
  const warnings=[...new Set([...(Array.isArray(plan.warnings)?plan.warnings:[]),...dataWarnings(plan)])],accepted=sales.accepted+collections.accepted+stock.accepted,duplicate=sales.duplicate+collections.duplicate+stock.duplicate,missing=sales.missing+collections.missing+stock.missing,rejected=warnings.filter(value=>/مرفوض|غير صالح|تعذر|خطأ/.test(String(value))).length;
  return{fileName:file.name,hash,accepted,duplicate,missing,rejected,warnings,total:sales.total+collections.total+stock.total,breakdown:{sales,collections,stock}};
}
function qualityHtml(q){
  const parts=q.breakdown||{};
  return `<div class="ops-note" data-bh-import-quality="1" style="margin-bottom:12px"><b>فحص ملف Excel قبل الحفظ</b><br>الملف: <b>${esc(q.fileName)}</b><br>Hash: <code>${esc(q.hash)}</code><div style="display:grid;grid-template-columns:repeat(4,minmax(90px,1fr));gap:7px;margin-top:9px"><span>المقبول: <b>${q.accepted}</b></span><span>المرفوض: <b>${q.rejected}</b></span><span>المكرر داخل الملف: <b>${q.duplicate}</b><small style="display:block">لن يُحفظ مرتين</small></span><span>الناقص: <b>${q.missing}</b></span></div>${parts.sales?`<div style="margin-top:7px">تفصيل المقبول: مبيعات <b>${parts.sales.accepted}</b> — تحصيلات <b>${parts.collections.accepted}</b> — مخزون <b>${parts.stock.accepted}</b></div>`:''}${q.warnings.length?`<div style="margin-top:7px">تحذيرات: ${q.warnings.slice(0,8).map(esc).join(' — ')}</div>`:''}<div style="margin-top:7px">لم تُحفظ أي بيانات بعد. استخدم زر الاعتماد أو الإلغاء.</div></div>`;
}
async function inspect(file,mode){
  validateFile(file);
  if(!window.XLSX||!window.BinHamidDailySummaryParser)throw new Error('محرك قراءة Excel غير جاهز. أعد المحاولة. لم يتم حفظ أي بيانات.');
  let workbook;try{workbook=window.XLSX.read(new Uint8Array(await file.arrayBuffer()),{type:'array',cellDates:false});}catch(error){throw new Error(`تعذر قراءة ملف Excel: ${error.message}. لم يتم حفظ أي بيانات.`);}
  if(!workbook?.SheetNames?.length)throw new Error('ملف Excel لا يحتوي أوراق عمل. لم يتم حفظ أي بيانات.');
  const extra=window.BinHamidDailySummaryParser.parseWorkbook(workbook,window.XLSX)||{};
  let base={};
  try{base=mode==='movement'&&typeof window.opsParseMovementWorkbook==='function'?window.opsParseMovementWorkbook(workbook,file.name)||{}:typeof window.bh12ParseDailyWorkbook==='function'?window.bh12ParseDailyWorkbook(workbook)||{}:{};}catch(error){throw new Error(`تعذر تحليل صفوف Excel: ${error.message}. لم يتم حفظ أي بيانات.`);}
  const plan=composePlan(base,extra);
  const quality=buildQuality(plan,file,await fingerprint(file));
  if(quality.accepted<=0)throw new Error('لا توجد صفوف صالحة للاستيراد. لم يتم حذف أو استبدال أي بيانات سابقة.');
  return quality;
}
function wrap(name,mode){
  const original=window[name];if(typeof original!=='function')return false;if(original.__fileValidation)return true;
  const wrapped=async function(file){
    pending=await inspect(file,mode);
    const open=window.opsOpenModal;
    let temporary=null;
    if(typeof open==='function'){
      temporary=function(title,html,onSave,label){if(window.opsOpenModal===temporary)window.opsOpenModal=open;return open.call(this,title,qualityHtml(pending)+String(html||''),onSave,label);};
      temporary.__qualityTemporary=true;window.opsOpenModal=temporary;
    }
    try{return await original.apply(this,arguments);}finally{pending=null;if(temporary&&window.opsOpenModal===temporary)window.opsOpenModal=open;}
  };
  wrapped.__fileValidation=true;window[name]=wrapped;return true;
}
function install(){
  if(installed)return true;
  const a=wrap('opsImportDailySummary','summary'),b=wrap('opsImportDailyMovement','movement');
  if(!a||!b)return false;
  installed=true;window.BinHamidImportFileValidation={version:VERSION,installed:true,validateFile,buildQuality,composePlan};console.info('[BinHamid]',VERSION,'loaded');return true;
}
const timer=setInterval(()=>{if(install())clearInterval(timer);},250);setTimeout(()=>{clearInterval(timer);if(!installed)console.error('[BinHamid] تعذر تثبيت حارس ملفات Excel.');},25000);
})();
