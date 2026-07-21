import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';
import { parseDailyWorkbook } from '../api/_lib/daily-summary-parser.js';
import { addDays, timelineBlocksApproval } from '../api/_lib/daily-report-timeline.js';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('daily workbook parser detects the operational date from workbook headers',()=>{
  const rows=[
    ['تاريخ التقرير','20/07/2026'],
    ['المبيعات'],
    ['رقم الفاتورة','الكمية','كود العميل','اسم العميل','الصنف','قيمة المبيعات'],
    [1001,5,'C-1','عميل اختبار','بلوك 20',250]
  ];
  const workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet(rows),'اليومي');
  const parsed=parseDailyWorkbook(workbook,XLSX);
  assert.equal(parsed.reportDate,'2026-07-20');
  assert.equal(parsed.summary.reportDate,'2026-07-20');
  assert.equal(parsed.summary.invoiceCount,1);
});

test('timeline guard blocks a missing day unless the authorized override is explicit',()=>{
  const timeline={errors:[],missingDates:['2026-07-21']};
  assert.equal(timelineBlocksApproval(timeline,false)[0].code,'MISSING_REPORT_DATES');
  assert.deepEqual(timelineBlocksApproval(timeline,true),[]);
  assert.equal(addDays('2026-07-19',1),'2026-07-20');
});

test('Telegram daily report requires explicit approval and supports review buttons',async()=>{
  const bot=await read('api/_lib/bot-files.js');
  assert.match(bot,/shouldPost:false/);
  assert.match(bot,/dailyReportReviewKeyboard/);
  assert.match(bot,/بانتظار الاعتماد/);
  assert.doesNotMatch(bot,/if\(approval\.shouldPost\)\{try\{posting=await commitDailyReportFromTelegram/);
  assert.match(bot,/inventoryType:'finished_goods'/);
  assert.match(bot,/generateCustomerMovementPdf/);
});

test('Telegram gateway handles approve, force-gap and reject callbacks',async()=>{
  const gateway=await read('api/_lib/telegram-webhook-gateway.js');
  const review=await read('api/_lib/bot-daily-report-review.js');
  assert.match(gateway,/action==='dr'/);
  assert.match(gateway,/handleDailyReportCallback/);
  assert.match(review,/dr:\$\{allowGap\?'force':'approve'\}/);
  assert.match(review,/dr:reject:/);
  assert.match(review,/daily_report\.approve/);
  assert.match(review,/\['admin','manager'\]/);
});

test('server approval enforces opening date and report sequence',async()=>{
  const route=await read('api/_lib/routes/daily-report.js');
  assert.match(route,/loadDailyReportTimeline/);
  assert.match(route,/timelineBlocksApproval/);
  assert.match(route,/allowDateGap/);
  const timeline=await read('api/_lib/daily-report-timeline.js');
  assert.match(timeline,/REPORT_BEFORE_MOVEMENT_START/);
  assert.match(timeline,/OPENING_BALANCE_DATE_CONFLICT/);
  assert.match(timeline,/MISSING_REPORT_DATES/);
});

test('from-to customer movement report uses opening, sales and collections equation',async()=>{
  const report=await read('api/_lib/daily-customer-movement-pdf.js');
  assert.match(report,/customer_opening_balances/);
  assert.match(report,/daily_report_sales_lines/);
  assert.match(report,/daily_report_cash_movements/);
  assert.match(report,/opening\+row\.approvedSales\+row\.currentSales-row\.approvedCollections-row\.currentCollections/);
  assert.match(report,/الحركة من/);
  assert.match(report,/إلى/);
});

test('cumulative report uses operational date and excludes current-day stored sales',async()=>{
  const pdf=await read('api/_lib/daily-cumulative-pdf.js');
  const data=await read('api/_lib/daily-cumulative-report-data.js');
  assert.match(pdf,/requestedReportDate/);
  assert.match(data,/sale\.date>=reportDate/);
});

test('login cloud pull preserves the approved declaration text version',async()=>{
  const sync=await read('assets/login-sync.js');
  assert.match(sync,/2026-07-14-original-plus-portfolio-v1/);
  assert.match(sync,/incomingLegacy\.txt=approvedLegacy\.txt/);
  assert.match(sync,/incomingLegacy\.txtCustom=false/);
});
