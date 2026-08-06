import crypto from 'node:crypto';
import * as XLSX from 'xlsx';
import { commitDailyReportFromTelegram } from './routes/daily-report.js';
import { parseDailyWorkbook } from './daily-summary-parser.js';
import { payloadFromAnalysis } from './daily-report-v3.js';
import { planSingleDayRepair } from './daily-report-v7.js';
import { prepareErpSuccessDelivery,sendErpSuccessDelivery } from './erp-telegram-delivery.js';
import { sendThreeDaySalesCollectionsReport } from './erp-three-day-report.js';
import { downloadObject,insert,select } from './supabase.js';
import { errorResponse,json } from './http.js';

const REPOSITORY='fikrimamdouh/binhamid-factory-control';
const OIDC_ISSUER='https://token.actions.githubusercontent.com';
const OIDC_AUDIENCE='binhamid-erp-failed-cloud-retry';
const WORKFLOW_PATH='/.github/workflows/fix-erp-treasury-and-retry-once.yml@refs/heads/main';
const AUDIT_ACTION='erp_failed_cloud_retry_delivery';
export const ERP_FAILED_CLOUD_RETRY_REVISION='2026-08-06-treasury-dedup-v1';
let jwksCache={expires:0,keys:[]};

const clean=(value,max=3000)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const base64Json=value=>{try{return JSON.parse(Buffer.from(value,'base64url').toString('utf8'));}catch{return null;}};
const audiences=value=>Array.isArray(value)?value:[value];
const riyadhDate=offsetDays=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()+offsetDays*86400000));
const stable=value=>Array.isArray(value)?`[${value.map(stable).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`:JSON.stringify(value);
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');

async function jwks(){
  if(jwksCache.expires>Date.now()&&jwksCache.keys.length)return jwksCache.keys;
  const response=await fetch(`${OIDC_ISSUER}/.well-known/jwks`,{headers:{Accept:'application/json'}});
  if(!response.ok)throw Object.assign(new Error('تعذر التحقق من هوية GitHub Actions'),{status:502,code:'GITHUB_OIDC_JWKS_FAILED'});
  const data=await response.json();
  jwksCache={expires:Date.now()+3600000,keys:Array.isArray(data.keys)?data.keys:[]};
  return jwksCache.keys;
}

async function verifyGithubOidc(req){
  const auth=clean(req.headers?.authorization);
  if(!auth.startsWith('Bearer '))throw Object.assign(new Error('هوية إعادة ترحيل التقرير مطلوبة'),{status:401,code:'ERP_CLOUD_RETRY_AUTH_REQUIRED'});
  const token=auth.slice(7),parts=token.split('.');
  if(parts.length!==3)throw Object.assign(new Error('رمز GitHub Actions غير صالح'),{status:401,code:'ERP_CLOUD_RETRY_AUTH_INVALID'});
  const header=base64Json(parts[0]),claims=base64Json(parts[1]);
  if(!header||!claims||header.alg!=='RS256'||!header.kid)throw Object.assign(new Error('بنية رمز GitHub Actions غير صالحة'),{status:401,code:'ERP_CLOUD_RETRY_AUTH_INVALID'});
  const key=(await jwks()).find(item=>item.kid===header.kid);
  if(!key)throw Object.assign(new Error('مفتاح GitHub Actions غير معروف'),{status:401,code:'ERP_CLOUD_RETRY_AUTH_KEY_UNKNOWN'});
  const valid=crypto.verify('RSA-SHA256',Buffer.from(`${parts[0]}.${parts[1]}`),crypto.createPublicKey({key,format:'jwk'}),Buffer.from(parts[2],'base64url'));
  const now=Math.floor(Date.now()/1000),workflowRef=String(claims.workflow_ref||'');
  if(!valid||claims.iss!==OIDC_ISSUER||!audiences(claims.aud).includes(OIDC_AUDIENCE)||claims.repository!==REPOSITORY||Number(claims.exp||0)<=now||Number(claims.nbf||0)>now+30)throw Object.assign(new Error('هوية GitHub Actions لا تخص المستودع المعتمد'),{status:401,code:'ERP_CLOUD_RETRY_AUTH_INVALID'});
  if(claims.ref!=='refs/heads/main'||!workflowRef.includes(WORKFLOW_PATH))throw Object.assign(new Error('إعادة الترحيل غير صادرة من المسار المعتمد'),{status:403,code:'ERP_CLOUD_RETRY_REF_FORBIDDEN'});
}

async function failedImport(reportDate){
  const rows=await select('imports',`original_name=ilike.*${encodeURIComponent(reportDate)}*&status=in.(failed,validation_failed,ready,ready_for_review,validating)&select=id,file_path,original_name,file_hash,status,posted_batch_id,created_at&order=created_at.desc&limit=10`).catch(()=>[]);
  return(rows||[]).find(row=>row?.id&&row?.file_path)||null;
}

