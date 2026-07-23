import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const asset=fs.readFileSync(new URL('../assets/final-ui-consistency.js',import.meta.url),'utf8');
const telegram=fs.readFileSync(new URL('../assets/telegram-pdf-declarations.js',import.meta.url),'utf8');
const apiPath=parts=>new URL('../'+['api',...parts].join('/'),import.meta.url);
const route=fs.readFileSync(apiPath(['_lib','routes','attendance-safe.js']),'utf8');
const router=fs.readFileSync(apiPath(['router.js']),'utf8');
const index=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('Telegram module is the single owner of exact print sending',()=>{
  assert.match(telegram,/captureByClick/);
  assert.match(telegram,/clonePrintSheet/);
  assert.match(telegram,/window\.print=function/);
  assert.match(telegram,/bhSendPrintedButtonToTelegram/);
  assert.doesNotMatch(asset,/bhSendSheetToTelegram|sendExactPrintResult|bhExactTelegram/);
});

test('opening balances are indexed and injected into the active ledger',()=>{
  assert.match(asset,/customerOpeningBalances/);
  assert.match(asset,/openingBalance:opening/);
  assert.match(asset,/patchCustomerTable/);
  assert.match(asset,/ensureBalanceIndex/);
  assert.match(asset,/byClientId:new Map/);
  assert.match(asset,/byCode:new Map/);
});

test('employee attendance GET uses a degraded central route instead of the failing optional endpoint',()=>{
  assert.match(asset,/route=attendance-safe/);
  assert.match(route,/safeSelect/);
  assert.match(route,/degraded:warnings\.length>0/);
  assert.match(router,/'attendance-safe':attendanceSafe\.attendanceSafe/);
});

test('runtime observers are targeted and periodic full-page scans are removed',()=>{
  assert.match(asset,/installTimer/);
  assert.match(asset,/function scheduleInstall/);
  assert.doesNotMatch(asset,/setInterval/);
  assert.match(index,/final-ui-consistency\.js\?v=20260721-4/);
  assert.match(index,/telegram-pdf-declarations\.js\?v=20260723-9/);
  assert.match(index,/import-file-validation\.js\?v=20260723-parser-overlap-1/);
});
