import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('critical financial and sales sources cannot fall back to empty data',async()=>{
  const files=['api/_lib/bot-costs-data.js','api/_lib/cost-engine.js','api/_lib/mix-design-costing.js','api/_lib/bot-sales.js'];
  for(const path of files){
    const source=await read(path);
    assert.doesNotMatch(source,/\.catch\(\(\)=>\[\]\)/,`${path} still returns an empty list after a read failure`);
    assert.match(source,/requiredSelect/,`${path} must use mandatory reads`);
  }
});

test('mandatory read errors include operation, save state, retry and reference metadata',async()=>{
  const source=await read('api/_lib/required-data.js');
  for(const marker of ['status:503','operation:','saved:false','retryable:true','reference','لم يتم إصدار نتيجة ناقصة'])assert.match(source,new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});

test('sales legacy migration cannot silently omit failed orders',async()=>{
  const source=await read('api/_lib/bot-sales.js');
  assert.match(source,/SALES_LEGACY_SYNC_FAILED/);
  assert.match(source,/لم يصدر التقرير لتجنب عرض قائمة ناقصة/);
  assert.doesNotMatch(source,/loadOrderEvents\(reference\)\.catch\(\(\)=>\[\]\)/);
  assert.doesNotMatch(source,/persistSalesOrder[\s\S]{0,260}\.catch\(error=>console\.warn/);
});

test('bot permissions fail closed and fleet menu makes no GPS tracking claim',async()=>{
  const source=await read('api/_lib/bot-menu-permissions.js');
  assert.match(source,/BOT_CAPABILITIES_READ_FAILED/);
  assert.match(source,/حالة الأسطول من الحضور/);
  assert.doesNotMatch(source,/label:'حالة الأسطول وGPS'/);
  assert.doesNotMatch(source,/user_capabilities[\s\S]{0,180}\.catch\(\(\)=>\[\]\)/);
});

test('Telegram print capture is event driven and never waits on a fixed document timer',async()=>{
  const source=await read('assets/telegram-pdf-declarations.js');
  const capture=source.match(/function captureByClick[\s\S]*?window\.addEventListener\('pagehide'/)?.[0]||'';
  assert.match(capture,/captureRequest=/);
  assert.doesNotMatch(capture,/setTimeout|7000/);
  assert.match(source,/bhCancelPrintedButtonCapture/);
  assert.match(source,/document-ready/);
});

test('Excel imports reject unsafe files and show quality counts before approval',async()=>{
  const guard=await read('assets/import-file-validation.js'),index=await read('index.html'),existing=await read('assets/existing-daily-import-fix.js');
  for(const marker of ['ALLOWED_EXT','file.size','MAX_BYTES','الملف فارغ','لم يتم حذف أو استبدال أي بيانات سابقة','SHA-256','المقبول','المرفوض','المكرر','الناقص','لم تُحفظ أي بيانات بعد'])assert.match(guard,new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(guard,/quality\.accepted<=0/);
  assert.match(index,/import-file-validation\.js\?v=20260722-1/);
  assert.match(existing,/sourceFileFingerprint/);
  assert.match(existing,/duplicateBatch\(hash,reportDate\)/);
});

test('placeholder sales representatives are permanently deleted and never initialized again',async()=>{
  const source=await read('assets/default-sales-reps.js');
  assert.match(source,/permanent_delete_employee/);
  assert.match(source,/حذف نهائي لسجل موظف افتراضي/);
  assert.match(source,/مسؤول مبيعات البلوك/);
  assert.match(source,/مسؤول مبيعات الخرسانة/);
  assert.doesNotMatch(source,/D\.emp\.push/);
  assert.doesNotMatch(source,/PLACEHOLDERS/);
});

test('critical HTML tables escape database supplied text',async()=>{
  const attendance=await read('attendance-admin.html');
  for(const value of ['x.code','x.name','x.address','x.app_users?.full_name','x.work_sites?.name','x.event_type','x.odometer','x.fuel_liters','x.fuel_amount'])assert.ok(attendance.includes(`esc(${value}`),`attendance-admin must escape ${value}`);
  const accounting=await read('accounting.html');
  for(const value of ['r.account_code','r.account_name_ar','r.customer_external_id','e.source_type','e.description','l.customer_external_id'])assert.ok(accounting.includes(`esc(${value}`),`accounting must escape ${value}`);
  const roles=await read('assets/cloud-user-roles.js');
  for(const value of ['item.icon','item.label','group','error.message'])assert.ok(roles.includes(`esc(${value}`),`role UI must escape ${value}`);
});