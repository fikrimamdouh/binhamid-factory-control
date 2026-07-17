import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const exists=path=>fs.existsSync(new URL(`../${path}`,import.meta.url));

test('automatic device sessions are read-only and cannot approve or write',()=>{
  const source=read('api/_lib/device-session.js');
  assert.doesNotMatch(source,/DEVICE_CAPABILITIES[^;]*state\.write/s);
  assert.doesNotMatch(source,/DEVICE_CAPABILITIES[^;]*daily_report\.import/s);
  assert.doesNotMatch(source,/DEVICE_CAPABILITIES[^;]*daily_report\.approve/s);
  assert.match(source,/state\.read/);
  assert.match(source,/daily_report\.view/);
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

test('automatic import does not mark a file applied before successful processing and is opt-in',()=>{
  const source=read('assets/cloud-control.js');
  const call=source.indexOf('bhCloudApplyImport');
  const mark=source.indexOf('bhMarkApplied',call);
  assert.ok(call>=0&&mark>call,'file must be marked only after successful apply');
  assert.match(source,/getItem\(AIK\)!==['"]1['"]|getItem\(AIK\)===['"]1['"]/);
});

test('structured accounting API and page are present',()=>{
  assert.equal(exists('api/_lib/routes/accounting.js'),true);
  assert.equal(exists('accounting.html'),true);
  const router=read('api/router.js');
  const vercel=read('vercel.json');
  assert.match(router,/accounting/);
  assert.match(vercel,/api\/accounting/);
});
