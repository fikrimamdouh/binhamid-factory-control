import { readFileSync,writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const databaseUrl=String(process.env.SUPABASE_DB_URL||'').trim();
const preflightPath=process.env.MIGRATION_PREFLIGHT_PATH||'migration-preflight.json';
const resultPath=process.env.MIGRATION_RESULT_PATH||'migration-result.json';
const targetVersion=22;
const fail=(code,reason,extra={})=>{writeFileSync(resultPath,`${JSON.stringify({ok:false,code,reason,...extra},null,2)}\n`,{mode:0o600});console.error(`[governance-verify] ${code}: ${reason}`);process.exit(1);};
const query=sql=>{const result=spawnSync('psql',[databaseUrl,'-X','-t','-A','-v','ON_ERROR_STOP=1','-c',sql],{encoding:'utf8',env:process.env,timeout:120000});if(result.error||result.status!==0)fail('VERIFICATION_QUERY_FAILED','The post-migration verification query failed.',{exitCode:result.status??-1});return String(result.stdout||'').trim();};
if(!databaseUrl)fail('DATABASE_URL_EMPTY','The resolved database connection is empty.');
let preflight;try{preflight=JSON.parse(readFileSync(preflightPath,'utf8'));}catch{fail('PREFLIGHT_RESULT_INVALID','The migration preflight result is unavailable.');}
const state=JSON.parse(query(`select json_build_object(
'currentVersion',(select coalesce(max(version),0) from public.migration_history),
'versions',(select json_agg(version order by version) from public.migration_history where version between 16 and 22),
'objects',json_build_object(
'financialPeriods',to_regclass('public.financial_periods') is not null,
'creditOverrides',to_regclass('public.credit_override_requests') is not null,
'unifiedAssets',to_regclass('public.unified_assets') is not null,
'complianceDocuments',to_regclass('public.compliance_documents') is not null,
'custodyAccounts',to_regclass('public.custody_accounts') is not null,
'restoreTests',to_regclass('public.restore_test_runs') is not null,
'handoverRuns',to_regclass('public.handover_acceptance_runs') is not null,
'chartOfAccounts',to_regclass('public.chart_of_accounts') is not null,
'journalEntries',to_regclass('public.journal_entries') is not null,
'journalLines',to_regclass('public.journal_entry_lines') is not null,
'telegramReceipts',to_regclass('public.telegram_update_receipts') is not null,
'generalLedger',to_regclass('public.general_ledger') is not null,
'trialBalance',to_regclass('public.trial_balance') is not null,
'accountingIntegrity',to_regclass('public.accounting_integrity_report') is not null,
'postAccountingFunction',exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='post_daily_report_accounting'),
'reversalFunction',exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='reverse_journal_entry'),
'importTransitionFunction',exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='transition_import_status'),
'telegramClaimFunction',exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='claim_telegram_update'),
'atomicDailyReportAcceptance',exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='commit_daily_report_acceptance'),
'accountingTrigger',exists(select 1 from pg_trigger where tgname='daily_report_accounting_post_trigger' and not tgisinternal),
'financialPeriodTrigger',exists(select 1 from pg_trigger where tgname='daily_report_batches_financial_period_guard' and not tgisinternal)),
'accounting',json_build_object(
'unbalanced',(select unbalanced_entries from public.accounting_integrity_report),
'entriesWithoutLines',(select entries_without_lines from public.accounting_integrity_report),
'totalDebit',(select total_debit from public.accounting_integrity_report),
'totalCredit',(select total_credit from public.accounting_integrity_report),
'approvedBatchesWithoutJournal',(select count(*) from public.daily_report_batches b where b.status='approved' and (exists(select 1 from public.daily_report_sales_lines s where s.batch_id=b.id) or exists(select 1 from public.daily_report_cash_movements c where c.batch_id=b.id and c.is_customer_collection=true)) and not exists(select 1 from public.journal_entries j where j.source_batch_id=b.id)),
'reversedEntriesWithoutPostedReversal',(select count(*) from public.journal_entries e where e.status='reversed' and not exists(select 1 from public.journal_entries r where r.reversal_of=e.id and r.status='posted'))),
'counts',json_build_object(
'customers',(select count(*) from public.customers),
'employees',(select count(*) from public.employees),
'vehicles',(select count(*) from public.vehicles),
'appUsers',(select count(*) from public.app_users),
'salesOrders',(select count(*) from public.sales_orders),
'collectionEvents',(select count(*) from public.collection_events),
'maintenanceOrders',(select count(*) from public.maintenance_orders),
'dailySalesLines',(select count(*) from public.daily_report_sales_lines),
'dailyCashMovements',(select count(*) from public.daily_report_cash_movements),
'imports',(select count(*) from public.imports),
'auditLog',(select count(*) from public.audit_log))
)::text;`));
if(Number(state.currentVersion)!==23)fail('TARGET_VERSION_NOT_REACHED','Production did not reach schema version 23.',{currentVersion:Number(state.currentVersion)});
const versions=(state.versions||[]).map(Number);if([16,17,18,19,20,21,22,23].some(version=>!versions.includes(version)))fail('MIGRATION_HISTORY_INCOMPLETE','Migration history is incomplete.',{versions});
const missing=Object.entries(state.objects||{}).filter(([,value])=>!value).map(([name])=>name);if(missing.length)fail('DATABASE_OBJECTS_MISSING','Required schema-23 objects are missing.',{missing});
if(Number(state.accounting?.unbalanced||0)!==0||Number(state.accounting?.entriesWithoutLines||0)!==0||Number(state.accounting?.approvedBatchesWithoutJournal||0)!==0||Number(state.accounting?.reversedEntriesWithoutPostedReversal||0)!==0||Number(state.accounting?.totalDebit||0)!==Number(state.accounting?.totalCredit||0))fail('ACCOUNTING_INTEGRITY_FAILED','Accounting entries are missing, incomplete or unbalanced.',{accounting:state.accounting});
const changed=Object.keys(preflight.counts||{}).filter(key=>Number(preflight.counts[key])!==Number(state.counts?.[key]));
if(changed.some(key=>key!=='auditLog'))fail('PROTECTED_ROW_COUNT_CHANGED','Protected operational row counts changed during schema migration.',{changed,before:preflight.counts,after:state.counts});
const migrationResult={ok:true,code:'SCHEMA_23_APPLIED_AND_VERIFIED',fromVersion:Number(preflight.currentVersion),toVersion:23,appliedMigrations:Array.from({length:Math.max(0,23-Number(preflight.currentVersion))},(_,index)=>Number(preflight.currentVersion)+index+1),transactionAtomic:true,preMigrationBackup:preflight.backup,beforeCounts:preflight.counts,afterCounts:state.counts,verification:state};
writeFileSync(resultPath,`${JSON.stringify(migrationResult,null,2)}\n`,{mode:0o600});console.log(`[governance-verify] SUCCESS ${migrationResult.fromVersion}->23`);
