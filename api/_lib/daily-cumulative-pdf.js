import { htmlToPdf } from './pdf-service.js';
import { loadProjectedCumulativeDailyReport } from './daily-cumulative-report-data.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money=value=>Number(value||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const qty=value=>Number(value||0).toLocaleString('en-US',{maximumFractionDigits:3});
const riyadhDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const title=type=>type==='block'?'تقرير البلوك':'تقرير الخرسانة';
const unit=type=>type==='block'?'قطعة':'م³';
const icon=type=>type==='block'?'🧱':'🏗️';
const accent=type=>type==='block'?'#8a5a2c':'#0d6a4a';
const VALID_TYPES=new Set(['block','concrete']);

function currentInvoiceRows(rows=[]){
  const invoices=rows.flatMap(customer=>(customer.invoices||[]).map(invoice=>({...invoice,customerCode:customer.code,customerName:customer.name})));
  if(!invoices.length)return'<p class="empty">لا توجد مبيعات جديدة لهذا القسم في الملف الحالي.</p>';
  return `<table><thead><tr><th>#</th><th>الفاتورة</th><th>كود العميل</th><th>العميل</th><th>الصنف</th><th>الكمية</th><th>المبلغ</th></tr></thead><tbody>${invoices.map((row,index)=>`<tr><td>${index+1}</td><td>${esc(row.invoice)}</td><td>${esc(row.customerCode||'—')}</td><td>${esc(row.customerName)}</td><td>${esc(row.item)}</td><td>${qty(row.quantity)}</td><td>${money(row.total)}</td></tr>`).join('')}</tbody></table>`;
}

function statusBadge(row){
  const bought=Number(row.currentSales||0)>0,paid=Number(row.currentApplied||0)>0,advance=Number(row.currentUnallocated||0)>0,due=Number(row.closingBalance||0)>0;
  const chips=[];
  if(bought)chips.push('<span class="chip buy">اشترى اليوم</span>');
  if(paid)chips.push('<span class="chip pay">سدّد اليوم</span>');
  if(advance)chips.push('<span class="chip advance">دفعة مقدمة</span>');
  chips.push(due?'<span class="chip due">عليه رصيد</span>':'<span class="chip clear">مسدّد</span>');
  return chips.join(' ');
}

