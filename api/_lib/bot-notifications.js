import crypto from 'node:crypto';
import { select, insert } from './supabase.js';
import { sendMessage } from './telegram.js';
import { enterpriseSnapshot } from './bot-enterprise-priorities.js';

const now=()=>new Date().toISOString();
async function managerChats(){
  const users=await select('app_users','active=eq.true&role=in.(admin,manager)&select=id,full_name,role&limit=100');
  if(!users?.length)return[];
  const ids=users.map(item=>item.id).join(','),channels=await select('user_channels',`active=eq.true&channel=eq.telegram&user_id=in.(${ids})&select=user_id,external_id&limit=200`),map=new Map(users.map(item=>[String(item.id),item]));
  return(channels||[]).map(item=>({...item,user:map.get(String(item.user_id))})).filter(item=>item.external_id);
}
async function alertInputs(){
  const [snapshot,approvals,maintenance,discrepancies,state]=await Promise.all([
    enterpriseSnapshot(),
    select('approvals','status=eq.pending&select=id,amount,created_at&limit=500'),
    select('maintenance_orders','status=in.(reported,inspection,quotation_required,approval_pending,approved,in_repair,testing)&select=id,priority,vehicle_stopped,status,reported_at&limit=500'),
    select('discrepancies','status=in.(open,under_review)&select=id,severity,title&limit=500'),
    select('app_state','key=eq.primary&select=updated_at,revision&limit=1')
  ]);
  const urgentMaintenance=(maintenance||[]).filter(item=>item.priority==='urgent'||item.vehicle_stopped),critical=(discrepancies||[]).filter(item=>item.severity==='critical'),staleHours=state?.[0]?.updated_at?(Date.now()-new Date(state[0].updated_at).getTime())/36e5:null;
  return{snapshot,approvals:approvals||[],maintenance:maintenance||[],urgentMaintenance,critical,staleHours,revision:state?.[0]?.revision||0};
}
function briefText(data){
  return `<b>ملخص مصنع بن حامد</b>\n\nالعمليات المفتوحة: <b>${data.snapshot.open.length}</b>\nالعاجلة: <b>${data.snapshot.urgent.length}</b>\nالمتأخرة: <b>${data.snapshot.overdue.length}</b>\nالاعتمادات المعلقة: <b>${data.approvals.length}</b>\nأوامر الورشة المفتوحة: <b>${data.maintenance.length}</b>\nمركبات أو معدات متوقفة/عاجلة: <b>${data.urgentMaintenance.length}</b>\nفروقات حرجة: <b>${data.critical.length}</b>\nرقم المزامنة: <b>${data.revision}</b>${data.staleHours!==null?`\nعمر آخر مزامنة: <b>${data.staleHours.toFixed(1)} ساعة</b>`:''}\n\nاكتب «ما يحتاج تدخلي الآن» لعرض الأولويات التفصيلية.`;
}
function alertText(data){
  const items=[];
  if(data.critical.length)items.push(`${data.critical.length} فروقات رقابية حرجة`);
  if(data.urgentMaintenance.length)items.push(`${data.urgentMaintenance.length} أوامر ورشة عاجلة أو أصول متوقفة`);
  if(data.snapshot.overdue.length)items.push(`${data.snapshot.overdue.length} مهام أو طلبات متأخرة`);
  if(data.approvals.length>=5)items.push(`${data.approvals.length} اعتمادات معلقة`);
  if(data.staleHours!==null&&data.staleHours>12)items.push(`المزامنة متوقفة أو قديمة منذ ${data.staleHours.toFixed(1)} ساعة`);
  return items.length?`<b>تنبيه تشغيلي</b>\n\n${items.map((item,index)=>`${index+1}. ${item}`).join('\n')}\n\nاكتب «ما يحتاج تدخلي الآن» للتفاصيل.`:'';
}
async function alreadySent(hash,hours=6){
  const since=new Date(Date.now()-hours*36e5).toISOString(),rows=await select('audit_log',`action=eq.telegram_alert_sent&created_at=gte.${encodeURIComponent(since)}&select=details&limit=100`);
  return(rows||[]).some(item=>item.details?.hash===hash);
}
async function markSent(hash,type,count){return insert('audit_log',[{actor_type:'system',actor_id:'cron',action:'telegram_alert_sent',entity_type:'notification',entity_id:hash,details:{hash,type,recipient_count:count},created_at:now()}]);}
export async function sendManagerBrief(){
  const [chats,data]=await Promise.all([managerChats(),alertInputs()]);if(!chats.length)return{sent:0,reason:'no_managers'};
  const text=briefText(data);for(const item of chats)await sendMessage(item.external_id,text);await markSent(crypto.createHash('sha256').update(`brief:${new Date().toISOString().slice(0,13)}`).digest('hex'),'brief',chats.length);return{sent:chats.length};
}
export async function sendMeaningfulAlerts(){
  const [chats,data]=await Promise.all([managerChats(),alertInputs()]),text=alertText(data);if(!chats.length||!text)return{sent:0,reason:!chats.length?'no_managers':'no_alerts'};
  const hash=crypto.createHash('sha256').update(text).digest('hex');if(await alreadySent(hash))return{sent:0,reason:'duplicate'};
  for(const item of chats)await sendMessage(item.external_id,text);await markSent(hash,'alert',chats.length);return{sent:chats.length};
}
