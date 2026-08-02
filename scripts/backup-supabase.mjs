import { createHash, createCipheriv, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { spawnSync } from 'node:child_process';

const required=name=>{const value=String(process.env[name]||'').trim();if(!value)throw new Error(`${name} is required`);return value;};
const safe=value=>String(value||'').replace(/[^A-Za-z0-9_.-]/g,'-').slice(0,100);
const timestamp=()=>new Date().toISOString().replace(/[:.]/g,'-');
const sha256=file=>{const hash=createHash('sha256');const data=readFileSync(file);hash.update(data);return hash.digest('hex');};
const serviceHeaders=()=>{const key=required('SUPABASE_SERVICE_ROLE_KEY'),headers={apikey:key};if(!key.startsWith('sb_secret_'))headers.Authorization=`Bearer ${key}`;return headers;};
const riyadhDateOffset=days=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()+Number(days||0)*86400000));

function command(name,args,options={}){
  const result=spawnSync(name,args,{encoding:'utf8',stdio:options.stdio||['ignore','pipe','pipe'],env:process.env,...options});
  if(result.error)throw new Error(`${name} unavailable: ${result.error.message}`);
  if(result.status!==0)throw new Error(`${name} failed: ${String(result.stderr||'').trim().slice(0,1200)}`);
  return String(result.stdout||'').trim();
}

function schemaVersion(databaseUrl){
  try{return Number(command('psql',[databaseUrl,'-X','-t','-A','-v','ON_ERROR_STOP=1','-c','select coalesce(max(version),0) from public.migration_history;']))||0;}
  catch{return 0;}
}

function erpDailyReportStatus(databaseUrl,reportDate){
  const checkedDate=/^\d{4}-\d{2}-\d{2}$/.test(String(reportDate||''))?String(reportDate):riyadhDateOffset(-1);
  const sql=`
WITH target AS (
  SELECT id,report_date,status,committed_at,created_at
  FROM public.daily_report_batches
  WHERE report_date=DATE '${checkedDate}'
  ORDER BY committed_at DESC NULLS LAST,created_at DESC
  LIMIT 1
), latest AS (
  SELECT report_date,status,committed_at
  FROM public.daily_report_batches
  ORDER BY report_date DESC,committed_at DESC NULLS LAST,created_at DESC
  LIMIT 1
), sales AS (
  SELECT COUNT(*)::bigint invoice_count,
         ROUND(COALESCE(SUM(amount),0),2) sales_total,
         ROUND(COALESCE(SUM(amount) FILTER (WHERE sales_type='block'),0),2) block_total,
         ROUND(COALESCE(SUM(amount) FILTER (WHERE sales_type='concrete'),0),2) concrete_total
  FROM public.daily_report_sales_lines
  WHERE batch_id=(SELECT id FROM target)
), cash AS (
  SELECT COUNT(*) FILTER (WHERE is_customer_collection)::bigint collection_rows,
         ROUND(COALESCE(SUM(debit-credit) FILTER (WHERE is_customer_collection),0),2) collections_total
  FROM public.daily_report_cash_movements
  WHERE batch_id=(SELECT id FROM target)
), latest_import AS (
  SELECT status,original_name,last_error_code,created_at
  FROM public.imports
  WHERE report_type IN ('daily_movement','block_daily_movement','concrete_daily_movement')
    AND created_at >= TIMESTAMPTZ '${checkedDate} 00:00:00+03'
  ORDER BY created_at DESC
  LIMIT 1
)
SELECT json_build_object(
  'reportDate','${checkedDate}',
  'found',EXISTS(SELECT 1 FROM target),
  'batchId',(SELECT id::text FROM target),
  'batchStatus',(SELECT status::text FROM target),
  'committedAtRiyadh',(SELECT to_char(committed_at AT TIME ZONE 'Asia/Riyadh','YYYY-MM-DD HH24:MI:SS') FROM target),
  'invoiceCount',(SELECT invoice_count FROM sales),
  'salesTotal',(SELECT sales_total FROM sales),
  'blockSales',(SELECT block_total FROM sales),
  'concreteSales',(SELECT concrete_total FROM sales),
  'collectionRows',(SELECT collection_rows FROM cash),
  'collectionsTotal',(SELECT collections_total FROM cash),
  'latestReportDate',(SELECT report_date::text FROM latest),
  'latestReportStatus',(SELECT status::text FROM latest),
  'latestReportCommittedAtRiyadh',(SELECT to_char(committed_at AT TIME ZONE 'Asia/Riyadh','YYYY-MM-DD HH24:MI:SS') FROM latest),
  'latestImportStatus',(SELECT status::text FROM latest_import),
  'latestImportFile',(SELECT original_name FROM latest_import),
  'latestImportError',(SELECT last_error_code::text FROM latest_import),
  'latestImportAtRiyadh',(SELECT to_char(created_at AT TIME ZONE 'Asia/Riyadh','YYYY-MM-DD HH24:MI:SS') FROM latest_import)
)::text;`;
  try{
    const raw=command('psql',[databaseUrl,'-X','-t','-A','-v','ON_ERROR_STOP=1','-c',sql]);
    return raw?JSON.parse(raw):{reportDate:checkedDate,found:false};
  }catch(error){
    return{reportDate:checkedDate,found:null,diagnosticError:String(error?.message||error).slice(0,500)};
  }
}

