import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { projectCumulativeDailyReport } from '../api/_lib/daily-cumulative-report-data.js';

test('collections settle current invoices before older invoices',()=>{
  const report=projectCumulativeDailyReport({
    reportDate:'2026-07-26',
    storedSales:[{reference_no:'OLD-1',sales_type:'concrete',customer_external_id:'1001',customer_name:'عميل اختبار',item:'خرسانة قديمة',quantity:1,total_amount:100,paid_amount:0,status:'registered',delivery_date:'2026-07-20'}],
    dailySales:[{invoice:'NEW-1',kind:'خرسانة',customerCode:'1001',customer:'عميل اختبار',item:'خرسانة جديدة',quantity:1,amount:60}],
    dailyCollections:[{customerCode:'1001',customer:'عميل اختبار',amount:80}]
  });
  const row=report.departments.concrete.rows[0];
  assert.equal(row.currentSales,60);
  assert.equal(row.currentApplied,80);
  assert.equal(row.invoices[0].outstanding,0);
  assert.equal(row.closingBalance,80);
});

test('customer buttons remain reusable after opening the first statement',async()=>{
  const source=await readFile(new URL('../api/_lib/bot-customer-search.js',import.meta.url),'utf8');
  assert.match(source,/\['enterprise_customer_choose','enterprise_customer_last_statement'\]\.includes/);
  assert.match(source,/choices:Array\.isArray\(preserved\.choices\)/);
  assert.doesNotMatch(source,/clearMaintenanceSession/);
  assert.match(source,/compactButtonName/);
});

test('portfolio declaration is based on assigned unpaid customers with old-new split',async()=>{
  const portfolio=await readFile(new URL('../api/_lib/customer-portfolio-pdf.js',import.meta.url),'utf8');
  const delivery=await readFile(new URL('../api/_lib/erp-telegram-delivery.js',import.meta.url),'utf8');
  assert.match(portfolio,/assignedToRep/);
  assert.match(portfolio,/oldBalance:a\.oldDebt/);
  assert.match(portfolio,/paidNew:a\.paidNew/);
  assert.match(portfolio,/paidOld:a\.paidOld/);
  assert.match(portfolio,/قاعدة التوزيع/);
  assert.match(delivery,/dailyOnly:false,dueOnly:true,currentBatch:true/);
});

test('portfolio keeps legacy employee ids when cloud employees are merged',async()=>{
  const portfolio=await readFile(new URL('../api/_lib/customer-portfolio-pdf.js',import.meta.url),'utf8');
  assert.match(portfolio,/current\.id,current\.external_id,cloudId/);
  assert.match(portfolio,/id:clean\(current\.id\)\|\|cloudId/);
  assert.match(portfolio,/external_id:cloudId/);
  assert.match(portfolio,/employeeAliases:aliases/);
});

test('current concrete sales cannot be dropped by a stale representative link',async()=>{
  const portfolio=await readFile(new URL('../api/_lib/customer-portfolio-pdf.js',import.meta.url),'utf8');
  assert.match(portfolio,/for\(const row of analysis\?\.sales\|\|\[\]\).*add\(master\|\|\{\}, \{customerCode:code,customerName:name\}\)/s);
  assert.match(portfolio,/if\(!selected\.size&&!dailyOnly\)for\(const row of analyticsRows/);
  assert.match(portfolio,/تم منع إرسال إقرار فارغ/);
});
