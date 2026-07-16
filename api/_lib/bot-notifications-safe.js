import { select, patch } from './supabase.js';
import { sendMessage } from './telegram.js';
import { queueDailyReportReminders, retryFailedNotifications, sendManagerBrief, sendMeaningfulAlerts } from './bot-notifications.js';

const now=()=>new Date().toISOString();
const html=value=>String(value??'').replace(/[&<>]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[char]));
async function chatForUser(userId){
  return(await select('user_channels',`user_id=eq.${encodeURIComponent(userId)}&channel=eq.telegram&active=eq.true&select=external_id&order=last_seen_at.desc&limit=1`))?.[0]?.external_id||null;
}
export async function processNotificationOutbox(limit=50){
  const safeLimit=Math.max(1,Math.min(200,Number(limit)||50));
  const due=await select('notification_outbox',`status=eq.pending&scheduled_at=lte.${encodeURIComponent(now())}&select=id,recipient_user_id,recipient_chat_id,title,message,payload&order=scheduled_at.asc&limit=${safeLimit}`)||[];
  let sent=0,failed=0;
  for(const item of due){
    try{
      const chatId=item.recipient_chat_id||await chatForUser(item.recipient_user_id);
      if(!chatId){
        await patch('notification_outbox',`id=eq.${item.id}`,{status:'failed',error_text:'لا يوجد حساب Telegram فعال للمستلم'});
        failed++;
        continue;
      }
      const title=html(String(item.title||'').slice(0,300));
      const message=html(String(item.message||'').slice(0,3500));
      const text=`${title?`<b>${title}</b>\n\n`:''}${message}`.slice(0,3900);
      await sendMessage(chatId,text,{action_name:'notification_outbox',action_payload:{notification_id:item.id,type:item.payload?.type||null}});
      await patch('notification_outbox',`id=eq.${item.id}`,{status:'sent',sent_at:now(),recipient_chat_id:String(chatId),error_text:null});
      sent++;
    }catch(error){
      await patch('notification_outbox',`id=eq.${item.id}`,{status:'failed',error_text:String(error?.message||error).slice(0,1000)}).catch(()=>{});
      failed++;
    }
  }
  return{processed:due.length,sent,failed,skipped:Math.max(0,due.length-sent-failed)};
}
export { queueDailyReportReminders, retryFailedNotifications, sendManagerBrief, sendMeaningfulAlerts };
