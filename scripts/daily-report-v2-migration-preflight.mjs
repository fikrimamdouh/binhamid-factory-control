import { existsSync,readFileSync,writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const databaseUrl=String(process.env.SUPABASE_DB_URL||'').trim();
const resultPath=String(process.env.DAILY_REPORT_V2_PREFLIGHT_PATH||'daily-report-v2-preflight.json');
const targetVersion=30;
const save=value=>writeFileSync(resultPath,`${JSON.stringify(value,null,2)}\n`,{mode:0o600});
const fail=(code,reason,extra={})=>{save({ok:false,code,reason,...extra});console.error(`[daily-report-v2-preflight] ${code}: ${reason}`);process.exit(1);};
const query=sql=>{
  const result=spawnSync('psql',[databaseUrl,'-X','-t','-A','-v','ON_ERROR_STOP=1','-c',sql],{encoding:'utf8',env:process.env,timeout:120000});
  if(result.error||result.status!==0)fail('PREFLIGHT_QUERY_FAILED','The daily-report v2 preflight query failed.',{exitCode:result.status??-1});
  return String(result.stdout||'').trim();
};

if(!databaseUrl)fail('DATABASE_URL_EMPTY','The resolved database connection is empty.');
const state=JSON.parse(query(`select json_build_object(
  'currentVersion',(select coalesce(max(version),0) from public.migration_history),
  'dependencies',json_build_object(
    'migrationHistory',to_regclass('public.migration_history') is not null,
    'dailyBatches',to_regclass('public.daily_report_batches') is not null,
    'dailySales',to_regclass('public.daily_report_sales_lines') is not null,
    'dailyCash',to_regclass('public.daily_report_cash_movements') is not null,
    'dailyTreasuries',to_regclass('public.daily_report_treasury_balances') is not null,
    'dailyInventory',to_regclass('public.daily_report_inventory_snapshots') is not null,
    'chartOfAccounts',to_regclass('public.chart_of_accounts') is not null,
    'journalEntries',to_regclass('public.journal_entries') is not null,
    'journalLines',to_regclass('public.journal_entry_lines') is not null,
    'customers',to_regclass('public.customers') is not null,
    'ensureCustomer',to_regprocedure('public.ensure_daily_report_customer(text,text)') is not null,
    'postAccounting',to_regprocedure('public.post_daily_report_accounting(uuid,text)') is not null),
  'counts',json_build_object(
    'dailyBatches',(select count(*) from public.daily_report_batches),
    'dailySales',(select count(*) from public.daily_report_sales_lines),
    'dailyCash',(select count(*) from public.daily_report_cash_movements),
    'dailyTreasuries',(select count(*) from public.daily_report_treasury_balances),
    'dailyInventory',(select count(*) from public.daily_report_inventory_snapshots),
    'salesOrders',(select count(*) from public.sales_orders),
    'collectionEvents',(select count(*) from public.collection_events),
    'journalEntries',(select count(*) from public.journal_entries),
    'journalLines',(select count(*) from public.journal_entry_lines))
)::text;`));
const currentVersion=Number(state.currentVersion||0);
if(currentVersion<28||currentVersion>targetVersion)fail('SCHEMA_VERSION_OUT_OF_RANGE','Production schema must be between version 28 and 30 before this migration.',{currentVersion,targetVersion});
const missing=Object.entries(state.dependencies||{}).filter(([,value])=>!value).map(([name])=>name);
if(missing.length)fail('BASE_SCHEMA_INCOMPLETE','Required daily-report or accounting objects are missing.',{currentVersion,missing});

const manifestPath=String(process.env.PRE_MIGRATION_MANIFEST||'').trim();
if(!manifestPath||!existsSync(manifestPath))fail('BACKUP_MANIFEST_MISSING','The encrypted pre-migration backup manifest is missing.');
let manifest;
try{manifest=JSON.parse(readFileSync(manifestPath,'utf8'));}
catch{fail('BACKUP_MANIFEST_INVALID','The encrypted pre-migration backup manifest is invalid.');}
if(manifest.format!=='binhamid-backup-v1'||manifest.encrypted!==true||Number(manifest.schemaVersion)!==currentVersion||!/^[a-f0-9]{64}$/i.test(String(manifest.checksumSha256||''))){
  fail('BACKUP_GATE_FAILED','The encrypted backup did not pass the schema and checksum gate.',{currentVersion,backupSchemaVersion:Number(manifest.schemaVersion)});
}

const result={ok:true,currentVersion,targetVersion,counts:state.counts,backup:{fileName:manifest.fileName,checksumSha256:manifest.checksumSha256,schemaVersion:Number(manifest.schemaVersion),encrypted:true}};
save(result);
console.log(`[daily-report-v2-preflight] READY ${currentVersion}->${targetVersion}`);