async function existingBatch(reportDate){
  return(await select('daily_report_batches',`report_date=eq.${encodeURIComponent(reportDate)}&status=in.(approved,committed)&select=id,report_date,status,file_hash,summary,committed_at&order=committed_at.desc.nullslast,created_at.desc&limit=1`).catch(()=>[]))?.[0]||null;
}

async function deliveryMarker(reportDate){
  return(await select('audit_log',`action=eq.${AUDIT_ACTION}&entity_id=eq.${encodeURIComponent(reportDate)}&select=id,details,created_at&order=created_at.desc&limit=1`).catch(()=>[]))?.[0]||null;
}

async function loadAnalysis(importRow,reportDate){
  const stored=await downloadObject(importRow.file_path);
  const workbook=XLSX.read(stored.buffer,{type:'buffer',cellDates:true});
  const parsed=parseDailyWorkbook(workbook,XLSX);
  const repaired=planSingleDayRepair(parsed,reportDate);
  return{analysis:repaired.analysis,repair:repaired.repair||null,storedBytes:stored.buffer.length};
}

async function deliver({analysis,sourceFile,reportDate,batchId,posting}){
  const prepared=await prepareErpSuccessDelivery({analysis,sourceFile,reportDate});
  const telegram=await sendErpSuccessDelivery({analysis,sourceFile,reportDate,posting:{...posting,batchId},prepared});
  const threeDay=await sendThreeDaySalesCollectionsReport(reportDate).catch(error=>({ok:false,error:clean(error?.message,500)}));
  await insert('audit_log',[{actor_type:'system',actor_id:'erp-failed-cloud-retry',action:AUDIT_ACTION,entity_type:'daily_report',entity_id:reportDate,details:{revision:ERP_FAILED_CLOUD_RETRY_REVISION,batchId,sourceFile,telegram,threeDay,completedAt:new Date().toISOString()}}],{prefer:'return=minimal'}).catch(()=>{});
  return{telegram,threeDay};
}

export async function retryFailedCloudReport(req,res){
  try{
    if(req.method!=='GET')throw Object.assign(new Error('Method not allowed'),{status:405,code:'METHOD_NOT_ALLOWED'});
    await verifyGithubOidc(req);
    const params=new URL(req.url||'/api/erp/daily-report',`https://${String(req.headers?.host||'localhost')}`).searchParams;
    const requested=clean(params.get('reportDate'),20),reportDate=/^20\d{2}-\d{2}-\d{2}$/.test(requested)?requested:riyadhDate(-1);
    let batch=await existingBatch(reportDate);
    const marker=await deliveryMarker(reportDate);
    if(batch&&marker)return json(res,200,{ok:true,alreadyCompleted:true,cloudRetryRevision:ERP_FAILED_CLOUD_RETRY_REVISION,reportDate,batch,delivery:marker.details});
    const importRow=await failedImport(reportDate);
    if(!importRow)throw Object.assign(new Error(`لم يُعثر على ملف ERP مخزن لتاريخ ${reportDate}`),{status:404,code:'ERP_CLOUD_RETRY_IMPORT_MISSING'});
    const loaded=await loadAnalysis(importRow,reportDate);
    let posting=null;
    if(!batch){
      const payload=payloadFromAnalysis(loaded.analysis,reportDate),contentHash=sha(stable(payload));
      posting=await commitDailyReportFromTelegram({reportDate,originalName:importRow.original_name||`Daily-Report-${reportDate}.xlsx`,fileHash:importRow.file_hash||contentHash,contentHash,idempotencyKey:`cloud-retry:${reportDate}:${importRow.file_hash||contentHash}`,importId:importRow.id,payload},'erp-failed-cloud-retry');
      if(!posting?.ok)throw Object.assign(new Error(clean(posting?.reason,500)||'فشل ترحيل ملف ERP المخزن'),{status:422,code:'ERP_CLOUD_RETRY_POSTING_FAILED',details:{posting}});
      batch=await existingBatch(reportDate);
    }
    if(!batch?.id)throw Object.assign(new Error('لم تُنشأ دفعة التقرير بعد إعادة الترحيل'),{status:502,code:'ERP_CLOUD_RETRY_BATCH_MISSING'});
    const delivery=await deliver({analysis:loaded.analysis,sourceFile:importRow.original_name||`Daily-Report-${reportDate}.xlsx`,reportDate,batchId:batch.id,posting:posting||{ok:true,duplicate:true}});
    return json(res,200,{ok:true,alreadyCompleted:false,cloudRetryRevision:ERP_FAILED_CLOUD_RETRY_REVISION,reportDate,batch,posting,repair:loaded.repair,storedBytes:loaded.storedBytes,delivery});
  }catch(error){
    console.error('[ERP_FAILED_CLOUD_RETRY]',{revision:ERP_FAILED_CLOUD_RETRY_REVISION,code:error?.code||null,message:clean(error?.message,1000),details:error?.details||null});
    return errorResponse(res,error);
  }
}
