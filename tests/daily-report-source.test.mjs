import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('daily report approval is cloud-first and blocks offline approval',async()=>{
  const source=await read('assets/daily-report-source-of-truth.js');
  assert.match(source,/\/api\/daily-report/);
  assert.match(source,/action:'preview'/);
  assert.match(source,/action:'commit'/);
  assert.match(source,/تعذر الاتصال بالخادم\. لم يعتمد التقرير ولم تُرحّل أي حركة/);
  assert.ok(source.indexOf('await cloudApprove(context,reportDate)')<source.indexOf('await onSave.apply'));
  assert.match(source,/cloudImportId/);
});

test('source-of-truth guard is injected outside legacy.html',async()=>{
  const index=await read('index.html'),legacy=await read('legacy.html');
  assert.match(index,/daily-report-source-of-truth\.js/);
  assert.doesNotMatch(legacy,/daily-report-source-of-truth\.js/);
});

test('canonical API enforces preview, capability checks and atomic RPC commit',async()=>{
  const route=await read('api/_lib/routes/daily-report.js');
  assert.match(route,/daily_report\.approve/);
  assert.match(route,/daily_report\.import/);
  assert.match(route,/commit_daily_report/);
  assert.match(route,/register_daily_report_attempt/);
  assert.match(route,/DUPLICATE_INVOICE/);
  assert.match(route,/COLLECTION_EXCEEDS_BALANCE/);
  assert.match(route,/RECONCILIATION_DIFFERENCE/);
});
