import { htmlToPdf } from './pdf-service.js';
import { parseFuelWorkbook, buildFuelControlReport } from './fuel-summary-parser.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money=value=>Number(value||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const qty=value=>Number(value||0).toLocaleString('en-US',{maximumFractionDigits:2});
const riyadhDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const ALERT_ICON={danger:'⛔',warn:'⚠️',info:'ℹ️'};
const ALERT_LABEL={danger:'حرج',warn:'تنبيه',info:'معلومة'};
const CATEGORY={all:{title:'تقرير الوقود',empty:'لا توجد تعبئات وقود في هذا الملف',slug:'fuel'},diesel:{title:'تقرير الديزل',empty:'لا توجد تعبئات ديزل في هذا الملف',slug:'diesel'},petrol:{title:'تقرير البنزين',empty:'لا توجد تعبئات بنزين في هذا الملف',slug:'petrol'},other:{title:'تقرير أنواع الوقود الأخرى',empty:'لا توجد تعبئات من أنواع الوقود الأخرى',slug:'other'}};

function vehiclesTable(vehicles,empty){
  if(!vehicles.length)return`<p class="empty">${esc(empty)}</p>`;
  return `<table><thead><tr><th>#</th><th>رقم اللوحة</th><th>المركبة / السائق</th><th>عدد التعبئات</th><th>اللترات</th><th>المبلغ</th><th>متوسط السعر</th><th>النسبة</th><th>الملاحظات</th></tr></thead><tbody>${vehicles.map((v,i)=>`<tr class="${v.alertCount?'flag':''}"><td>${i+1}</td><td><b>${esc(v.plate)}</b></td><td>${esc(v.vehicleName||'—')}<div class="muted">${esc(v.drivers)}</div></td><td>${v.fills}</td><td>${qty(v.liters)}</td><td>${money(v.amount)}</td><td>${v.avgPrice}</td><td>${v.share}%</td><td>${v.alertCount?`<span class="chip warn">${v.alertCount} ملاحظة</span>`:'<span class="chip clear">سليم</span>'}</td></tr>`).join('')}</tbody></table>`;
}
function alertsTable(alerts){
  if(!alerts.length)return'<p class="empty">لا توجد ملاحظات رقابية على هذا الملف.</p>';
  return `<table><thead><tr><th>الحالة</th><th>اللوحة</th><th>الإيصال</th><th>السائق</th><th>الملاحظة</th><th>التفاصيل</th></tr></thead><tbody>${alerts.slice(0,200).map(a=>`<tr class="${a.level}"><td>${ALERT_ICON[a.level]||''} ${ALERT_LABEL[a.level]||a.level}</td><td><b>${esc(a.plate)}</b></td><td>${esc(a.receipt)}</td><td>${esc(a.driver)}</td><td>${esc(a.check)}</td><td>${esc(a.detail)}</td></tr>`).join('')}</tbody></table>${alerts.length>200?`<p class="empty">وأكثر من ${alerts.length-200} ملاحظة إضافية.</p>`:''}`;
}
export function fuelReportHtml({report,sourceFile,reportDate,category='all',accountBalance=null}){
  const meta=CATEGORY[category]||CATEGORY.all,t=report.totals,balanceCard=category==='diesel'&&Number.isFinite(accountBalance)?`<td>رصيد خزنة المحطة بنهاية اليوم<strong>${money(accountBalance)} ر.س</strong><span class="muted">${esc(reportDate)}</span></td>`:'';
  const summaryLine=t.fillCount?`<b>ملخص سريع:</b> ${t.fillCount} تعبئة على <b>${t.plateCount}</b> لوحة، بإجمالي <b>${qty(t.liters)} لتر</b> و<b>${money(t.amount)} ر.س</b>. رُصد <b>${t.danger}</b> ملاحظة حرجة و<b>${t.warn}</b> تنبيه.`:`لم يتم العثور على تعبئات صالحة في هذا القسم.`;
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
    @page{size:A4 landscape;margin:10mm}*{box-sizing:border-box}body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#173746;font-size:10px;line-height:1.5}.band{width:100%;border-collapse:collapse;border-bottom:4px solid #a1471f;margin-bottom:10px}.band td{border:0;padding:0 0 10px}.badge{width:46px;height:46px;border-radius:12px;background:#a1471f;color:#fff;text-align:center;line-height:46px;font-size:24px}.band h1{font-size:22px;margin:0}.sub,.muted{color:#5c6d74}.meta,.summary{border:1px solid #d5dee2;background:#f7f9fa;padding:8px 10px;border-radius:8px;margin:8px 0}.summary{border-color:#a1471f55;background:#a1471f0d;font-size:11px}.cards{width:100%;border-collapse:separate;border-spacing:7px 0;margin:10px 0}.cards td{border:1px solid #c5d0d5;border-radius:9px;background:#f7f9fa;padding:8px}.cards strong{display:block;font-size:15px;color:#a1471f}.cards span{display:block;margin-top:2px}.empty{border:1px dashed #aebbc0;padding:12px;color:#60737c;border-radius:8px;text-align:center}table{width:100%;border-collapse:collapse;margin:6px 0;page-break-inside:auto}thead{display:table-header-group}tr{page-break-inside:avoid}th,td{border:1px solid #bbc7cc;padding:5px;text-align:right;vertical-align:top}th{background:#a1471f;color:#fff}tr.flag td{background:#fff6ec}tr.danger td{background:#fdecea}tr.warn td{background:#fff8e8}.chip{display:inline-block;font-size:7.5px;padding:2px 6px;border-radius:99px}.chip.warn{background:#fdf3e0;color:#8a5a00}.chip.clear{background:#eef9f1;color:#1b6b3f}.footer{margin-top:14px;color:#60737c;font-size:9px;border-top:1px solid #e1e7e9;padding-top:8px}h2{font-size:14px;margin:16px 0 7px}
  </style></head><body>
    <table class="band"><tr><td style="width:58px"><div class="badge">⛽</div></td><td><h1>${esc(meta.title)} — مطابقة برقم اللوحة</h1><div class="sub">مصنع بن حامد للبلوك والخرسانة الجاهزة</div></td></tr></table>
    <div class="meta">الملف: <b>${esc(sourceFile)}</b> &nbsp;|&nbsp; تاريخ التقرير: <b>${esc(reportDate)}</b> &nbsp;|&nbsp; الإنشاء: <b>${esc(new Date().toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'}))}</b></div>
    <div class="summary">${summaryLine}</div>
    <table class="cards"><tr><td>عدد اللوحات<strong>${t.plateCount}</strong></td><td>عدد التعبئات<strong>${t.fillCount}</strong></td><td>إجمالي اللترات<strong>${qty(t.liters)}</strong></td><td>إجمالي المبلغ<strong>${money(t.amount)} ر.س</strong></td>${balanceCard}<td>حرج / تنبيه<strong>${t.danger} / ${t.warn}</strong></td></tr></table>
    <h2>الاستهلاك حسب رقم اللوحة</h2>${vehiclesTable(report.vehicles,meta.empty)}
    <h2>التحذيرات والملاحظات الرقابية</h2>${alertsTable(report.alerts)}
    <div class="footer">التحذيرات آلية: إيصال مكرر، قراءة عداد غير منطقية، تعبئة متقاربة، وكمية أو سعر خارج المعتاد. التقرير رقابي أولي ولا يستبدل المطابقة المستندية.</div>
  </body></html>`;
}

function rowsForCategory(rows,category){return category==='all'?rows:rows.filter(row=>row.category===category);}
export async function generateFuelReportPdf(workbook,xlsx,sourceFile='fuel-report.xlsx',options={}){
  const parsed=parseFuelWorkbook(workbook,xlsx),sourceRows=Array.isArray(options.rows)?options.rows:parsed.rows,category=options.category||'all',rows=rowsForCategory(sourceRows,category),report=buildFuelControlReport(rows),reportDate=options.reportDate||riyadhDate(),meta=CATEGORY[category]||CATEGORY.all;
  const html=fuelReportHtml({report,sourceFile,reportDate,category,accountBalance:options.accountBalance});
  const pdf=await htmlToPdf(html,{filename:`${meta.slug}-report-${reportDate}`,landscape:true});
  return{pdf,filename:`${meta.slug}-report-${reportDate}.pdf`,caption:`⛽ ${meta.title} — ${report.totals.plateCount} لوحة، ${report.totals.warn+report.totals.danger} ملاحظة`,report,rowCount:rows.length,parsedRowCount:parsed.rowCount,category};
}
export async function generateFuelReportPdfs(workbook,xlsx,sourceFile='fuel-report.xlsx',options={}){
  const parsed=parseFuelWorkbook(workbook,xlsx),sourceRows=Array.isArray(options.rows)?options.rows:parsed.rows,categories=['diesel','petrol','other'].filter(category=>sourceRows.some(row=>row.category===category));
  if(!categories.length)return[];
  const reports=[];for(const category of categories)reports.push(await generateFuelReportPdf(workbook,xlsx,sourceFile,{...options,rows:sourceRows,category}));return reports;
}