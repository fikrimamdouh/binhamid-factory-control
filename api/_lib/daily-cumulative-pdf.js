import { htmlToPdf } from './pdf-service.js';
import { loadProjectedCumulativeDailyReport } from './daily-cumulative-report-data.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money=value=>Number(value||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const qty=value=>Number(value||0).toLocaleString('en-US',{maximumFractionDigits:3});
const riyadhDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const title=type=>type==='block'?'تقرير البلوك التراكمي':'تقرير الخرسانة التراكمي';
const unit=type=>type==='block'?'قطعة':'م³';
const slug=type=>type==='block'?'block':'concrete';
const icon=type=>type==='block'?'🧱':'🏗️';
const accent=type=>type==='block'?'#8a5a2c':'#0d6a4a';

function currentInvoiceRows(rows=[]){
  const invoices=rows.flatMap(customer=>(customer.invoices||[]).map(invoice=>({...invoice,customerCode:customer.code,customerName:customer.name})));
  if(!invoices.length)return'<p class="empty">📭 لا توجد مبيعات جديدة لهذا القسم في الملف الحالي.</p>';
  return `<table><thead><tr><th>#</th><th>الفاتورة</th><th>كود العميل</th><th>العميل</th><th>الصنف</th><th>الكمية</th><th>المبلغ</th></tr></thead><tbody>${invoices.map((row,index)=>`<tr><td>${index+1}</td><td>${esc(row.invoice)}</td><td>${esc(row.customerCode||'—')}</td><td>${esc(row.customerName)}</td><td>${esc(row.item)}</td><td>${qty(row.quantity)}</td><td>${money(row.total)}</td></tr>`).join('')}</tbody></table>`;
}

// صف حالة العميل: اشترى اليوم؟ سدّد اليوم؟ دفع مقدمًا؟ ومتبقي عليه ولا لأ
function statusBadge(row){
  const bought=Number(row.currentSales||0)>0,paid=Number(row.currentApplied||0)>0,advance=Number(row.currentUnallocated||0)>0,due=Number(row.closingBalance||0)>0;
  const chips=[];
  if(bought)chips.push('<span class="chip buy">🛒 اشترى اليوم</span>');
  if(paid)chips.push('<span class="chip pay">💵 سدّد اليوم</span>');
  if(advance)chips.push('<span class="chip advance">💰 دفعة مقدمة</span>');
  chips.push(due?'<span class="chip due">⚠️ عليه رصيد</span>':'<span class="chip clear">✅ مسدّد</span>');
  return chips.join(' ');
}

