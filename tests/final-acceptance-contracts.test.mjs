import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const exists=path=>fs.existsSync(new URL(`../${path}`,import.meta.url));

test('automatic device bootstrap grants no business-data capability',()=>{
  const source=read('api/_lib/device-session.js');
  assert.match(source,/DEVICE_CAPABILITIES=Object\.freeze\(\[\]\)/);
  for(const capability of ['state.write','state.read','dashboard.manager','imports.manage','daily_report.import','daily_report.approve','accounting.view'])assert.doesNotMatch(source,new RegExp(capability.replace('.','\\.')));
  assert.match(source,/DEVICE_CAPABILITY_REQUIRED/);
});

test('production readiness follows schema 25, six functions and manual migration confirmation',()=>{
  const workflow=read('.github/workflows/production-readiness.yml'),migrations=read('.github/workflows/apply-pending-migrations.yml'),preflight=read('scripts/governance-migration-preflight.mjs'),verify=read('scripts/governance-migration-verify.mjs'),runtime=read('api/_lib/routes/system-runtime.js');
  assert.doesNotMatch(workflow,/directOperationsSchema\)!==15|expected schema 15|schema 15/);
  for(const marker of ['report.directOperationsSchema===25','const expectedFunctionCount=6','Number(report.vercelFunctionsExpected)!==expectedFunctionCount','functions=${report.vercelFunctionsExpected||0}','report.unifiedOperationEngine!==true'])assert.ok(workflow.includes(marker),`production readiness missing ${marker}`);
  for(const marker of ['LATEST_REQUIRED_VERSION=25','directOperationsSchema:25','vercelFunctionsExpected:6'])assert.ok(runtime.includes(marker),`runtime missing ${marker}`);
  for(const marker of ['025_unified_operation_engine.sql',"ISOLATED_MIGRATION_TARGET: '25'",'$(seq $((current_version + 1)) 25)','EXPECTED_SCHEMA_VERSION=25','APPLY_SCHEMA_25','maintenance_window_confirmed','Confirm protected maintenance window'])assert.ok(migrations.includes(marker),`migration workflow missing ${marker}`);
  assert.doesNotMatch(migrations,/\n  push:/);
  assert.match(preflight,/targetVersion=25/);assert.match(verify,/targetVersion=25/);
  for(const marker of ['operationEvents','operationIdempotencyColumn','operationLifecycleColumn','outboxDedupeColumn','executeOperationFunction','transitionOperationFunction'])assert.match(verify,new RegExp(marker));
});

test('accounting migrations provide balanced journals, ledger, reversal and trial balance',()=>{
  const files=['supabase/migrations/019_accounting_import_and_telegram_integrity.sql','supabase/migrations/020_accounting_reversal_and_projection_safety.sql','supabase/migrations/021_reversal_ledger_balance_fix.sql'];for(const file of files)assert.equal(exists(file),true,`${file} must exist`);const sql=files.map(read).join('\n');for(const marker of ['chart_of_accounts','journal_entries','journal_entry_lines','general_ledger','trial_balance','post_daily_report_accounting','reverse_journal_entry','telegram_update_receipts','transition_import_status'])assert.match(sql,new RegExp(marker));assert.match(sql,/debit[^;]*credit|credit[^;]*debit/s);assert.match(sql,/migration_history\(version,migration_name\)[\s\S]*21/);
});

test('unified operation migration provides atomic identity, lifecycle, event history and outbox',()=>{
  const sql=read('supabase/migrations/025_unified_operation_engine.sql');
  for(const marker of ['operational_records_idempotency_uidx','pg_advisory_xact_lock','operation_events','notification_outbox_dedupe_uidx','execute_unified_operation','transition_unified_operation','operation_transition_allowed','queue_operation_notifications'])assert.match(sql,new RegExp(marker));
  for(const name of ['execute_unified_operation','transition_unified_operation','queue_operation_notifications'])assert.match(sql,new RegExp(`revoke all on function public\\.${name}[\\s\\S]{0,300}from public,anon,authenticated`));
});

