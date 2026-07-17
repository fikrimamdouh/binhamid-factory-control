import { htmlToPdf } from './pdf-service.js';
import { loadProjectedCumulativeDailyReport } from './daily-cumulative-report-data.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money=value=>Number(value||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const qty=value=>Number(value||0).toLocaleString('en-US',{maximumFractionDigits:3});
const riyadhDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const title=type=>type==='block'?'تقرير البلوك التراكمي':'تقرير الخرسانة التراكمي';
const unit=type=>type==='block'?'قطعة':'م³';
const slug=type=>type==='block'?'block':'concrete';

function currentInvoiceRows(rows=[]){
  const invoices=rows.flatMap(customer=>(customer.invoices||[]).map(invoice=>({...invoice,customerCode:customer.code,customerName:customer.name})));
  if(!invoices.length)return'<p class="empty">لا توجد مبيعات جديدة لهذا القسم في الملف الحالي.</p>';
  return `<table><thead><tr><th>#</th><th>الفاتورة</th><th>كود العميل</th><th>العميل</th><th>الصنف</th><th>الكمية</th><th>المبلغ</th></tr></thead><tbody>${invoices.map((row,index)=>`<tr><td>${index+1}</td><td>${esc(row.invoice)}</td><td>${esc(row.customerCode||'—')}</td><td>${esc(row.customerName)}</td><td>${esc(row.item)}</td><td>${qty(row.quantity)}</td><td>${money(row.total)}</td></tr>`).join('')}</tbody></table>`;
}

export function cumulativeDepartmentHtml({type,data,sourceFile,reportDate,latestApprovedDate}){
  const rows=data?.rows||[],totals=data?.totals||{};
  const customers=rows.length?`<table><thead><tr><th>#</th><th>كود العميل</th><th>العميل</th><th>رصيد سابق</th><th>مبيعات الملف</th><th>تحصيل موزع اليوم</th><th>الرصيد المتوقع</th><th>إجمالي المبيعات</th><th>إجمالي المسدد</th></tr></thead><tbody>${rows.map((row,index)=>`<tr class="${row.closingBalance>0?'due':'clear'}"><td>${index+1}</td><td>${esc(row.code||'—')}</td><td>${esc(row.name)}${row.currentUnallocated>0?`<div class="warning">تحصيل غير موزع للعميل: ${money(row.currentUnallocated)}</div>`:''}</td><td>${money(row.openingBalance)}</td><td>${money(row.currentSales)}</td><td>${money(row.currentApplied)}</td><td><strong>${money(row.closingBalance)}</strong></td><td>${money(row.cumulativeSales)}</td><td>${money(row.cumulativePaid)}</td></tr>`).join('')}</tbody></table>`:'<p class="empty">لا توجد حركة أو أرصدة لهذا القسم حتى الآن.</p>';
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>@page{size:A4 landscape;margin:10mm}*{box-sizing:border-box}body{font-family:Arial,Tahoma,sans-serif;color:#173746;font-size:10px;line-height:1.45}h1{font-size:23px;margin:0 0 5px;border-bottom:3px solid #a97926;padding-bottom:7px}h2{font-size:15px;margin:17px 0 7px}.meta{color:#5c6d74;margin-bottom:8px}.notice{border:1px solid #d79b2e;background:#fff8e8;padding:7px;border-radius:6px;margin:8px 0}.cards{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin:10px 0}.card{border:1px solid #c5d0d5;border-radius:6px;background:#f7f9fa;padding:7px}.card strong{display:block;font-size:15px;color:#0d4a63}.warning{font-size:8px;color:#9a4d00;margin-top:2px}.empty{border:1px dashed #aebbc0;padding:10px;color:#60737c}table{width:100%;border-collapse:collapse;margin:6px 0;page-break-inside:auto}thead{display:table-header-group}tr{page-break-inside:avoid}th,td{border:1px solid #bbc7cc;padding:4px;text-align:right;vertical-align:top}th{background:#eaf0f2}.due td:nth-child(7){background:#fff3ef}.clear td:nth-child(7){background:#eef9f1}.footer{margin-top:14px;color:#60737c;font-size:9px}</style></head><body><h1>${esc(title(type))}</h1><div class="meta">مصنع بن حامد للبلوك والخرسانة الجاهزة<br>الملف اليومي الوارد: ${esc(sourceFile)}<br>تاريخ حركة الملف: ${esc(reportDate)} — آخر تقرير معتمد سابقًا: ${esc(latestApprovedDate||'لا يوجد')}<br>تاريخ الإنشاء: ${esc(new Date().toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'}))}</div><div class="notice"><strong>مسودة تراكميّة قبل الاعتماد.</strong> الأرصدة السابقة مأخوذة من قاعدة البيانات، ثم أضيفت مبيعات الملف الحالي ووُزعت تحصيلاته على أقدم الفواتير وفق FIFO. لا تصبح حركة الملف نهائية إلا بعد اعتماده من البرنامج.</div><div class="cards"><div class="card">العملاء<strong>${totals.customers||0}</strong></div><div class="card">الرصيد السابق<strong>${money(totals.openingBalance)} ر.س</strong></div><div class="card">مبيعات الملف<strong>${money(totals.currentSales)} ر.س</strong></div><div class="card">كمية الملف<strong>${qty(totals.currentQuantity)} ${unit(type)}</strong></div><div class="card">تحصيل موزع<strong>${money(totals.currentApplied)} ر.س</strong></div><div class="card">الرصيد المتوقع<strong>${money(totals.closingBalance)} ر.س</strong></div></div><h2>كشف العملاء التراكمي</h2>${customers}<h2>فواتير القسم في الملف الحالي</h2>${currentInvoiceRows(rows)}<div class="footer">المعادلة: الرصيد المتوقع = الرصيد السابق + مبيعات الملف − التحصيل الموزع على فواتير القسم. أي تحصيل غير موزع يظهر للتنبيه ولا يُخصم من رصيد القسم حتى يتم تخصيصه.</div></body></html>`;
}

export async function generateCumulativeDailyPdfs(analysis={},sourceFile='daily-report.xlsx'){
  const reportDate=riyadhDate(),projection=await loadProjectedCumulativeDailyReport(analysis,reportDate);
  return Promise.all(['block','concrete'].map(async type=>{
    const html=cumulativeDepartmentHtml({type,data:projection.departments[type],sourceFile,reportDate,latestApprovedDate:projection.latestApprovedDate});
    const pdf=await htmlToPdf(html,{filename:`${slug(type)}-cumulative-${reportDate}`,landscape:true});
    return{type,pdf,filename:`${slug(type)}-cumulative-${reportDate}.pdf`,caption:`${title(type)} — مسودة حتى ${reportDate}`,summary:projection.departments[type].totals};
  }));
}
