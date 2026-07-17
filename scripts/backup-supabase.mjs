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
  const version=schemaVersion(databaseUrl),checksum=sha256(finalFile),storagePrefix=safe(process.env.BACKUP_STORAGE_PREFIX||'backups'),storagePath=`${storagePrefix}/${environment}/${basename(finalFile)}`,manifest={format:'binhamid-backup-v1',environment,createdAt:new Date().toISOString(),schemaVersion:version,fileName:basename(finalFile),checksumSha256:checksum,encrypted:Boolean(encryptionKey),compression:'gzip',databaseFormat:'plain-sql',databaseScope:'public-schema',schemas:['public'],restoreRequires:'psql',pgDumpVersion:clientVersion};
  const manifestPath=`${finalFile}.manifest.json`;writeFileSync(manifestPath,JSON.stringify(manifest,null,2),{mode:0o600});
  let uploaded=false;if(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY){await uploadToStorage(finalFile,storagePath,'application/octet-stream');await uploadToStorage(manifestPath,`${storagePath}.manifest.json`,'application/json');uploaded=true;}
  await recordRun({environment,backup_name:basename(finalFile),schema_version:version,status:'completed',storage_path:uploaded?storagePath:null,manifest,checksum_sha256:checksum,encrypted:Boolean(encryptionKey),size_bytes:statSync(finalFile).size,completed_at:new Date().toISOString()});
  const removed=applyRetention(directory,Math.max(1,Number(process.env.BACKUP_RETENTION_DAYS)||30));
  process.stdout.write(`${JSON.stringify({ok:true,file:finalFile,manifest:manifestPath,storagePath:uploaded?storagePath:null,schemaVersion:version,checksumSha256:checksum,sizeBytes:statSync(finalFile).size,pgDumpVersion:clientVersion,databaseScope:manifest.databaseScope,retentionRemoved:removed.length})}\n`);
}

main().catch(async error=>{try{await recordRun({environment:safe(process.env.BACKUP_ENVIRONMENT||process.env.VERCEL_ENV||'unknown'),backup_name:`binhamid-failed-${timestamp()}`,schema_version:0,status:'failed',manifest:{},encrypted:Boolean(process.env.BACKUP_ENCRYPTION_KEY),error_text:String(error.message).slice(0,1000)});}catch{}console.error(`Backup failed: ${error.message}`);process.exit(1);});