test('daily report commit requires a stored original and returns accounting evidence',()=>{
  const source=read('api/_lib/routes/daily-report.js');assert.match(source,/importId/);assert.match(source,/ORIGINAL_FILE_REQUIRED|النسخة الأصلية/);assert.match(source,/journal|accounting/i);assert.match(source,/posted_batch_id|postedBatchId/);assert.match(source,/commit_daily_report_acceptance/);assert.doesNotMatch(source,/await patch\('daily_report_batches'/);const acceptance=read('supabase/migrations/021_reversal_ledger_balance_fix.sql');assert.match(acceptance,/create or replace function public\.commit_daily_report_acceptance/);assert.match(acceptance,/ACCOUNTING_POSTING_INVALID/);assert.match(acceptance,/transition_import_status\(\s*p_import_id,'posted'/);
});

test('Telegram webhook processing is idempotent and unexpected failures are retryable',()=>{
  const source=read('api/_lib/telegram-webhook-gateway.js');assert.match(source,/claim_telegram_update/);assert.match(source,/complete_telegram_update/);assert.match(source,/fail_telegram_update/);assert.match(source,/claim\?\.status==='completed'/);assert.match(read('api/_lib/telegram-webhook-handler.js'),/if\(req\.telegramGatewayManaged\)return/);assert.doesNotMatch(source,/error_logged:true/);assert.match(source,/statusCode\s*=\s*503|json\(res,503/);
});

test('security-definer acceptance RPCs are not executable by PUBLIC',()=>{
  const sql=['supabase/migrations/019_accounting_import_and_telegram_integrity.sql','supabase/migrations/020_accounting_reversal_and_projection_safety.sql','supabase/migrations/021_reversal_ledger_balance_fix.sql'].map(read).join('\n');for(const name of ['claim_telegram_update','complete_telegram_update','fail_telegram_update','reverse_journal_entry','commit_daily_report_acceptance'])assert.match(sql,new RegExp(`revoke all on function public\\.${name}[\\s\\S]{0,300}from public,anon,authenticated`));assert.match(sql,/grant execute[\s\S]*to service_role/);
});

test('website and Telegram imports coexist while daily approval keeps one import identity',()=>{
  const review=read('assets/import-review-guard.js'),integrity=read('assets/daily-approval-integrity-guard.js');assert.match(review,/dailyWebsiteApproval:true/);assert.match(review,/autoImport:true/);assert.doesNotMatch(review,/localStorage\.setItem\(AUTO_KEY,'0'\)/);assert.doesNotMatch(review,/الترحيل التلقائي موقوف رقابيًا/);assert.match(review,/sessionStorage\.setItem\(ACTIVE_KEY,importId\)/);assert.doesNotMatch(review,/finally\s*\{[\s\S]*removeItem\(ACTIVE_KEY\)/);assert.match(integrity,/payload\.importId=importId/);assert.match(integrity,/clearActiveImport/);assert.match(integrity,/recoveryDuplicate:true/);
});

test('structured accounting API and page are present',()=>{assert.equal(exists('api/_lib/routes/accounting.js'),true);assert.equal(exists('accounting.html'),true);const router=read('api/router.js'),vercel=read('vercel.json');assert.match(router,/accounting/);assert.match(vercel,/api\/accounting/);});

test('isolated final database acceptance requires Schema 25 and tests unified operation idempotency',()=>{
  const source=read('scripts/final-acceptance-database.mjs');assert.match(source,/max\(version\),0\) from public\.migration_history\)<>25/);assert.match(source,/Number\(evidence\.schemaVersion\)!==25/);assert.match(source,/execute_unified_operation/);assert.match(source,/transition_unified_operation/);assert.match(source,/operationSecondDuplicate/);assert.match(source,/operationOutbox/);assert.match(source,/null::uuid/);assert.match(source,/'processing'::text/);assert.match(source,/'posted'::text/);
});
