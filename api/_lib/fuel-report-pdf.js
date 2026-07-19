import { htmlToPdf } from './pdf-service.js';
import { parseFuelWorkbook, buildFuelControlReport } from './fuel-summary-parser.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money=value=>Number(value||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const qty=value=>Number(value||0).toLocaleString('en-US',{maximumFractionDigits:2});
const riyadhDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const ALERT_ICON={danger:'⛔',warn:'⚠️',info:'ℹ️'};
const ALERT_LABEL={danger:'حرج',warn:'تنبيه',info:'معلومة'};

function vehiclesTable(vehicles){
  if(!vehicles.length)return'<p class="empty">📭 لا توجد تعبئات ديزل في هذا الملف.</p>';
  return `<table><thead><tr><th>#</th><th>رقم اللوحة</th><th>المركبة / السائق</th><th>عدد التعبئات</th><th>اللترات</th><th>المبلغ</th><th>متوسط السعر</th><th>النسبة</th><th>الملاحظات</th></tr></thead><tbody>${vehicles.map((v,i)=>`<tr class="${v.alertCount?'flag':''}"><td>${i+1}</td><td><b>${esc(v.plate)}</b></td><td>${esc(v.vehicleName||'—')}<div class="muted">${esc(v.drivers)}</div></td><td>${v.fills}</td><td>${qty(v.liters)}</td><td>${money(v.amount)}</td><td>${v.avgPrice}</td><td>${v.share}%</td><td>${v.alertCount?`<span class="chip warn">${v.alertCount} ملاحظة</span>`:'<span class="chip clear">✅ سليم</span>'}</td></tr>`).join('')}</tbody></table>`;
}
function alertsTable(alerts){
  if(!alerts.length)return'<p class="empty">✅ لا توجد ملاحظات رقابية على هذا الملف.</p>';
  return `<table><thead><tr><th>الحالة</th><th>اللوحة</th><th>الإيصال</th><th>السائق</th><th>الملاحظة</th><th>التفاصيل</th></tr></thead><tbody>${alerts.slice(0,200).map(a=>`<tr class="${a.level}"><td>${ALERT_ICON[a.level]||''} ${ALERT_LABEL[a.level]||a.level}</td><td><b>${esc(a.plate)}</b></td><td>${esc(a.receipt)}</td><td>${esc(a.driver)}</td><td>${esc(a.check)}</td><td>${esc(a.detail)}</td></tr>`).join('')}</tbody></table>${alerts.length>200?`<p class="empty">وأكثر من ${alerts.length-200} ملاحظة إضافية — راجع النظام لعرض القائمة الكاملة.</p>`:''}`;
}

