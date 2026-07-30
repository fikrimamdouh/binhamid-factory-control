import crypto from 'node:crypto';
import { body, errorResponse, json, method } from '../_lib/http.js';
import { select } from '../_lib/supabase.js';

const REPOSITORY='fikrimamdouh/binhamid-factory-control';
const OIDC_ISSUER='https://token.actions.githubusercontent.com';
const OIDC_AUDIENCE='binhamid-fuel-sync';
let jwksCache={expires:0,keys:[]};

const clean=(value,max=1000)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const encoded=value=>encodeURIComponent(String(value??''));
const validDate=value=>/^20\d{2}-\d{2}-\d{2}$/.test(String(value||''));
function base64Json(value){try{return JSON.parse(Buffer.from(value,'base64url').toString('utf8'));}catch{return null;}}
const audiences=value=>Array.isArray(value)?value:[value];
async function jwks(){if(jwksCache.expires>Date.now()&&jwksCache.keys.length)return jwksCache.keys;const response=await fetch(`${OIDC_ISSUER}/.well-known/jwks`,{headers:{Accept:'application/json'}});if(!response.ok)throw Object.assign(new Error('تعذر التحقق من هوية GitHub Actions'),{status:502,code:'GITHUB_OIDC_JWKS_FAILED'});const data=await response.json();jwksCache={expires:Date.now()+3600000,keys:Array.isArray(data.keys)?data.keys:[]};return jwksCache.keys;}
async function verifyGithubOidc(req){
  const auth=clean(req.headers?.authorization,3000);if(!auth.startsWith('Bearer '))throw Object.assign(new Error('هوية مزامنة الوقود مطلوبة'),{status:401,code:'FUEL_SYNC_AUTH_REQUIRED'});
  const token=auth.slice(7),parts=token.split('.');if(parts.length!==3)throw Object.assign(new Error('رمز GitHub Actions غير صالح'),{status:401,code:'FUEL_SYNC_AUTH_REQUIRED'});
  const header=base64Json(parts[0]),claims=base64Json(parts[1]);if(!header||!claims||header.alg!=='RS256'||!header.kid)throw Object.assign(new Error('بنية رمز GitHub Actions غير صالحة'),{status:401,code:'FUEL_SYNC_AUTH_INVALID'});
  const key=(await jwks()).find(item=>item.kid===header.kid);if(!key)throw Object.assign(new Error('مفتاح GitHub Actions غير معروف'),{status:401,code:'FUEL_SYNC_AUTH_KEY_UNKNOWN'});
  const valid=crypto.verify('RSA-SHA256',Buffer.from(`${parts[0]}.${parts[1]}`),crypto.createPublicKey({key,format:'jwk'}),Buffer.from(parts[2],'base64url')),now=Math.floor(Date.now()/1000);
  if(!valid||claims.iss!==OIDC_ISSUER||!audiences(claims.aud).includes(OIDC_AUDIENCE)||claims.repository!==REPOSITORY||Number(claims.exp||0)<=now||Number(claims.nbf||0)>now+30)throw Object.assign(new Error('هوية GitHub Actions لا تخص مستودع مصنع بن حامد'),{status:401,code:'FUEL_SYNC_AUTH_INVALID'});
  if(claims.ref!=='refs/heads/main'&&!String(claims.workflow_ref||'').includes('/.github/workflows/noor-khoy-fuel-sync.yml@refs/heads/main'))throw Object.assign(new Error('فحص حالة الوقود غير صادر من الفرع الرئيسي'),{status:403,code:'FUEL_SYNC_REF_FORBIDDEN'});
  return claims;
}
function statusInput(value){const kind=clean(value?.kind,40),reportDate=clean(value?.reportDate,20);if(!['daily-report','vehicle-balance-report'].includes(kind)||!validDate(reportDate))throw Object.assign(new Error('بيانات فحص حالة تقرير الوقود غير صالحة'),{status:400,code:'FUEL_DELIVERY_STATUS_INVALID'});return{kind,reportDate};}
const uniqueChats=rows=>new Set((rows||[]).map(row=>String(row.chat_id||'')).filter(Boolean)).size;
async function dailyStatus(reportDate){
  const phrase=encoded('إقرار الوقود'),date=encoded(reportDate);
  const textRows=await select('telegram_messages',`direction=eq.outgoing&delivery_status=eq.sent&message_type=eq.text&and=(text.ilike.*${phrase}*,text.ilike.*${date}*)&select=chat_id,created_at&order=created_at.desc&limit=20`).catch(()=>[]);
  const documentRows=await select('telegram_messages',`direction=eq.outgoing&delivery_status=eq.sent&message_type=eq.document&file_name=ilike.*report-${date}.pdf&select=chat_id,created_at,file_name&order=created_at.desc&limit=20`).catch(()=>[]);
  const textRecipients=uniqueChats(textRows),documentRecipients=uniqueChats(documentRows),delivered=textRecipients>=2&&documentRecipients>=2;
  const deliveredAt=[...(textRows||[]),...(documentRows||[])].map(row=>row.created_at).filter(Boolean).sort().at(-1)||null;
  return{delivered,deliveredAt,details:{textRecipients,documentRecipients,documents:[...new Set((documentRows||[]).map(row=>row.file_name).filter(Boolean))]}};
}
function riyadhUtcBounds(day){const start=new Date(`${day}T00:00:00+03:00`),end=new Date(start);end.setUTCDate(end.getUTCDate()+1);return{start:start.toISOString(),end:end.toISOString()};}
async function vehicleStatus(reportDate){
  const key=`vehicle_diesel_balance:${reportDate}`,audit=(await select('audit_log',`action=eq.vehicle_diesel_balance_report_sent&entity_id=eq.${encoded(key)}&select=details,created_at&order=created_at.desc&limit=1`).catch(()=>[]))?.[0];
  if(audit&&Number(audit.details?.recipient_count||0)>=2)return{delivered:true,deliveredAt:audit.created_at,details:audit.details};
  const bounds=riyadhUtcBounds(reportDate),phrase=encoded('رصيد الديزل غير المستخدم في السيارات');
  const rows=await select('telegram_messages',`direction=eq.outgoing&delivery_status=eq.sent&message_type=eq.text&text=ilike.*${phrase}*&created_at=gte.${encoded(bounds.start)}&created_at=lt.${encoded(bounds.end)}&select=chat_id,created_at&order=created_at.desc&limit=20`).catch(()=>[]);
  const recipients=uniqueChats(rows);return{delivered:recipients>=2,deliveredAt:(rows||[]).map(row=>row.created_at).filter(Boolean).sort().at(-1)||null,details:{recipients}};
}

export default async function handler(req,res){
  if(!method(req,res,['POST']))return;
  try{await verifyGithubOidc(req);const input=statusInput(await body(req,30_000)),result=input.kind==='daily-report'?await dailyStatus(input.reportDate):await vehicleStatus(input.reportDate);return json(res,200,{ok:true,...input,...result});}
  catch(error){errorResponse(res,error);}
}
