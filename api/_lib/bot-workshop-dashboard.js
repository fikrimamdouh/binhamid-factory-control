import { select } from './supabase.js';
import { sendMessage } from './telegram.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const OPEN=['draft','reported','inspection','quotation_required','approval_pending','approved','in_repair','testing'];
const STATUS_LABEL={draft:'مؤقت',reported:'مبلّغ',inspection:'قيد الفحص',quotation_required:'بانتظار تسعير/قطع غيار',approval_pending:'بانتظار اعتماد',approved:'معتمد',in_repair:'قيد الإصلاح',testing:'قيد الاختبار',completed:'مكتمل',closed:'مغلق',cancelled:'ملغي'};

function riyadhStartIso(){
  const now=new Date();
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const get=type=>parts.find(item=>item.type===type)?.value||'';
  return `${get('year')}-${get('month')}-${get('day')}T00:00:00+03:00`;
}
function short(value,max=150){const text=String(value||'').replace(/\s+/g,' ').trim();return text.length>max?`${text.slice(0,max-1)}…`:text;}
function statusCounts(rows=[]){
  const counts={};
  for(const row of rows)counts[row.status]=(counts[row.status]||0)+1;
  return counts;
}
function priorityAdvice({urgent,stopped,parts,pendingApproval}){
  const notes=[];
  if(stopped)notes.push(`متابعة ${stopped} أصل أو مركبة متوقفة قبل توزيع العمل.`);
  if(urgent)notes.push(`مراجعة ${urgent} طلب عاجل وتحديد مسؤول وموعد إنجاز.`);
  if(parts)notes.push(`طلب أسعار لـ ${parts} طلب قطع غيار مفتوح.`);
  if(pendingApproval)notes.push(`حسم ${pendingApproval} طلب بانتظار الاعتماد.`);
  if(!notes.length)notes.push('لا يظهر إجراء عاجل؛ استمر في متابعة الفحص الوقائي وإغلاق الأوامر المكتملة.');
  return notes;
}

export async function sendExecutiveWorkshopStatus(chatId){
  const start=riyadhStartIso();
  const [todayOrders,openOrders,todayLogs,users,completedToday]=await Promise.all([
    select('maintenance_orders',`reported_at=gte.${encodeURIComponent(start)}&select=id,reference_no,plate_snapshot,problem,status,priority,vehicle_stopped,reported_by,reported_at&order=reported_at.desc&limit=200`),
    select('maintenance_orders',`status=in.(${OPEN.join(',')})&select=id,reference_no,plate_snapshot,problem,status,priority,vehicle_stopped,reported_by,reported_at&order=reported_at.asc&limit=300`),
    select('audit_log',`created_at=gte.${encodeURIComponent(start)}&action=in.(mechanic_daily_report,mechanic_inspection,mechanic_order_update,spare_parts_request)&select=action,entity_id,details,created_at&order=created_at.desc&limit=200`),
    select('app_users','role=eq.mechanic&select=id,full_name,active&limit=100'),
    select('maintenance_orders',`closed_at=gte.${encodeURIComponent(start)}&select=id,reference_no&limit=200`)
  ]);

  const userMap=new Map((users||[]).map(user=>[String(user.id),user.full_name]));
  const mechanics=new Map();
  for(const log of todayLogs||[]){
    const name=log.details?.mechanic_name||'مسؤول الورشة';
    const item=mechanics.get(name)||{reports:0,inspections:0,updates:0,parts:0,last:''};
    if(log.action==='mechanic_daily_report')item.reports++;
    if(log.action==='mechanic_inspection')item.inspections++;
    if(log.action==='mechanic_order_update')item.updates++;
    if(log.action==='spare_parts_request')item.parts++;
    if(!item.last)item.last=short(log.details?.report_text||log.details?.inspection_text||log.details?.note||log.details?.request_text||'',120);
    mechanics.set(name,item);
  }
  for(const order of todayOrders||[]){
    const name=userMap.get(String(order.reported_by));
    if(name&&!mechanics.has(name))mechanics.set(name,{reports:0,inspections:0,updates:0,parts:0,last:short(order.problem,120)});
  }

  const open=openOrders||[],today=todayOrders||[],counts=statusCounts(open);
  const urgent=open.filter(row=>row.priority==='urgent').length;
  const stopped=open.filter(row=>row.vehicle_stopped).length;
  const parts=open.filter(row=>row.status==='quotation_required').length;
  const pendingApproval=open.filter(row=>row.status==='approval_pending').length;
  const inspections=(todayLogs||[]).filter(row=>row.action==='mechanic_inspection').length;
  const dailyReports=(todayLogs||[]).filter(row=>row.action==='mechanic_daily_report').length;
  const updates=(todayLogs||[]).filter(row=>row.action==='mechanic_order_update').length;

  let text=`<b>الحالة التنفيذية للورشة والميكانيكي</b>\n\n<b>نشاط اليوم</b>\n• تقارير يومية: <b>${dailyReports}</b>\n• فحوصات معدات وأصول: <b>${inspections}</b>\n• تحديثات أوامر الإصلاح: <b>${updates}</b>\n• طلبات أو أوامر جديدة: <b>${today.length}</b>\n• أوامر مكتملة اليوم: <b>${completedToday?.length||0}</b>\n\n<b>الوضع المفتوح</b>\n• إجمالي مهام الورشة المفتوحة: <b>${open.length}</b>\n• عاجلة: <b>${urgent}</b>\n• مركبات أو معدات متوقفة: <b>${stopped}</b>\n• طلبات قطع غيار وتسعير: <b>${parts}</b>\n• بانتظار اعتماد: <b>${pendingApproval}</b>`;

  const statusLine=Object.entries(counts).filter(([,count])=>count).map(([status,count])=>`${STATUS_LABEL[status]||status}: ${count}`).join(' — ');
  if(statusLine)text+=`\n\n<b>توزيع الحالات</b>\n${esc(statusLine)}`;

  if(mechanics.size){
    text+=`\n\n<b>أداء الميكانيكي اليوم</b>`;
    for(const [name,item] of [...mechanics.entries()].slice(0,8)){
      text+=`\n• <b>${esc(name)}</b>: ${item.reports} تقرير، ${item.inspections} فحص، ${item.updates} تحديث، ${item.parts} طلب قطع غيار`;
      if(item.last)text+=`\n  آخر بيان: ${esc(item.last)}`;
    }
  }else{
    text+=`\n\n<b>أداء الميكانيكي اليوم</b>\nلم يُسجل نشاط تفصيلي حتى الآن.`;
  }

  const critical=open.filter(row=>row.priority==='urgent'||row.vehicle_stopped||row.status==='quotation_required').slice(0,8);
  if(critical.length){
    text+=`\n\n<b>أهم الطلبات التي تحتاج متابعة</b>`;
    for(const row of critical){
      text+=`\n• <b>${esc(row.reference_no)}</b> — ${esc(row.plate_snapshot||'أصل/طلب عام')}\n  ${esc(STATUS_LABEL[row.status]||row.status)}: ${esc(short(row.problem,130))}`;
    }
  }

  text+=`\n\n<b>الإجراءات المقترحة</b>`;
  for(const note of priorityAdvice({urgent,stopped,parts,pendingApproval}))text+=`\n• ${esc(note)}`;
  text+=`\n\nالملخص مبني على سجل الورشة المركزي حتى لحظة الطلب.`;
  return sendMessage(chatId,text.slice(0,3900));
}
