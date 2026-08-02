import crypto from 'node:crypto';
import { body, errorResponse, json, method } from '../http.js';
import { config } from '../config.js';
import { insert, select } from '../supabase.js';
import { loadDailyBrief, renderDailyBrief } from '../bot-daily-brief.js';
import { sendMessage } from '../telegram.js';

const REPOSITORY='fikrimamdouh/binhamid-factory-control';
const ISSUER='https://token.actions.githubusercontent.com';
const AUDIENCE='binhamid-daily-sales-brief';
const WORKFLOW='/.github/workflows/daily-sales-brief.yml@refs/heads/main';
let cache={expires:0,keys:[]};

const clean=(value,max=4000)=>String(value??'').trim().slice(0,max);
const decode=value=>{try{return JSON.parse(Buffer.from(value,'base64url').toString('utf8'));}catch{return null;}};
const audiences=value=>Array.isArray(value)?value:[value];
const now=()=>new Date().toISOString();
function riyadhDay(){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const map=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}
function slotName(value){
  const normalized=clean(value,20).toLowerCase();
  if(normalized==='morning'||normalized==='evening')return normalized;
  const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Riyadh',hour:'2-digit',hourCycle:'h23'}).format(new Date()));
  return hour<13?'morning':'evening';
}

async function keys(){
  if(cache.expires>Date.now()&&cache.keys.length)return cache.keys;
  const response=await fetch(`${ISSUER}/.well-known/jwks`,{headers:{Accept:'application/json'}});
  if(!response.ok)throw Object.assign(new Error('تعذر التحقق من هوية تشغيل تقرير المبيعات'),{status:502,code:'DAILY_SALES_OIDC_JWKS_FAILED'});
  const data=await response.json();
  cache={expires:Date.now()+3600000,keys:Array.isArray(data.keys)?data.keys:[]};
  return cache.keys;
}
async function authorize(req){
  const auth=clean(req.headers?.authorization,3000);
  if(!auth.startsWith('Bearer '))throw Object.assign(new Error('هوية تشغيل تقرير المبيعات مطلوبة'),{status:401,code:'DAILY_SALES_AUTH_REQUIRED'});
  const parts=auth.slice(7).split('.'),header=decode(parts[0]),claims=decode(parts[1]);
  if(parts.length!==3||!header||!claims||header.alg!=='RS256'||!header.kid)throw Object.assign(new Error('هوية تشغيل تقرير المبيعات غير صالحة'),{status:401,code:'DAILY_SALES_AUTH_INVALID'});
  const key=(await keys()).find(item=>item.kid===header.kid),epoch=Math.floor(Date.now()/1000);
  if(!key)throw Object.assign(new Error('مفتاح هوية التشغيل غير معروف'),{status:401,code:'DAILY_SALES_AUTH_KEY_UNKNOWN'});
  const valid=crypto.verify('RSA-SHA256',Buffer.from(`${parts[0]}.${parts[1]}`),crypto.createPublicKey({key,format:'jwk'}),Buffer.from(parts[2],'base64url'));
  const workflowRef=String(claims.workflow_ref||'');
  if(!valid||claims.iss!==ISSUER||!audiences(claims.aud).includes(AUDIENCE)||claims.repository!==REPOSITORY||claims.ref!=='refs/heads/main'||!workflowRef.includes(WORKFLOW)||Number(claims.exp||0)<=epoch||Number(claims.nbf||0)>epoch+30){
    throw Object.assign(new Error('هوية تشغيل تقرير المبيعات غير معتمدة'),{status:403,code:'DAILY_SALES_AUTH_FORBIDDEN'});
  }
}

async function recipients(){
  const users=await select('app_users','active=eq.true&role=in.(admin,manager)&select=id&limit=100').catch(()=>[])||[];
  const ids=users.map(item=>item.id).filter(Boolean).join(',');
  const channels=ids?await select('user_channels',`active=eq.true&channel=eq.telegram&user_id=in.(${ids})&select=external_id&limit=200`).catch(()=>[]):[];
  const result=new Set((channels||[]).map(item=>clean(item.external_id,100)).filter(Boolean));
  if(config.telegramOwnerId)result.add(String(config.telegramOwnerId));
  return [...result];
}
async function alreadySent({runDay,slot,batchId}){
  const since=new Date(Date.now()-36*3600000).toISOString();
  const rows=await select('audit_log',`action=eq.telegram_sales_brief_sent&created_at=gte.${encodeURIComponent(since)}&select=details&order=created_at.desc&limit=100`).catch(()=>[])||[];
  return rows.some(row=>String(row?.details?.run_day||'')===runDay&&String(row?.details?.slot||'')===slot&&String(row?.details?.batch_id||'')===String(batchId||''));
}
async function recordSent(details){
  await insert('audit_log',[{actor_type:'system',actor_id:'github-actions',action:'telegram_sales_brief_sent',entity_type:'daily_report',entity_id:String(details.batch_id||details.run_day),details,created_at:now()}]);
}

export async function sendDailySalesBrief(req,res){
  if(!method(req,res,['POST']))return;
  try{
    await authorize(req);
    const payload=await body(req),slot=slotName(payload?.slot),runDay=riyadhDay(),force=payload?.force===true;
    const brief=await loadDailyBrief(),batchId=brief?.batch?.id||'',reportDate=String(brief?.batch?.report_date||'').slice(0,10);
    if(!force&&await alreadySent({runDay,slot,batchId}))return json(res,200,{ok:true,sent:0,reason:'duplicate',slot,runDay,reportDate,batchId});
    const chats=await recipients();
    if(!chats.length)throw Object.assign(new Error('لا يوجد حساب تيليجرام فعال لاستلام تقرير المبيعات'),{status:404,code:'DAILY_SALES_NO_RECIPIENTS'});
    const heading=slot==='morning'?'تقرير المبيعات الصباحي':'تقرير المبيعات المسائي';
    const text=`<b>${heading}</b>\n━━━━━━━━━━━━━━\n\n${renderDailyBrief(brief)}`.slice(0,3900);
    const results=[];
    for(const chatId of chats){
      const sent=await sendMessage(chatId,text,{disable_voice_reply:true,action_name:'daily_sales_brief',action_payload:{slot,run_day:runDay,report_date:reportDate||null,batch_id:batchId||null}});
      results.push({chatId:String(chatId),messageId:sent?.message_id||null});
    }
    await recordSent({slot,run_day:runDay,report_date:reportDate||null,batch_id:batchId||null,recipient_count:results.length,source:clean(payload?.source,80)||'github-actions'});
    return json(res,200,{ok:true,sent:results.length,slot,runDay,reportDate:reportDate||null,batchId:batchId||null,recipients:results});
  }catch(error){return errorResponse(res,error);}
}
