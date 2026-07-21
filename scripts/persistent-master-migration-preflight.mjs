import { existsSync,readFileSync,writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// This file is intentionally touched after workflow installation so the main-branch push trigger runs once.
const databaseUrl=String(process.env.SUPABASE_DB_URL||'').trim();
const resultPath=process.env.MASTER_MIGRATION_PREFLIGHT_PATH||'persistent-master-preflight.json';
const targetVersion=26;
const fail=(code,reason,extra={})=>{writeFileSync(resultPath,`${JSON.stringify({ok:false,code,reason,...extra},null,2)}\n`,{mode:0o600});console.error(`[persistent-master-preflight] ${code}: ${reason}`);process.exit(1);};
const query=sql=>{const result=spawnSync('psql',[databaseUrl,'-X','-t','-A','-v','ON_ERROR_STOP=1','-c',sql],{encoding:'utf8',env:process.env,timeout:120000});if(result.error||result.status!==0)fail('PREFLIGHT_QUERY_FAILED','The persistent master-data preflight query failed.',{exitCode:result.status??-1});return String(result.stdout||'').trim();};
if(!databaseUrl)fail('DATABASE_URL_EMPTY','The resolved database connection is empty.');
const state=JSON.parse(query(`select json_build_object(
  'currentVersion',(select coalesce(max(version),0) from public.migration_history),
  'dependencies',json_build_object(
    'employees',to_regclass('public.employees') is not null,
    'vehicles',to_regclass('public.vehicles') is not null,
    'appUsers',to_regclass('public.app_users') is not null,
    'userInvitations',to_regclass('public.user_invitations') is not null,
    'unifiedAssets',to_regclass('public.unified_assets') is not null,
    'migrationHistory',to_regclass('public.migration_history') is not null,
    'auditLog',to_regclass('public.audit_log') is not null),
  'counts',json_build_object(
    'employees',(select count(*) from public.employees),
    'vehicles',(select count(*) from public.vehicles),
    'appUsers',(select count(*) from public.app_users),
    'userInvitations',(select count(*) from public.user_invitations),
    'unifiedAssets',(select count(*) from public.unified_assets))
)::text;`));
const currentVersion=Number(state.currentVersion||0);
if(currentVersion<24||currentVersion>targetVersion)fail('SCHEMA_VERSION_OUT_OF_RANGE','Production schema must be between versions 24 and 26.',{currentVersion,targetVersion});
const missing=Object.entries(state.dependencies||{}).filter(([,value])=>!value).map(([name])=>name);
if(missing.length)fail('BASE_SCHEMA_INCOMPLETE','Required employee and asset master objects are missing.',{currentVersion,missing});
const manifestPath=String(process.env.PRE_MIGRATION_MANIFEST||'').trim();
if(!manifestPath||!existsSync(manifestPath))fail('BACKUP_MANIFEST_MISSING','The encrypted pre-migration backup manifest is missing.');
let manifest;try{manifest=JSON.parse(readFileSync(manifestPath,'utf8'));}catch{fail('BACKUP_MANIFEST_INVALID','The encrypted pre-migration backup manifest is invalid.');}
if(manifest.format!=='binhamid-backup-v1'||manifest.encrypted!==true||Number(manifest.schemaVersion)!==currentVersion||!/^[a-f0-9]{64}$/i.test(String(manifest.checksumSha256||'')))fail('BACKUP_GATE_FAILED','The encrypted backup did not pass the schema and checksum gate.',{currentVersion,backupSchemaVersion:Number(manifest.schemaVersion)});
const result={ok:true,currentVersion,targetVersion,counts:state.counts,backup:{fileName:manifest.fileName,checksumSha256:manifest.checksumSha256,schemaVersion:Number(manifest.schemaVersion),encrypted:true}};
writeFileSync(resultPath,`${JSON.stringify(result,null,2)}\n`,{mode:0o600});
console.log(`[persistent-master-preflight] READY ${currentVersion}->${targetVersion}`);
