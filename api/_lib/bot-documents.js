import crypto from 'node:crypto';
import { select } from './supabase.js';
import { sendDocumentBuffer, sendMessage } from './telegram.js';
import { displayName } from './bot-profile.js';
import { enterpriseSnapshot } from './bot-enterprise-priorities.js';
import { enterpriseEvents, esc, formatAmount, operationLine, reduceEnterpriseOperations } from './bot-enterprise-store.js';

function escapeHtml(value=''){return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
function reportTitle(kind){return({manager:'التقرير التنفيذي لمدير المصنع',tasks:'تقرير المهام المفتوحة',workshop:'تقرير الورشة والصيانة',sales:'تقرير أوامر البيع'}[kind]||'تقرير مصنع بن حامد');}
async function reportBody(kind){
  if(kind==='manager'){
    const snapshot=await enterpriseSnapshot();
    const [approvals,maintenance,discrepancies]=await Promise.all([
      select('approvals','status=eq.pending&select=id,amount&limit=500'),
      select('maintenance_orders','status=in.(reported,inspection,quotation_required,approval_pending,approved,in_repair,testing)&select=reference_no,plate_snapshot,problem,status,priority,vehicle_stopped&limit=500'),
      select('discrepancies','status=in.(open,under_review)&select=reference_no,title,severity&limit=500')
    ]);
    return `<h2>المؤشرات التنفيذية</h2><table><tr><th>المؤشر</th><th>القيمة</th></tr><tr><td>العمليات المفتوحة</td><td>${snapshot.open.length}</td></tr><tr><td>العاجلة</td><td>${snapshot.urgent.length}</td></tr><tr><td>المتأخرة</td><td>${snapshot.overdue.length}</td></tr><tr><td>الاعتمادات المعلقة</td><td>${approvals?.length||0}</td></tr><tr><td>أوامر الورشة المفتوحة</td><td>${maintenance?.length||0}</td></tr><tr><td>الفروقات الرقابية</td><td>${discrepancies?.length||0}</td></tr></table><h2>أهم العمليات</h2>${snapshot.open.slice(0,25).map(item=>`<div class="card">${operationLine(item).replace(/<b>/g,'<strong>').replace(/<\/b>/g,'</strong>').replace(/\n/g,'<br>')}</div>`).join('')||'<p>لا توجد عمليات مفتوحة.</p>'}`;
  }
  if(kind==='tasks'){
    const ops=reduceEnterpriseOperations(await enterpriseEvents(1000)).filter(item=>item.category==='task'&&!['completed','closed','cancelled'].includes(item.status));
    return `<h2>المهام المفتوحة</h2>${ops.map(item=>`<div class="card"><strong>${escapeHtml(item.reference_no)}</strong> — ${escapeHtml(item.title||'مهمة')}<br>المسؤول: ${escapeHtml(item.assigned_to||'غير محدد')}<br>الموعد: ${escapeHtml(item.due_date||'غير محدد')}<br>الحالة: ${escapeHtml(item.status||'مفتوح')}<br>${escapeHtml(item.note||'')}</div>`).join('')||'<p>لا توجد مهام مفتوحة.</p>'}`;
  }
  if(kind==='workshop'){
    const rows=await select('maintenance_orders','status=in.(reported,inspection,quotation_required,approval_pending,approved,in_repair,testing)&select=reference_no,plate_snapshot,problem,status,priority,vehicle_stopped,estimated_cost,actual_cost,reported_at&order=reported_at.desc&limit=200');
    return `<h2>أوامر الإصلاح المفتوحة</h2><table><tr><th>المرجع</th><th>الأصل</th><th>الحالة</th><th>الأولوية</th><th>الوصف</th></tr>${(rows||[]).map(row=>`<tr><td>${escapeHtml(row.reference_no)}</td><td>${escapeHtml(row.plate_snapshot||'أصل عام')}</td><td>${escapeHtml(row.status)}</td><td>${escapeHtml(row.priority)}</td><td>${escapeHtml(row.problem)}</td></tr>`).join('')}</table>`;
  }
  const logs=await select('audit_log','action=in.(sales_order_created,sales_order_updated)&select=action,entity_id,details,created_at&order=created_at.desc&limit=500');
  const map=new Map();for(const row of [...(logs||[])].reverse())map.set(String(row.entity_id),{...(map.get(String(row.entity_id))||{}),...row.details,reference_no:String(row.entity_id)});
  return `<h2>أوامر البيع</h2><table><tr><th>المرجع</th><th>القسم</th><th>العميل</th><th>القيمة</th><th>التوريد</th><th>الحالة</th></tr>${[...map.values()].slice(0,200).map(row=>`<tr><td>${escapeHtml(row.reference_no)}</td><td>${escapeHtml(row.sales_type||'')}</td><td>${escapeHtml(row.customer_name||'')}</td><td>${formatAmount(row.total_amount)} ر.س</td><td>${escapeHtml(row.delivery_date||'')}</td><td>${escapeHtml(row.status||'')}</td></tr>`).join('')}</table>`;
}
function htmlDocument({title,body,requestedBy,verification}){
  const verifyUrl=`https://binhamid-factory-control.vercel.app/?verify=${encodeURIComponent(verification)}`;
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>body{font-family:Arial,Tahoma,sans-serif;color:#173746;padding:34px;line-height:1.7}h1{font-size:24px;border-bottom:3px solid #a97926;padding-bottom:12px}h2{font-size:18px;margin-top:28px}table{width:100%;border-collapse:collapse;margin:14px 0}th,td{border:1px solid #bbc7cc;padding:8px;text-align:right}th{background:#eef2f3}.card{border:1px solid #d5dddf;border-radius:8px;padding:10px;margin:8px 0}.meta{font-size:12px;color:#60737c}.verify{margin-top:35px;border-top:1px solid #ccd5d8;padding-top:14px}</style></head><body><h1>${escapeHtml(title)}</h1><div class="meta">مصنع بن حامد للبلوك والخرسانة الجاهزة<br>تاريخ الإنشاء: ${new Date().toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'})}<br>طالب التقرير: ${escapeHtml(requestedBy)}</div>${body}<div class="verify"><strong>رمز التحقق:</strong> ${escapeHtml(verification)}<br><img width="130" height="130" src="https://quickchart.io/qr?size=180&text=${encodeURIComponent(verifyUrl)}"><br><span class="meta">تم إنشاء المستند آليًا من السجل المركزي. يلزم مراجعة المصدر عند الاعتماد المالي أو النظامي.</span></div></body></html>`;
}
async function convertToPdf(html){
  const url=String(process.env.PDF_SERVICE_URL||'').trim();if(!url)return null;
  const headers={'Content-Type':'application/json'};const key=String(process.env.PDF_SERVICE_API_KEY||'').trim();if(key)headers.Authorization=`Bearer ${key}`;
  const response=await fetch(url,{method:'POST',headers,body:JSON.stringify({html,format:'A4',printBackground:true})});
  if(!response.ok)throw new Error(`تعذر إنشاء PDF: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
export async function sendOperationalDocument(message,identity,kind){
  if(!['admin','manager','accountant'].includes(identity?.role))return sendMessage(message.chat.id,'إنشاء التقارير التنفيذية متاح للإدارة والمحاسب.');
  const title=reportTitle(kind),body=await reportBody(kind),verification=crypto.randomBytes(8).toString('hex').toUpperCase(),html=htmlDocument({title,body,requestedBy:displayName(identity,message.from),verification});
  try{
    const pdf=await convertToPdf(html);
    if(pdf)return sendDocumentBuffer(message.chat.id,pdf,`${kind}-${new Date().toISOString().slice(0,10)}.pdf`,'application/pdf',title);
  }catch(error){await sendMessage(message.chat.id,`تعذر التحويل إلى PDF؛ سأرسل نسخة HTML قابلة للطباعة. السبب: ${esc(error.message)}`);}
  return sendDocumentBuffer(message.chat.id,Buffer.from(html,'utf8'),`${kind}-${new Date().toISOString().slice(0,10)}.html`,'text/html',`${title} — نسخة قابلة للطباعة`);
}
