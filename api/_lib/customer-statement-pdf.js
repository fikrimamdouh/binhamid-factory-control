import { htmlToPdf } from './pdf-service.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money=value=>Number(value||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const riyadhNow=()=>new Date().toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'});
const salesTypeLabel={block:'بلوك',concrete:'خرسانة'};
const DECISION_LABEL={normal:'طبيعي',watch:'مراجعة قبل زيادة الائتمان',stop:'إيقاف البيع الآجل حتى المراجعة'};
const DECISION_COLOR={normal:'#1b6b3f',watch:'#8a5a00',stop:'#9a2f2f'};
const AGING_LABEL={current:'لم يحن أجله',days1to30:'١-٣٠ يوم',days31to60:'٣١-٦٠ يوم',days61to90:'٦١-٩٠ يوم',days90plus:'أكثر من ٩٠ يوم'};

function invoicesTable(rows){
  if(!rows.length)return'<p class="empty">📭 لا توجد فواتير بعد الرصيد الافتتاحي.</p>';
  return `<table><thead><tr><th>التاريخ</th><th>المرجع</th><th>النوع</th><th>الإجمالي</th><th>المسدد</th><th>المتبقي</th><th>الاستحقاق</th></tr></thead><tbody>${rows.map(row=>`<tr class="${row.outstanding>0?'due':'clear'}"><td>${esc(String(row.delivery_date||row.created_at||'').slice(0,10)||'—')}</td><td>${esc(row.reference_no||'—')}</td><td>${esc(salesTypeLabel[row.sales_type]||row.sales_type||'—')}</td><td>${money(row.total)}</td><td>${money(row.paid)}</td><td><strong>${money(row.outstanding)}</strong></td><td>${esc(row.dueDate||'—')}${row.daysLate>0?`<div class="warning">متأخر ${row.daysLate} يوم</div>`:''}</td></tr>`).join('')}</tbody></table>`;
}
function collectionsTable(rows){
  if(!rows.length)return'<p class="empty">📭 لا توجد تحصيلات بعد الرصيد الافتتاحي.</p>';
  return `<table><thead><tr><th>التاريخ</th><th>المرجع</th><th>المبلغ</th><th>غير موزع</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${esc(String(row.occurred_at||row.created_at||'').slice(0,10)||'—')}</td><td>${esc(row.reference_no||'—')}</td><td>${money(row.amount)}</td><td>${row.unallocated>0?`<span class="chip advance">💰 ${money(row.unallocated)}</span>`:'—'}</td></tr>`).join('')}</tbody></table>`;
}
function agingRow(row){
  const buckets=['current','days1to30','days31to60','days61to90','days90plus'];
  return `<table><thead><tr>${buckets.map(key=>`<th>${AGING_LABEL[key]}</th>`).join('')}</tr></thead><tbody><tr>${buckets.map(key=>`<td>${money(row.aging?.[key]||0)}</td>`).join('')}</tr></tbody></table>`;
}

export function customerStatementHtml(row){
  const decision=row.decision||'normal';
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
    @page{size:A4;margin:12mm}
    *{box-sizing:border-box}
    body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#173746;font-size:10.5px;line-height:1.6}
    .band{display:flex;align-items:center;gap:12px;border-bottom:4px solid #14425F;padding-bottom:10px;margin-bottom:10px}
    .band .badge{width:46px;height:46px;border-radius:12px;background:#14425F;color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;flex:none}
    .band h1{font-size:19px;margin:0}
    .band .sub{color:#5c6d74;font-size:10px;margin-top:2px}
    .meta{background:#f7f9fa;border:1px solid #e1e7e9;border-radius:8px;padding:8px 10px;margin-bottom:10px;display:grid;grid-template-columns:1fr 1fr;gap:4px 14px}
    .meta div b{color:#14425F}
    .status{display:inline-block;padding:4px 12px;border-radius:99px;font-weight:700;color:#fff;background:${DECISION_COLOR[decision]||'#14425F'}}
    h2{font-size:13px;margin:14px 0 6px}
    .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin:10px 0}
    .card{border:1px solid #c5d0d5;border-radius:9px;background:#f7f9fa;padding:8px 9px}
    .card span.lb{color:#5c6d74;display:block;font-size:9px}
    .card strong{display:block;font-size:14px;color:#14425F;margin-top:2px}
    table{width:100%;border-collapse:collapse;margin:6px 0}
    th,td{border:1px solid #bbc7cc;padding:5px;text-align:right;font-size:9.5px}
    th{background:#14425F;color:#fff}
    .due td:nth-child(6){background:#fff3ef}
    .clear td:nth-child(6){background:#eef9f1}
    .empty{border:1px dashed #aebbc0;padding:10px;color:#60737c;border-radius:8px;text-align:center}
    .warning{font-size:8px;color:#9a2f2f}
    .chip{display:inline-block;font-size:8px;padding:2px 6px;border-radius:99px;background:#fdf3e0;color:#8a5a00}
    .footer{margin-top:16px;color:#60737c;font-size:8.5px;border-top:1px solid #e1e7e9;padding-top:7px}
  </style></head><body>
    <div class="band"><div class="badge">🧾</div><div><h1>كشف حساب عميل</h1><div class="sub">مصنع بن حامد للبلوك والخرسانة الجاهزة</div></div></div>
    <div class="meta">
      <div>العميل: <b>${esc(row.name)}</b></div>
      <div>رقم الحساب: <b>${esc(row.code||'—')}</b></div>
      <div>الجوال: <b>${esc(row.phone||'—')}</b></div>
      <div>حتى تاريخ: <b>${esc(new Date().toISOString().slice(0,10))}</b></div>
    </div>
    <div style="margin:10px 0">الحالة الائتمانية: <span class="status">${esc(DECISION_LABEL[decision]||decision)}</span></div>
    <div class="cards">
      <div class="card"><span class="lb">الرصيد الافتتاحي</span><strong>${money(row.openingBalance)}</strong></div>
      <div class="card"><span class="lb">إجمالي المبيعات</span><strong>${money(row.grossSales)}</strong></div>
      <div class="card"><span class="lb">إجمالي التحصيلات</span><strong>${money(row.collections)}</strong></div>
      <div class="card"><span class="lb">الرصيد الحالي</span><strong>${money(row.netBalance)}</strong></div>
      <div class="card"><span class="lb">مديونية على العميل</span><strong>${money(row.debitBalance)}</strong></div>
      <div class="card"><span class="lb">رصيد دائن له</span><strong>${money(row.creditBalance)}</strong></div>
      <div class="card"><span class="lb">المتأخر المؤرَّخ</span><strong>${money(row.overdue)}</strong></div>
      <div class="card"><span class="lb">عدد الحركات</span><strong>${(row.invoiceCount||0)+(row.collectionCount||0)}</strong></div>
    </div>
    <h2>📅 أعمار الديون</h2>${agingRow(row)}
    <h2>🧾 أحدث الفواتير</h2>${invoicesTable((row.sales||[]).slice(0,25))}
    <h2>💵 أحدث التحصيلات</h2>${collectionsTable((row.collectionRows||[]).slice(0,25))}
    <div class="footer">الحركات المعتمدة من التقرير اليومي تظهر تلقائيًا في هذا الكشف. تاريخ الإصدار: ${esc(riyadhNow())}</div>
  </body></html>`;
}

export async function generateCustomerStatementPdf(row){
  const html=customerStatementHtml(row),safeName=String(row.code||row.name||'customer').replace(/[^\x00-\x7F]/g,'_').replace(/[^A-Za-z0-9._-]/g,'_').slice(0,60)||'customer';
  const pdf=await htmlToPdf(html,{filename:`statement-${safeName}`,landscape:false});
  return{pdf,filename:`statement-${safeName}.pdf`,caption:`🧾 كشف حساب — ${row.name}${row.code?` (${row.code})`:''}`};
}
