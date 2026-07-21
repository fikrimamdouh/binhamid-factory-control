import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('Telegram sales routing blocks invoice and collection claims without official posting',async()=>{
  const [guard,handler]=await Promise.all([
    read('api/_lib/bot-sales-accounting-guard.js'),
    read('api/_lib/telegram-webhook-handler.js')
  ]);
  assert.match(handler,/from '\.\/bot-sales-accounting-guard\.js'/);
  assert.match(guard,/session\?\.state==='sales_update_order'/);
  for(const phrase of ['تم التحصيل','سدد بالكامل','صدر.*فاتور','تم اصدار الفاتور'])assert.match(guard,new RegExp(phrase));
  assert.match(guard,/لم تتغير حالة أمر البيع/);
  assert.match(guard,/لا يوجد حفظ مالي ولا قيد ولا تحصيل مسجل/);
  assert.match(guard,/التقرير اليومي أو شاشة الاعتماد/);
});

test('sales accounting guard preserves non-financial sales operations',async()=>{
  const guard=await read('api/_lib/bot-sales-accounting-guard.js');
  assert.match(guard,/return continueSalesSessionBase\(message,identity,session,text\)/);
  assert.match(guard,/return handleSalesTextCommandBase\(message,identity,text\)/);
  for(const name of ['startSalesAction','confirmSalesOrder','cancelSalesDraft','showSalesMenu'])assert.match(guard,new RegExp(name));
  assert.match(guard,/callback_data:'sales:open'/);
  assert.match(guard,/callback_data:'ent:accounting_menu'/);
});