function pgDumpVersion(){
  const output=command('pg_dump',['--version']);
  return output.match(/([0-9]+(?:\.[0-9]+)+)/)?.[1]||'unknown';
}

async function gzipFile(source,target){await pipeline(createReadStream(source),createGzip({level:9}),createWriteStream(target,{mode:0o600}));}

async function encryptFile(source,target,secret){
  const size=statSync(source).size;if(size>250*1024*1024)throw new Error('Encrypted backup exceeds the 250 MB safe in-memory limit');
  const iv=randomBytes(12),key=createHash('sha256').update(secret).digest(),cipher=createCipheriv('aes-256-gcm',key,iv),plain=readFileSync(source),encrypted=Buffer.concat([cipher.update(plain),cipher.final()]),tag=cipher.getAuthTag();
  writeFileSync(target,Buffer.concat([Buffer.from('BH01'),iv,tag,encrypted]),{mode:0o600});
}

async function uploadToStorage(file,storagePath,contentType){
  const base=required('SUPABASE_URL').replace(/\/$/,''),bucket=String(process.env.SUPABASE_STORAGE_BUCKET||'factory-documents'),encoded=storagePath.split('/').map(encodeURIComponent).join('/'),buffer=readFileSync(file);
  const response=await fetch(`${base}/storage/v1/object/${encodeURIComponent(bucket)}/${encoded}`,{method:'POST',headers:{...serviceHeaders(),'Content-Type':contentType,'x-upsert':'false'},body:buffer});
  if(!response.ok)throw new Error(`Storage upload failed (${response.status}): ${(await response.text()).slice(0,500)}`);
}

