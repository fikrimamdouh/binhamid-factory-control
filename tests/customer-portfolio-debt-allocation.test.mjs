import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { projectCumulativeDailyReport } from '../api/_lib/daily-cumulative-report-data.js';
import { buildReportActivityIndex, settleCustomerAccount } from '../api/_lib/customer-settlement.js';
import { removeRepeatedPaymentTerms } from '../api/_lib/customer-portfolio-document.js';

test('collections settle older invoices before current report invoices',()=>{
  const report=projectCumulativeDailyReport({
    reportDate:'2026-07-26',
    storedSales:[{reference_no:'OLD-1',sales_type:'concrete',customer_external_id:'1001',customer_name:'عميل اختبار',item:'خرسانة قديمة',quantity:1,total_amount:100,paid_amount:0,status:'registered',delivery_date:'2026-07-20'}],
    dailySales:[{invoice:'NEW-1',kind:'خرسانة',customerCode:'1001',customer:'عميل اختبار',item:'خرسانة جديدة',quantity:1,amount:60}],
    dailyCollections:[{customerCode:'1001',customer:'عميل اختبار',amount:80}]
  });
  const row=report.departments.concrete.rows[0];
  assert.equal(row.currentSales,60);
  assert.equal(row.currentApplied,80);
  assert.equal(row.currentAppliedToOld,80);
  assert.equal(row.currentAppliedToNew,0);
  assert.equal(row.invoices[0].outstanding,60);
  assert.equal(row.closingBalance,80);
});

test('old customer payment reduces previous balance before report purchases',()=>{
  const result=settleCustomerAccount({openingBalance:5000,openingCount:1,grossSales:0,paidApplied:0,unallocatedCredit:0,aging:{}},{code:'1054',name:'مقهى مون بكس',sales:2000,collections:3500,lastSale:'2026-07-27',lastCollection:'2026-07-27'});
  assert.equal(result.customerClass,'old');
  assert.equal(result.previousBalance,5000);
  assert.equal(result.paidCurrent,0);
  assert.equal(result.paidPrevious,3500);
  assert.equal(result.remainingCurrent,2000);
  assert.equal(result.remainingOpening,1500);
  assert.equal(result.finalDebt,3500);
  assert.equal(result.status,'old_paid_previous_with_current_due');
});

test('new customer is distinguished and can be fully paid',()=>{
  const result=settleCustomerAccount({openingBalance:0,openingCount:0,grossSales:0,invoiceCount:0,collectionCount:0,aging:{}},{code:'NEW-1',name:'عميل جديد',sales:1200,collections:1200});
  assert.equal(result.customerClass,'new');
  assert.equal(result.status,'new_paid_full');
  assert.equal(result.finalDebt,0);
  assert.equal(result.finalAdvance,0);
});

test('item description controls sector while a declared mismatch is flagged',()=>{
  const analysis={sales:[{invoice:'A1',kind:'خرسانة',item:'بلوك 20',customerCode:'1',customer:'عميل',amount:100},{invoice:'A1',kind:'خرسانة',item:'خرسانة',customerCode:'1',customer:'عميل',amount:100}],collections:[]};
  const concrete=buildReportActivityIndex(analysis,'concrete','2026-07-27');
  const block=buildReportActivityIndex(analysis,'block','2026-07-27');
  assert.equal(concrete.rows.length,1);
  assert.equal(concrete.rows[0].sales,100);
  assert.equal(block.rows.length,1);
  assert.equal(block.rows[0].sales,100);
  assert.ok(block.rows[0].alerts.has('sales_type_mismatch'));
  assert.ok(!block.rows[0].alerts.has('duplicate_invoice'));
});

test('customers with the same name and different codes remain separate',()=>{
  const index=buildReportActivityIndex({sales:[{invoice:'A1',kind:'خرسانة',customerCode:'1001',customer:'اسم متشابه',amount:100},{invoice:'A2',kind:'خرسانة',customerCode:'1002',customer:'اسم متشابه',amount:250}],collections:[]},'concrete','2026-07-27');
  assert.equal(index.rows.length,2);
  assert.equal(index.byCustomerCode.get('1001').sales,100);
  assert.equal(index.byCustomerCode.get('1002').sales,250);
  assert.notEqual(index.byCustomerCode.get('1001'),index.byCustomerCode.get('1002'));
});

test('customer buttons remain reusable after opening the first statement',async()=>{
  const source=await readFile(new URL('../api/_lib/bot-customer-search.js',import.meta.url),'utf8');
  assert.match(source,/\['enterprise_customer_choose','enterprise_customer_last_statement'\]\.includes/);
  assert.match(source,/choices:Array\.isArray\(preserved\.choices\)/);
  assert.doesNotMatch(source,/clearMaintenanceSession/);
  assert.match(source,/compactButtonName/);
});

test('payment terms are removed from the portfolio tables and kept in declaration text',()=>{
  const source='<div class="f w2 dark"><div class="k">مهلة السداد المعتمدة</div><div class="v lg">3 <span>أيام</span></div></div><table><tr><th style="width:13mm">مهلة السداد</th></tr><tr><td class="mono">3 يوم</td></tr></table><p>ألتزم بمهلة السداد 3 أيام</p>';
  const cleaned=removeRepeatedPaymentTerms(source);
  assert.doesNotMatch(cleaned,/مهلة السداد المعتمدة/);
  assert.doesNotMatch(cleaned,/>مهلة السداد<\/th>/);
  assert.doesNotMatch(cleaned,/>3 يوم<\/td>/);
  assert.match(cleaned,/ألتزم بمهلة السداد 3 أيام/);
});

test('portfolio is limited to section sales history and current report activity',async()=>{
  const portfolio=await readFile(new URL('../api/_lib/customer-portfolio-pdf.js',import.meta.url),'utf8');
  assert.match(portfolio,/hasSectionSales/);
  assert.match(portfolio,/scopedBase\?\.grossSales/);
  assert.match(portfolio,/settlement\.remainingPriorSales/);
  assert.match(portfolio,/settlement\.hasReportActivity/);
  assert.doesNotMatch(portfolio,/assignedToRep/);
});

test('portfolio keeps legacy employee ids when cloud employees are merged',async()=>{
  const portfolio=await readFile(new URL('../api/_lib/customer-portfolio-pdf.js',import.meta.url),'utf8');
  assert.match(portfolio,/current\.id,current\.external_id,cloudId/);
  assert.match(portfolio,/id:clean\(current\.id\)\|\|cloudId/);
  assert.match(portfolio,/external_id:cloudId/);
  assert.match(portfolio,/employeeAliases:aliases/);
});

test('portfolio includes classifications, totals, aging and fixed snapshots',async()=>{
  const [portfolio,settlement]=await Promise.all([readFile(new URL('../api/_lib/customer-portfolio-pdf.js',import.meta.url),'utf8'),readFile(new URL('../api/_lib/customer-settlement.js',import.meta.url),'utf8')]);
  assert.match(portfolio,/aggregateSettlements/);
  assert.match(settlement,/customerClassLabel/);
  assert.match(portfolio,/أعمار المديونية/);
  assert.match(portfolio,/persistPortfolioReportSnapshot/);
  assert.match(portfolio,/portfolio-snapshots/);
  assert.match(portfolio,/portfolio-settlement-v4-concrete-cash-bank-cutoff/);
});
