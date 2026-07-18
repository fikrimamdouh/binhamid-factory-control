import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const productionUrl=String(process.env.PRODUCTION_URL||'https://binhamid-factory-control.vercel.app').replace(/\/$/,'');
const db=String(process.env.SUPABASE_DB_URL||'').trim();
const telegramToken=String(process.env.TELEGRAM_BOT_TOKEN||'').trim();
const report={checkedAt:new Date().toISOString(),productionUrl,live:{ok:false},database:{configured:Boolean(db),ok:false,sections:{}},telegram:{tokenConfigured:Boolean(telegramToken),ok:false},findings:[]};

function classifyPsqlError(stderr=''){
  const text=String(stderr||'');
  if(/could not translate host name|Name or service not known|Temporary failure in name resolution/i.test(text))return'DATABASE_DNS_FAILED';
  if(/password authentication failed/i.test(text))return'DATABASE_AUTH_FAILED';
  if(/connection.*timed out|timeout expired|could not connect/i.test(text))return'DATABASE_CONNECTION_FAILED';
  if(/relation .* does not exist/i.test(text))return'DATABASE_RELATION_MISSING';
  if(/column .* does not exist/i.test(text))return'DATABASE_COLUMN_MISSING';
  if(/permission denied/i.test(text))return'DATABASE_PERMISSION_DENIED';
  if(/syntax error/i.test(text))return'DATABASE_QUERY_SYNTAX';
  return'DATABASE_QUERY_FAILED';
}

function psqlJson(name,sql){
  const result=spawnSync('psql',[db,'-X','-t','-A','-v','ON_ERROR_STOP=1','-c',sql],{encoding:'utf8',timeout:120000,env:process.env});
  if(result.error||result.status!==0)return{name,ok:false,errorCode:classifyPsqlError(result.stderr||result.error?.message)};
  try{return{name,ok:true,data:JSON.parse(String(result.stdout||'').trim())};}
  catch{return{name,ok:false,errorCode:'DATABASE_INVALID_JSON'};}
}

try{
  const response=await fetch(`${productionUrl}/api/system/status?t=${Date.now()}`,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(20000)});
  const body=await response.json().catch(()=>({}));
  report.live={ok:response.ok&&body?.ok===true,httpStatus:response.status,version:body?.version||null,directOperationsSchema:Number(body?.directOperationsSchema||0),webhookVersion:Number(body?.webhookVersion||0),supabaseConfigured:Boolean(body?.supabaseConfigured),storageConfigured:Boolean(body?.storageConfigured),telegramConfigured:Boolean(body?.telegramConfigured),openaiConfigured:Boolean(body?.openaiConfigured),publicUrlConfigured:Boolean(body?.publicUrlConfigured),gitCommit:body?.gitCommit||null,deploymentId:body?.deploymentId||null};
  if(!report.live.ok)report.findings.push({severity:'critical',code:'LIVE_STATUS_FAILED'});
  if(report.live.directOperationsSchema!==24)report.findings.push({severity:'critical',code:'LIVE_SCHEMA_MISMATCH',actual:report.live.directOperationsSchema});
  if(report.live.webhookVersion!==3)report.findings.push({severity:'critical',code:'LIVE_WEBHOOK_MISMATCH',actual:report.live.webhookVersion});
  for(const [key,code] of [['supabaseConfigured','SUPABASE_NOT_CONFIGURED'],['storageConfigured','STORAGE_NOT_CONFIGURED'],['telegramConfigured','TELEGRAM_NOT_CONFIGURED'],['publicUrlConfigured','PUBLIC_URL_NOT_CONFIGURED']])if(!report.live[key])report.findings.push({severity:'critical',code});
  if(!report.live.openaiConfigured)report.findings.push({severity:'warning',code:'OPENAI_NOT_CONFIGURED'});
  if(!report.live.gitCommit)report.findings.push({severity:'warning',code:'LIVE_COMMIT_NOT_EXPOSED'});
}catch(error){report.live={ok:false,errorCode:error?.name||'FETCH_FAILED'};report.findings.push({severity:'critical',code:'LIVE_UNREACHABLE'});}

