import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { erpSaleType, erpTelegramRecipients, buildCollectionDeliveryRows, buildErpDuplicateNoticeText } from '../api/_lib/erp-telegram-delivery.js';
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

test('collection delivery classifies an old customer and settles previous balance first',()=>{
  const analysis={
    sales:[{invoice:'18123',kind:'خرسانة',customerCode:'13063',customer:'عميل الخرسانة',item:'خرسانة جديدة',quantity:10,amount:600}],
    collections:[{customerCode:'13063',customer:'عميل الخرسانة',amount:800,treasuryCode:'101',treasuryName:'الخزينة الرئيسية'}]
  };
  const projection=projectCumulativeDailyReport({
    reportDate:'2026-07-25',
    storedSales:[],
    dailySales:analysis.sales,
    dailyCollections:analysis.collections
  });
  const analytics={rows:[{
    key:'code:13063',code:'13063',externalId:'13063',name:'عميل الخرسانة',
    openingBalance:5000,openingCount:1,grossSales:0,paidApplied:0,unallocatedCredit:0,
    invoiceCount:0,collectionCount:0,aging:{current:0,days1to30:0,days31to60:0,days61to90:0,days90plus:0},sales:[]
  }]};
  const rows=buildCollectionDeliveryRows(analysis,projection,analytics,'2026-07-25');
  assert.equal(rows.length,1);
  assert.equal(rows[0].code,'13063');
  assert.equal(rows[0].customerClass,'old');
  assert.equal(rows[0].previousBalance,5000);
  assert.equal(rows[0].reportSales,600);
  assert.equal(rows[0].reportCollections,800);
  assert.equal(rows[0].paidCurrent,0);
  assert.equal(rows[0].paidPrevious,800);
  assert.equal(rows[0].finalDebt,4800);
  assert.equal(rows[0].status,'old_paid_previous_with_current_due');
  assert.equal(rows[0].linked,true);
});

test('automatic Telegram delivery includes the owner and Manea once',()=>{
  assert.deepEqual(erpTelegramRecipients('111','6870312376'),['111','6870312376']);
  assert.deepEqual(erpTelegramRecipients('6870312376','6870312376'),['6870312376']);
});

test('upgraded historical report sends an explicit Telegram success notice',()=>{
  const text=buildErpDuplicateNoticeText({
    reportDate:'2026-07-26',
    sourceFile:'26(1).xlsx',
    upgrade:{upgraded:true,salesAdded:1,cashMovementsAdded:3,treasuriesAdded:1,inventoryAdded:1,salesCount:18,cashMovementCount:17,treasuryCount:2,inventoryCount:2}
  });
  assert.match(text,/تم تحديث تقرير ERP القديم بنجاح/);
  assert.match(text,/دون تكرار أي حركة/);
  assert.match(text,/السجلات المستكملة: <b>6<\/b>/);
  assert.match(text,/الفواتير: <b>18<\/b>/);
  assert.match(text,/الحركات المالية: <b>17<\/b>/);
});

test('portfolio preparation uses dated analytics and persists fixed snapshots after posting',async()=>{
  const portfolio=await readFile(new URL('../api/_lib/customer-portfolio-pdf.js',import.meta.url),'utf8');
  const delivery=await readFile(new URL('../api/_lib/erp-telegram-delivery.js',import.meta.url),'utf8');
  const dailyPdf=await readFile(new URL('../api/_lib/daily-cumulative-pdf.js',import.meta.url),'utf8');
  const route=await readFile(new URL('../api/_lib/daily-report-v4.js',import.meta.url),'utf8');
  assert.match(portfolio,/beforeDate:reportDate/);
  assert.match(portfolio,/buildReportActivityIndex/);
  assert.match(portfolio,/persistPortfolioReportSnapshot/);
  assert.match(delivery,/loadCustomerAnalytics\(\{active:true,role:'admin'\},\{asOf:reportDate,beforeDate:reportDate\}\)/);
  assert.match(delivery,/persistPortfolioReportSnapshot\(report\)/);
  assert.match(dailyPdf,/currentBatch:options\?\.currentBatch!==false/);
  assert.match(route,/prepareErpSuccessDelivery\(\{analysis,sourceFile:originalName,reportDate\}\)/);
  assert.match(route,/sendErpDuplicateNotice/);
  assert.match(route,/posting:result\.posting,prepared/);
});
