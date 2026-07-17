import { createHash } from 'node:crypto';
import { existsSync,readFileSync,readdirSync,statSync } from 'node:fs';
import { basename,join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const databaseUrl=String(process.env.SUPABASE_DB_URL||'').trim();
const directory=resolve(process.env.BACKUP_OUTPUT_DIR||'backup-output');
const manifestFile=String(process.env.BACKUP_MANIFEST_FILE||'').trim();
const resultFile=String(process.env.BACKUP_RESULT_FILE||'').trim();
const sqlLiteral=value=>`'${String(value??'').replaceAll("'","''")}'`;
const fail=(code,reason,extra={})=>{console.error(`[backup-evidence] ${code}: ${reason}${Object.keys(extra).length?` ${JSON.stringify(extra)}`:''}`);process.exit(1);};
const discoverFiles=root=>readdirSync(root,{recursive:true,withFileTypes:true}).filter(entry=>entry.isFile()).map(entry=>join(entry.parentPath||root,entry.name));

if(!databaseUrl)fail('DATABASE_URL_EMPTY','The protected database connection is unavailable.');
if(!existsSync(directory))fail('BACKUP_DIRECTORY_MISSING','The verified backup directory is unavailable.');
const files=discoverFiles(directory);
const manifestPath=manifestFile||files.find(file=>file.endsWith('.manifest.json'))||'';
if(!manifestPath||!existsSync(manifestPath))fail('BACKUP_MANIFEST_MISSING','The verified backup manifest is unavailable.',{filesScanned:files.length});
let manifest;try{manifest=JSON.parse(readFileSync(manifestPath,'utf8'));}catch{fail('BACKUP_MANIFEST_INVALID','The verified backup manifest is not valid JSON.');}
if(manifest.format!=='binhamid-backup-v1'||manifest.encrypted!==true||!/^[a-f0-9]{64}$/i.test(String(manifest.checksumSha256||'')))fail('BACKUP_MANIFEST_FIELDS_INVALID','The manifest did not pass encryption and checksum validation.');
if(manifest.databaseScope!=='public-schema'||!Array.isArray(manifest.schemas)||!manifest.schemas.includes('public'))fail('BACKUP_SCOPE_NOT_RESTORABLE','The backup manifest is not an independently restorable public-schema backup.');
const encryptedPath=files.find(file=>basename(file)===manifest.fileName&&file.endsWith('.enc'))||'';
if(!encryptedPath||!existsSync(encryptedPath))fail('ENCRYPTED_BACKUP_MISSING','The encrypted file named by the manifest is unavailable.');
const encryptedBytes=readFileSync(encryptedPath),actualSize=statSync(encryptedPath).size,actualChecksum=createHash('sha256').update(encryptedBytes).digest('hex');
if(actualSize<=154||actualChecksum!==manifest.checksumSha256)fail('ENCRYPTED_BACKUP_VERIFICATION_FAILED','The encrypted file size or checksum does not match the manifest.',{sizeBytes:actualSize});
let result={};if(resultFile&&existsSync(resultFile)){const lines=readFileSync(resultFile,'utf8').trim().split(/\r?\n/).filter(Boolean);try{result=JSON.parse(lines.at(-1)||'{}');}catch{fail('BACKUP_RESULT_INVALID','The backup result file is invalid.');}}
const sizeBytes=Number(result.sizeBytes||actualSize);if(!Number.isFinite(sizeBytes)||sizeBytes!==actualSize)fail('BACKUP_SIZE_INVALID','The encrypted backup size does not match the result file.',{actualSize,resultSize:sizeBytes});
const backupName=String(manifest.fileName||basename(String(result.file||''))).trim();if(!backupName)fail('BACKUP_NAME_MISSING','The encrypted backup name is missing.');
const createdAt=String(manifest.createdAt||new Date().toISOString());
const sql=`insert into public.backup_runs(environment,backup_name,schema_version,status,storage_path,manifest,checksum_sha256,encrypted,size_bytes,started_at,completed_at,verified_at,error_text)
values(${sqlLiteral(manifest.environment||'production')},${sqlLiteral(backupName)},${Number(manifest.schemaVersion)||0},'verified',null,${sqlLiteral(JSON.stringify(manifest))}::jsonb,${sqlLiteral(manifest.checksumSha256)},true,${actualSize},${sqlLiteral(createdAt)}::timestamptz,${sqlLiteral(createdAt)}::timestamptz,now(),null)
on conflict(backup_name) do update set environment=excluded.environment,schema_version=excluded.schema_version,status='verified',manifest=excluded.manifest,checksum_sha256=excluded.checksum_sha256,encrypted=true,size_bytes=excluded.size_bytes,completed_at=excluded.completed_at,verified_at=now(),error_text=null
returning id;`;
const command=spawnSync('psql',[databaseUrl,'-X','-t','-A','-v','ON_ERROR_STOP=1','-c',sql],{encoding:'utf8',env:process.env,timeout:120000});
if(command.error||command.status!==0)fail('BACKUP_REGISTRY_WRITE_FAILED','The verified backup metadata could not be recorded.',{exitCode:command.status??-1});
console.log(`[backup-evidence] RECORDED ${backupName}; schema=${manifest.schemaVersion}; bytes=${actualSize}; scope=${manifest.databaseScope}`);
