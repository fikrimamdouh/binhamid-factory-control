import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('Telegram exact-print capture cancels stale work instead of blocking the next document',()=>{
  const source=read('assets/telegram-pdf-declarations.js');
  assert.match(source,/v8-runtime-notice-filter/);
  assert.match(source,/if\(captureRequest\)settle\(captureRequest,'reject'/);
  assert.match(source,/requestAnimationFrame\(function\(\)\{requestAnimationFrame/);
  assert.match(source,/زر الطباعة لم يُنشئ ورقة أو معاينة صالحة/);
  assert.doesNotMatch(source,/يوجد مستند آخر قيد التجهيز/);
  assert.match(source,/sending\.has\(key\)/);
});

test('revision conflict recovery downloads backup then replaces local program state cleanly',()=>{
  const source=read('assets/sync-integrity-guard.js');
  assert.match(source,/v4-full-pull-no-print/);
  assert.match(source,/سحب وتنظيف النسخة المحلية/);
  assert.match(source,/function downloadBackup\(\)/);
  assert.match(source,/function cleanProgramLocalState\(\)/);
  assert.match(source,/binhamid_cloud_access_token/);
  assert.match(source,/binhamid_cloud_device_id/);
  assert.match(source,/binhamid_cloud_app_user_id/);
  assert.match(source,/function writePulledState\(data\)/);
  assert.match(source,/remove\('binhamid_cloud_pending'\)/);
  assert.match(source,/binhamid-cloud-state-pulled/);
  assert.doesNotMatch(source,/binhamid_conflict_backup_/);
});

test('boot cache keys point to repaired synchronization and PDF modules',()=>{
  const index=read('index.html');
  assert.match(index,/state-load-performance\.js\?v=20260722-3/);
  assert.match(index,/sync-integrity-guard\.js\?v=20260723-4/);
  assert.match(index,/telegram-pdf-declarations\.js\?v=20260723-8/);
});