import crypto from 'node:crypto';
import { select, insert, patch, rpc } from './supabase.js';
import { sendMessage } from './telegram.js';
import { buildManagerSnapshot, formatManagerBrief, stableAlertDigest } from './manager-metrics.js';

const now=()=>new Date().toISOString();
const html=value=>String(value??'').replace(/[&<>]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[char]));
function riyadhDay(offset=0){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const map=Object.fromEntries(parts.map(part=>[part.type,part.value]));const date=new Date(`${map.year}-${map.month}-${map.day}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+offset);return date.toISOString().slice(0,10);}

async function managerChats(){
  const users=await select('app_users','active=eq.true&role=in.(admin,manager)&select=id,full_name,role&limit=100');
  if(!users?.length)return[];
  const ids=users.map(item=>item.id).join(','),channels=await select('user_channels',`active=eq.true&channel=eq.telegram&user_id=in.(${ids})&select=user_id,external_id&limit=200`),map=new Map(users.map(item=>[String(item.id),item]));
  return(channels||[]).map(item=>({...item,user:map.get(String(item.user_id))})).filter(item=>item.external_id);
}
async function alreadySent(hash,hours=6){
  const since=new Date(Date.now()-hours*36e5).toISOString(),rows=await select('audit_log',`action=eq.telegram_alert_sent&created_at=gte.${encodeURIComponent(since)}&select=details&limit=200`);
  return(rows||[]).some(item=>item.details?.hash===hash);
}
async function markSent(hash,type,count,day){return insert('audit_log',[{actor_type:'system',actor_id:'cron',action:'telegram_alert_sent',entity_type:'notification',entity_id:hash,details:{hash,type,day,recipient_count:count},created_at:now()}]);}
async function chatForUser(userId){return(await select('user_channels',`user_id=eq.${encodeURIComponent(userId)}&channel=eq.telegram&active=eq.true&select=external_id&order=last_seen_at.desc&limit=1`))?.[0]?.external_id||null;}

export async function queueDailyReportReminders(day=riyadhDay(0)){
  try{const result=await rpc('queue_missing_daily_reports',{p_day:day});return{queued:Number(Array.isArray(result)?result[0]?.queue_missing_daily_reports||result[0]||0:result||0),day};}
  catch(error){return{queued:0,day,skipped:true,error:String(error?.message||error)};}
}

export async function processNotificationOutbox(limit=50){
  const safeLimit=Math.max(1,Math.min(200,Number(limit)||50)),due=await select('notification_outbox',`status=eq.pending&scheduled_at=lte.${encodeURIComponent(now())}&select=id,recipient_user_id,recipient_chat_id,title,message,payload,attempts&order=scheduled_at.asc&limit=${safeLimit}`)||[];
  let sent=0,failed=0;
  for(const item of due){
    try{
      await patch('notification_outbox',`id=eq.${item.id}`,{status:'processing',last_attempt_at:now()});
      const chatId=item.recipient_chat_id||await chatForUser(item.recipient_user_id);
      if(!chatId){await patch('notification_outbox',`id=eq.${item.id}`,{status:'failed',error_text:'لا يوجد حساب Telegram فعال للمستلم'});failed++;continue;}
      const title=html(String(item.title||'').slice(0,300)),message=html(String(item.message||'').slice(0,3500)),text=`${title?`<b>${title}</b>\n\n`:''}${message}`.slice(0,3900);
      await sendMessage(chatId,text,{action_name:'notification_outbox',action_payload:{notification_id:item.id,type:item.payload?.type||null}});
      await patch('notification_outbox',`id=eq.${item.id}`,{status:'sent',sent_at:now(),recipient_chat_id:String(chatId),error_text:null});sent++;
    }catch(error){await patch('notification_outbox',`id=eq.${item.id}`,{status:'failed',error_text:String(error?.message||error).slice(0,1000)}).catch(()=>{});failed++;}
  }
  return{processed:due.length,sent,failed,skipped:Math.max(0,due.length-sent-failed)};
}

export async function retryFailedNotifications(limit=30){
  const since=new Date(Date.now()-24*36e5).toISOString(),rows=await select('notification_outbox',`status=eq.failed&attempts=lt.5&created_at=gte.${encodeURIComponent(since)}&select=id&order=created_at.asc&limit=${Math.max(1,Math.min(100,Number(limit)||30))}`)||[];
  for(const row of rows)await patch('notification_outbox',`id=eq.${row.id}`,{status:'pending',scheduled_at:now(),error_text:null});
  return{requeued:rows.length};
}

export async function sendManagerBrief(){
  const [chats,snapshot]=await Promise.all([managerChats(),buildManagerSnapshot(riyadhDay(-1),{persistAlerts:true})]);
  if(!chats.length)return{sent:0,reason:'no_managers',day:snapshot.day};
  const text=formatManagerBrief(snapshot),hash=crypto.createHash('sha256').update(`brief:${snapshot.day}:${text}`).digest('hex');
  if(await alreadySent(hash,20))return{sent:0,reason:'duplicate',day:snapshot.day};
  for(const item of chats)await sendMessage(item.external_id,text,{action_name:'manager_brief',action_payload:{day:snapshot.day}});
  await markSent(hash,'brief',chats.length,snapshot.day);return{sent:chats.length,day:snapshot.day,alerts:snapshot.alerts.length};
}

export async function sendMeaningfulAlerts(){
  const [chats,snapshot]=await Promise.all([managerChats(),buildManagerSnapshot(riyadhDay(0),{persistAlerts:true})]);
  const alerts=snapshot.alerts.filter(item=>item.severity!=='info').slice(0,10);
  if(!chats.length||!alerts.length)return{sent:0,reason:!chats.length?'no_managers':'no_alerts',day:snapshot.day};
  const digest=stableAlertDigest(alerts),hash=crypto.createHash('sha256').update(`alerts:${snapshot.day}:${digest}`).digest('hex');
  if(await alreadySent(hash))return{sent:0,reason:'duplicate',day:snapshot.day};
  const text=`<b>تنبيهات مصنع بن حامد</b>\n\n${alerts.map((item,index)=>`${index+1}. <b>${html(item.title)}</b>\n${html(item.message)}`).join('\n\n')}`.slice(0,3900);
  for(const item of chats)await sendMessage(item.external_id,text,{action_name:'manager_alerts',action_payload:{day:snapshot.day,digest}});
  await markSent(hash,'alert',chats.length,snapshot.day);return{sent:chats.length,day:snapshot.day,alerts:alerts.length};
}
