import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const index=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=fs.readFileSync(new URL('../assets/customer-portfolio-range-control.js',import.meta.url),'utf8');

test('portfolio range control loads before the retired automatic declaration module',()=>{
  const range=index.indexOf('customer-portfolio-range-control.js');
  const legacy=index.indexOf('daily-portfolio-declarations.js');
  assert.ok(range>=0,'range control must be loaded');
  assert.ok(legacy>range,'range control must own the automatic flow before the legacy module loads');
  assert.match(source,/window\.__BH_DAILY_PORTFOLIO_DECLARATIONS__=true/);
});

test('manual portfolio declaration has a real invoice date range',()=>{
  assert.match(source,/id=\"pcFrom\"/);
  assert.match(source,/id=\"pcTo\"/);
  assert.match(source,/inRange\(delivery\?\.date,context\.fromDate,context\.toDate\)/);
  assert.match(source,/تاريخ البداية يجب ألا يكون بعد تاريخ النهاية/);
});

test('approved report date is copied into both aliases and never silently replaced by today',()=>{
  assert.match(source,/\['dailyDate','reportDate'\]/);
  assert.match(source,/تم منع استخدام تاريخ اليوم تلقائيًا/);
  assert.match(source,/reportDate=iso\(reportDate\)/);
  assert.match(source,/تعذر تحديد تاريخ التقرير المعتمد/);
});

test('automatic Telegram declaration uses exact approved sales and the same site print sheet',()=>{
  assert.match(source,/exactSales:hasExactRows/);
  assert.match(source,/fromDate:reportDate,toDate:reportDate,reportDate/);
  assert.match(source,/pendingPrintContext=context/);
  assert.match(source,/bhSendPrintedButtonToTelegram\(button,null\)/);
  assert.match(source,/window\.print=function\(\)\{annotateSheet\(context\);return previousPrint/);
  assert.match(source,/window\.bhAfterDailyReportApproved=afterApproved/);
});