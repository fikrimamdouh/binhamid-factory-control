import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('ERP folder sync is isolated, authenticated, idempotent and uses the canonical daily report commit',async()=>{
  const routePath=['..','api','erp','daily-report.js'].join('/');
  const source=await readFile(new URL(routePath,import.meta.url),'utf8');
  assert.match(source,/X-ERP|x-erp-sync-token/i);
  assert.match(source,/sha256\(buffer\)/);
  assert.match(source,/file_hash=eq\.\$\{hash\}/);
  assert.match(source,/parseDailyWorkbook/);
  assert.match(source,/commitDailyReportFromTelegram/);
  assert.match(source,/idempotencyKey:`erp-folder:/);
  assert.match(source,/inventoryType:'finished_goods'/);
  assert.match(source,/inventoryType:'raw_material'/);
});

test('ERP folder sync accepts a workbook when the dedicated parser found daily sections even if generic classification missed it',async()=>{
  const routePath=['..','api','erp','daily-report.js'].join('/');
  const source=await readFile(new URL(routePath,import.meta.url),'utf8');
  assert.match(source,/export function dailyParserEvidence/);
  assert.match(source,/Object\.values\(counts\)\.some\(value=>value>0\)/);
  assert.match(source,/if\(evidence\.recognized\)return\{reportType:/);
  assert.match(source,/classification=resolveDailyReportType/);
  assert.match(source,/source:\{kind:'erp-folder'.*classification/s);
});
