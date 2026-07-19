import { sendMessage, keyboard } from './telegram.js';
import { clearMaintenanceSession } from './bot-maintenance.js';
import { esc, norm, setEnterpriseSession } from './bot-enterprise-store.js';
import { config } from './config.js';
import { insert, select } from './supabase.js';

const ownerId=()=>String(config.telegramOwnerId||'').trim();
const isOwner=identity=>Boolean(identity?.active&&ownerId()&&String(identity.external_id||'')===ownerId());
const audienceLabels={all:'جميع المستخدمين',admin:'الإدارة',accountant:'الحسابات',sales:'المبيعات والتحصيل',operations:'التشغيل'};
const roleGroups={admin:new Set(['admin','manager']),accountant:new Set(['accountant']),sales:new Set(['block_sales','concrete_sales','collector']),operations:new Set(['mechanic','driver','employee','warehouse','fuel_operator','hr','procurement','quality'])};

function field(text,label){const match=String(text||'').match(new RegExp(`(?:^|\\n)\\s*${label}\\s*[:：-]\\s*(.+)`,'i'));return match?.[1]?.trim()||'';}
function parseAudience(value){const text=norm(value);if(/^(الكل|الجميع|جميع المستخدمين)$/.test(text))return'all';if(/^(الاداره|الإدارة|المديرين)$/.test(text))return'admin';if(/^(الحسابات|المحاسبين)$/.test(text))return'accountant';if(/^(المبيعات|التحصيل|المبيعات والتحصيل)$/.test(text))return'sales';if(/^(التشغيل|الموظفين|العمال)$/.test(text))return'operations';return'';}
function parseDraft(text){return{title:field(text,'(?:العنوان|عنوان الاشعار|عنوان الإشعار)'),body:field(text,'(?:الرساله|الرسالة|النص|التفاصيل)'),audience:parseAudience(field(text,'(?:الفئه|الفئة|المستلمون|الى|إلى)'))};}
function notificationText(draft){return `<b>إشعار النظام</b>\n\n<b>${esc(draft.title)}</b>\n${esc(draft.body)}\n\nالفئة: <b>${esc(audienceLabels[draft.audience]||draft.audience)}</b>\nصادر من إدارة مصنع بن حامد`;} 

export async function startSystemNotification(message,identity){
  if(!isOwner(identity))return sendMessage(message.chat.id,'إرسال إشعارات النظام متاح للمالك فقط.');
  await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,'system_notification_compose',{startedAt:new Date().toISOString()});
  return sendMessage(message.chat.id,'أرسل الإشعار في رسالة واحدة:\n\nالعنوان: تحديث النظام\nالرسالة: تم إضافة تقارير العملاء الجديدة. افتح البوت واضغط /start.\nالفئة: الكل\n\nالفئات المتاحة: الكل، الإدارة، الحسابات، المبيعات، التشغيل. لن يُرسل شيء قبل المعاينة والتأكيد.');
}

export async function continueSystemNotificationSession(message,identity,session,text){
  if(session?.state==='system_notification_compose'){
    if(!isOwner(identity))return false;
    const draft=parseDraft(text),missing=[];if(!draft.title)missing.push('العنوان');if(!draft.body)missing.push('الرسالة');if(!draft.audience)missing.push('الفئة الصحيحة');
    if(missing.length){await sendMessage(message.chat.id,`البيانات الناقصة: ${missing.join('، ')}. أعد إرسال النموذج كاملًا.`);return true;}
    await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,'system_notification_confirm',{draft,startedAt:new Date().toISOString()});
    await sendMessage(message.chat.id,`<b>معاينة قبل الإرسال</b>\n\n${notificationText(draft)}`,keyboard([[{text:'إرسال الإشعار',callback_data:'ent:notification_confirm'},{text:'إلغاء',callback_data:'ent:notification_cancel'}]]));return true;
  }
  if(session?.state==='system_notification_confirm'){await sendMessage(message.chat.id,'استخدم زر إرسال الإشعار أو الإلغاء.');return true;}
  return false;
}

async function recipients(audience){
  const [channels,users]=await Promise.all([
    select('user_channels','channel=eq.telegram&active=eq.true&select=user_id,external_id&limit=5000').catch(()=>[]),
    select('app_users','active=eq.true&select=id,full_name,role&limit=5000').catch(()=>[])
  ]),userMap=new Map((users||[]).map(row=>[String(row.id),row])),allowed=audience==='all'?null:roleGroups[audience];
  const seen=new Set(),output=[];
  for(const channel of channels||[]){const user=userMap.get(String(channel.user_id));if(!user||allowed&&!allowed.has(String(user.role||'')))continue;const chatId=String(channel.external_id||'');if(!chatId||seen.has(chatId))continue;seen.add(chatId);output.push({chatId,user});}
  return output;
}

async function sendBroadcast(message,identity,draft){
  const rows=await recipients(draft.audience),text=notificationText(draft);let sent=0,failed=0;
  for(const row of rows){try{await sendMessage(row.chatId,text);sent++;}catch{failed++;}}
  await insert('audit_log',[{actor_type:'telegram',actor_id:String(identity.external_id||identity.user_id||''),action:'system_notification_sent',entity_type:'notification',entity_id:`notification-${Date.now()}`,details:{title:draft.title,audience:draft.audience,recipient_count:rows.length,sent_count:sent,failed_count:failed,source_chat_id:String(message.chat.id),source_message_id:String(message.message_id||'')}}],{prefer:'return=minimal'}).catch(()=>{});
  await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id).catch(()=>{});
  return sendMessage(message.chat.id,`<b>تم إرسال إشعار النظام</b>\n\nالفئة: <b>${esc(audienceLabels[draft.audience])}</b>\nنجح: <b>${sent}</b>\nتعذر: <b>${failed}</b>\nإجمالي المستهدفين: <b>${rows.length}</b>`);
}

export async function handleSystemNotificationCallback(message,from,identity,value){
  if(value==='notification_start')return startSystemNotification({...message,from},identity);
  if(value==='notification_cancel'){await clearMaintenanceSession(message.chat.id,identity.external_id||from.id).catch(()=>{});return sendMessage(message.chat.id,'تم إلغاء إشعار النظام.');}
  if(value!=='notification_confirm')return false;if(!isOwner(identity))return sendMessage(message.chat.id,'إرسال إشعارات النظام متاح للمالك فقط.');
  const session=(await select('bot_sessions',`channel=eq.telegram&chat_id=eq.${encodeURIComponent(String(message.chat.id))}&external_user_id=eq.${encodeURIComponent(String(identity.external_id||from.id))}&select=*&limit=1`).catch(()=>[]))?.[0];
  if(session?.state!=='system_notification_confirm'||!session.context?.draft)return sendMessage(message.chat.id,'انتهت جلسة الإشعار. ابدأ من جديد.');
  return sendBroadcast({...message,from},identity,session.context.draft);
}

export async function handleSystemNotificationTextCommand(message,identity,text){
  const value=norm(text);if(!/^(اشعار النظام|إشعار النظام|ارسال اشعار|إرسال إشعار|تحديث النظام للمستخدمين)$/.test(value))return false;await startSystemNotification(message,identity);return true;
}
