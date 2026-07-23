import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import {
  classifyDailyReportCommitError,
  mergeInventorySnapshots
} from '../api/_lib/routes/daily-report.js';

test('inventory movements from the same workbook row become one truthful snapshot',()=>{
  const rows=mergeInventorySnapshots([
    {sourceRowNo:22,inventoryType:'raw_material',itemCode:'10020006',itemName:'بلك أسود',unit:'بلوكه',opening:-7362,received:10400,issued:0,closing:1353},
    {sourceRowNo:22,inventoryType:'finished_goods',itemCode:'10020006',itemName:'بلك أسود',unit:'بلوكه',opening:-7362,received:0,issued:1685,closing:1353}
  ]);
  assert.deepEqual(rows,[{
    sourceRowNo:22,
    inventoryType:'finished_goods',
    itemCode:'10020006',
    itemName:'بلك أسود',
    unit:'بلوكه',
    opening:-7362,
    received:10400,
    issued:1685,
    closing:1353
  }]);
});

test('daily report commit errors expose safe actionable codes without database details',()=>{
  const closed=classifyDailyReportCommitError(Object.assign(new Error('FINANCIAL_PERIOD_CLOSED:secret'),{status:502,upstreamStatus:400}));
  assert.equal(closed.status,409);
  assert.equal(closed.code,'DAILY_REPORT_FINANCIAL_PERIOD_CLOSED');
  assert.doesNotMatch(closed.message,/secret/);

  const duplicate=classifyDailyReportCommitError(Object.assign(new Error('duplicate key violates unique constraint private_name'),{status:502,upstreamStatus:409}));
  assert.equal(duplicate.status,409);
  assert.equal(duplicate.code,'DAILY_REPORT_REFERENCE_CONFLICT');
  assert.doesNotMatch(duplicate.message,/private_name/);

  const generic=classifyDailyReportCommitError(Object.assign(new Error('private database detail'),{status:502,upstreamStatus:400}));
  assert.equal(generic.status,502);
  assert.equal(generic.code,'DAILY_REPORT_DATABASE_COMMIT_FAILED');
  assert.doesNotMatch(generic.message,/private database detail/);
});

test('storage uploads and atomic acceptance retry only retry-safe operations',async()=>{
  const [supabase,daily]=await Promise.all([
    fs.readFile(new URL('../api/_lib/supabase.js',import.meta.url),'utf8'),
    fs.readFile(new URL('../api/_lib/routes/daily-report.js',import.meta.url),'utf8')
  ]);
  assert.match(supabase,/x-upsert': 'true'/);
  assert.match(supabase,/uploadWithRetry/);
  assert.match(supabase,/storageTransient/);
  assert.match(daily,/commitAcceptance/);
  assert.match(daily,/upstreamStatus===429\|\|upstreamStatus>=500/);
  assert.match(daily,/classifyDailyReportCommitError\(error,'storage'\)/);
  assert.match(daily,/classifyDailyReportCommitError\(error,'database'\)/);
});
