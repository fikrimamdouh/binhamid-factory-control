import { readFileSync,writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const databaseUrl=String(process.env.SUPABASE_DB_URL||'').trim();
const preflightPath=process.env.MIGRATION_PREFLIGHT_PATH||'migration-preflight.json';
const resultPath=process.env.MIGRATION_RESULT_PATH||'migration-result.json';
const fail=(code,reason,extra={})=>{writeFileSync(resultPath,`${JSON.stringify({ok:false,code,reason,...extra},null,2)}\n`,{mode:0o600});console.error(`[governance-verify] ${code}: ${reason}`);process.exit(1);};
const query=sql=>{const result=spawnSync('psql',[databaseUrl,'-X','-t','-A','-v','ON_ERROR_STOP=1','-c',sql],{encoding:'utf8',env:process.env,timeout:120000});if(result.error||result.status!==0)fail('VERIFICATION_QUERY_FAILED','The post-migration verification query failed.',{exitCode:result.status??-1});return String(result.stdout||'').trim();};
if(!databaseUrl)fail('DATABASE_URL_EMPTY','The resolved database connection is empty.');
let preflight;try{preflight=JSON.parse(readFileSync(preflightPath,'utf8'));}catch{fail('PREFLIGHT_RESULT_INVALID','The migration preflight result is unavailable.');}
const state=JSON.parse(query(`select json_build_object(
'currentVersion',(select coalesce(max(version),0) from public.migration_history),
'versions',(select json_agg(version order by version) from public.migration_history where version between 16 and 18),
'objects',json_build_object(
'financialPeriods',to_regclass('public.financial_periods') is not null,
'financialPeriodEvents',to_regclass('public.financial_period_events') is not null,
'creditOverrides',to_regclass('public.credit_override_requests') is not null,
'unifiedAssets',to_regclass('public.unified_assets') is not null,
'assetLinks',to_regclass('public.asset_source_links') is not null,
'complianceDocuments',to_regclass('public.compliance_documents') is not null,
'custodyAccounts',to_regclass('public.custody_accounts') is not null,
'custodyTransactions',to_regclass('public.custody_transactions') is not null,
'restoreTests',to_regclass('public.restore_test_runs') is not null,
'handoverRuns',to_regclass('public.handover_acceptance_runs') is not null,
'handoverSignoffs',to_regclass('public.handover_signoffs') is not null,
'creditExposureView',to_regclass('public.control_credit_exposure') is not null,
'expiringDocumentsView',to_regclass('public.control_expiring_documents') is not null,
'openCustodiesView',to_regclass('public.control_open_custodies') is not null,
'assetDuplicatesView',to_regclass('public.control_asset_duplicates') is not null,
'periodCloseFunction',exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='close_financial_period'),
'periodReopenFunction',exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='reopen_financial_period'),
'creditRequestFunction',exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='request_credit_override'),
'creditDecisionFunction',exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='decide_credit_override'),
'custodyRequestFunction',exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='request_custody_transaction'),
'custodyDecisionFunction',exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='approve_custody_transaction'),
'handoverStartFunction',exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='start_handover_acceptance'),
'handoverSignFunction',exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='sign_handover_acceptance'),
'salesPeriodTrigger',exists(select 1 from pg_trigger where tgname='sales_orders_financial_period_guard' and not tgisinternal),
'collectionPeriodTrigger',exists(select 1 from pg_trigger where tgname='collection_events_financial_period_guard' and not tgisinternal),
'dailyReportPeriodTrigger',exists(select 1 from pg_trigger where tgname='daily_report_batches_financial_period_guard' and not tgisinternal),
'costPeriodTrigger',exists(select 1 from pg_trigger where tgname='cost_ledger_financial_period_guard' and not tgisinternal),
'creditLimitTrigger',exists(select 1 from pg_trigger where tgname='sales_orders_credit_limit_guard' and not tgisinternal),
'dailyCreditFlagTrigger',exists(select 1 from pg_trigger where tgname='daily_report_credit_breach_flag' and not tgisinternal),
'maintenanceClosureTrigger',exists(select 1 from pg_trigger where tgname='maintenance_closure_control_trigger' and not tgisinternal),
'plateLookupIndex',exists(select 1 from pg_indexes where schemaname='public' and indexname='unified_assets_plate_idx'),
'noUniquePlateIndex',not exists(select 1 from pg_indexes where schemaname='public' and indexname='unified_assets_plate_uidx')),
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
if(Number(state.currentVersion)!==18)fail('TARGET_VERSION_NOT_REACHED','Production did not reach schema version 18.',{currentVersion:Number(state.currentVersion)});
const versions=(state.versions||[]).map(Number);if([16,17,18].some(version=>!versions.includes(version)))fail('MIGRATION_HISTORY_INCOMPLETE','Governance migration history is incomplete.',{versions});
const missing=Object.entries(state.objects||{}).filter(([,value])=>!value).map(([name])=>name);if(missing.length)fail('DATABASE_OBJECTS_MISSING','Required schema-18 governance objects are missing.',{missing});
if(!state.assetBackfillCheck)fail('ASSET_BACKFILL_INCOMPLETE','One or more legacy vehicles were not represented in the unified asset register.');
if(!state.governanceCapabilities)fail('GOVERNANCE_CAPABILITIES_INCOMPLETE','Governance capabilities were not seeded.');
const changed=Object.keys(preflight.counts||{}).filter(key=>Number(preflight.counts[key])!==Number(state.counts?.[key]));if(changed.length)fail('PROTECTED_ROW_COUNT_CHANGED','Protected operational row counts changed during schema migration.',{changed,before:preflight.counts,after:state.counts});
const migrationResult={ok:true,code:'GOVERNANCE_MIGRATIONS_APPLIED_AND_VERIFIED',fromVersion:Number(preflight.currentVersion),toVersion:18,appliedMigrations:Array.from({length:Math.max(0,18-Number(preflight.currentVersion))},(_,index)=>Number(preflight.currentVersion)+index+1),transactionAtomic:true,preMigrationBackup:preflight.backup,beforeCounts:preflight.counts,afterCounts:state.counts,verification:state};
writeFileSync(resultPath,`${JSON.stringify(migrationResult,null,2)}\n`,{mode:0o600});console.log(`[governance-verify] SUCCESS ${migrationResult.fromVersion}->18`);
