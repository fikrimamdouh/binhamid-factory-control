import { readFileSync,writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const databaseUrl=String(process.env.SUPABASE_DB_URL||'').trim();
const preflightPath=process.env.MASTER_MIGRATION_PREFLIGHT_PATH||'persistent-master-preflight.json';
const resultPath=process.env.MASTER_MIGRATION_RESULT_PATH||'persistent-master-result.json';
const targetVersion=26;
const fail=(code,reason,extra={})=>{writeFileSync(resultPath,`${JSON.stringify({ok:false,code,reason,...extra},null,2)}\n`,{mode:0o600});console.error(`[persistent-master-verify] ${code}: ${reason}`);process.exit(1);};
const query=sql=>{const result=spawnSync('psql',[databaseUrl,'-X','-t','-A','-v','ON_ERROR_STOP=1','-c',sql],{encoding:'utf8',env:process.env,timeout:120000});if(result.error||result.status!==0)fail('VERIFICATION_QUERY_FAILED','The persistent master-data verification query failed.',{exitCode:result.status??-1,stderr:String(result.stderr||'').slice(-1000)});return String(result.stdout||'').trim();};
if(!databaseUrl)fail('DATABASE_URL_EMPTY','The resolved database connection is empty.');
let preflight;try{preflight=JSON.parse(readFileSync(preflightPath,'utf8'));}catch{fail('PREFLIGHT_RESULT_INVALID','The persistent master-data preflight result is unavailable.');}
const state=JSON.parse(query(`select json_build_object(
  'currentVersion',(select coalesce(max(version),0) from public.migration_history),
  'versions',(select json_agg(version order by version) from public.migration_history where version between 24 and 26),
  'objects',json_build_object(
    'openingBalances',to_regclass('public.customer_opening_balances') is not null,
    'masterImportRuns',to_regclass('public.master_data_import_runs') is not null,
    'employeeAssetDirectory',to_regclass('public.employee_asset_directory') is not null,
    'identityDuplicateControl',to_regclass('public.control_employee_identity_duplicates') is not null,
    'identityGuard',exists(select 1 from pg_trigger where tgname='employees_national_id_guard' and not tgisinternal),
    'assetVehicleSync',exists(select 1 from pg_trigger where tgname='unified_assets_vehicle_sync' and not tgisinternal),
    'employeeNationalId',exists(select 1 from information_schema.columns where table_schema='public' and table_name='employees' and column_name='national_id'),
    'employeeSite',exists(select 1 from information_schema.columns where table_schema='public' and table_name='employees' and column_name='site'),
    'employeeMetadata',exists(select 1 from information_schema.columns where table_schema='public' and table_name='employees' and column_name='metadata')),
  'duplicateIdentityCount',(select count(*) from public.control_employee_identity_duplicates),
  'counts',json_build_object(
    'employees',(select count(*) from public.employees),
    'vehicles',(select count(*) from public.vehicles),
    'appUsers',(select count(*) from public.app_users),
    'userInvitations',(select count(*) from public.user_invitations),
    'unifiedAssets',(select count(*) from public.unified_assets))
)::text;`));
if(Number(state.currentVersion)!==targetVersion)fail('TARGET_VERSION_NOT_REACHED','Production did not reach schema version 26.',{currentVersion:Number(state.currentVersion)});
const versions=(state.versions||[]).map(Number);if([24,25,26].some(version=>!versions.includes(version)))fail('MIGRATION_HISTORY_INCOMPLETE','Migration history 24-26 is incomplete.',{versions});
const missing=Object.entries(state.objects||{}).filter(([,value])=>!value).map(([name])=>name);if(missing.length)fail('DATABASE_OBJECTS_MISSING','Required persistent master-data objects are missing.',{missing});
if(Number(state.duplicateIdentityCount||0)!==0)fail('DUPLICATE_ACTIVE_IDENTITIES','Active employees contain duplicate national IDs.',{duplicateIdentityCount:Number(state.duplicateIdentityCount)});
const changed=Object.keys(preflight.counts||{}).filter(key=>Number(preflight.counts[key])!==Number(state.counts?.[key]));
if(changed.length)fail('PROTECTED_ROW_COUNT_CHANGED','Protected employee, vehicle or identity rows changed during schema migration.',{changed,before:preflight.counts,after:state.counts});
const result={ok:true,code:'SCHEMA_26_PERSISTENT_MASTER_VERIFIED',fromVersion:Number(preflight.currentVersion),toVersion:targetVersion,appliedMigrations:Array.from({length:Math.max(0,targetVersion-Number(preflight.currentVersion))},(_,index)=>Number(preflight.currentVersion)+index+1),transactionAtomic:true,preMigrationBackup:preflight.backup,beforeCounts:preflight.counts,afterCounts:state.counts,verification:state};
writeFileSync(resultPath,`${JSON.stringify(result,null,2)}\n`,{mode:0o600});
console.log(`[persistent-master-verify] SUCCESS ${result.fromVersion}->${targetVersion}`);
