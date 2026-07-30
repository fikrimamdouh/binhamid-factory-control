import crypto from 'node:crypto';
import { config } from '../_lib/config.js';
import { body, errorResponse, json, method } from '../_lib/http.js';
import { insert, select } from '../_lib/supabase.js';
import { sendMessage } from '../_lib/telegram.js';

const REPOSITORY='fikrimamdouh/binhamid-factory-control';
const OIDC_ISSUER='https://token.actions.githubusercontent.com';
const OIDC_AUDIENCE='binhamid-system-notify';
const WORKFLOW_PATH='/.github/workflows/send-sales-summary-20260729-once.yml@refs/heads/main';
const FACTORY_MANAGER_CHAT_ID='6870312376';
let jwksCache={expires:0,keys:[]};

const clean=(value,max=1000)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const encoded=value=>encodeURIComponent(String(value??''));
const validDate=value=>/^20\d{2}-\d{2}-\d{2}$/.test(String(value||''));
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const audiences=value=>Array.isArray(value)?value:[value];
const money=value=>Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const quantity=value=>Number(value).toLocaleString('en-US',{maximumFractionDigits:3});

function base64Json(value){try{return JSON.parse(Buffer.from(value,'base64url').toString('utf8'));}catch{return null;}}
async function jwks(){
  if(jwksCache.expires>Date.now()&&jwksCache.keys.length)return jwksCache.keys;
  const response=await fetch(`${OIDC_ISSUER}/.well-known/jwks`,{headers:{Accept:'application/json'}});
  if(!response.ok)throw Object.assign(new Error('تعذر التحقق من هوية GitHub Actions'),{status:502,code:'GITHUB_OIDC_JWKS_FAILED'});
  const data=await response.json();
  jwksCache={expires:Date.now()+3600000,keys:Array.isArray(data.keys)?data.keys:[]};
  return jwksCache.keys;
}
async function requireGithubIdentity(req){
  const auth=clean(req.headers?.authorization,4000);
  if(!auth.startsWith('Bearer '))throw Object.assign(new Error('هوية GitHub Actions مطلوبة'),{status:401,code:'SYSTEM_NOTIFY_AUTH_REQUIRED'});
  const token=auth.slice(7),parts=token.split('.');
  if(parts.length!==3)throw Object.assign(new Error('رمز GitHub Actions غير صالح'),{status:401,code:'SYSTEM_NOTIFY_AUTH_INVALID'});
  const header=base64Json(parts[0]),claims=base64Json(parts[1]);
  if(!header||!claims||header.alg!=='RS256'||!header.kid)throw Object.assign(new Error('بنية رمز GitHub Actions غير صالحة'),{status:401,code:'SYSTEM_NOTIFY_AUTH_INVALID'});
  const key=(await jwks()).find(item=>item.kid===header.kid);
  if(!key)throw Object.assign(new Error('مفتاح GitHub Actions غير معروف'),{status:401,code:'SYSTEM_NOTIFY_AUTH_KEY_UNKNOWN'});
  const signatureValid=crypto.verify('RSA-SHA256',Buffer.from(`${parts[0]}.${parts[1]}`),crypto.createPublicKey({key,format:'jwk'}),Buffer.from(parts[2],'base64url'));
  const now=Math.floor(Date.now()/1000),workflowRef=String(claims.workflow_ref||'');
  if(!signatureValid||claims.iss!==OIDC_ISSUER||!audiences(claims.aud).includes(OIDC_AUDIENCE)||claims.repository!==REPOSITORY||claims.ref!=='refs/heads/main'||!workflowRef.includes(WORKFLOW_PATH)||Number(claims.exp||0)<=now||Number(claims.nbf||0)>now+30){
    throw Object.assign(new Error('هوية التشغيل لا تخص مهمة إرسال ملخص مصنع بن حامد'),{status:403,code:'SYSTEM_NOTIFY_AUTH_FORBIDDEN'});
  }
  return claims;
}
function finiteAmount(value,label,max=1_000_000_000){
  const number=Number(value);
  if(!Number.isFinite(number)||number<0||number>max)throw Object.assign(new Error(`${label} غير صالح`),{status:400,code:'SYSTEM_NOTIFY_VALUE_INVALID'});
  return Number(number.toFixed(2));
}
function summaryInput(value){
  const reportDate=clean(value?.reportDate,20),sourceFile=clean(value?.sourceFile,160);
  if(!validDate(reportDate))throw Object.assign(new Error('تاريخ التقرير غير صالح'),{status:400,code:'SYSTEM_NOTIFY_DATE_INVALID'});
  if(!sourceFile)throw Object.assign(new Error('اسم ملف التقرير مطلوب'),{status:400,code:'SYSTEM_NOTIFY_FILE_REQUIRED'});
  if(value?.noChanges!==true)throw Object.assign(new Error('هذا المسار مخصص لتقرير تمت مراجعته دون إضافات جديدة'),{status:400,code:'SYSTEM_NOTIFY_STATE_INVALID'});
  return{
    reportDate,sourceFile,
    concreteQuantity:finiteAmount(value?.concreteQuantity,'كمية الخرسانة',10_000_000),
    concreteSales:finiteAmount(value?.concreteSales,'مبيعات الخرسانة'),
    blockQuantity:finiteAmount(value?.blockQuantity,'كمية البلوك',100_000_000),
    blockSales:finiteAmount(value?.blockSales,'مبيعات البلوك'),
    collections:finiteAmount(value?.collections,'التحصيلات')
  };
}
function recipients(){return[...new Set([config.telegramOwnerId,FACTORY_MANAGER_CHAT_ID].map(value=>clean(value,40)).filter(Boolean))];}
function summaryMessage(input){
  const total=Number((input.concreteSales+input.blockSales).toFixed(2));
  return `<b>ملخص حركة المبيعات — ${esc(input.reportDate)}</b>\n\nتم تحديث تقرير حركة أمس ومراجعته.\nلا توجد إضافات جديدة أو إجراءات مطلوبة على البيانات المسجلة.\n\n<b>المبيعات</b>\nالخرسانة: <b>${quantity(input.concreteQuantity)} م³</b> — <b>${money(input.concreteSales)} ر.س</b>\nالبلوك: <b>${quantity(input.blockQuantity)} قطعة</b> — <b>${money(input.blockSales)} ر.س</b>\nإجمالي المبيعات: <b>${money(total)} ر.س</b>\n\n<b>التحصيلات</b>\nإجمالي التحصيلات: <b>${money(input.collections)} ر.س</b>\n\n<b>الحالة</b>\nالتقرير مسجل بالكامل، ولم تتكرر أي حركة.\nالملف: <code>${esc(input.sourceFile)}</code>`;
}

