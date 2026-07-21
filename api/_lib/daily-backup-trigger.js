// طلب نسخة احتياطية مشفّرة واحدة بعد اعتماد التقرير اليومي مباشرة.
// نسخة واحدة يوميًا فقط توفيرًا للاستهلاك: الطلب يُتجاهل بهدوء إن كانت نسخة
// اليوم قد طُلبت بالفعل، أو إن لم يُضبط مفتاح GitHub — فلا يتعطل الترحيل أبدًا.
import { select, upsert } from './supabase.js';

const REPO='fikrimamdouh/binhamid-factory-control';

function riyadhDay(){
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
}

async function alreadyRequestedToday(day){
  const rows=await select('bot_sessions',`channel=eq.system&chat_id=eq.backup&external_user_id=eq.daily&select=context&limit=1`).catch(()=>[]);
  return String(rows?.[0]?.context?.day||'')===day;
}

async function markRequested(day,detail){
  return upsert('bot_sessions',[{channel:'system',chat_id:'backup',external_user_id:'daily',state:'backup_requested',context:{day,...detail},updated_at:new Date().toISOString()}],'channel,chat_id,external_user_id').catch(()=>null);
}

export async function requestDailyBackup(reason='daily-report-approved'){
  const token=String(process.env.GITHUB_BACKUP_TOKEN||'').trim();
  if(!token)return{skipped:true,code:'GITHUB_TOKEN_MISSING'};
  const day=riyadhDay();
  if(await alreadyRequestedToday(day))return{skipped:true,code:'ALREADY_REQUESTED_TODAY',day};
  try{
    const response=await fetch(`https://api.github.com/repos/${REPO}/dispatches`,{
      method:'POST',
      headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','Content-Type':'application/json','User-Agent':'binhamid-backup'},
      body:JSON.stringify({event_type:'daily-report-approved',client_payload:{reason,day}}),
      signal:AbortSignal.timeout(15_000)
    });
    if(!response.ok){
      const detail=(await response.text().catch(()=>'')).slice(0,200);
      console.warn('[daily backup dispatch]',response.status,detail);
      return{ok:false,status:response.status};
    }
    await markRequested(day,{reason,requestedAt:new Date().toISOString()});
    return{ok:true,day};
  }catch(error){
    console.warn('[daily backup dispatch]',String(error?.message||error).slice(0,200));
    return{ok:false,error:String(error?.message||error).slice(0,200)};
  }
}
