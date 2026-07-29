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

test('accounting acceptance stays schema 24 while production readiness advances to schema 32',()=>{
  const workflow=read('.github/workflows/production-readiness.yml');
  const accountingMigrations=read('.github/workflows/apply-pending-migrations.yml');
  const masterMigrations=read('.github/workflows/apply-persistent-master-migration.yml');
  const accountingPreflight=read('scripts/governance-migration-preflight.mjs');
  const accountingVerify=read('scripts/governance-migration-verify.mjs');
  const masterPreflight=read('scripts/persistent-master-migration-preflight.mjs');
  const masterVerify=read('scripts/persistent-master-migration-verify.mjs');
  const runtime=read('api/_lib/routes/system-runtime.js');
  assert.doesNotMatch(workflow,/directOperationsSchema\)!==15|expected schema 15|schema 15/);
  assert.match(workflow,/directOperationsSchema\)!==24|directOperationsSchema\)===24|directOperationsSchema===24/);
  assert.match(runtime,/LATEST_REQUIRED_VERSION=32/);
  assert.match(runtime,/directOperationsSchema:24/);
  assert.match(runtime,/erpPaymentReconciliation:true/);
  assert.match(accountingMigrations,/024_employee_nickname_and_financial_command_center\.sql/);
  assert.ok(accountingMigrations.includes("ISOLATED_MIGRATION_TARGET: '24'"));
  assert.ok(accountingMigrations.includes('$(seq $((current_version + 1)) 24)'));
  assert.match(accountingMigrations,/EXPECTED_SCHEMA_VERSION=24/);
  assert.match(accountingPreflight,/targetVersion=24/);
  assert.match(accountingVerify,/targetVersion=24/);
  for(const marker of ['appUsersNickname','employeesNickname','userInvitationsNickname','nicknameSyncTrigger'])assert.match(accountingVerify,new RegExp(marker));
  for(const marker of ['025_customer_opening_balances_table.sql','026_persistent_employee_asset_identity_link.sql',"ISOLATED_MIGRATION_TARGET: '26'",'$(seq $((current_version + 1)) 26)','EXPECTED_SCHEMA_VERSION="$(node -e','persistent-master-migration-verify.mjs','production-db-readiness.mjs'])assert.ok(masterMigrations.includes(marker),`missing ${marker}`);
  assert.match(masterPreflight,/targetVersion=26/);
  assert.match(masterVerify,/targetVersion=26/);
  for(const marker of ['masterImportRuns','employeeAssetDirectory','identityDuplicateControl','identityGuard','assetVehicleSync'])assert.match(masterVerify,new RegExp(marker));
});

test('accounting migrations provide balanced journals, ledger, reversal and trial balance',()=>{
  const files=['supabase/migrations/019_accounting_import_and_telegram_integrity.sql','supabase/migrations/020_accounting_reversal_and_projection_safety.sql','supabase/migrations/021_reversal_ledger_balance_fix.sql'];
  for(const file of files)assert.equal(exists(file),true,`${file} must exist`);
  const sql=files.map(read).join('\n');
  for(const marker of ['chart_of_accounts','journal_entries','journal_entry_lines','general_ledger','trial_balance','post_daily_report_accounting','reverse_journal_entry','telegram_update_receipts','transition_import_status'])assert.match(sql,new RegExp(marker));
  assert.match(sql,/debit[^;]*credit|credit[^;]*debit/s);
  assert.match(sql,/migration_history\(version,migration_name\)[\s\S]*21/);
});

test('daily report commit requires a stored original and returns accounting evidence',()=>{
  const source=read('api/_lib/routes/daily-report.js');
  assert.match(source,/importId/);
  assert.match(source,/ORIGINAL_FILE_REQUIRED|النسخة الأصلية/);
  assert.match(source,/journal|accounting/i);
  assert.match(source,/posted_batch_id|postedBatchId/);
  assert.match(source,/commit_daily_report_acceptance/);
  assert.doesNotMatch(source,/await patch\('daily_report_batches'/);
  const acceptance=read('supabase/migrations/021_reversal_ledger_balance_fix.sql');
  assert.match(acceptance,/create or replace function public\.commit_daily_report_acceptance/);
  assert.match(acceptance,/ACCOUNTING_POSTING_INVALID/);
  assert.match(acceptance,/transition_import_status\(\s*p_import_id,'posted'/);
});

test('Telegram webhook processing is idempotent and unexpected failures are retryable',()=>{
  const source=read('api/_lib/telegram-webhook-gateway.js');
  assert.match(source,/claim_telegram_update/);
  assert.match(source,/complete_telegram_update/);
  assert.match(source,/fail_telegram_update/);
  assert.match(source,/claim\?\.status==='completed'/);
  assert.match(read('api/_lib/telegram-webhook-handler.js'),/if\(req\.telegramGatewayManaged\)return/);
});
