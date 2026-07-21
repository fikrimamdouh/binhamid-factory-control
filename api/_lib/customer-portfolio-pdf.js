import { select } from './supabase.js';
import { htmlToPdf } from './pdf-service.js';
import { loadProjectedCumulativeDailyReport } from './daily-cumulative-report-data.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money=value=>Number(value||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const qty=value=>Number(value||0).toLocaleString('en-US',{maximumFractionDigits:3});
const norm=value=>String(value??'').trim().toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/\s+/g,' ');
const riyadhDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const title=type=>type==='block'?'إقرار مسؤولية محفظة عملاء — البلوك':'إقرار مسؤولية محفظة عملاء — الخرسانة';
const icon=type=>type==='block'?'🧱':'🏗️';
const accent=type=>type==='block'?'#8a5a2c':'#0d6a4a';
const ROLE_BY_TYPE={block:'مسؤول مبيعات البلوك',concrete:'مسؤول مبيعات الخرسانة'};
const CUSTOMER_PORTFOLIO_DECLARATION = `أُقر بأن العملاء المدرجين في هذا النموذج مُسندون إليّ، وأنني المسؤول المباشر عن متابعة تعاملاتهم وتحصيل مستحقات المنشأة لديهم.
ألتزم بعدم البيع الآجل لأي عميل خارج سقف الائتمان المعتمد له، وبعدم منح أي مهلة سداد تتجاوز المدة المقررة أعلاه.
ألتزم بالحصول على موافقة كتابية مسبقة من الإدارة قبل أي تجاوز لسقف الائتمان أو مهلة السداد أو قبل التعامل مع عميل غير مُسجّل في هذا النموذج.
ألتزم بتوريد كامل المبالغ المحصّلة إلى خزينة المنشأة خلال يوم عمل واحد من تاريخ التحصيل، وبعدم الاحتفاظ بأي مبلغ لدي تحت أي مبرر.
ألتزم بتسليم إيصال قبض رسمي مسلسل ومختوم لكل عميل عند كل تحصيل، وأُقر بأن التحصيل بدون إيصال رسمي مخالفة جسيمة.
ألتزم برفع تقرير أسبوعي عن حالة الذمم المدينة لعملائي، وبإبلاغ الإدارة فورًا عن أي عميل يتأخر عن السداد أو تظهر عليه بوادر تعثر.
أُقر بأن للمنشأة الحق المطلق في إضافة أو حذف أو نقل أي عميل من محفظتي في أي وقت ودون إبداء أسباب، وأن كشف العملاء المرفق يُحدَّث تلقائيًا بموجب ذلك.
أُقر بعلمي التام بأن جميع العملاء والبيانات التجارية ملك خالص للمنشأة، وألتزم بعدم إفشائها أو استغلالها لمصلحتي أو لمصلحة الغير أثناء الخدمة أو بعدها.
ألتزم بمتابعة المبالغ غير المسددة خلال مهلة {الأيام} أيام من تاريخ التوريد، ورفع حالة المتأخرات للإدارة.\u2028ألتزم بأن مهلة السداد المحددة أعلاه ({الأيام} أيام) نافذة فقط في حال توفر السيولة الكافية لدى المنشأة لشراء المواد الخام التشغيلية؛ وفي حال عدم توفر هذه السيولة، ألتزم أنا (المحصل أو مسؤول مبيعات الخرسانة) بتحصيل دفعة مقدمة من العميل قبل التوريد، أو بتحصيل كامل قيمة الحساب فورًا، ولا يجوز الاعتداد بمهلة السداد المذكورة في هذه الحالة إلا بموافقة كتابية مسبقة من الإدارة.`;