if(db){
  const queries={
    schema:`select json_build_object('schemaVersion',(select coalesce(max(version),0) from migration_history),'migrationCount',(select count(*) from migration_history))::text;`,
    users:`select json_build_object('active',(select count(*) from app_users where active),'pending',(select count(*) from app_users where not active or role='pending'),'activeChannels',(select count(*) from user_channels where active and channel='telegram'),'byRole',(select coalesce(json_object_agg(role,cnt),'{}'::json) from (select role,count(*) cnt from app_users where active group by role order by role) q))::text;`,
    invitations:`select json_build_object('byStatus',(select coalesce(json_object_agg(status,cnt),'{}'::json) from (select status,count(*) cnt from user_invitations group by status order by status) q),'expiredOpen',(select count(*) from user_invitations where status in ('pending','opened','accepted_pending_approval') and expires_at<now()),'acceptedWaiting',(select count(*) from user_invitations where status='accepted_pending_approval'))::text;`,
    telegram:`select json_build_object('messages24h',(select count(*) from telegram_messages where created_at>=now()-interval '24 hours'),'incoming24h',(select count(*) from telegram_messages where created_at>=now()-interval '24 hours' and coalesce(direction,'incoming')='incoming'),'lastMessageAt',(select max(created_at) from telegram_messages),'receiptsByStatus',(select coalesce(json_object_agg(status,cnt),'{}'::json) from (select status,count(*) cnt from telegram_update_receipts where updated_at>=now()-interval '24 hours' group by status order by status) q),'failedReceipts24h',(select count(*) from telegram_update_receipts where updated_at>=now()-interval '24 hours' and status='failed'))::text;`,
    excel:`select json_build_object('importsTotal',(select count(*) from imports),'byStatus',(select coalesce(json_object_agg(status,cnt),'{}'::json) from (select status,count(*) cnt from imports group by status order by status) q),'lastImportAt',(select max(created_at) from imports),'storageFailures',(select count(*) from imports where last_error_code='ORIGINAL_STORAGE_FAILED'),'processingFailures',(select count(*) from imports where status in ('failed','validation_failed')),'readyForReview',(select count(*) from imports where status='ready_for_review'),'latestErrorCodes',(select coalesce(json_agg(x),'[]'::json) from (select coalesce(last_error_code,'NONE') code,count(*) count from imports where created_at>=now()-interval '7 days' group by coalesce(last_error_code,'NONE') order by count(*) desc limit 12) x),'dailyBatchesByStatus',(select coalesce(json_object_agg(status,cnt),'{}'::json) from (select status,count(*) cnt from daily_report_batches group by status order by status) q))::text;`,
    webPersistence:`select json_build_object('operationalRecordsTotal',(select count(*) from operational_records),'operationalRecords24h',(select count(*) from operational_records where created_at>=now()-interval '24 hours'),'auditOperations24h',(select count(*) from audit_log where created_at>=now()-interval '24 hours' and entity_type is not null),'lastOperationalAt',(select max(updated_at) from operational_records),'projectionTrigger',(select exists(select 1 from pg_trigger where tgname='audit_operational_projection_trigger' and not tgisinternal)))::text;`
  };
  for(const [name,sql] of Object.entries(queries)){
    const section=psqlJson(name,sql);report.database.sections[name]=section.ok?{ok:true,...section.data}:{ok:false,errorCode:section.errorCode};
    if(!section.ok)report.findings.push({severity:'critical',code:`${name.toUpperCase()}_${section.errorCode}`});
  }
  report.database.ok=Boolean(report.database.sections.schema?.ok&&report.database.sections.users?.ok&&report.database.sections.invitations?.ok&&report.database.sections.telegram?.ok&&report.database.sections.excel?.ok&&report.database.sections.webPersistence?.ok);
}else report.findings.push({severity:'critical',code:'SUPABASE_DB_URL_MISSING_IN_GITHUB'});

