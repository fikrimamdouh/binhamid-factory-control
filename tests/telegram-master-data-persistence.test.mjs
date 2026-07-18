import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('Telegram sales orders persist to the canonical sales_orders table and retain audit history',async()=>{
  const source=await read('api/_lib/bot-sales.js');
  assert.match(source,/upsert\('sales_orders'/);
  assert.match(source,/persistSalesOrder\(draft,message,identity\)/);
  assert.match(source,/loadSalesRows/);
  assert.match(source,/syncLegacyOrders/);
  assert.match(source,/تم تسجيل أمر البيع رسميًا في جدول المبيعات والموقع/);
});

test('test sales order cleanup is admin-only and cannot delete invoiced or collected orders',async()=>{
  const source=await read('api/_lib/bot-sales.js');
  assert.match(source,/PROTECTED_DELETE=new Set\(\['invoiced','collected'\]\)/);
  assert.match(source,/identity\.role!=='admin'/);
  assert.match(source,/remove\('sales_orders'/);
  assert.match(source,/remove\('operational_records'/);
  assert.match(source,/حذف أمر بيع تجريبي/);
});

test('customer creation writes to the customer master and requires explicit confirmation',async()=>{
  const source=await read('api/_lib/bot-customer-reports.js');
  assert.match(source,/enterprise_customer_create_confirm/);
  assert.match(source,/insert\('customers'/);
  assert.match(source,/action:'customer_created'/);
  assert.match(source,/تم إنشاء العميل في سجل الموقع/);
});

test('active Telegram users synchronize to employee master records',async()=>{
  const source=await read('api/_lib/bot-webhook-core.js');
  assert.match(source,/syncEmployeeMaster/);
  assert.match(source,/upsert\('employees'/);
  assert.match(source,/identity\.role==='admin'/);
});

test('expired Telegram callback acknowledgements do not fail the business action',async()=>{
  const source=await read('api/_lib/telegram.js');
  assert.match(source,/query is too old\|response timeout expired\|query ID is invalid/);
  assert.match(source,/telegram callback expired/);
  assert.match(source,/return null/);
});
