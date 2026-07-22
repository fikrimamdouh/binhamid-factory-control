import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('Telegram exact-print capture cancels stale work instead of blocking the next document',()=>{
  const source=read('assets/telegram-pdf-declarations.js');
  assert.match(source,/v7-stale-lock-release/);
  assert.match(source,/if\(captureRequest\)settle\(captureRequest,'reject'/);
  assert.match(source,/requestAnimationFrame\(function\(\)\{requestAnimationFrame/);
  assert.match(source,/زر الطباعة لم يُنشئ ورقة جديدة/);
  assert.doesNotMatch(source,/يوجد مستند آخر قيد التجهيز/);
  assert.match(source,/sending\.has\(key\)/);
});

test('revision conflict message provides a safe pull button and local backup',()=>{
  const source=read('assets/sync-integrity-guard.js');
  assert.match(source,/سحب النسخة الحديثة بأمان/);
  assert.match(source,/binhamid_conflict_backup_/);
  assert.match(source,/reason:'revision-conflict-before-cloud-pull'/);
  assert.match(source,/previousFetch\('\/api\/state'/);
  assert.match(source,/remove\(CONFLICT_KEY\)/);
  assert.match(source,/binhamid-cloud-state-pulled/);
  assert.match(source,/لا تضغط «مزامنة الآن»/);
});

test('boot cache keys point to repaired synchronization and PDF modules',()=>{
  const index=read('index.html');
  assert.match(index,/sync-integrity-guard\.js\?v=20260722-2/);
  assert.match(index,/telegram-pdf-declarations\.js\?v=20260722-7/);
});
