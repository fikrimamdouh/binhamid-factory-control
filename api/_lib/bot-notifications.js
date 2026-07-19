import crypto from 'node:crypto';
import { select, insert, patch, rpc } from './supabase.js';
import { sendDocumentBuffer, sendMessage } from './telegram.js';
import { buildManagerSnapshot, formatManagerBrief, stableAlertDigest } from './manager-metrics.js';
import { htmlToPdf } from './pdf-service.js';
import { config } from './config.js';
import { dispatchOperationNotifications } from './operation-engine.js';

const now=()=>new Date().toISOString();
const html=value=>String(value??'').replace(/[&<>]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[char]));
function riyadhDay(offset=0){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const map=Object.fromEntries(parts.map(part=>[part.type,part.value]));const date=new Date(`${map.year}-${map.month}-${map.day}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+offset);return date.toISOString().slice(0,10);}
function riyadhHour(){return Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Riyadh',hour:'2-digit',hourCycle:'h23'}).format(new Date()));}
function riyadhWeekday(){const day=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Riyadh',weekday:'short'}).format(new Date());return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(day);}
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function briefHtml(snapshot){return `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><style>body{font-family:Arial;color:#143442;padding:28px}h1{color:#0d506a;border-bottom:3px solid #bd8b28;padding-bottom:8px}table{border-collapse:collapse;width:100%;margin:14px 0}td,th{border:1px solid #cbd5da;padding:9px;text-align:right}th{background:#edf4f5}.alert{padding:8px;border-bottom:1px solid #ddd}</style><h1>تقرير المدير اليومي — مصنع بن حامد</h1><p>التاريخ: ${esc(snapshot.day)}</p><table><tr><th>المبيعات</th><th>تحصيلات</th><th>خزينة 101</th><th>خزينة 104</th><th>ديزل</th><th>صيانة مفتوحة</th></tr><tr><td>${esc(snapshot.sales.total)} ر.س</td><td>${esc(snapshot.collections.total)} ر.س</td><td>${esc(snapshot.collections.treasury101)} ر.س</td><td>${esc(snapshot.collections.treasury104)} ر.س</td><td>${esc(snapshot.fuel.liters)} لتر</td><td>${esc(snapshot.maintenance.open.length)}</td></tr></table><h2>التنبيهات</h2>${snapshot.alerts.slice(0,10).map(x=>`<div class="alert"><b>${esc(x.title)}</b><br>${esc(x.message)}</div>`).join('')||'<p>لا توجد تنبيهات حرجة.</p>'}</html>`;}

async function managerChats(){const users=await select('app_users','active=eq.true&role=in.(admin,manager)&select=id,full_name,role&limit=100');if(!users?.length)return[];const ids=users.map(item=>item.id).join(','),channels=await select('user_channels',`active=eq.true&channel=eq.telegram&user_id=in.(${ids})&select=user_id,external_id&limit=200`),map=new Map(users.map(item=>[String(item.id),item]));return(channels||[]).map(item=>({...item,user:map.get(String(item.user_id))})).filter(item=>item.external_id);}
async function alreadySent(hash,hours=6){const since=new Date(Date.now()-hours*36e5).toISOString(),rows=await select('audit_log',`action=eq.telegram_alert_sent&created_at=gte.${encodeURIComponent(since)}&select=details&limit=200`);return(rows||[]).some(item=>item.details?.hash===hash);}
async function markSent(hash,type,count,day){return insert('audit_log',[{actor_type:'system',actor_id:'cron',action:'telegram_alert_sent',entity_type:'notification',entity_id:hash,details:{hash,type,day,recipient_count:count},created_at:now()}]);}

export async function queueDailyReportReminders(day=riyadhDay(0)){try{const result=await rpc('queue_missing_daily_reports',{p_day:day});return{queued:Number(Array.isArray(result)?result[0]?.queue_missing_daily_reports||result[0]||0:result||0),day};}catch(error){return{queued:0,day,skipped:true,error:String(error?.message||error)};}}

export async function processNotificationOutbox(limit=50){
  const safeLimit=Math.max(1,Math.min(200,Number(limit)||50)),stamp=now();let rows=[];
  try{rows=await select('notification_outbox',`status=in.(pending,failed,retrying)&scheduled_at=lte.${encodeURIComponent(stamp)}&or=(next_attempt_at.is.null,next_attempt_at.lte.${encodeURIComponent(stamp)})&select=id&order=scheduled_at.asc&limit=${safeLimit}`)||[];}
  catch{rows=await select('notification_outbox',`status=eq.pending&scheduled_at=lte.${encodeURIComponent(stamp)}&select=id&order=scheduled_at.asc&limit=${safeLimit}`)||[];}
  const result=await dispatchOperationNotifications(rows.map(row=>row.id));
  return{processed:result.queued,sent:result.sent,failed:result.failed,deadLetter:result.deadLetter,skipped:Math.max(0,result.queued-result.sent-result.failed-result.deadLetter)};
}

export async function retryFailedNotifications(limit=30){
  const safeLimit=Math.max(1,Math.min(100,Number(limit)||30)),stamp=now();
  try{
    const rows=await select('notification_outbox',`status=eq.failed&attempt_count=lt.5&or=(next_attempt_at.is.null,next_attempt_at.lte.${encodeURIComponent(stamp)})&select=id&order=created_at.asc&limit=${safeLimit}`)||[];
    for(const row of rows)await patch('notification_outbox',`id=eq.${row.id}`,{status:'pending',scheduled_at:stamp,error_text:null});
    const exhausted=await select('notification_outbox',`status=eq.failed&attempt_count=gte.5&select=id&limit=${safeLimit}`).catch(()=>[]);
    for(const row of exhausted||[])await patch('notification_outbox',`id=eq.${row.id}`,{status:'dead_letter',dead_letter_at:stamp,next_attempt_at:null});
    return{requeued:rows.length,deadLettered:exhausted?.length||0};
  }catch{
    const since=new Date(Date.now()-24*36e5).toISOString(),rows=await select('notification_outbox',`status=eq.failed&attempts=lt.5&created_at=gte.${encodeURIComponent(since)}&select=id&order=created_at.asc&limit=${safeLimit}`)||[];
    for(const row of rows)await patch('notification_outbox',`id=eq.${row.id}`,{status:'pending',scheduled_at:stamp,error_text:null});
    return{requeued:rows.length,compatibilityMode:true};
  }
}

export async function sendManagerBrief(){const [chats,snapshot]=await Promise.all([managerChats(),buildManagerSnapshot(riyadhDay(-1),{persistAlerts:true})]);if(!chats.length)return{sent:0,reason:'no_managers',day:snapshot.day};const text=formatManagerBrief(snapshot),hash=crypto.createHash('sha256').update(`brief:${snapshot.day}:${text}`).digest('hex');if(await alreadySent(hash,20))return{sent:0,reason:'duplicate',day:snapshot.day};for(const item of chats)await sendMessage(item.external_id,text,{action_name:'manager_brief',action_payload:{day:snapshot.day}});try{const pdf=await htmlToPdf(briefHtml(snapshot),{filename:`binhamid-manager-brief-${snapshot.day}`});for(const item of chats)await sendDocumentBuffer(item.external_id,pdf,`binhamid-manager-brief-${snapshot.day}.pdf`,'application/pdf',`تقرير المدير اليومي — ${snapshot.day}`);}catch(error){console.warn('[manager brief pdf]',{code:error?.code||null,message:String(error?.message||'').slice(0,300)});}await markSent(hash,'brief',chats.length,snapshot.day);return{sent:chats.length,day:snapshot.day,alerts:snapshot.alerts.length};}
export async function sendScheduledManagerBrief(){if(riyadhHour()!==config.managerBriefHour)return{sent:0,reason:'outside_configured_hour',hour:riyadhHour(),configuredHour:config.managerBriefHour};return sendManagerBrief();}

// This is intentionally an operational export, not a replacement for the
// encrypted, restorable database backup. It contains no tokens, credentials or
// Telegram conversation history and is delivered only to approved managers.
export async function sendWeeklyOperationalExport(){
  if(riyadhWeekday()!==config.weeklyExportWeekday||riyadhHour()!==config.weeklyExportHour)return{sent:0,reason:'outside_configured_window'};
  const day=riyadhDay(0),hash=crypto.createHash('sha256').update(`weekly-operational-export:${day}`).digest('hex');if(await alreadySent(hash,30))return{sent:0,reason:'duplicate',day};
  const [chats,customers,vehicles,orders,batches,maintenance,inventory,backups]=await Promise.all([managerChats(),select('customers','select=external_id,customer_code,customer_name,phone,credit_limit,payment_days,active,updated_at&limit=10000'),select('vehicles','select=external_id,plate_no,asset_no,make,model,status,active,updated_at&limit=10000'),select('sales_orders','select=reference_no,sales_type,customer_external_id,customer_name,item,quantity,total_amount,paid_amount,status,delivery_date,created_at&order=created_at.desc&limit=10000'),select('daily_report_batches','select=report_date,original_name,status,summary,committed_at&order=report_date.desc&limit=366'),select('maintenance_orders','select=reference_no,vehicle_external_id,priority,status,vehicle_stopped,actual_cost,reported_at,updated_at&order=updated_at.desc&limit=5000'),select('inventory_items','select=external_id,sku,item_name,category,unit,quantity_on_hand,minimum_quantity,average_cost,active,updated_at&limit=10000'),select('backup_runs','status=in.(completed,verified)&select=backup_name,status,completed_at,verified_at,checksum_sha256,size_bytes&order=completed_at.desc&limit=20')]);
  if(!chats.length)return{sent:0,reason:'no_managers',day};const payload={kind:'binhamid-operational-weekly-export',generatedAt:now(),day,notice:'تشغيلي للمراجعة؛ النسخة القابلة للاستعادة محفوظة ومشفرة في مخزن النسخ الاحتياطي.',customers,vehicles,salesOrders:orders,dailyReports:batches,maintenanceOrders:maintenance,inventoryItems:inventory,backupEvidence:backups},buffer=Buffer.from(JSON.stringify(payload,null,2),'utf8');if(buffer.length>18*1024*1024)return{sent:0,reason:'export_too_large',bytes:buffer.length,day};for(const item of chats)await sendDocumentBuffer(item.external_id,buffer,`binhamid-operational-export-${day}.json`,'application/json',`تصدير تشغيلي أسبوعي — ${day}. النسخة القابلة للاستعادة تبقى مشفرة في المخزن.`);await markSent(hash,'weekly_operational_export',chats.length,day);return{sent:chats.length,day,bytes:buffer.length};
}

export async function sendMeaningfulAlerts(){const [chats,snapshot]=await Promise.all([managerChats(),buildManagerSnapshot(riyadhDay(0),{persistAlerts:true})]),alerts=snapshot.alerts.filter(item=>item.severity!=='info').slice(0,10);if(!chats.length||!alerts.length)return{sent:0,reason:!chats.length?'no_managers':'no_alerts',day:snapshot.day};const digest=stableAlertDigest(alerts),hash=crypto.createHash('sha256').update(`alerts:${snapshot.day}:${digest}`).digest('hex');if(await alreadySent(hash))return{sent:0,reason:'duplicate',day:snapshot.day};const text=`<b>تنبيهات مصنع بن حامد</b>\n\n${alerts.map((item,index)=>`${index+1}. <b>${html(item.title)}</b>\n${html(item.message)}`).join('\n\n')}`.slice(0,3900);for(const item of chats)await sendMessage(item.external_id,text,{action_name:'manager_alerts',action_payload:{day:snapshot.day,digest}});await markSent(hash,'alert',chats.length,snapshot.day);return{sent:chats.length,day:snapshot.day,alerts:alerts.length};}
