import { createDecipheriv,createHash } from 'node:crypto';
import { existsSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync } from 'node:fs';
import { basename,join,resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';

const directory=resolve(process.env.RESTORE_ARTIFACT_DIR||'restore-artifact');
const output=resolve(process.env.RESTORE_DRILL_RESULT||'restore-drill-result.json');
const secret=String(process.env.BACKUP_ENCRYPTION_KEY||'').trim();
const localDb=String(process.env.LOCAL_DATABASE_URL||'postgresql://postgres:postgres@127.0.0.1:5432/restore_drill').trim();
const productionDb=String(process.env.SUPABASE_DB_URL||'').trim();
const startedAt=new Date().toISOString();
let plaintextPath='';

const save=value=>writeFileSync(output,`${JSON.stringify({format:'binhamid-restore-drill-v1',startedAt,checkedAt:new Date().toISOString(),...value},null,2)}\n`,{mode:0o600});
const fail=(code,reason,extra={})=>{save({ok:false,status:'failed',code,reason,...extra});console.error(`[restore-drill] ${code}: ${reason}`);process.exitCode=1;};
const command=(name,args,options={})=>{const result=spawnSync(name,args,{encoding:'utf8',env:process.env,timeout:options.timeout||300000,stdio:options.stdio||['ignore','pipe','pipe']});if(result.error||result.status!==0)throw Object.assign(new Error(`${name} failed`),{code:'COMMAND_FAILED',command:name,exitCode:result.status??-1,stderr:String(result.stderr||'').slice(0,500)});return String(result.stdout||'').trim();};
const sha256=buffer=>createHash('sha256').update(buffer).digest('hex');
const sqlLiteral=value=>`'${String(value??'').replaceAll("'","''")}'`;

function discover(){
  if(!existsSync(directory))throw Object.assign(new Error('artifact directory missing'),{code:'ARTIFACT_DIRECTORY_MISSING'});
  const files=readdirSync(directory,{recursive:true}).map(name=>join(directory,String(name))).filter(path=>existsSync(path));
  const encrypted=files.filter(path=>path.endsWith('.enc'));
  const manifests=files.filter(path=>path.endsWith('.manifest.json'));
  if(encrypted.length!==1)throw Object.assign(new Error('expected one encrypted file'),{code:'ENCRYPTED_FILE_COUNT_INVALID',count:encrypted.length});
  const manifestPath=manifests.find(path=>basename(path)===`${basename(encrypted[0])}.manifest.json`)||manifests[0];
  if(!manifestPath)throw Object.assign(new Error('manifest missing'),{code:'MANIFEST_MISSING'});
  return{encryptedPath:encrypted[0],manifestPath};
}

function decrypt(encryptedPath,manifest){
  if(!secret)throw Object.assign(new Error('encryption key missing'),{code:'ENCRYPTION_KEY_MISSING'});
  const encrypted=readFileSync(encryptedPath);
  if(encrypted.length<=32||encrypted.subarray(0,4).toString()!=='BH01')throw Object.assign(new Error('encrypted header invalid'),{code:'ENCRYPTED_FORMAT_INVALID'});
  const checksum=sha256(encrypted);
  if(checksum!==manifest.checksumSha256)throw Object.assign(new Error('checksum mismatch'),{code:'CHECKSUM_MISMATCH'});
  const iv=encrypted.subarray(4,16),tag=encrypted.subarray(16,32),ciphertext=encrypted.subarray(32),key=createHash('sha256').update(secret).digest(),decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAuthTag(tag);
  let compressed;try{compressed=Buffer.concat([decipher.update(ciphertext),decipher.final()]);}catch{throw Object.assign(new Error('decryption failed'),{code:'DECRYPTION_FAILED'});}
  let sql;try{sql=gunzipSync(compressed);}catch{throw Object.assign(new Error('gzip failed'),{code:'GZIP_INVALID'});}
  if(sql.length<100||!/create|insert|alter/i.test(sql.toString('utf8',0,Math.min(sql.length,20000))))throw Object.assign(new Error('sql payload invalid'),{code:'SQL_PAYLOAD_INVALID'});
  plaintextPath=join(directory,'restore-drill.sql');writeFileSync(plaintextPath,sql,{mode:0o600});
  return{checksum,sizeBytes:encrypted.length,sqlBytes:sql.length};
}

function localVerification(){
  command('psql',[localDb,'-X','-v','ON_ERROR_STOP=1','-f',plaintextPath],{timeout:900000,stdio:['ignore','pipe','pipe']});
  const query=`select json_build_object(
    'schemaVersion',(select coalesce(max(version),0) from public.migration_history),
    'counts',json_build_object(
      'customers',case when to_regclass('public.customers') is null then 0 else (select count(*) from public.customers) end,
      'employees',case when to_regclass('public.employees') is null then 0 else (select count(*) from public.employees) end,
      'vehicles',case when to_regclass('public.vehicles') is null then 0 else (select count(*) from public.vehicles) end,
      'salesOrders',case when to_regclass('public.sales_orders') is null then 0 else (select count(*) from public.sales_orders) end,
      'collections',case when to_regclass('public.collection_events') is null then 0 else (select count(*) from public.collection_events) end,
      'maintenance',case when to_regclass('public.maintenance_orders') is null then 0 else (select count(*) from public.maintenance_orders) end,
      'auditLog',case when to_regclass('public.audit_log') is null then 0 else (select count(*) from public.audit_log) end
    ),
    'objects',json_build_object(
      'app_state',to_regclass('public.app_state') is not null,
      'daily_report_batches',to_regclass('public.daily_report_batches') is not null,
      'sales_payment_allocations',to_regclass('public.sales_payment_allocations') is not null,
      'backup_runs',to_regclass('public.backup_runs') is not null
    )
  )::text;`;
  return JSON.parse(command('psql',[localDb,'-X','-t','-A','-v','ON_ERROR_STOP=1','-c',query]));
}

function recordProduction(result,manifest,artifactName){
  if(!productionDb)return false;
  const evidence=JSON.stringify({artifactName,backupFile:manifest.fileName,backupChecksum:manifest.checksumSha256,pgDumpVersion:manifest.pgDumpVersion||null,localPostgres:'17'});
  const sql=`insert into public.restore_test_runs(environment,status,checksum_verified,schema_version,row_counts,evidence,started_by,started_at,completed_at,notes)
  values('github-actions-local-postgres','passed',true,${Number(result.schemaVersion)||0},${sqlLiteral(JSON.stringify(result.counts||{}))}::jsonb,${sqlLiteral(evidence)}::jsonb,'github-actions',${sqlLiteral(startedAt)}::timestamptz,now(),'استعادة آلية إلى PostgreSQL محلي غير إنتاجي') returning id;`;
  command('psql',[productionDb,'-X','-t','-A','-v','ON_ERROR_STOP=1','-c',sql],{timeout:120000});
  return true;
}

try{
  mkdirSync(directory,{recursive:true});
  const {encryptedPath,manifestPath}=discover();
  let manifest;try{manifest=JSON.parse(readFileSync(manifestPath,'utf8'));}catch{throw Object.assign(new Error('manifest invalid'),{code:'MANIFEST_INVALID'});}
  if(manifest.format!=='binhamid-backup-v1'||manifest.encrypted!==true||!/^[a-f0-9]{64}$/i.test(String(manifest.checksumSha256||'')))throw Object.assign(new Error('manifest fields invalid'),{code:'MANIFEST_FIELDS_INVALID'});
  const decrypted=decrypt(encryptedPath,manifest),verification=localVerification();
  if(Number(verification.schemaVersion)!==Number(manifest.schemaVersion))throw Object.assign(new Error('restored schema differs from manifest'),{code:'RESTORED_SCHEMA_MISMATCH',restoredSchemaVersion:Number(verification.schemaVersion),manifestSchemaVersion:Number(manifest.schemaVersion)});
  const missingObjects=Object.entries(verification.objects||{}).filter(([,value])=>!value).map(([key])=>key);if(missingObjects.length)throw Object.assign(new Error('required restored objects missing'),{code:'RESTORED_OBJECTS_MISSING',missingObjects});
  const recorded=recordProduction(verification,manifest,basename(process.env.RESTORE_ARTIFACT_NAME||directory));
  save({ok:true,status:'passed',code:'RESTORE_DRILL_PASSED',artifactName:process.env.RESTORE_ARTIFACT_NAME||null,backupFile:manifest.fileName,checksumSha256:decrypted.checksum,encryptedSizeBytes:decrypted.sizeBytes,restoredSqlBytes:decrypted.sqlBytes,schemaVersion:Number(verification.schemaVersion),rowCounts:verification.counts,objects:verification.objects,productionEvidenceRecorded:recorded,plaintextRemoved:true});
  console.log(`[restore-drill] PASSED schema=${verification.schemaVersion}; backup=${manifest.fileName}`);
}catch(error){
  fail(error?.code||'RESTORE_DRILL_FAILED','The encrypted backup could not be restored and verified in the isolated PostgreSQL service.',{exitCode:error?.exitCode??null,missingObjects:error?.missingObjects||null,restoredSchemaVersion:error?.restoredSchemaVersion??null,manifestSchemaVersion:error?.manifestSchemaVersion??null});
}finally{
  if(plaintextPath)rmSync(plaintextPath,{force:true});
}
