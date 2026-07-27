import { readFileSync,writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const databaseUrl=String(process.env.SUPABASE_DB_URL||'').trim();
const preflightPath=String(process.env.DAILY_REPORT_V2_PREFLIGHT_PATH||'daily-report-v2-preflight.json');
const resultPath=String(process.env.DAILY_REPORT_V2_RESULT_PATH||'daily-report-v2-result.json');
const targetVersion=29;
const save=value=>writeFileSync(resultPath,`${JSON.stringify(value,null,2)}\n`,{mode:0o600});
const fail=(code,reason,extra={})=>{save({ok:false,code,reason,...extra});console.error(`[daily-report-v2-verify] ${code}: ${reason}`);process.exit(1);};
const query=sql=>{
  const result=spawnSync('psql',[databaseUrl,'-X','-t','-A','-v','ON_ERROR_STOP=1','-c',sql],{encoding:'utf8',env:process.env,timeout:120000});
  if(result.error||result.status!==0)fail('VERIFICATION_QUERY_FAILED','The daily-report v2 verification query failed.',{exitCode:result.status??-1,stderr:String(result.stderr||'').slice(-1000)});
  return String(result.stdout||'').trim();
};

if(!databaseUrl)fail('DATABASE_URL_EMPTY','The resolved database connection is empty.');
let preflight;
try{preflight=JSON.parse(readFileSync(preflightPath,'utf8'));}
catch{fail('PREFLIGHT_RESULT_INVALID','The daily-report v2 preflight result is unavailable.');}

const state=JSON.parse(query(`select json_build_object(
  'currentVersion',(select coalesce(max(version),0) from public.migration_history),
  'migrationName',(select migration_name from public.migration_history where version=29),
  'objects',json_build_object(
    'upgradeFunction',to_regprocedure('public.upgrade_daily_report_details(date,text,jsonb,text)') is not null,
    'cashValidationFunction',to_regprocedure('public.validate_daily_report_cash_line()') is not null,
    'postAccountingFunction',to_regprocedure('public.post_daily_report_accounting(uuid,text)') is not null,
    'cashValidationTrigger',exists(select 1 from pg_trigger where tgrelid='public.daily_report_cash_movements'::regclass and tgname='daily_report_cash_validation_trigger' and not tgisinternal),
    'bankAccount',exists(select 1 from public.chart_of_accounts where account_code='110205' and account_name_ar='البنك الأهلي 105' and account_type='asset' and normal_side='debit' and active=true),
    'validationSupports105',position('105' in pg_get_functiondef('public.validate_daily_report_cash_line()'::regprocedure))>0,
    'accountingSupports105',position('110205' in pg_get_functiondef('public.post_daily_report_accounting(uuid,text)'::regprocedure))>0),
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
if(Number(state.currentVersion)!==targetVersion)fail('TARGET_VERSION_NOT_REACHED','Database did not reach schema version 29.',{currentVersion:Number(state.currentVersion)});
if(state.migrationName!=='029_daily_report_v2_upgrade')fail('MIGRATION_HISTORY_INVALID','Migration 029 history is missing or has the wrong name.',{migrationName:state.migrationName});
const missing=Object.entries(state.objects||{}).filter(([,value])=>!value).map(([name])=>name);
if(missing.length)fail('DATABASE_OBJECTS_MISSING','Required daily-report v2 objects are missing.',{missing});
const changed=Object.keys(preflight.counts||{}).filter(key=>Number(preflight.counts[key])!==Number(state.counts?.[key]));
if(changed.length)fail('PROTECTED_ROW_COUNT_CHANGED','Migration 029 changed protected operational rows before any explicit report replay.',{changed,before:preflight.counts,after:state.counts});

const result={ok:true,code:'SCHEMA_29_DAILY_REPORT_V2_VERIFIED',fromVersion:Number(preflight.currentVersion),toVersion:targetVersion,transactionAtomic:true,preMigrationBackup:preflight.backup,beforeCounts:preflight.counts,afterCounts:state.counts,verification:state};
save(result);
console.log(`[daily-report-v2-verify] SUCCESS ${result.fromVersion}->${targetVersion}`);
