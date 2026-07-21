import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const asset=fs.readFileSync(new URL('../assets/final-ui-consistency.js',import.meta.url),'utf8');
const route=fs.readFileSync(new URL('../api/_lib/routes/attendance-safe.js',import.meta.url),'utf8');
const router=fs.readFileSync(new URL('../api/router.js',import.meta.url),'utf8');
const index=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('exact Telegram button reuses the print button result',()=>{
  assert.match(asset,/طباعة\\s\*النموذج/);
  assert.match(asset,/window\.print=function\(\)\{\}/);
  assert.match(asset,/printButton\.click\(\)/);
  assert.match(asset,/bhSendSheetToTelegram/);
});

test('opening balances are injected into the active ledger and customer table',()=>{
  assert.match(asset,/customerOpeningBalances/);
  assert.match(asset,/openingBalance:opening/);
  assert.match(asset,/patchCustomerTable/);
  assert.match(asset,/OPS\.customerOpeningBalances=rows/);
  assert.match(asset,/client&&client\.openingBalance/);
});

test('employee attendance GET uses a degraded central route instead of the failing optional endpoint',()=>{
  assert.match(asset,/route=attendance-safe/);
  assert.match(route,/safeSelect/);
  assert.match(route,/degraded:warnings\.length>0/);
  assert.match(router,/'attendance-safe':attendanceSafe\.attendanceSafe/);
  assert.match(index,/final-ui-consistency\.js/);
});
