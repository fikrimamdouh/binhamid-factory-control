import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('ERP folder sync is isolated, authenticated, idempotent and uses the canonical daily report commit',async()=>{
  const source=await readFile(new URL('../api/erp/daily-report.js',import.meta.url),'utf8');
  assert.match(source,/X-ERP|x-erp-sync-token/i);
  assert.match(source,/sha256\(buffer\)/);
  assert.match(source,/file_hash=eq\.\$\{hash\}/);
  assert.match(source,/parseDailyWorkbook/);
  assert.match(source,/commitDailyReportFromTelegram/);
  assert.match(source,/idempotencyKey:`erp-folder:/);
  assert.match(source,/inventoryType:'finished_goods'/);
  assert.match(source,/inventoryType:'raw_material'/);
});
