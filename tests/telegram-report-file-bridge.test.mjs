import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseStoredReportRequest, storedReportMatches } from '../api/_lib/bot-report-files.js';
import { reportKeyboard } from '../api/_lib/bot-reports.js';

const read=parts=>fs.readFileSync(new URL(parts.join('/'),import.meta.url),'utf8');

test('plain concrete report request resolves to latest concrete file',()=>{
  assert.deepEqual(parseStoredReportRequest('تقرير خرسانة'),{kind:'concrete'});
  assert.deepEqual(parseStoredReportRequest('نزّل تقرير البلوك 17/7/2026'),{kind:'block',date:'2026-07-17'});
});

test('report period is normalized and ordered',()=>{
  assert.deepEqual(parseStoredReportRequest('تقارير الخرسانة من 17/7/2026 إلى 1/7/2026'),{kind:'concrete',from:'2026-07-01',to:'2026-07-17'});
});

test('daily report summaries are filtered by requested department',()=>{
  const row={preview_summary:{concreteSales:20175,concreteQuantity:110.5,blockSales:5505,blockQuantity:3100}};
  assert.equal(storedReportMatches(row,'concrete'),true);
  assert.equal(storedReportMatches(row,'block'),true);
  assert.equal(storedReportMatches({preview_summary:{concreteSales:0,blockSales:5505}},'concrete'),false);
});

test('report menu exposes downloadable website files',()=>{
  const values=reportKeyboard().reply_markup.inline_keyboard.flat().map(item=>item.callback_data);
  assert.ok(values.includes('report:concrete_file'));
  assert.ok(values.includes('report:block_file'));
  assert.ok(values.includes('report:daily_file'));
});

test('enterprise webhook routes text and callback file requests',()=>{
  const source=read(['..','api','_lib','telegram-webhook-handler.js']);
  assert.match(source,/handleStoredReportTextCommand/);
  assert.match(source,/action==='reportfile'/);
  assert.match(source,/sendStoredReportRequest\(message\.chat\.id,identity,'concrete'\)/);
  assert.match(source,/sendStoredReportFile/);
});