const schema=report.database.sections.schema||{},users=report.database.sections.users||{},invitations=report.database.sections.invitations||{},telegramDb=report.database.sections.telegram||{},excel=report.database.sections.excel||{},webPersistence=report.database.sections.webPersistence||{};
if(schema.ok&&Number(schema.schemaVersion)!==24)report.findings.push({severity:'critical',code:'DATABASE_SCHEMA_MISMATCH',actual:schema.schemaVersion});
if(users.ok&&Number(users.active||0)===0)report.findings.push({severity:'critical',code:'NO_ACTIVE_USERS'});
if(users.ok&&Number(users.activeChannels||0)===0)report.findings.push({severity:'critical',code:'NO_ACTIVE_TELEGRAM_CHANNELS'});
if(invitations.ok&&Number(invitations.acceptedWaiting||0)>0)report.findings.push({severity:'warning',code:'INVITATIONS_WAITING_APPROVAL',count:invitations.acceptedWaiting});
if(invitations.ok&&Number(invitations.expiredOpen||0)>0)report.findings.push({severity:'warning',code:'EXPIRED_OPEN_INVITATIONS',count:invitations.expiredOpen});
if(telegramDb.ok&&Number(telegramDb.failedReceipts24h||0)>0)report.findings.push({severity:'critical',code:'TELEGRAM_UPDATES_FAILED_24H',count:telegramDb.failedReceipts24h});
if(excel.ok&&Number(excel.storageFailures||0)>0)report.findings.push({severity:'critical',code:'EXCEL_STORAGE_FAILURES',count:excel.storageFailures});
if(excel.ok&&Number(excel.processingFailures||0)>0)report.findings.push({severity:'critical',code:'EXCEL_PROCESSING_FAILURES',count:excel.processingFailures});
if(webPersistence.ok&&!webPersistence.projectionTrigger)report.findings.push({severity:'critical',code:'WEB_PROJECTION_TRIGGER_MISSING'});

if(telegramToken){
  try{
    const response=await fetch(`https://api.telegram.org/bot${telegramToken}/getWebhookInfo`,{signal:AbortSignal.timeout(20000)});
    const data=await response.json().catch(()=>({})),result=data?.result||{};
    report.telegram={tokenConfigured:true,ok:Boolean(response.ok&&data?.ok),webhookConfigured:Boolean(result.url),webhookHost:(()=>{try{return new URL(result.url).host;}catch{return null;}})(),pendingUpdateCount:Number(result.pending_update_count||0),lastErrorDate:result.last_error_date?new Date(Number(result.last_error_date)*1000).toISOString():null,lastErrorMessage:result.last_error_message?String(result.last_error_message).slice(0,240):null,maxConnections:Number(result.max_connections||0)};
    if(!report.telegram.ok||!report.telegram.webhookConfigured)report.findings.push({severity:'critical',code:'TELEGRAM_WEBHOOK_NOT_READY'});
    if(report.telegram.pendingUpdateCount>20)report.findings.push({severity:'critical',code:'TELEGRAM_PENDING_UPDATES_HIGH',count:report.telegram.pendingUpdateCount});
    if(report.telegram.lastErrorMessage)report.findings.push({severity:'critical',code:'TELEGRAM_WEBHOOK_LAST_ERROR',message:report.telegram.lastErrorMessage});
  }catch(error){report.telegram={tokenConfigured:true,ok:false,errorCode:error?.name||'FETCH_FAILED'};report.findings.push({severity:'critical',code:'TELEGRAM_WEBHOOK_CHECK_FAILED'});}
}else report.findings.push({severity:'warning',code:'TELEGRAM_TOKEN_NOT_AVAILABLE_IN_GITHUB'});

report.summary={critical:report.findings.filter(x=>x.severity==='critical').length,warnings:report.findings.filter(x=>x.severity==='warning').length,registrationReady:Boolean(report.live.ok&&users.ok&&Number(users.activeChannels||0)>0&&(report.telegram.ok||report.live.telegramConfigured)),excelReady:Boolean(report.live.storageConfigured&&excel.ok&&Number(excel.processingFailures||0)===0),webPersistenceReady:Boolean(webPersistence.ok&&webPersistence.projectionTrigger)};
writeFileSync('runtime-registration-excel-diagnostic.json',`${JSON.stringify(report,null,2)}\n`,{mode:0o600});
console.log(`[runtime-diagnostic] critical=${report.summary.critical}; warnings=${report.summary.warnings}; registrationReady=${report.summary.registrationReady}; excelReady=${report.summary.excelReady}; webPersistenceReady=${report.summary.webPersistenceReady}`);
