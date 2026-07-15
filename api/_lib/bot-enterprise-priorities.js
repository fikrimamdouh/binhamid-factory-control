import { select } from './supabase.js';
import { sendMessage, keyboard } from './telegram.js';
import { ACTIVE_STATUS, enterpriseEvents, esc, formatAmount, operationLine, reduceEnterpriseOperations } from './bot-enterprise-store.js';

export async function sendEnterprisePriorities(chatId){
  const [events,approvals,orders,discrepancies,state]=await Promise.all([
    enterpriseEvents(),
    select('approvals','status=eq.pending&select=id,reference_no,summary,amount,created_at&limit=100'),
    select('maintenance_orders','status=in.(reported,inspection,quotation_required,approval_pending,approved,in_repair,testing)&select=reference_no,plate_snapshot,problem,status,priority,vehicle_stopped,reported_at&limit=200'),
    select('discrepancies','status=in.(open,under_review)&select=reference_no,title,severity,created_at&limit=100'),
    select('app_state','key=eq.primary&select=updated_at,revision&limit=1')
  ]);
  const ops=reduceEnterpriseOperations(events),open=ops.filter(item=>ACTIVE_STATUS.has(item.status));
  const urgent=open.filter(item=>item.priority==='critical'||item.priority==='urgent');
  const overdue=open.filter(item=>item.due_date&&new Date(item.due_date)<new Date());
  const stopped=(orders||[]).filter(item=>item.vehicle_stopped),parts=(orders||[]).filter(item=>item.status==='quotation_required'),critical=(discrepancies||[]).filter(item=>item.severity==='critical');
  const syncAt=state?.[0]?.updated_at?new Date(state[0].updated_at):null,syncHours=syncAt?(Date.now()-syncAt.getTime())/36e5:null;
  const points=[];
  if(critical.length)points.push(`مراجعة ${critical.length} فروقات رقابية حرجة.`);
  if(stopped.length)points.push(`متابعة ${stopped.length} مركبات أو معدات متوقفة.`);
  if(parts.length)points.push(`الحصول على أسعار لـ ${parts.length} طلبات قطع غيار.`);
  if(approvals?.length)points.push(`حسم ${approvals.length} اعتمادًا معلقًا بقيمة ${formatAmount(approvals.reduce((sum,item)=>sum+Number(item.amount||0),0))} ر.س.`);
  if(overdue.length)points.push(`متابعة ${overdue.length} مهام أو طلبات تجاوزت موعدها.`);
  if(urgent.length)points.push(`تعيين مسؤول وموعد لـ ${urgent.length} عمليات عاجلة.`);
  if(syncHours!==null&&syncHours>12)points.push(`مزامنة البرنامج قديمة منذ ${syncHours.toFixed(1)} ساعة.`);
  if(!points.length)points.push('لا يظهر مؤشر حرج حاليًا من السجل المركزي.');
  let text=`<b>ما يحتاج تدخلك الآن</b>\n\n${points.map((item,index)=>`${index+1}. ${esc(item)}`).join('\n')}`;
  const samples=[...urgent,...overdue].slice(0,6);if(samples.length)text+=`\n\n<b>عينات للمتابعة</b>\n${samples.map(operationLine).join('\n\n')}`;
  return sendMessage(chatId,text.slice(0,3900),keyboard([[{text:'تحديث',callback_data:'ent:priorities'},{text:'الاعتمادات',callback_data:'ent:approvals'}],[{text:'مهام الفريق',callback_data:'ent:team_tasks'}]]));
}
export async function enterpriseSnapshot(){
  const ops=reduceEnterpriseOperations(await enterpriseEvents(1000)),open=ops.filter(item=>ACTIVE_STATUS.has(item.status)),byCategory={};
  for(const item of open)byCategory[item.category]=(byCategory[item.category]||0)+1;
  return{open,byCategory,urgent:open.filter(item=>item.priority==='critical'||item.priority==='urgent'),overdue:open.filter(item=>item.due_date&&new Date(item.due_date)<new Date())};
}
