import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('accounting reports never convert source failures into empty balanced data',async()=>{
  const source=await read('api/_lib/bot-accounting.js');
  assert.match(source,/async function requiredSelect\(/);
  assert.match(source,/ACCOUNTING_SOURCE_UNAVAILABLE/);
  assert.match(source,/لم يتم حفظ أو اعتماد أي أرقام/);
  assert.match(source,/لم يتم إصدار حكم باتزان الحسابات/);
  assert.doesNotMatch(source,/safeSelect\('trial_balance'/);
  assert.match(source,/requiredSelect\('trial_balance'/);
  assert.match(source,/requiredSelect\('journal_entries'/);
  assert.match(source,/requiredSelect\('accounting_integrity_report'/);
  assert.match(source,/requiredSelect\('general_ledger'/);
});

test('accounting source failures expose retry controls and a trace reference',async()=>{
  const source=await read('api/_lib/bot-accounting.js');
  assert.match(source,/sourceReference/);
  assert.match(source,/telegram accounting unavailable/);
  assert.match(source,/إعادة المحاولة/);
  assert.match(source,/فتح مركز المحاسبة/);
  assert.match(source,/retryCallback/);
});
