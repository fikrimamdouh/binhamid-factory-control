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
'versions',(select json_agg(version order by version) from public.migration_history where version between 11 and 17),
'objects',json_build_object(
'cost_centers',to_regclass('public.cost_centers') is not null,
'cost_periods',to_regclass('public.cost_periods') is not null,
'daily_report_import_attempts',to_regclass('public.daily_report_import_attempts') is not null,
'fifo_rebuild_runs',to_regclass('public.fifo_rebuild_runs') is not null,
'financial_periods',to_regclass('public.financial_periods') is not null,
'financial_period_events',to_regclass('public.financial_period_events') is not null,
'credit_override_requests',to_regclass('public.credit_override_requests') is not null,
'unified_assets',to_regclass('public.unified_assets') is not null,
'asset_source_links',to_regclass('public.asset_source_links') is not null,
'compliance_documents',to_regclass('public.compliance_documents') is not null,
'custody_accounts',to_regclass('public.custody_accounts') is not null,
'custody_transactions',to_regclass('public.custody_transactions') is not null,
'restore_test_runs',to_regclass('public.restore_test_runs') is not null,
'handover_acceptance_runs',to_regclass('public.handover_acceptance_runs') is not null,
'handover_signoffs',to_regclass('public.handover_signoffs') is not null,
'control_credit_exposure',to_regclass('public.control_credit_exposure') is not null,
'control_expiring_documents',to_regclass('public.control_expiring_documents') is not null,
'control_open_custodies',to_regclass('public.control_open_custodies') is not null,
'close_financial_period',to_regprocedure('public.close_financial_period(date,date,text,text)') is not null,
'reopen_financial_period',to_regprocedure('public.reopen_financial_period(uuid,text,text)') is not null,
'request_credit_override',to_regprocedure('public.request_credit_override(text,numeric,text,text)') is not null,
'decide_credit_override',to_regprocedure('public.decide_credit_override(uuid,text,text,text,timestamp with time zone)') is not null,
'request_custody_transaction',to_regprocedure('public.request_custody_transaction(text,text,numeric,text,text,text)') is not null,
'approve_custody_transaction',to_regprocedure('public.approve_custody_transaction(uuid,text,boolean,text)') is not null,
'start_handover_acceptance',to_regprocedure('public.start_handover_acceptance(text,text,jsonb)') is not null,
'sign_handover_acceptance',to_regprocedure('public.sign_handover_acceptance(uuid,text,text,text,text)') is not null,
'financial_sales_trigger',exists(select 1 from pg_trigger where tgname='sales_orders_financial_period_guard' and not tgisinternal),
'financial_collection_trigger',exists(select 1 from pg_trigger where tgname='collection_events_financial_period_guard' and not tgisinternal),
'financial_daily_trigger',exists(select 1 from pg_trigger where tgname='daily_report_batches_financial_period_guard' and not tgisinternal),
'financial_cost_trigger',exists(select 1 from pg_trigger where tgname='cost_ledger_financial_period_guard' and not tgisinternal),
'credit_limit_trigger',exists(select 1 from pg_trigger where tgname='sales_orders_credit_limit_guard' and not tgisinternal),
'maintenance_closure_trigger',exists(select 1 from pg_trigger where tgname='maintenance_closure_control_trigger' and not tgisinternal)),
'assetBackfillCheck',(select count(*) from public.unified_assets where external_id in (select external_id from public.vehicles))=(select count(*) from public.vehicles),
'governanceCapabilities',(select count(*) from public.role_capabilities where capability in ('financial_period.manage','credit_override.approve','assets.manage','compliance.manage','custody.approve','handover.manage','restore_test.manage'))>=7,
'counts',json_build_object(
'customers',(select count(*) from public.customers),
'employees',(select count(*) from public.employees),
'vehicles',(select count(*) from public.vehicles),
'salesOrders',(select count(*) from public.sales_orders),
'collectionEvents',(select count(*) from public.collection_events),
'maintenanceOrders',(select count(*) from public.maintenance_orders),
'dailySalesLines',(select count(*) from public.daily_report_sales_lines),
'dailyCashMovements',(select count(*) from public.daily_report_cash_movements))
)::text;`));
if(Number(state.currentVersion)!==17)stop('TARGET_VERSION_NOT_REACHED','Production did not reach schema version 17.',{currentVersion:Number(state.currentVersion)});
const versions=(state.versions||[]).map(Number);if([11,12,13,14,15,16,17].some(v=>!versions.includes(v)))stop('MIGRATION_HISTORY_INCOMPLETE','Migration history is incomplete.',{versions});
const missing=Object.entries(state.objects||{}).filter(([,v])=>!v).map(([k])=>k);if(missing.length)stop('DATABASE_OBJECTS_MISSING','Required version-17 objects are missing.',{missing});
if(!state.assetBackfillCheck)stop('ASSET_BACKFILL_INCOMPLETE','One or more legacy vehicles were not represented in the unified asset register.');
if(!state.governanceCapabilities)stop('GOVERNANCE_CAPABILITIES_INCOMPLETE','Governance capabilities were not seeded.');
const changed=Object.keys(preflight.counts||{}).filter(k=>Number(preflight.counts[k])!==Number(state.counts?.[k]));if(changed.length)stop('PROTECTED_ROW_COUNT_CHANGED','Protected operational row counts changed during schema migration.',{changed,before:preflight.counts,after:state.counts});
const result={ok:true,code:'MIGRATIONS_APPLIED_AND_VERIFIED',fromVersion:Number(preflight.currentVersion),toVersion:17,appliedMigrations:Array.from({length:Math.max(0,17-Number(preflight.currentVersion))},(_,i)=>Number(preflight.currentVersion)+i+1),transactionAtomic:true,preMigrationBackup:preflight.backup,beforeCounts:preflight.counts,afterCounts:state.counts,verification:state};
writeFileSync(output,`${JSON.stringify(result,null,2)}\n`,{mode:0o600});
console.log(`[migration-verify] SUCCESS ${result.fromVersion}->17`);
