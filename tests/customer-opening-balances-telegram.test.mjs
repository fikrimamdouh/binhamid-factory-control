import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildCustomerAnalytics, findCustomers } from '../api/_lib/bot-customer-report-data.js';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('opening balances are combined with later customer movements without aging the imported balance',()=>{
  const analytics=buildCustomerAnalytics({
    role:'admin',asOf:new Date('2026-07-19T00:00:00Z'),
    customers:[
      {external_id:'A',customer_code:'10001',customer_name:'عميل مدين',segment:'الاثنين',credit_limit:1000,payment_days:30},
      {external_id:'B',customer_code:'10002',customer_name:'عميل دائن',segment:'الاثنين'}
    ],
    openingBalances:[
      {clientId:'A',customerCode:'10001',amount:1500,date:'2026-07-19',cheques:20,previous:0,debit:3000,credit:1500},
      {clientId:'B',customerCode:'10002',amount:-400,date:'2026-07-19'}
    ],
    sales:[{reference_no:'S1',sales_type:'block',customer_external_id:'A',customer_name:'عميل مدين',total_amount:500,paid_amount:0,status:'registered',delivery_date:'2026-07-19'}],
    collections:[]
  });
  const debit=findCustomers(analytics,'10001')[0],credit=findCustomers(analytics,'عميل دائن')[0];
  assert.equal(debit.openingBalance,1500);
  assert.equal(debit.netBalance,2000);
  assert.equal(debit.unagedOpening,1500);
  assert.equal(debit.aging.current,500);
  assert.equal(credit.creditBalance,400);
  assert.equal(analytics.totals.openingDebit,1500);
  assert.equal(analytics.totals.openingCredit,400);
  assert.equal(analytics.totals.openingCheques,20);
  assert.equal(analytics.totals.debitBalance,2000);
  assert.equal(analytics.totals.creditBalance,400);
  assert.equal(analytics.totals.noMovement,1);
});

test('legacy customer trial-balance export is recognized without changing its headers',async()=>{
  const source=await read('assets/customer-opening-balances.js');
  for(const marker of ["format:'legacy_trial_balance'","exactHeaderIndex(header,['العميل'])","name:explicitName>=0?explicitName:customer+1","exactHeaderIndex(header,['ما قبله'","exactHeaderIndex(header,['مدين'])","exactHeaderIndex(header,['دائن'])","exactHeaderIndex(header,['الشيكات','شيكات'])","cellDates:true","raw:true",'sourceHash','openingBalanceCheques'])assert.ok(source.includes(marker),`missing ${marker}`);
  assert.match(source,/previous\+debit-credit/);
  assert.match(source,/Math\.abs\(difference\)>0\.01/);
  assert.match(source,/الأرصدة الافتتاحية لا تدخل أعمار الديون/);
});

test('Telegram exposes executive customer reporting, balance lookup and amount filters',async()=>{
  const [reports,data,index]=await Promise.all([read('api/_lib/bot-customer-reports.js'),read('api/_lib/bot-customer-report-data.js'),read('index.html')]);
  for(const marker of ['customer_credit','customer_concentration','customer_no_movement','customer_zero','الملخص التنفيذي للعملاء','تحليل تركيز المديونية','كشف حساب العميل','عملاء أكبر من 50000','كشف حساب مؤسسة بن حامد'])assert.ok(reports.includes(marker),`missing ${marker}`);
  assert.match(reports,/رصيد\(\?: العميل\)\?/);
  assert.match(reports,/عملاء\\s\+بين/);
  assert.match(reports,/أكبر\\s\+\(10\|20\|50\)/);
  for(const marker of ["select('app_state'","payload?.ops?.customerOpeningBalances",'openingBalances:openingRows(payload)','openingDebit','openingCredit','netBalance','debitBalance','creditBalance'])assert.ok(data.includes(marker),`missing ${marker}`);
  assert.match(index,/customer-opening-balances\.js\?v=20260719-2/);
});
