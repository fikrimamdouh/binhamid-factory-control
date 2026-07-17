import { readFileSync,writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const db=String(process.env.SUPABASE_DB_URL||'').trim();
const preflightPath=process.env.MIGRATION_PREFLIGHT_PATH||'migration-preflight.json';
const output=process.env.MIGRATION_RESULT_PATH||'migration-result.json';
const stop=(code,reason,extra={})=>{writeFileSync(output,`${JSON.stringify({ok:false,code,reason,...extra},null,2)}\n`);console.error(`[migration-verify] ${code}: ${reason}`);process.exit(1);};
const query=sql=>{const r=spawnSync('psql',[db,'-X','-t','-A','-v','ON_ERROR_STOP=1','-c',sql],{encoding:'utf8',env:process.env,timeout:120000});if(r.error||r.status!==0)stop('VERIFICATION_QUERY_FAILED','The post-migration verification query failed.',{exitCode:r.status??-1});return String(r.stdout||'').trim();};
if(!db)stop('DATABASE_URL_EMPTY','The resolved database connection is empty.');
let preflight;try{preflight=JSON.parse(readFileSync(preflightPath,'utf8'));}catch{stop('PREFLIGHT_RESULT_INVALID','The migration preflight result is unavailable.');}
const state=JSON.parse(query(`select json_build_object(
'currentVersion',(select coalesce(max(version),0) from public.migration_history),
'versions',(select json_agg(version order by version) from public.migration_history where version between 11 and 15),
'objects',json_build_object(
'cost_centers',to_regclass('public.cost_centers') is not null,
'cost_periods',to_regclass('public.cost_periods') is not null,
'cost_calculation_runs',to_regclass('public.cost_calculation_runs') is not null,
'daily_report_import_attempts',to_regclass('public.daily_report_import_attempts') is not null,
'fifo_rebuild_runs',to_regclass('public.fifo_rebuild_runs') is not null,
'cost_unit_monthly_report',to_regclass('public.cost_unit_monthly_report') is not null,
'run_cost_period',to_regprocedure('public.run_cost_period(date,text,boolean)') is not null,
'register_daily_report_attempt',to_regprocedure('public.register_daily_report_attempt(date,text,text,text,text,text,uuid,jsonb,jsonb,jsonb,text)') is not null,
'rebuild_customer_fifo',to_regprocedure('public.rebuild_customer_fifo(text,text,text)') is not null,
'allocate_collection_fifo_core',to_regprocedure('public.allocate_collection_fifo_core(uuid,uuid)') is not null,
'project_maintenance_cost_v2',to_regprocedure('public.project_maintenance_cost_v2()') is not null,
'ensure_daily_report_customer',to_regprocedure('public.ensure_daily_report_customer(text,text)') is not null,
'daily_sale_trigger',exists(select 1 from pg_trigger where tgname='daily_report_sale_validation_trigger' and not tgisinternal),
'daily_cash_trigger',exists(select 1 from pg_trigger where tgname='daily_report_cash_validation_trigger' and not tgisinternal),
'daily_cash_customer_deferred_trigger',exists(select 1 from pg_trigger where tgname='daily_report_cash_customer_deferred_trigger' and not tgisinternal and tgdeferrable and tginitdeferred),
'fifo_trigger',exists(select 1 from pg_trigger where tgname='sales_order_backdated_fifo_trigger' and not tgisinternal),
'maintenance_trigger',exists(select 1 from pg_trigger where tgname='maintenance_cost_projection_v2_trigger' and not tgisinternal)),
'identityCheck',length(public.daily_sale_identity('TEST','TEST','block',1,1))=64,
'fifoPreviewCheck',(public.preview_customer_fifo_rebuild('__migration_smoke_check__')->>'willRebuildChronologically')::boolean,
'counts',json_build_object(
'customers',(select count(*) from public.customers),
'salesOrders',(select count(*) from public.sales_orders),
'collectionEvents',(select count(*) from public.collection_events),
'maintenanceOrders',(select count(*) from public.maintenance_orders),
'dailySalesLines',(select count(*) from public.daily_report_sales_lines),
'dailyCashMovements',(select count(*) from public.daily_report_cash_movements))
)::text;`));
if(Number(state.currentVersion)!==15)stop('TARGET_VERSION_NOT_REACHED','Production did not reach schema version 15.',{currentVersion:Number(state.currentVersion)});
const versions=(state.versions||[]).map(Number);if([11,12,13,14,15].some(v=>!versions.includes(v)))stop('MIGRATION_HISTORY_INCOMPLETE','Migration history is incomplete.',{versions});
const missing=Object.entries(state.objects||{}).filter(([,v])=>!v).map(([k])=>k);if(missing.length)stop('DATABASE_OBJECTS_MISSING','Required version-15 objects are missing.',{missing});
if(!state.identityCheck||!state.fifoPreviewCheck)stop('FUNCTION_SMOKE_CHECK_FAILED','Read-only database function checks failed.');
const changed=Object.keys(preflight.counts||{}).filter(k=>Number(preflight.counts[k])!==Number(state.counts?.[k]));if(changed.length)stop('PROTECTED_ROW_COUNT_CHANGED','Protected operational row counts changed during schema migration.',{changed,before:preflight.counts,after:state.counts});
const result={ok:true,code:'MIGRATIONS_APPLIED_AND_VERIFIED',fromVersion:Number(preflight.currentVersion),toVersion:15,appliedMigrations:Array.from({length:Math.max(0,15-Number(preflight.currentVersion))},(_,i)=>Number(preflight.currentVersion)+i+1),transactionAtomic:true,preMigrationBackup:preflight.backup,beforeCounts:preflight.counts,afterCounts:state.counts,verification:state};
writeFileSync(output,`${JSON.stringify(result,null,2)}\n`,{mode:0o600});
console.log(`[migration-verify] SUCCESS ${result.fromVersion}->15`);
