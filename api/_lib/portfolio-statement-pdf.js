// كشف حساب محفظة المندوب — مستند تشغيلي مستقل تمامًا عن إقرار المسؤولية.
// الإقرار يُوقَّع وقد يُقصر على المديونين؛ هذا الكشف لا يُوقَّع ويحفظ الصورة الكاملة:
// كل عملاء المندوب، وما اشتراه كل عميل، وما سدَّده، وما تبقى عليه.
// (كشف العميل الواحد موجود في customer-statement-pdf.js — هذا للمحفظة كلها.)
import { htmlToPdf } from './pdf-service.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const clean=value=>String(value??'').trim();
const num=value=>Number(value||0);
const money=value=>num(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtG=value=>{const text=clean(value);if(!/^\d{4}-\d{2}-\d{2}$/.test(text))return text;const[y,m,d]=text.split('-');return`${d}/${m}/${y}`;};
const DEPARTMENT={block:'البلوك',concrete:'الخرسانة'};

const CSS=`<style>@page{size:A4 portrait;margin:10mm 9mm}*{box-sizing:border-box}
body{margin:0;direction:rtl;font-family:'IBM Plex Sans Arabic',Tahoma,Arial,sans-serif;color:#12100D;font-size:9.4pt}
.hd{display:flex;align-items:center;gap:5mm;border-bottom:2pt solid #0B2233;padding-bottom:2.5mm;margin-bottom:3mm}
.hd img{width:26mm;height:auto}.hd .co{font-size:11pt;font-weight:700;color:#0B2233}
.hd .sub{font-size:7.8pt;color:#6B6350;margin-top:.6mm}
.hd .meta{margin-inline-start:auto;text-align:left;font-size:7.2pt;color:#55503F;direction:ltr}
.hd .meta b{display:block;color:#0B2233;font-family:ui-monospace,monospace;font-size:8.2pt}
.who{display:flex;gap:5mm;flex-wrap:wrap;background:#FBF7EF;border:.8pt solid #E0D6C0;padding:2mm 3mm;margin-bottom:3mm;font-size:8.4pt}
.who i{font-style:normal;color:#8C8368}
table{width:100%;border-collapse:collapse;font-size:8.8pt}
thead th{background:#0B2233;color:#E4CFA4;font-weight:500;font-size:7.6pt;padding:1.7mm 2mm;text-align:center;border-inline-start:.5pt solid rgba(217,181,112,.25)}
tbody td{padding:1.5mm 2mm;border-bottom:.6pt solid #EDE7DA;border-inline-start:.6pt solid #F2EDE2;text-align:center}
tbody tr:nth-child(even){background:#FCFAF6}tbody tr.ok{background:#F3F8F3}
td.nm{text-align:right;font-weight:600}td.mono{font-family:ui-monospace,monospace;direction:ltr;font-size:8pt}
td.num{font-family:ui-monospace,monospace;font-weight:700;color:#0B2233}
td.due{color:#8A2D20}td.zero{color:#3F7A46}
td.idx{font-family:ui-monospace,monospace;color:#A79C82;font-size:7.4pt}
tfoot td{background:#F3EBDC;border-top:1.2pt solid #C6B187;padding:2mm;font-weight:700;color:#0B2233;text-align:center;font-family:ui-monospace,monospace}
tfoot td.lbl{text-align:right;font-family:inherit;color:#8A6520}
.none{padding:6mm;color:#B4AB94;font-style:italic;text-align:center}
.sum{display:flex;border:1.1pt solid #B4893A;margin-top:3mm;background:linear-gradient(180deg,#FDF8EF,#F6EBD8)}
.sum div{flex:1;padding:2mm 3mm;border-inline-start:.7pt solid #E8E1D2}
.sum .k{font-size:6.6pt;color:#9A9077;font-weight:600}
.sum .v{font-family:ui-monospace,monospace;font-size:10.5pt;font-weight:700;color:#0B2233;margin-top:.5mm}
.sum .v.due{color:#8A2D20;font-size:12.5pt}
.ft{margin-top:3mm;font-size:7pt;color:#A79C82;font-style:italic}</style>`;

function bodyRows(rows){
  if(!rows.length)return'<tr><td colspan="6" class="none">لا توجد حركة عملاء في هذه الفترة</td></tr>';
  return rows.map((row,index)=>{
    const settled=num(row.outstanding)<=0;
    return`<tr${settled?' class="ok"':''}><td class="idx">${String(index+1).padStart(2,'0')}</td><td class="nm">${esc(row.name)}</td><td class="mono">${esc(row.code||'—')}</td><td class="num">${money(row.sales)}</td><td class="num">${money(row.paid)}</td><td class="num ${settled?'zero':'due'}">${money(row.outstanding)}</td></tr>`;
  }).join('');
}

export function renderPortfolioStatement({type='block',companyName='',employee={},customers=[],reportDate='',documentRef='',logoUrl=''}={}){
  const department=DEPARTMENT[type]||DEPARTMENT.block;
  // الأعلى مديونية أولًا حتى تُقرأ المتأخرات فورًا دون بحث.
  const rows=[...customers].sort((a,b)=>num(b.outstanding)-num(a.outstanding)||num(b.sales)-num(a.sales)||clean(a.name).localeCompare(clean(b.name),'ar'));
  const totals=rows.reduce((out,row)=>{out.sales+=num(row.sales);out.paid+=num(row.paid);out.outstanding+=num(row.outstanding);return out;},{sales:0,paid:0,outstanding:0});
  const due=rows.filter(row=>num(row.outstanding)>0).length;
  const head=`<div class="hd">${logoUrl?`<img src="${esc(logoUrl)}" alt="">`:''}<div><div class="co">${esc(companyName)}</div><div class="sub">كشف حساب عملاء ${department} — للمتابعة التشغيلية، غير مخصص للتوقيع</div></div><div class="meta">مرجع<b>${esc(documentRef)}</b>تاريخ التقرير<b>${fmtG(reportDate)}</b></div></div>`;
  const who=`<div class="who"><span><i>المندوب:</i> <b>${esc(employee.name||'—')}</b></span><span><i>رقم الإقامة:</i> <b>${esc(employee.nationalId||'—')}</b></span><span><i>القطاع:</i> <b>${department}</b></span><span><i>عدد العملاء:</i> <b>${rows.length}</b></span><span><i>عليهم رصيد:</i> <b>${due}</b></span></div>`;
  const table=`<table><thead><tr><th style="width:8mm">م</th><th>العميل</th><th style="width:22mm">الكود</th><th style="width:28mm">قيمة المشتريات</th><th style="width:26mm">المسدَّد</th><th style="width:28mm">المتبقي</th></tr></thead><tbody>${bodyRows(rows)}</tbody><tfoot><tr><td colspan="3" class="lbl">الإجمالي</td><td>${money(totals.sales)}</td><td>${money(totals.paid)}</td><td>${money(totals.outstanding)}</td></tr></tfoot></table>`;
  const summary=`<div class="sum"><div><div class="k">إجمالي قيمة المشتريات</div><div class="v">${money(totals.sales)}</div></div><div><div class="k">إجمالي المسدَّد</div><div class="v">${money(totals.paid)}</div></div><div><div class="k">إجمالي المتبقي</div><div class="v due">${money(totals.outstanding)}</div></div></div>`;
  const foot=`<div class="ft">«قيمة المشتريات» و«المسدَّد» عن فترة التقرير، و«المتبقي» كامل الرصيد غير المسدَّد شاملًا ما سبق. الصفوف الخضراء لعملاء سدَّدوا بالكامل.</div>`;
  return{document:`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">${CSS}</head><body>${head}${who}${table}${summary}${foot}</body></html>`,totals,due,count:rows.length};
}

export async function buildPortfolioStatementPdf(input={}){
  const rendered=renderPortfolioStatement(input),department=DEPARTMENT[input.type]||DEPARTMENT.block;
  const pdf=await htmlToPdf(rendered.document,{filename:`portfolio-statement-${input.type||'block'}-${input.reportDate||''}`,landscape:false});
  return{type:input.type,pdf,filename:`كشف حساب عملاء ${department} — ${input.reportDate||''}.pdf`,department,totals:rendered.totals,due:rendered.due,count:rendered.count};
}