function inventoryTable(rows,cols){
  if(!rows.length)return'';
  return `<table><thead><tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr><td>${esc(row.itemCode||'—')}</td><td>${esc(row.itemName)}</td><td>${esc(row.unit||'—')}</td><td>${qty(row.opening)}</td><td>${qty(row.received)}</td><td>${qty(row.issued)}</td><td><strong>${qty(row.closing)}</strong></td></tr>`).join('')}</tbody></table>`;
}

function inventorySection(type,finishedGoods=[],rawMaterials=[]){
  const departmentFinished=finishedGoods.filter(row=>type==='block'?/بلك|بلوك/.test(row.itemName):/خرسانه|خرسانة/.test(row.itemName));
  const cols=['كود الصنف','الصنف','الوحدة','رصيد سابق','وارد','منصرف','رصيد حالي'];
  const finishedHtml=departmentFinished.length?inventoryTable(departmentFinished,cols):'<p class="empty">لا توجد حركة مخزون منتج تام لهذا القسم في الملف.</p>';
  const materialsHtml=rawMaterials.length?inventoryTable(rawMaterials,cols):'<p class="empty">لا توجد حركة خامات في الملف.</p>';
  return `<section><h2>حركة المنتج التام (${type==='block'?'البلوك':'الخرسانة'})</h2>${finishedHtml}</section><section><h2>حركة الخامات المشتركة</h2>${materialsHtml}</section>`;
}

export function cumulativeDepartmentHtml({type,data,sourceFile,reportDate,latestApprovedDate,finishedGoods=[],rawMaterials=[]}){
  const rows=data?.rows||[],totals=data?.totals||{};
  const boughtToday=rows.filter(r=>Number(r.currentSales||0)>0),paidToday=rows.filter(r=>Number(r.currentApplied||0)>0),stillDue=rows.filter(r=>Number(r.closingBalance||0)>0),advanceToday=rows.filter(r=>Number(r.currentUnallocated||0)>0);
  const advanceTotal=advanceToday.reduce((sum,r)=>sum+Number(r.currentUnallocated||0),0);
  const summaryLine=rows.length
    ?`اشترى <b>${boughtToday.length}</b> عميل بقيمة <b>${money(totals.currentSales)} ر.س</b>، وسدّد <b>${paidToday.length}</b> عميل بقيمة <b>${money(totals.currentApplied)} ر.س</b>${advanceToday.length?`، منها <b>${money(advanceTotal)} ر.س</b> دفعات مقدمة`:''}، ولا يزال <b>${stillDue.length}</b> عميل عليهم رصيد.`
    :'لا توجد حركة شراء أو تحصيل لهذا القسم في ملف اليوم.';
  const customers=rows.length?`<table><thead><tr><th>#</th><th>كود العميل</th><th>العميل</th><th>الحالة</th><th>رصيد سابق</th><th>مبيعات اليوم</th><th>تحصيل موزع اليوم</th><th>دفعة مقدمة</th><th>الرصيد المتوقع</th><th>إجمالي المبيعات</th><th>إجمالي المسدد</th></tr></thead><tbody>${rows.map((row,index)=>`<tr class="${row.closingBalance>0?'due':'clear'}"><td>${index+1}</td><td>${esc(row.code||'—')}</td><td>${esc(row.name)}</td><td>${statusBadge(row)}</td><td>${money(row.openingBalance)}</td><td>${money(row.currentSales)}</td><td>${money(row.currentApplied)}</td><td>${row.currentUnallocated>0?money(row.currentUnallocated):'—'}</td><td><strong>${money(row.closingBalance)}</strong></td><td>${money(row.cumulativeSales)}</td><td>${money(row.cumulativePaid)}</td></tr>`).join('')}</tbody></table>`:'<p class="empty">لا توجد حركة أو أرصدة لهذا القسم حتى الآن.</p>';
  const cards=[
    ['عدد العملاء',totals.customers||0],['اشتروا اليوم',boughtToday.length],['سدّدوا اليوم',paidToday.length],['دفعات مقدمة',advanceToday.length],['عليهم رصيد',stillDue.length],
    ['الرصيد السابق',`${money(totals.openingBalance)} ر.س`],['مبيعات اليوم',`${money(totals.currentSales)} ر.س`],['كمية اليوم',`${qty(totals.currentQuantity)} ${unit(type)}`],['الرصيد المتوقع',`${money(totals.closingBalance)} ر.س`]
  ];
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
    @page{size:A4 landscape;margin:5mm}
    *{box-sizing:border-box}
    html,body{margin:0;padding:0}
    body{font-family:Tahoma,Arial,sans-serif;color:#173746;font-size:7.4px;line-height:1.25;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .header{display:flex;align-items:center;gap:8px;border-bottom:3px solid ${accent(type)};padding:0 0 5px;margin:0 0 5px}
    .badge{width:32px;height:32px;border-radius:7px;background:${accent(type)};color:#fff;text-align:center;line-height:32px;font-size:17px;flex:none}
    h1{font-size:16px;margin:0;color:#173746}.sub{font-size:7px;color:#5c6d74;margin-top:1px}
    .meta,.notice,.summary{border:1px solid #d8e0e3;border-radius:5px;padding:4px 6px;margin:4px 0}
    .meta{background:#f7f9fa;color:#52656e}.notice{background:#fff8e8;border-color:#d79b2e}.summary{background:${accent(type)}0d;border-color:${accent(type)}55;font-size:8px}
    .cards{display:grid;grid-template-columns:repeat(9,1fr);gap:3px;margin:4px 0}
    .card{border:1px solid #c5d0d5;border-radius:5px;background:#f7f9fa;padding:4px;text-align:center;min-height:37px}
    .card span{display:block;color:#5c6d74;font-size:6.7px}.card strong{display:block;font-size:9px;color:${accent(type)};margin-top:2px}
    section{margin:6px 0 0}h2{font-size:9px;margin:5px 0 3px;color:#173746}
    table{width:100%;border-collapse:collapse;margin:2px 0;table-layout:auto}
    thead{display:table-header-group}tr{page-break-inside:avoid}th,td{border:1px solid #bbc7cc;padding:2px 3px;text-align:right;vertical-align:top;word-break:break-word}
    th{background:${accent(type)};color:#fff;font-size:6.8px}.due td:nth-child(9){background:#fff3ef}.clear td:nth-child(9){background:#eef9f1}
    .chip{display:inline-block;font-size:5.8px;padding:1px 3px;border-radius:8px;margin:0 1px;white-space:nowrap}.buy{background:#e7f0fb;color:#1a4f8a}.pay{background:#e8f7ee;color:#0d6a4a}.advance{background:#fdf3e0;color:#8a5a00}.due{background:#fdecea;color:#9a2f2f}.clear{background:#eef9f1;color:#1b6b3f}
    .empty{border:1px dashed #aebbc0;padding:5px;color:#60737c;border-radius:5px;text-align:center;margin:3px 0}.footer{margin-top:5px;color:#60737c;font-size:6.5px;border-top:1px solid #e1e7e9;padding-top:3px}
  </style></head><body>
    <header class="header"><div class="badge">${icon(type)}</div><div><h1>${esc(title(type))} التراكمي</h1><div class="sub">مصنع بن حامد للبلوك والخرسانة الجاهزة — تقرير تراكمي</div></div></header>
    <div class="meta">الملف اليومي: <b>${esc(sourceFile)}</b> | تاريخ الحركة: <b>${esc(reportDate)}</b> | آخر تقرير معتمد سابقًا: <b>${esc(latestApprovedDate||'لا يوجد')}</b> | الإنشاء: ${esc(new Date().toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'}))}</div>
    <div class="notice"><strong>مسودة تراكميّة قبل الاعتماد.</strong> الرصيد المتوقع = الرصيد السابق + مبيعات اليوم − التحصيل الموزع. يُوزّع التحصيل وفق FIFO (الأقدم أولًا). الحركة الحالية تصبح نهائية بعد اعتماد التقرير من البرنامج.</div>
    <div class="summary">${summaryLine}</div>
    <div class="cards">${cards.map(([label,value])=>`<div class="card"><span>${label}</span><strong>${value}</strong></div>`).join('')}</div>
    <section><h2>كشف العملاء التراكمي</h2>${customers}</section>
    <section><h2>فواتير القسم في الملف الحالي</h2>${currentInvoiceRows(rows)}</section>
    ${inventorySection(type,finishedGoods,rawMaterials)}
    <div class="footer">أي تحصيل غير موزع يظهر كدفعة مقدمة ولا يُخصم من رصيد القسم حتى يتم تخصيصه.</div>
  </body></html>`;
}

export async function generateCumulativeDailyPdfs(analysis={},sourceFile='daily-report.xlsx',requestedTypes=['block','concrete'],reportDateOverride=''){
  const types=[...new Set((Array.isArray(requestedTypes)?requestedTypes:[requestedTypes]).filter(type=>VALID_TYPES.has(type)))];
  if(!types.length)throw Object.assign(new Error('حدد تقرير البلوك أو تقرير الخرسانة.'),{status:400,code:'DAILY_REPORT_TYPE_REQUIRED'});
  const reportDate=/^\d{4}-\d{2}-\d{2}$/.test(String(reportDateOverride||''))?String(reportDateOverride):riyadhDate(),projection=await loadProjectedCumulativeDailyReport(analysis,reportDate);
  return Promise.all(types.map(async type=>{
    const html=cumulativeDepartmentHtml({type,data:projection.departments[type],sourceFile,reportDate,latestApprovedDate:projection.latestApprovedDate,finishedGoods:analysis?.finishedGoods,rawMaterials:analysis?.rawMaterials});
    const pdf=await htmlToPdf(html,{filename:title(type),landscape:true});
    return{type,pdf,filename:`${title(type)}.pdf`,caption:`${title(type)} — حتى ${reportDate}`,summary:projection.departments[type].totals};
  }));
}
