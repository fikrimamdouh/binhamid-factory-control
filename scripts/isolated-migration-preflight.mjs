import { writeFileSync,readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const databaseUrl=String(process.env.LOCAL_DATABASE_URL||'').trim();
const manifestPath=String(process.env.ISOLATED_BACKUP_MANIFEST||'').trim();
const output=String(process.env.MIGRATION_PREFLIGHT_PATH||'migration-preflight.json');
const fail=(code,reason)=>{console.error(`[isolated-preflight] ${code}: ${reason}`);process.exit(1);};
if(!databaseUrl)fail('LOCAL_DATABASE_URL_EMPTY','The isolated database URL is empty.');
let manifest;try{manifest=JSON.parse(readFileSync(manifestPath,'utf8'));}catch{fail('MANIFEST_INVALID','The restored backup manifest is unavailable.');}
const sql=`select json_build_object(
  'currentVersion',(select coalesce(max(version),0) from public.migration_history),
  'counts',json_build_object(
    'customers',(select count(*) from public.customers),
    'employees',(select count(*) from public.employees),
    'vehicles',(select count(*) from public.vehicles),
    'salesOrders',(select count(*) from public.sales_orders),
    'collectionEvents',(select count(*) from public.collection_events),
    'maintenanceOrders',(select count(*) from public.maintenance_orders),
    'dailySalesLines',(select count(*) from public.daily_report_sales_lines),
    'dailyCashMovements',(select count(*) from public.daily_report_cash_movements),
    'imports',(select count(*) from public.imports),
    'auditLog',(select count(*) from public.audit_log))
)::text;`;
const result=spawnSync('psql',[databaseUrl,'-X','-t','-A','-v','ON_ERROR_STOP=1','-c',sql],{encoding:'utf8',env:process.env,timeout:120000});
if(result.error||result.status!==0)fail('PREFLIGHT_QUERY_FAILED','The isolated preflight query failed.');
const state=JSON.parse(String(result.stdout||'').trim());
if(Number(state.currentVersion)!==Number(manifest.schemaVersion))fail('RESTORED_SCHEMA_MISMATCH','The restored clone does not match the backup manifest.');
const report={ok:true,currentVersion:Number(state.currentVersion),targetVersion:22,counts:state.counts,backup:{fileName:manifest.fileName,checksumSha256:manifest.checksumSha256,schemaVersion:Number(manifest.schemaVersion),encrypted:true},isolated:true};
writeFileSync(output,`${JSON.stringify(report,null,2)}\n`,{mode:0o600});
console.log(`[isolated-preflight] READY ${report.currentVersion}->20`);
