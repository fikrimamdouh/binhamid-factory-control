import { json, method } from '../_lib/http.js';
import { processNotificationOutbox, queueDailyReportReminders, retryFailedNotifications, sendManagerBrief, sendMeaningfulAlerts } from '../_lib/bot-notifications.js';
function authorized(req){const expected=String(process.env.CRON_SECRET||'').trim();if(!expected)return{ok:false,status:503,error:'CRON_SECRET غير مضبوط'};const supplied=String(req.headers.authorization||'');return supplied===`Bearer ${expected}`?{ok:true}:{ok:false,status:401,error:'unauthorized'};}
export default async function handler(req,res){
  if(!method(req,res,['GET','POST']))return;
  const auth=authorized(req);if(!auth.ok)return json(res,auth.status,{ok:false,error:auth.error});
  try{
    const mode=String(req.query?.mode||'all').toLowerCase();let result;
    if(mode==='brief')result={brief:await sendManagerBrief()};
    else if(mode==='alerts')result={alerts:await sendMeaningfulAlerts()};
    else if(mode==='outbox')result={outbox:await processNotificationOutbox()};
    else if(mode==='retry')result={retry:await retryFailedNotifications(),outbox:await processNotificationOutbox()};
    else if(mode==='all')result={dailyReports:await queueDailyReportReminders(),retry:await retryFailedNotifications(),outbox:await processNotificationOutbox(),alerts:await sendMeaningfulAlerts()};
    else return json(res,400,{ok:false,error:'mode غير صحيح'});
    json(res,200,{ok:true,mode,...result});
  }catch(error){console.error('[scheduled telegram notification]',error);json(res,500,{ok:false,error:error.message});}
}
