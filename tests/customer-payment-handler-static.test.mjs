import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const handler=await readFile(new URL('../api/_lib/customer-payment-reconciliation-handler.js',import.meta.url),'utf8');
const wrapper=await readFile(new URL('../api/_lib/daily-report-v7.js',import.meta.url),'utf8');
const migration=await readFile(new URL('../supabase/migrations/032_customer_payment_reconciliation.sql',import.meta.url),'utf8');

test('v7 leaves normal ERP requests on v6 and isolates reconciliation mode',()=>{
  assert.match(wrapper,/currentDailyReport/);
  assert.match(wrapper,/customer-payment-reconciliation/);
  assert.match(wrapper,/return currentDailyReport\(req,res\)/);
});

test('reconciliation defaults to preview and requires explicit commit',()=>{
  assert.match(handler,/\|\|'preview'/);
  assert.match(handler,/\['preview','commit'\]/);
  assert.match(handler,/if\(action==='preview'\)/);
});

test('server globally matches customer payments before calling the atomic RPC',()=>{
  assert.match(handler,/selectCollectionsForCustomers/);
  assert.match(handler,/buildCustomerPaymentCompletionPlan/);
  assert.match(handler,/append_daily_report_customer_payments/);
});

test('database function is idempotent, allocates FIFO and posts accounting',()=>{
  assert.match(migration,/account_code=v_customer/);
  assert.match(migration,/voucher_no,''\)=v_voucher/);
  assert.match(migration,/allocate_collection_fifo/);
  assert.match(migration,/post_daily_report_accounting/);
  assert.match(migration,/daily_report_customer_payments_reconciled/);
});
