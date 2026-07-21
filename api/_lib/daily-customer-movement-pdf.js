import { htmlToPdf } from './pdf-service.js';
import { select } from './supabase.js';
import { loadDailyReportTimeline } from './daily-report-timeline.js';

const PAGE_SIZE=1000;
const n=value=>Number(value||0)||0;
const money=value=>n(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const keyOf=(code,name)=>String(code||'').trim()?`code:${String(code).trim()}`:`name:${String(name||'غير مسمى').trim().toLowerCase()}`;
const chunks=(values,size=80)=>{const out=[];for(let index=0;index<values.length;index+=size)out.push(values.slice(index,index+size));return out;};
async function pagedSelect(table,query,maxPages=50){const out=[];for(let page=0;page<maxPages;page++){const rows=await select(table,`${query}&limit=${PAGE_SIZE}&offset=${page*PAGE_SIZE}`).catch(()=>[]);if(!Array.isArray(rows)||!rows.length)break;out.push(...rows);if(rows.length<PAGE_SIZE)break;}return out;}
async function rowsForBatches(table,fields,batchIds=[]){const out=[];for(const part of chunks(batchIds)){if(!part.length)continue;out.push(...await pagedSelect(table,`batch_id=in.(${part.join(',')})&select=${fields}`));}return out;}
function blank(code,name){return{code:String(code||''),name:String(name||code||'عميل غير مسمى'),opening:0,approvedSales:0,approvedCollections:0,currentSales:0,currentCollections:0,closing:0,invoiceCount:0,collectionCount:0};}
function add(map,code,name){const key=keyOf(code,name);if(!map.has(key))map.set(key,blank(code,name));const row=map.get(key);if(!row.code&&code)row.code=String(code);if((!row.name||row.name==='عميل غير مسمى')&&name)row.name=String(name);return row;}

export async function loadCustomerMovementProjection(analysis={},reportDate=''){
  const timeline=await loadDailyReportTimeline(reportDate),fromDate=timeline.fromDate||reportDate,toDate=timeline.toDate||reportDate;
  const[openingRows,batches]=await Promise.all([
    pagedSelect('customer_opening_balances','select=customer_code,customer_name,balance,balance_date&order=customer_code.asc'),
    pagedSelect('daily_report_batches',`status=eq.approved&report_date=gte.${fromDate}&report_date=lt.${toDate}&select=id,report_date,status&order=report_date.asc`)
  ]),batchIds=(batches||[]).map(row=>row.id).filter(Boolean);
  const[sales,cash]=await Promise.all([
    rowsForBatches('daily_report_sales_lines','batch_id,invoice_no,customer_code,customer_name,amount',batchIds),
    rowsForBatches('daily_report_cash_movements','batch_id,account_code,account_name,debit,credit,is_customer_collection',batchIds)
  ]),map=new Map();
  for(const row of openingRows||[]){const item=add(map,row.customer_code,row.customer_name);item.opening+=n(row.balance);}
  for(const row of sales||[]){const item=add(map,row.customer_code,row.customer_name);item.approvedSales+=Math.max(0,n(row.amount));item.invoiceCount++;}
  for(const row of cash||[]){if(row.is_customer_collection===false)continue;const amount=Math.max(n(row.debit),n(row.credit),0);const item=add(map,row.account_code,row.account_name);item.approvedCollections+=amount;item.collectionCount++;}
  for(const row of analysis?.sales||[]){const item=add(map,row.customerCode,row.customer);item.currentSales+=Math.max(0,n(row.amount));item.invoiceCount++;}
  for(const row of analysis?.collections||[]){const item=add(map,row.customerCode,row.customer);item.currentCollections+=Math.max(0,n(row.amount));item.collectionCount++;}
  const rows=[...map.values()].map(row=>({...row,totalSales:row.approvedSales+row.currentSales,totalCollections:row.approvedCollections+row.currentCollections,closing:row.opening+row.approvedSales+row.currentSales-row.approvedCollections-row.currentCollections})).filter(row=>Math.abs(row.opening)+Math.abs(row.totalSales)+Math.abs(row.totalCollections)>0.004).sort((a,b)=>b.closing-a.closing||a.name.localeCompare(b.name,'ar'));
  const totals=rows.reduce((out,row)=>{for(const key of ['opening','approvedSales','approvedCollections','currentSales','currentCollections','totalSales','totalCollections','closing'])out[key]+=n(row[key]);out.customers++;return out;},{customers:0,opening:0,approvedSales:0,approvedCollections:0,currentSales:0,currentCollections:0,totalSales:0,totalCollections:0,closing:0});
  return{timeline,rows,totals,batches,openingRowCount:openingRows.length,postedSalesRowCount:sales.length,postedCollectionRowCount:cash.length};
}

export function customerMovementHtml({projection,sourceFile}){
  const{timeline,rows,totals}=projection,missing=timeline.missingDates||[],hardErrors=timeline.errors||[];
  const body=rows.length?rows.map((row,index)=>`<tr class="${row.closing>0?'due':row.closing<0?'credit':'clear'}"><td>${index+1}</td><td>${esc(row.code||'—')}</td><td>${esc(row.name)}</td><td>${money(row.opening)}</td><td>${money(row.approvedSales)}</td><td>${money(row.approvedCollections)}</td><td>${money(row.currentSales)}</td><td>${money(row.currentCollections)}</td><td>${money(row.totalSales)}</td><td>${money(row.totalCollections)}</td><td><strong>${money(row.closing)}</strong></td></tr>`).join(''):`<tr><td colspan="11" class="empty">لا توجد حركة أو أرصدة ضمن الفترة.</td></tr>`;
  return`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>@page{size:A4 landscape;margin:9mm}*{box-sizing:border-box}body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#173746;font-size:9px}.head{border-bottom:4px solid #14425f;padding-bottom:8px}.head h1{margin:0;font-size:21px}.meta,.note{margin:8px 0;padding:8px 10px;border:1px solid #d8e0e4;border-radius:8px;background:#f7f9fa}.warn{background:#fff5e5;border-color:#d79b2e}.error{background:#fff0ed;border-color:#b84235;color:#862b21}.cards{display:grid;grid-template-columns:repeat(5,1fr);gap:7px;margin:8px 0}.card{border:1px solid #c5d0d5;border-radius:8px;padding:7px;background:#fff}.card b{display:block;font-size:14px;color:#14425f}table{width:100%;border-collapse:collapse}thead{display:table-header-group}tr{page-break-inside:avoid}th,td{border:1px solid #bdc8cd;padding:4px;text-align:right}th{background:#14425f;color:#fff}.due td:last-child{background:#fff0ed}.credit td:last-child{background:#eaf7ef;color:#17653d}.clear td:last-child{background:#f4f5f5}.empty{text-align:center;padding:18px}.footer{margin-top:8px;color:#687b84}</style></head><body><div class="head"><h1>كشف حركة وأرصدة العملاء من الرصيد الافتتاحي</h1><div>مصنع بن حامد للبلوك والخرسانة الجاهزة</div></div><div class="meta">الملف الحالي: <b>${esc(sourceFile)}</b> | الرصيد الافتتاحي حتى: <b>${esc(timeline.openingDate||'غير محدد')}</b> | الحركة من: <b>${esc(timeline.fromDate)}</b> إلى: <b>${esc(timeline.toDate)}</b> | آخر يوم معتمد سابقًا: <b>${esc(timeline.latestApprovedDate||'لا يوجد')}</b></div>${hardErrors.length?`<div class="note error"><b>أخطاء تمنع الاعتماد:</b><br>${hardErrors.map(error=>esc(error.message||error.code)).join('<br>')}</div>`:''}${missing.length?`<div class="note warn"><b>تنبيه تسلسل:</b> الأيام التالية غير معتمدة: ${esc(missing.join('، '))}. التقرير مسودة ولا يصبح نهائيًا قبل معالجة الفجوة أو اعتمادها بصلاحية المدير.</div>`:''}<div class="cards"><div class="card">العملاء<b>${totals.customers}</b></div><div class="card">الرصيد الافتتاحي<b>${money(totals.opening)}</b></div><div class="card">مبيعات الفترة<b>${money(totals.totalSales)}</b></div><div class="card">تحصيلات الفترة<b>${money(totals.totalCollections)}</b></div><div class="card">الرصيد المتوقع<b>${money(totals.closing)}</b></div></div><table><thead><tr><th>#</th><th>الكود</th><th>العميل</th><th>افتتاحي</th><th>مبيعات معتمدة</th><th>تحصيلات معتمدة</th><th>مبيعات الملف</th><th>تحصيلات الملف</th><th>إجمالي المبيعات</th><th>إجمالي التحصيلات</th><th>الرصيد المتوقع</th></tr></thead><tbody>${body}</tbody></table><div class="footer">المعادلة: الرصيد المتوقع = الرصيد الافتتاحي + المبيعات المعتمدة + مبيعات الملف الحالي − التحصيلات المعتمدة − تحصيلات الملف الحالي. الرصيد السالب يعني رصيدًا دائنًا للعميل.</div></body></html>`;
}

export async function generateCustomerMovementPdf(analysis={},reportDate='',sourceFile='daily-report.xlsx'){
  const projection=await loadCustomerMovementProjection(analysis,reportDate),html=customerMovementHtml({projection,sourceFile}),pdf=await htmlToPdf(html,{filename:`customer-movement-${reportDate}`,landscape:true});
  return{pdf,filename:`customer-movement-${reportDate}.pdf`,caption:`كشف حركة العملاء من ${projection.timeline.fromDate} إلى ${projection.timeline.toDate} — مسودة`,projection};
}