// نفس دالة استبدال المتغيرات {الموظف}/{المنشأة}/{الأيام} المستخدمة في نموذج
// الموقع (tpl في legacy.html) حتى يطابق النص المطبوع من تليجرام النص المطبوع
// من الموقع تمامًا.
function applyTemplate(line,ctx){
  return esc(line)
    .replace(/\{الموظف\}/g,`<b>${esc(ctx.emp||'……………')}</b>`)
    .replace(/\{المنشأة\}/g,`<b>${esc(ctx.companyName)}</b>`)
    .replace(/\{الأيام\}/g,`<b>${esc(ctx.days)}</b>`);
}
function clauseList(text,ctx){
  const lines=String(text||'').split('\n').map(s=>s.trim()).filter(Boolean);
  if(!lines.length)return '<p class="empty">لا توجد بنود إقرار محفوظة.</p>';
  return `<ol class="clauses">${lines.map(line=>`<li>${applyTemplate(line,ctx)}</li>`).join('')}</ol>`;
}

// يجلب نص الإقرار الحالي (D.txt.cli) واسم المنشأة ومهلة السداد وقائمة
// الموظفين من نفس نسخة الحالة السحابية (app_state) التي يحفظها الموقع —
// أي تعديل تعمليه على نصوص البنود من الموقع ينعكس تلقائيًا هنا.
async function loadAppState(){
  const rows=await select('app_state','key=eq.primary&select=payload&limit=1').catch(()=>[]);
  const legacy=rows?.[0]?.payload?.legacy||{};
  return{
    declarationText:CUSTOMER_PORTFOLIO_DECLARATION,
    companyName:legacy?.cfg?.name||'مصنع بن حامد للبلوك والخرسانة الجاهزة',
    days:Number(legacy?.cfg?.days||3)||3,
    employees:Array.isArray(legacy?.emp)?legacy.emp:[]
  };
}
function findRep(employees,type){
  const wanted=norm(ROLE_BY_TYPE[type]);
  return employees.find(e=>norm(e?.role||'').includes(wanted))||employees.find(e=>norm(e?.role||'').includes('مسؤول مبيعات')||norm(e?.role||'').includes('مندوب'))||null;
}

function customersTable(rows){
  if(!rows.length)return'<p class="empty">📭 لا يوجد عملاء نشطون لهذا القسم حتى الآن.</p>';
  return `<table><thead><tr><th>#</th><th>كود العميل</th><th>اسم العميل</th><th>قيمة التوريدات</th><th>المدفوع</th><th>المتبقي</th></tr></thead><tbody>${rows.map((row,index)=>`<tr class="${row.closingBalance>0?'due':'clear'}"><td>${index+1}</td><td>${esc(row.code||'—')}</td><td>${esc(row.name)}</td><td>${money(row.cumulativeSales)}</td><td>${money(row.cumulativePaid)}</td><td><strong>${money(row.closingBalance)}</strong></td></tr>`).join('')}</tbody></table>`;
}