export function cumulativeDepartmentHtml({type,data,sourceFile,reportDate,latestApprovedDate}){
  const rows=data?.rows||[],totals=data?.totals||{};
  const boughtToday=rows.filter(r=>Number(r.currentSales||0)>0),paidToday=rows.filter(r=>Number(r.currentApplied||0)>0),stillDue=rows.filter(r=>Number(r.closingBalance||0)>0),advanceToday=rows.filter(r=>Number(r.currentUnallocated||0)>0);
  const advanceTotal=advanceToday.reduce((sum,r)=>sum+Number(r.currentUnallocated||0),0);
  const summaryLine=rows.length
    ?`📌 <b>ملخص سريع لليوم:</b> اشترى <b>${boughtToday.length}</b> عميل بقيمة <b>${money(totals.currentSales)} ر.س</b>، وسدّد <b>${paidToday.length}</b> عميل بقيمة <b>${money(totals.currentApplied)} ر.س</b>${advanceToday.length?`، منها <b>${money(advanceTotal)} ر.س دفعة مقدمة</b> لـ<b>${advanceToday.length}</b> عميل (رصيد له لصالح مشترياته القادمة)`:''}، ولا يزال <b>${stillDue.length}</b> عميل عليهم رصيد مستحق.`
    :'📭 لا توجد أي حركة شراء أو تحصيل لهذا القسم في ملف اليوم.';
  const customers=rows.length?`<table><thead><tr><th>#</th><th>كود العميل</th><th>العميل</th><th>الحالة اليوم</th><th>رصيد سابق</th><th>مبيعات الملف</th><th>تحصيل موزع اليوم</th><th>دفعة مقدمة</th><th>الرصيد المتوقع</th><th>إجمالي المبيعات</th><th>إجمالي المسدد</th></tr></thead><tbody>${rows.map((row,index)=>`<tr class="${row.closingBalance>0?'due':'clear'}"><td>${index+1}</td><td>${esc(row.code||'—')}</td><td>${esc(row.name)}</td><td>${statusBadge(row)}</td><td>${money(row.openingBalance)}</td><td>${money(row.currentSales)}</td><td>${money(row.currentApplied)}</td><td>${row.currentUnallocated>0?`<span class="advance-value">💰 ${money(row.currentUnallocated)}</span>`:'—'}</td><td><strong>${money(row.closingBalance)}</strong></td><td>${money(row.cumulativeSales)}</td><td>${money(row.cumulativePaid)}</td></tr>`).join('')}</tbody></table>`:'<p class="empty">📭 لا توجد حركة أو أرصدة لهذا القسم حتى الآن.</p>';
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
    @page{size:A4 landscape;margin:10mm}
    *{box-sizing:border-box}
    body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#173746;font-size:10px;line-height:1.5}
    .band{display:flex;align-items:center;gap:12px;border-bottom:4px solid ${accent(type)};padding-bottom:10px;margin-bottom:10px}
    .band .badge{width:46px;height:46px;border-radius:12px;background:${accent(type)};color:#fff;display:flex;align-items:center;justify-content:center;font-size:24px;flex:none}
    .band h1{font-size:22px;margin:0}
    .band .sub{color:#5c6d74;font-size:10px;margin-top:2px}
    .meta{color:#5c6d74;margin-bottom:8px;background:#f7f9fa;border:1px solid #e1e7e9;border-radius:8px;padding:8px 10px}
    h2{font-size:14px;margin:16px 0 7px;display:flex;align-items:center;gap:6px}
    .notice{border:1px solid #d79b2e;background:#fff8e8;padding:8px 10px;border-radius:8px;margin:8px 0}
    .summary{border:1px solid ${accent(type)}55;background:${accent(type)}0d;padding:9px 12px;border-radius:8px;margin:10px 0;font-size:11px}
    .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin:10px 0}
    .card{border:1px solid #c5d0d5;border-radius:9px;background:#f7f9fa;padding:8px 9px;position:relative;overflow:hidden}
    .card .ic{font-size:14px;margin-bottom:2px;display:block}
    .card strong{display:block;font-size:15px;color:${accent(type)};margin-top:2px}
    .card span.lb{color:#5c6d74}
    .warning{font-size:8px;color:#9a4d00;margin-top:2px}
    .empty{border:1px dashed #aebbc0;padding:12px;color:#60737c;border-radius:8px;text-align:center}
    table{width:100%;border-collapse:collapse;margin:6px 0;page-break-inside:auto}
    thead{display:table-header-group}
    tr{page-break-inside:avoid}
    th,td{border:1px solid #bbc7cc;padding:5px;text-align:right;vertical-align:top}
    th{background:${accent(type)};color:#fff}
    .due td:nth-child(8){background:#fff3ef}
    .clear td:nth-child(8){background:#eef9f1}
    .chip{display:inline-block;font-size:7.5px;padding:2px 6px;border-radius:99px;margin:1px;white-space:nowrap}
    .chip.buy{background:#e7f0fb;color:#1a4f8a}
    .chip.pay{background:#e8f7ee;color:#0d6a4a}
    .chip.advance{background:#fdf3e0;color:#8a5a00}
    .chip.due{background:#fdecea;color:#9a2f2f}
    .chip.clear{background:#eef9f1;color:#1b6b3f}
    .advance-value{color:#8a5a00;font-weight:bold}
    .footer{margin-top:14px;color:#60737c;font-size:9px;border-top:1px solid #e1e7e9;padding-top:8px}
  </style></head><body>
    <div class="band"><div class="badge">${icon(type)}</div><div><h1>${esc(title(type))}</h1><div class="sub">مصنع بن حامد للبلوك والخرسانة الجاهزة</div></div></div>
    <div class="meta">📄 الملف اليومي الوارد: <b>${esc(sourceFile)}</b> &nbsp;|&nbsp; 📅 تاريخ حركة الملف: <b>${esc(reportDate)}</b> &nbsp;|&nbsp; ⏱️ آخر تقرير معتمد سابقًا: <b>${esc(latestApprovedDate||'لا يوجد')}</b> &nbsp;|&nbsp; 🕓 تاريخ الإنشاء: ${esc(new Date().toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'}))}</div>
    <div class="notice">📝 <strong>مسودة تراكميّة قبل الاعتماد.</strong> الأرصدة السابقة مأخوذة من قاعدة البيانات، ثم أضيفت مبيعات الملف الحالي ووُزعت تحصيلاته على أقدم الفواتير وفق FIFO. لا تصبح حركة الملف نهائية إلا بعد اعتماده من البرنامج.</div>
    <div class="summary">${summaryLine}</div>
    <div class="cards">
      <div class="card"><span class="ic">👥</span><span class="lb">عدد العملاء</span><strong>${totals.customers||0}</strong></div>
      <div class="card"><span class="ic">🛒</span><span class="lb">اشتروا اليوم</span><strong>${boughtToday.length}</strong></div>
      <div class="card"><span class="ic">💵</span><span class="lb">سدّدوا اليوم</span><strong>${paidToday.length}</strong></div>
      <div class="card"><span class="ic">💰</span><span class="lb">دفعة مقدمة</span><strong>${advanceToday.length}</strong></div>
      <div class="card"><span class="ic">⚠️</span><span class="lb">عليهم رصيد</span><strong>${stillDue.length}</strong></div>
      <div class="card"><span class="ic">📋</span><span class="lb">الرصيد السابق</span><strong>${money(totals.openingBalance)} ر.س</strong></div>
      <div class="card"><span class="ic">🧾</span><span class="lb">مبيعات الملف</span><strong>${money(totals.currentSales)} ر.س</strong></div>
      <div class="card"><span class="ic">⚖️</span><span class="lb">كمية الملف</span><strong>${qty(totals.currentQuantity)} ${unit(type)}</strong></div>
      <div class="card"><span class="ic">📌</span><span class="lb">الرصيد المتوقع</span><strong>${money(totals.closingBalance)} ر.س</strong></div>
    </div>
    <h2>📊 كشف العملاء التراكمي</h2>${customers}
    <h2>🧾 فواتير القسم في الملف الحالي</h2>${currentInvoiceRows(rows)}
    <div class="footer">المعادلة: الرصيد المتوقع = الرصيد السابق + مبيعات الملف − التحصيل الموزع على فواتير القسم. أي تحصيل غير موزع يظهر للتنبيه ولا يُخصم من رصيد القسم حتى يتم تخصيصه.</div>
  </body></html>`;
}

export async function generateCumulativeDailyPdfs(analysis={},sourceFile='daily-report.xlsx'){
  const reportDate=riyadhDate(),projection=await loadProjectedCumulativeDailyReport(analysis,reportDate);
  return Promise.all(['block','concrete'].map(async type=>{
    const html=cumulativeDepartmentHtml({type,data:projection.departments[type],sourceFile,reportDate,latestApprovedDate:projection.latestApprovedDate});
    const pdf=await htmlToPdf(html,{filename:`${slug(type)}-cumulative-${reportDate}`,landscape:true});
    return{type,pdf,filename:`${slug(type)}-cumulative-${reportDate}.pdf`,caption:`${icon(type)} ${title(type)} — مسودة حتى ${reportDate}`,summary:projection.departments[type].totals};
  }));
}