export function fuelReportHtml({report,sourceFile,reportDate}){
  const t=report.totals;
  const summaryLine=t.fillCount
    ?`⛽ <b>ملخص سريع:</b> ${t.fillCount} تعبئة ديزل على <b>${t.plateCount}</b> لوحة، بإجمالي <b>${qty(t.liters)} لتر</b> و<b>${money(t.amount)} ر.س</b>. رُصد <b>${t.danger}</b> ملاحظة حرجة و<b>${t.warn}</b> تنبيه يحتاجان مراجعة.`
    :'📭 لم يتم العثور على تعبئات ديزل صالحة في هذا الملف.';
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
    @page{size:A4 landscape;margin:10mm}
    *{box-sizing:border-box}
    body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#173746;font-size:10px;line-height:1.5}
    .band{display:flex;align-items:center;gap:12px;border-bottom:4px solid #a1471f;padding-bottom:10px;margin-bottom:10px}
    .band .badge{width:46px;height:46px;border-radius:12px;background:#a1471f;color:#fff;display:flex;align-items:center;justify-content:center;font-size:24px;flex:none}
    .band h1{font-size:22px;margin:0}
    .band .sub{color:#5c6d74;font-size:10px;margin-top:2px}
    .meta{color:#5c6d74;margin-bottom:8px;background:#f7f9fa;border:1px solid #e1e7e9;border-radius:8px;padding:8px 10px}
    h2{font-size:14px;margin:16px 0 7px;display:flex;align-items:center;gap:6px}
    .summary{border:1px solid #a1471f55;background:#a1471f0d;padding:9px 12px;border-radius:8px;margin:10px 0;font-size:11px}
    .cards{display:grid;grid-template-columns:repeat(5,1fr);gap:7px;margin:10px 0}
    .card{border:1px solid #c5d0d5;border-radius:9px;background:#f7f9fa;padding:8px 9px}
    .card .ic{font-size:14px;margin-bottom:2px;display:block}
    .card strong{display:block;font-size:15px;color:#a1471f;margin-top:2px}
    .card span.lb{color:#5c6d74}
    .empty{border:1px dashed #aebbc0;padding:12px;color:#60737c;border-radius:8px;text-align:center}
    table{width:100%;border-collapse:collapse;margin:6px 0;page-break-inside:auto}
    thead{display:table-header-group}
    tr{page-break-inside:avoid}
    th,td{border:1px solid #bbc7cc;padding:5px;text-align:right;vertical-align:top}
    th{background:#a1471f;color:#fff}
    tr.flag td{background:#fff6ec}
    tr.danger td{background:#fdecea}
    tr.warn td{background:#fff8e8}
    .muted{color:#5c6d74;font-size:8.5px}
    .chip{display:inline-block;font-size:7.5px;padding:2px 6px;border-radius:99px;white-space:nowrap}
    .chip.warn{background:#fdf3e0;color:#8a5a00}
    .chip.clear{background:#eef9f1;color:#1b6b3f}
    .footer{margin-top:14px;color:#60737c;font-size:9px;border-top:1px solid #e1e7e9;padding-top:8px}
  </style></head><body>
    <div class="band"><div class="badge">⛽</div><div><h1>تقرير الديزل — مطابقة برقم اللوحة</h1><div class="sub">مصنع بن حامد للبلوك والخرسانة الجاهزة</div></div></div>
    <div class="meta">📄 الملف: <b>${esc(sourceFile)}</b> &nbsp;|&nbsp; 📅 تاريخ الإنشاء: <b>${esc(reportDate)}</b> &nbsp;|&nbsp; 🕓 ${esc(new Date().toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'}))}</div>
    <div class="summary">${summaryLine}</div>
    <div class="cards">
      <div class="card"><span class="ic">🚛</span><span class="lb">عدد اللوحات</span><strong>${t.plateCount}</strong></div>
      <div class="card"><span class="ic">⛽</span><span class="lb">عدد التعبئات</span><strong>${t.fillCount}</strong></div>
      <div class="card"><span class="ic">📊</span><span class="lb">إجمالي اللترات</span><strong>${qty(t.liters)}</strong></div>
      <div class="card"><span class="ic">💰</span><span class="lb">إجمالي المبلغ</span><strong>${money(t.amount)} ر.س</strong></div>
      <div class="card"><span class="ic">⚠️</span><span class="lb">ملاحظات (حرج/تنبيه)</span><strong>${t.danger} / ${t.warn}</strong></div>
    </div>
    <h2>🚛 الاستهلاك حسب رقم اللوحة</h2>${vehiclesTable(report.vehicles)}
    <h2>⚠️ التحذيرات والملاحظات الرقابية</h2>${alertsTable(report.alerts)}
    <div class="footer">التحذيرات تلقائية: إيصال مكرر، قراءة عداد غير منطقية، تعبئة متقاربة (أقل من 6 ساعات)، كمية أو سعر يخرج عن المعتاد للوحة نفسها. هذا تقرير رقابي أولي ولا يستبدل مطابقة سجل الأصول الكاملة على الموقع.</div>
  </body></html>`;
}

export async function generateFuelReportPdf(workbook,xlsx,sourceFile='fuel-report.xlsx'){
  const parsed=parseFuelWorkbook(workbook,xlsx),dieselRows=parsed.rows.filter(row=>/diesel|ديزل/i.test(row.fuelType));
  const report=buildFuelControlReport(dieselRows),reportDate=riyadhDate();
  const html=fuelReportHtml({report,sourceFile,reportDate});
  const pdf=await htmlToPdf(html,{filename:`fuel-report-${reportDate}`,landscape:true});
  return{pdf,filename:`fuel-report-${reportDate}.pdf`,caption:`⛽ تقرير الديزل — ${report.totals.plateCount} لوحة، ${report.totals.warn+report.totals.danger} ملاحظة`,report,rowCount:parsed.rowCount};
}
