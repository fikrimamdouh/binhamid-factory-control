import { createDecipheriv, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';

const required=name=>{const value=String(process.env[name]||'').trim();if(!value)throw new Error(`${name} is required`);return value;};
function command(name,args,options={}){const result=spawnSync(name,args,{encoding:'utf8',env:process.env,stdio:options.stdio||['ignore','pipe','pipe'],...options});if(result.error)throw new Error(`${name} unavailable: ${result.error.message}`);if(result.status!==0)throw new Error(`${name} failed: ${String(result.stderr||'').trim().slice(0,1600)}`);return String(result.stdout||'').trim();}
const sha256=file=>createHash('sha256').update(readFileSync(file)).digest('hex');

function decrypt(source,target,secret){
  const buffer=readFileSync(source);if(buffer.length<32||buffer.subarray(0,4).toString()!=='BH01')throw new Error('Unsupported encrypted backup format');
  const iv=buffer.subarray(4,16),tag=buffer.subarray(16,32),encrypted=buffer.subarray(32),key=createHash('sha256').update(secret).digest(),decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAuthTag(tag);writeFileSync(target,Buffer.concat([decipher.update(encrypted),decipher.final()]),{mode:0o600});
}

function query(databaseUrl,sql){return command('psql',[databaseUrl,'-X','-t','-A','-v','ON_ERROR_STOP=1','-c',sql]);}
function assertSafeTarget(source,target){
  if(process.env.ALLOW_RESTORE_TEST_DATABASE!=='true')throw new Error('Set ALLOW_RESTORE_TEST_DATABASE=true for an explicit non-production restore');
  if(source&&source===target)throw new Error('Restore target must not equal the production source database');
  if(/prod(uction)?/i.test(String(process.env.RESTORE_ENVIRONMENT||'')))throw new Error('RESTORE_ENVIRONMENT must be non-production');
}

function main(){
  const input=resolve(process.argv[2]||'');if(!process.argv[2]||!existsSync(input))throw new Error('Usage: npm run restore:test -- /path/to/backup.sql.gz[.enc]');
  const target=required('RESTORE_DATABASE_URL');assertSafeTarget(String(process.env.SUPABASE_DB_URL||''),target);
  const expectedManifest=`${input}.manifest.json`,manifest=existsSync(expectedManifest)?JSON.parse(readFileSync(expectedManifest,'utf8')):null,expectedChecksum=String(process.env.BACKUP_EXPECTED_SHA256||manifest?.checksumSha256||'');
  const actualChecksum=sha256(input);if(expectedChecksum&&actualChecksum!==expectedChecksum)throw new Error('Backup checksum mismatch');
  const workDir=resolve(process.env.RESTORE_WORK_DIR||'.restore-work');mkdirSync(workDir,{recursive:true,mode:0o700});
  const compressed=resolve(workDir,`${basename(input)}.gz`),sql=resolve(workDir,`${basename(input)}.sql`);let compressedSource=input;
  if(input.endsWith('.enc')){decrypt(input,compressed,required('BACKUP_ENCRYPTION_KEY'));compressedSource=compressed;}
  const compressedBuffer=readFileSync(compressedSource),plain=gunzipSync(compressedBuffer);writeFileSync(sql,plain,{mode:0o600});
  const restore=spawnSync('psql',[target,'-X','-v','ON_ERROR_STOP=1','-f',sql],{encoding:'utf8',env:process.env,stdio:['ignore','pipe','pipe']});if(restore.error)throw new Error(`psql unavailable: ${restore.error.message}`);if(restore.status!==0)throw new Error(`Restore failed: ${String(restore.stderr||'').trim().slice(0,2000)}`);
  const schemaVersion=Number(query(target,'select coalesce(max(version),0) from public.migration_history;'))||0,tableCount=Number(query(target,"select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE';"))||0,criticalCounts={dailyReportBatches:Number(query(target,'select count(*) from public.daily_report_batches;'))||0,salesOrders:Number(query(target,'select count(*) from public.sales_orders;'))||0,collectionEvents:Number(query(target,'select count(*) from public.collection_events;'))||0,costLedger:Number(query(target,'select count(*) from public.cost_ledger;'))||0,fifoRebuildRuns:Number(query(target,'select count(*) from public.fifo_rebuild_runs;'))||0,auditLog:Number(query(target,'select count(*) from public.audit_log;'))||0};
  const missing=String(query(target,"with required(name) as (values ('app_state'),('daily_report_batches'),('daily_report_sales_lines'),('daily_report_cash_movements'),('daily_report_import_attempts'),('cost_ledger'),('cost_centers'),('cost_periods'),('operational_alerts'),('backup_runs'),('fifo_rebuild_runs')) select coalesce(string_agg(name,','),'') from required where to_regclass('public.'||name) is null;"));
  const customerFunction=query(target,"select to_regprocedure('public.ensure_daily_report_customer(text,text)') is not null;");
  if(schemaVersion<15||missing||customerFunction!=='t')throw new Error(`Restore readiness failed: schema=${schemaVersion}, missing=${missing||'none'}, customerMaster=${customerFunction}`);
  const result={ok:true,source:input,targetEnvironment:String(process.env.RESTORE_ENVIRONMENT||'test'),schemaVersion,tableCount,criticalCounts,checksumSha256:actualChecksum,manifestSchemaVersion:manifest?.schemaVersion??null,verifiedAt:new Date().toISOString()};
  writeFileSync(resolve(workDir,'restore-result.json'),JSON.stringify(result,null,2),{mode:0o600});if(process.env.KEEP_RESTORE_SQL!=='true'){rmSync(sql,{force:true});if(compressedSource===compressed)rmSync(compressed,{force:true});}
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

try{main();}catch(error){console.error(`Restore verification failed: ${error.message}`);process.exit(1);}
