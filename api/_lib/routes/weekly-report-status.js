import crypto from 'node:crypto';
import { body, errorResponse, json, method } from '../http.js';
import { select } from '../supabase.js';

const REPOSITORY='fikrimamdouh/binhamid-factory-control';
const OIDC_ISSUER='https://token.actions.githubusercontent.com';
const OIDC_AUDIENCE='binhamid-weekly-report-status';
const WORKFLOW_PATH='/.github/workflows/weekly-report-delivery-check.yml@refs/heads/main';
let jwksCache={expires:0,keys:[]};

const clean=(value,max=3000)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const base64Json=value=>{try{return JSON.parse(Buffer.from(value,'base64url').toString('utf8'));}catch{return null;}};
const audiences=value=>Array.isArray(value)?value:[value];
async function jwks(){
  if(jwksCache.expires>Date.now()&&jwksCache.keys.length)return jwksCache.keys;
  const response=await fetch(`${OIDC_ISSUER}/.well-known/jwks`,{headers:{Accept:'application/json'}});
  if(!response.ok)throw Object.assign(new Error('تعذر التحقق من هوية GitHub Actions'),{status:502,code:'GITHUB_OIDC_JWKS_FAILED'});
  const data=await response.json();jwksCache={expires:Date.now()+3600000,keys:Array.isArray(data.keys)?data.keys:[]};return jwksCache.keys;
}
async function verifyGithubOidc(req){
  const auth=clean(req.headers?.authorization);if(!auth.startsWith('Bearer '))throw Object.assign(new Error('هوية الفحص مطلوبة'),{status:401,code:'WEEKLY_STATUS_AUTH_REQUIRED'});
  const token=auth.slice(7),parts=token.split('.');if(parts.length!==3)throw Object.assign(new Error('رمز GitHub Actions غير صالح'),{status:401,code:'WEEKLY_STATUS_AUTH_INVALID'});
  const header=base64Json(parts[0]),claims=base64Json(parts[1]);if(!header||!claims||header.alg!=='RS256'||!header.kid)throw Object.assign(new Error('بنية رمز GitHub Actions غير صالحة'),{status:401,code:'WEEKLY_STATUS_AUTH_INVALID'});
  const key=(await jwks()).find(item=>item.kid===header.kid);if(!key)throw Object.assign(new Error('مفتاح GitHub Actions غير معروف'),{status:401,code:'WEEKLY_STATUS_AUTH_KEY_UNKNOWN'});
  const valid=crypto.verify('RSA-SHA256',Buffer.from(`${parts[0]}.${parts[1]}`),crypto.createPublicKey({key,format:'jwk'}),Buffer.from(parts[2],'base64url')),now=Math.floor(Date.now()/1000),workflowRef=String(claims.workflow_ref||'');
  if(!valid||claims.iss!==OIDC_ISSUER||!audiences(claims.aud).includes(OIDC_AUDIENCE)||claims.repository!==REPOSITORY||Number(claims.exp||0)<=now||Number(claims.nbf||0)>now+30)throw Object.assign(new Error('هوية GitHub Actions لا تخص المستودع المعتمد'),{status:401,code:'WEEKLY_STATUS_AUTH_INVALID'});
  if(claims.ref!=='refs/heads/main'||!workflowRef.includes(WORKFLOW_PATH))throw Object.assign(new Error('فحص التسليم غير صادر من المسار المعتمد'),{status:403,code:'WEEKLY_STATUS_REF_FORBIDDEN'});
}

export async function weeklyReportStatus(req,res){
  if(!method(req,res,['POST']))return;
  try{
    await verifyGithubOidc(req);
    const input=await body(req,10_000),since=String(input?.since||'');
    if(!/^20\d{2}-\d{2}-\d{2}T/.test(since))throw Object.assign(new Error('وقت بداية الفحص غير صالح'),{status:400,code:'WEEKLY_STATUS_SINCE_INVALID'});
    const rows=await select('telegram_messages',`direction=eq.outgoing&delivery_status=eq.sent&action_name=eq.weekly_executive_report&created_at=gte.${encodeURIComponent(since)}&select=message_id,chat_id,created_at,action_payload&order=created_at.desc&limit=10`).catch(()=>[]);
    const latest=(rows||[])[0]||null;
    return json(res,200,{ok:true,delivered:Boolean(latest),messageId:latest?.message_id||null,deliveredAt:latest?.created_at||null,period:latest?.action_payload||null});
  }catch(error){return errorResponse(res,error);}
}
