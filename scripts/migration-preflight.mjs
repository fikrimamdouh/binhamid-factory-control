import { existsSync,readFileSync,writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const db=String(process.env.SUPABASE_DB_URL||'').trim();
const output=process.env.MIGRATION_PREFLIGHT_PATH||'migration-preflight.json';
const stop=(code,reason,extra={})=>{writeFileSync(output,`${JSON.stringify({ok:false,code,reason,...extra},null,2)}\n`);console.error(`[migration-preflight] ${code}: ${reason}`);process.exit(1);};
const query=sql=>{const r=spawnSync('psql',[db,'-X','-t','-A','-v','ON_ERROR_STOP=1','-c',sql],{encoding:'utf8',env:process.env,timeout:120000});if(r.error||r.status!==0)stop('PREFLIGHT_QUERY_FAILED','The production schema preflight query failed.',{exitCode:r.status??-1});return String(r.stdout||'').trim();};
if(!db)stop('DATABASE_URL_EMPTY','The resolved database connection is empty.');
const state=JSON.parse(query(`select json_build_object(
'currentVersion',(select coalesce(max(version),0) from public.migration_history),
'dependencies',json_build_object(
'cost_ledger',to_regclass('public.cost_ledger') is not null,
'app_users',to_regclass('public.app_users') is not null,
'driver_events',to_regclass('public.driver_events') is not null,
'daily_report_batches',to_regclass('public.daily_report_batches') is not null,
'daily_report_sales_lines',to_regclass('public.daily_report_sales_lines') is not null,
'daily_report_cash_movements',to_regclass('public.daily_report_cash_movements') is not null,
'customers',to_regclass('public.customers') is not null,
'sales_orders',to_regclass('public.sales_orders') is not null,
'collection_events',to_regclass('public.collection_events') is not null,
'sales_payment_allocations',to_regclass('public.sales_payment_allocations') is not null,
'maintenance_orders',to_regclass('public.maintenance_orders') is not null,
'audit_log',to_regclass('public.audit_log') is not null),
'counts',json_build_object(
'customers',(select count(*) from public.customers),
'salesOrders',(select count(*) from public.sales_orders),
'collectionEvents',(select count(*) from public.collection_events),
'maintenanceOrders',(select count(*) from public.maintenance_orders),
'dailySalesLines',(select count(*) from public.daily_report_sales_lines),
'dailyCashMovements',(select count(*) from public.daily_report_cash_movements))
)::text;`));
const version=Number(state.currentVersion||0);
if(version<10||version>14)stop('SCHEMA_VERSION_OUT_OF_RANGE','Production schema must be between versions 10 and 14.',{currentVersion:version});
const missing=Object.entries(state.dependencies||{}).filter(([,v])=>!v).map(([k])=>k);
if(missing.length)stop('BASE_SCHEMA_INCOMPLETE','Required base schema objects are missing.',{currentVersion:version,missing});
const manifestPath=String(process.env.PRE_MIGRATION_MANIFEST||'').trim();
if(!manifestPath||!existsSync(manifestPath))stop('BACKUP_MANIFEST_MISSING','The pre-migration backup manifest is missing.');
let manifest;try{manifest=JSON.parse(readFileSync(manifestPath,'utf8'));}catch{stop('BACKUP_MANIFEST_INVALID','The pre-migration backup manifest is invalid.');}
if(manifest.format!=='binhamid-backup-v1'||manifest.encrypted!==true||Number(manifest.schemaVersion)!==version||!/^[a-f0-9]{64}$/i.test(String(manifest.checksumSha256||'')))stop('BACKUP_GATE_FAILED','The pre-migration backup did not pass the schema and encryption gate.',{currentVersion:version,backupSchemaVersion:Number(manifest.schemaVersion)});
const result={ok:true,currentVersion:version,targetVersion:14,counts:state.counts,backup:{fileName:manifest.fileName,checksumSha256:manifest.checksumSha256,schemaVersion:Number(manifest.schemaVersion),encrypted:true}};
writeFileSync(output,`${JSON.stringify(result,null,2)}\n`,{mode:0o600});
console.log(`[migration-preflight] READY ${version}->14`);
