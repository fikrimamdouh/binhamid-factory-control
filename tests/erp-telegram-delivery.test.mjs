import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { erpSaleType, erpTelegramRecipients, buildCollectionDeliveryRows } from '../api/_lib/erp-telegram-delivery.js';
import { cumulativeSaleType, projectCumulativeDailyReport } from '../api/_lib/daily-cumulative-report-data.js';

test('ERP concrete sales keep their department across parser variants',()=>{
  const variants=[
    {kind:'خرسانة'},
    {kind:'خرسانه جاهزة'},
    {item:'خرسانة 7 سم'},
    {sales_type:'concrete'},
    {type:'ready mix'}
  ];
  for(const row of variants){assert.equal(erpSaleType(row),'concrete');assert.equal(cumulativeSaleType(row),'concrete');}
  assert.equal(erpSaleType({kind:'بلك'}),'block');
  assert.equal(cumulativeSaleType({item_name:'بلوك 20 سم'}),'block');
});

test('a concrete sale and collection update the concrete projection',()=>{
  const projection=projectCumulativeDailyReport({
    reportDate:'2026-07-25',
    dailySales:[{invoice:'18123',kind:'خرسانه جاهزة',customerCode:'13063',customer:'عميل الخرسانة',item:'خرسانة 20 سم',quantity:10,total_amount:1800}],
    dailyCollections:[{customerCode:'13063',customer:'عميل الخرسانة',amount:800}]
  });
  const row=projection.departments.concrete.rows[0];
  assert.equal(projection.departments.concrete.rows.length,1);
  assert.equal(row.currentSales,1800);
  assert.equal(row.currentApplied,800);
  assert.equal(row.currentAppliedToNew,800);
  assert.equal(row.currentAppliedToOld,0);
  assert.equal(projection.departments.block.rows.length,0);
});

test('collection delivery rows expose customer code and new-old allocation',()=>{
  const projection=projectCumulativeDailyReport({
    reportDate:'2026-07-25',
    storedSales:[{reference_no:'OLD-1',sales_type:'concrete',customer_external_id:'13063',customer_name:'عميل الخرسانة',item:'خرسانة قديمة',quantity:1,total_amount:1000,paid_amount:0,status:'registered',delivery_date:'2026-07-20'}],
    dailySales:[{invoice:'18123',kind:'خرسانة',customerCode:'13063',customer:'عميل الخرسانة',item:'خرسانة جديدة',quantity:10,amount:600}],
    dailyCollections:[{customerCode:'13063',customer:'عميل الخرسانة',amount:800}]
  });
  const rows=buildCollectionDeliveryRows({collections:[{customerCode:'13063',customer:'عميل الخرسانة',amount:800,treasuryCode:'101',treasuryName:'الخزينة الرئيسية'}]},projection);
  assert.equal(rows.length,1);
  assert.equal(rows[0].code,'13063');
  assert.equal(rows[0].concreteApplied,800);
  assert.equal(rows[0].appliedToNew,600);
  assert.equal(rows[0].appliedToOld,200);
  assert.equal(rows[0].outsideInvoices,0);
  assert.equal(rows[0].linked,true);
});

test('automatic Telegram delivery includes the owner and Manea once',()=>{
  assert.deepEqual(erpTelegramRecipients('111','6870312376'),['111','6870312376']);
  assert.deepEqual(erpTelegramRecipients('6870312376','6870312376'),['6870312376']);
});

test('portfolio drafts retain report movements and PDFs use the report date once',async()=>{
  const portfolio=await readFile(new URL('../api/_lib/customer-portfolio-pdf.js',import.meta.url),'utf8');
  const dailyPdf=await readFile(new URL('../api/_lib/daily-cumulative-pdf.js',import.meta.url),'utf8');
  const routePath=['..','api','erp','daily-report.js'].join('/');
  const route=await readFile(new URL(routePath,import.meta.url),'utf8');
  assert.match(portfolio,/activityIndex/);
  assert.match(portfolio,/reportAlreadyCommitted/);
  assert.match(portfolio,/options\?\.currentBatch===true/);
  assert.match(portfolio,/reportSales/);
  assert.match(portfolio,/reportCollections/);
  assert.match(dailyPdf,/currentBatch:options\?\.currentBatch!==false/);
  assert.match(route,/prepareErpSuccessDelivery\(\{analysis,sourceFile:originalName,reportDate\}\)/);
  assert.match(route,/posting\?\.duplicate/);
  assert.match(route,/prepared:preparedTelegram/);
});
