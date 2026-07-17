import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const exists=path=>fs.existsSync(new URL(`../${path}`,import.meta.url));

test('automatic device bootstrap grants no business-data capability',()=>{
  const source=read('api/_lib/device-session.js');
  assert.match(source,/DEVICE_CAPABILITIES=Object\.freeze\(\[\]\)/);
  for(const capability of ['state.write','state.read','dashboard.manager','imports.manage','daily_report.import','daily_report.approve','accounting.view'])assert.doesNotMatch(source,new RegExp(capability.replace('.','\\.')));
  assert.match(source,/AUTHENTICATED_USER_REQUIRED/);
});

test('production readiness follows the latest schema constant instead of schema 15 literals',()=>{
  const workflow=read('.github/workflows/production-readiness.yml');
  assert.doesNotMatch(workflow,/directOperationsSchema\)!==15|expected schema 15|schema 15/);
  assert.match(workflow,/EXPECTED_SCHEMA_VERSION:\s*['"]?19/);
});

test('accounting migration provides balanced journals, ledger and trial balance',()=>{
  const path='supabase/migrations/019_accounting_import_and_telegram_integrity.sql';
  assert.equal(exists(path),true,`${path} must exist`);
  const sql=read(path);
  for(const marker of ['chart_of_accounts','journal_entries','journal_entry_lines','general_ledger','trial_balance','post_daily_report_accounting','telegram_update_receipts','transition_import_status'])assert.match(sql,new RegExp(marker));
  assert.match(sql,/debit[^;]*credit|credit[^;]*debit/s);
  assert.match(sql,/migration_history\(version,migration_name\)[\s\S]*19/);
});

test('daily report commit requires a stored original and returns accounting evidence',()=>{
  const source=read('api/_lib/routes/daily-report.js');
  assert.match(source,/importId/);
  assert.match(source,/ORIGINAL_FILE_REQUIRED|النسخة الأصلية/);
  assert.match(source,/journal|accounting/i);
  assert.match(source,/posted_batch_id|postedBatchId/);
});

test('Telegram webhook processing is idempotent and unexpected failures are retryable',()=>{
  const source=read('api/_lib/telegram-webhook-gateway.js');
  assert.match(source,/claim_telegram_update/);
  assert.match(source,/complete_telegram_update/);
  assert.match(source,/fail_telegram_update/);
  assert.doesNotMatch(source,/error_logged:true/);
  assert.match(source,/statusCode\s*=\s*503|json\(res,503/);
});

test('automatic import is disabled and import IDs are passed into daily approval',()=>{
  const review=read('assets/import-review-guard.js');
  const integrity=read('assets/daily-approval-integrity-guard.js');
  assert.match(review,/localStorage\.setItem\(AUTO_KEY,'0'\)/);
  assert.match(review,/الترحيل التلقائي موقوف رقابيًا/);
  assert.match(review,/BinHamidActiveImportId/);
  assert.match(integrity,/payload\.importId=importId/);
  assert.match(integrity,/recoveryDuplicate:true/);
});

test('structured accounting API and page are present',()=>{
  assert.equal(exists('api/_lib/routes/accounting.js'),true);
  assert.equal(exists('accounting.html'),true);
  const router=read('api/router.js');
  const vercel=read('vercel.json');
  assert.match(router,/accounting/);
  assert.match(vercel,/api\/accounting/);
});