async function recordRun(row){
  if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)return;
  const response=await fetch(`${String(process.env.SUPABASE_URL).replace(/\/$/,'')}/rest/v1/backup_runs`,{method:'POST',headers:{...serviceHeaders(),'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify(row)});
  if(!response.ok)throw new Error(`backup_runs insert failed (${response.status}): ${(await response.text()).slice(0,500)}`);
}

function applyRetention(directory,days){
  const threshold=Date.now()-days*86400000,removed=[];
  for(const name of readdirSync(directory)){if(!name.startsWith('binhamid-'))continue;const file=join(directory,name);try{if(statSync(file).mtimeMs<threshold){rmSync(file,{force:true});removed.push(name);}}catch{}}
  return removed;
}

async function main(){
  const databaseUrl=required('SUPABASE_DB_URL'),environment=safe(process.env.BACKUP_ENVIRONMENT||process.env.VERCEL_ENV||process.env.NODE_ENV||'production'),directory=resolve(process.env.BACKUP_OUTPUT_DIR||'backups');mkdirSync(directory,{recursive:true,mode:0o700});
  const stamp=timestamp(),baseName=`binhamid-${environment}-${stamp}`,sql=join(directory,`${baseName}.sql`),compressed=join(directory,`${baseName}.sql.gz`),encryptionKey=String(process.env.BACKUP_ENCRYPTION_KEY||''),finalFile=encryptionKey?join(directory,`${baseName}.sql.gz.enc`):compressed,clientVersion=pgDumpVersion();
  const dumpArgs=[databaseUrl,'--format=plain','--schema=public','--no-owner','--no-privileges','--clean','--if-exists'];
  const fd=openSync(sql,'w',0o600),dump=spawnSync('pg_dump',dumpArgs,{stdio:['ignore',fd,'pipe'],env:process.env,encoding:'utf8'});
  if(dump.error)throw new Error(`pg_dump unavailable: ${dump.error.message}`);if(dump.status!==0)throw new Error(`pg_dump failed: ${String(dump.stderr||'').trim().slice(0,1200)}`);
  await gzipFile(sql,compressed);rmSync(sql,{force:true});if(encryptionKey){await encryptFile(compressed,finalFile,encryptionKey);rmSync(compressed,{force:true});}
  const version=schemaVersion(databaseUrl),erpReportDate=String(process.env.ERP_DIAGNOSTIC_DATE||'').trim()||riyadhDateOffset(-1),erpDailyReport=erpDailyReportStatus(databaseUrl,erpReportDate),checksum=sha256(finalFile),storagePrefix=safe(process.env.BACKUP_STORAGE_PREFIX||'backups'),storagePath=`${storagePrefix}/${environment}/${basename(finalFile)}`,manifest={format:'binhamid-backup-v1',environment,createdAt:new Date().toISOString(),schemaVersion:version,fileName:basename(finalFile),checksumSha256:checksum,encrypted:Boolean(encryptionKey),compression:'gzip',databaseFormat:'plain-sql',databaseScope:'public-schema',schemas:['public'],restoreRequires:'psql',pgDumpVersion:clientVersion};
  const manifestPath=`${finalFile}.manifest.json`;writeFileSync(manifestPath,JSON.stringify(manifest,null,2),{mode:0o600});
  let uploaded=false;if(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY){await uploadToStorage(finalFile,storagePath,'application/octet-stream');await uploadToStorage(manifestPath,`${storagePath}.manifest.json`,'application/json');uploaded=true;}
  await recordRun({environment,backup_name:basename(finalFile),schema_version:version,status:'completed',storage_path:uploaded?storagePath:null,manifest,checksum_sha256:checksum,encrypted:Boolean(encryptionKey),size_bytes:statSync(finalFile).size,completed_at:new Date().toISOString()});
  const removed=applyRetention(directory,Math.max(1,Number(process.env.BACKUP_RETENTION_DAYS)||30));
  process.stdout.write(`${JSON.stringify({ok:true,file:finalFile,manifest:manifestPath,storagePath:uploaded?storagePath:null,schemaVersion:version,checksumSha256:checksum,sizeBytes:statSync(finalFile).size,pgDumpVersion:clientVersion,databaseScope:manifest.databaseScope,erpDailyReport,retentionRemoved:removed.length})}\n`);
}

main().catch(async error=>{try{await recordRun({environment:safe(process.env.BACKUP_ENVIRONMENT||process.env.VERCEL_ENV||'unknown'),backup_name:`binhamid-failed-${timestamp()}`,schema_version:0,status:'failed',manifest:{},encrypted:Boolean(process.env.BACKUP_ENCRYPTION_KEY),error_text:String(error.message).slice(0,1000)});}catch{}console.error(`Backup failed: ${error.message}`);process.exit(1);});