export default async function handler(req,res){
  if(!method(req,res,['POST']))return;
  try{
    await requireGithubIdentity(req);
    const input=summaryInput(await body(req,30_000)),key=`daily_sales_summary:${input.reportDate}:${input.sourceFile}`;
    const previous=(await select('audit_log',`action=eq.daily_sales_summary_sent&entity_id=eq.${encoded(key)}&select=id,details,created_at&order=created_at.desc&limit=1`).catch(()=>[]))?.[0];
    if(previous)return json(res,200,{ok:true,duplicate:true,reportDate:input.reportDate,recipients:Number(previous?.details?.recipient_count||0),sentAt:previous.created_at||null});
    const targets=recipients();
    if(!targets.length||!config.telegramToken)throw Object.assign(new Error('إعدادات إرسال تيليجرام غير مكتملة'),{status:503,code:'TELEGRAM_NOT_CONFIGURED'});
    const text=summaryMessage(input),results=await Promise.allSettled(targets.map(chatId=>sendMessage(chatId,text,{action_name:'daily_sales_summary',action_payload:{reportDate:input.reportDate,sourceFile:input.sourceFile}}))),failures=results.filter(item=>item.status==='rejected');
    if(failures.length)throw Object.assign(new Error(`تعذر إرسال الملخص إلى ${failures.length} مستلم`),{status:502,code:'SYSTEM_NOTIFY_DELIVERY_FAILED'});
    await insert('audit_log',[{actor_type:'system',actor_id:'github-actions',action:'daily_sales_summary_sent',entity_type:'daily_report',entity_id:key,details:{report_date:input.reportDate,source_file:input.sourceFile,recipient_count:targets.length,concrete_quantity:input.concreteQuantity,concrete_sales:input.concreteSales,block_quantity:input.blockQuantity,block_sales:input.blockSales,collections:input.collections},created_at:new Date().toISOString()}],{prefer:'return=minimal'}).catch(error=>console.warn('[daily sales summary audit]',error?.message||error));
    return json(res,200,{ok:true,duplicate:false,reportDate:input.reportDate,recipients:targets.length,messageIds:results.map(item=>item.status==='fulfilled'?item.value?.message_id:null)});
  }catch(error){errorResponse(res,error);}
}