export function customerPortfolioHtml({type,rows,totals,rep,state,reportDate}){
  const ctx={emp:rep?.name||'',companyName:state.companyName,days:state.days};
  const stillDue=rows.filter(r=>Number(r.closingBalance||0)>0);
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
    @page{size:A4;margin:12mm}
    *{box-sizing:border-box}
    body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#173746;font-size:10.5px;line-height:1.65}
    .band{display:flex;align-items:center;gap:12px;border-bottom:4px solid ${accent(type)};padding-bottom:10px;margin-bottom:10px}
    .band .badge{width:46px;height:46px;border-radius:12px;background:${accent(type)};color:#fff;display:flex;align-items:center;justify-content:center;font-size:24px;flex:none}
    .band h1{font-size:19px;margin:0}
    .band .sub{color:#5c6d74;font-size:10px;margin-top:2px}
    .meta{background:#f7f9fa;border:1px solid #e1e7e9;border-radius:8px;padding:8px 10px;margin-bottom:10px;display:grid;grid-template-columns:1fr 1fr;gap:4px 14px}
    .meta div b{color:${accent(type)}}
    h2{font-size:13px;margin:14px 0 6px}
    .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin:10px 0}
    .card{border:1px solid #c5d0d5;border-radius:9px;background:#f7f9fa;padding:8px 9px}
    .card span.lb{color:#5c6d74;display:block;font-size:9px}
    .card strong{display:block;font-size:14px;color:${accent(type)};margin-top:2px}
    table{width:100%;border-collapse:collapse;margin:6px 0}
    th,td{border:1px solid #bbc7cc;padding:5px;text-align:right}
    th{background:${accent(type)};color:#fff;font-size:9.5px}
    .due td:nth-child(6){background:#fff3ef}
    .clear td:nth-child(6){background:#eef9f1}
    .empty{border:1px dashed #aebbc0;padding:10px;color:#60737c;border-radius:8px;text-align:center}
    ol.clauses{margin:6px 0 0;padding-inline-start:18px}
    ol.clauses li{margin-bottom:7px}
    .sign{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:22px}
    .sign div{border-top:1px solid #8a97a0;padding-top:6px;font-size:9.5px;color:#5c6d74}
    .footer{margin-top:16px;color:#60737c;font-size:8.5px;border-top:1px solid #e1e7e9;padding-top:7px}
  </style></head><body>
    <div class="band"><div class="badge">${icon(type)}</div><div><h1>${esc(title(type))}</h1><div class="sub">${esc(state.companyName)}</div></div></div>
    <div class="meta">
      <div>المسؤول: <b>${esc(rep?.name||'غير مسند')}</b></div>
      <div>المسمى الوظيفي: <b>${esc(rep?.role||ROLE_BY_TYPE[type])}</b></div>
      <div>الرقم الوظيفي: <b>${esc(rep?.no||'—')}</b></div>
      <div>تاريخ الإصدار: <b>${esc(reportDate)}</b></div>
    </div>
    <div class="cards">
      <div class="card"><span class="lb">عدد العملاء</span><strong>${totals.customers||0}</strong></div>
      <div class="card"><span class="lb">إجمالي التوريدات</span><strong>${money(totals.cumulativeSales)} ر.س</strong></div>
      <div class="card"><span class="lb">إجمالي المسدد</span><strong>${money(totals.cumulativePaid)} ر.س</strong></div>
      <div class="card"><span class="lb">عملاء عليهم رصيد</span><strong>${stillDue.length}</strong></div>
    </div>
    <h2>📋 بنود الإقرار</h2>${clauseList(state.declarationText,ctx)}
    <h2>🧾 كشف العملاء المُسندين</h2>${customersTable(rows)}
    <div class="sign"><div>اسم وتوقيع المسؤول: ${esc(rep?.name||'')}</div><div>اعتماد الإدارة والختم</div></div>
    <div class="footer">تقرير مولّد تلقائيًا من حركة الملف اليومي وأرصدة قاعدة البيانات. القيم قابلة للتغيّر مع كل ملف يومي جديد حتى الاعتماد النهائي.</div>
  </body></html>`;
}

export async function generateCustomerPortfolioPdfs(analysis={},sourceFile='daily-report.xlsx'){
  const reportDate=riyadhDate();
  const[state,projection]=await Promise.all([loadAppState(),loadProjectedCumulativeDailyReport(analysis,reportDate)]);
  return Promise.all(['block','concrete'].map(async type=>{
    const data=projection.departments[type],rep=findRep(state.employees,type);
    const html=customerPortfolioHtml({type,rows:data.rows,totals:data.totals,rep,state,reportDate});
    const pdf=await htmlToPdf(html,{filename:`portfolio-${type}-${reportDate}`,landscape:false});
    return{type,pdf,filename:`portfolio-${type}-${reportDate}.pdf`,caption:`${icon(type)} إقرار محفظة عملاء — ${rep?.name||ROLE_BY_TYPE[type]} — ${reportDate}`};
  }));
}
