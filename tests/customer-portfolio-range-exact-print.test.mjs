import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';

const read=path=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const route=read('api/_lib/routes/customer-portfolio-range.js');
const router=read('api/router.js');
const range=read('assets/customer-portfolio-range.js');
const capture=read('assets/telegram-pdf-declarations.js');
const archive=read('api/_lib/routes/reports-telegram.js');
const bot=read('api/_lib/bot-portfolio-reports.js');
const bridge=read('assets/exact-portfolio-metadata-bridge.js');
const index=read('index.html');

for(const file of ['api/_lib/routes/customer-portfolio-range.js','api/_lib/routes/reports-telegram.js','api/_lib/bot-portfolio-reports.js','assets/customer-portfolio-range.js','assets/telegram-pdf-declarations.js','assets/exact-portfolio-metadata-bridge.js']){
  test(`syntax check ${file}`,()=>{
    const result=spawnSync(process.execPath,['--check',new URL(`../${file}`,import.meta.url).pathname],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr||result.stdout);
  });
}

test('portfolio range API is registered and protected',()=>{
  assert.match(router,/customer-portfolio\/range/);
  assert.match(route,/requireCapability\(req,'daily_report\.view'\)/);
  assert.match(route,/status=eq\.approved/);
  assert.match(route,/customer_opening_balances/);
  assert.match(route,/daily_report_sales_lines/);
  assert.match(route,/daily_report_cash_movements/);
  assert.match(route,/latestActivityDate/);
});

test('period settlement allocates collections to old debt before current sales',()=>{
  assert.match(route,/row\.openingDebt=row\.baseOpening\+row\.priorSales-row\.priorCollections/);
  assert.match(route,/row\.oldDebtPaid=Math\.min\(Math\.max\(row\.openingDebt,0\),Math\.max\(row\.periodCollections,0\)\)/);
  assert.match(route,/row\.oldDebtRemaining=Math\.max\(row\.openingDebt-row\.oldDebtPaid,0\)/);
  assert.match(route,/row\.currentSalesPaid=Math\.min\(Math\.max\(row\.periodSales,0\),remainingCollection\)/);
  assert.match(route,/row\.closingBalance=row\.openingDebt\+row\.periodSales-row\.periodCollections/);
  for(const status of ['settled','partial','unpaid','no_prior_debt','new_debt'])assert.match(route,new RegExp(status));
});

test('website range UI provides presets, employee, sector, and settlement filters',()=>{
  for(const marker of ['آخر 7 أيام','آخر 10 أيام','آخر 30 يومًا','الشهر الحالي','bhPrEmployee','bhPrSector','bhPrStatus','bhPrSearch'])assert.match(range,new RegExp(marker));
  assert.match(range,/route:'customer-portfolio\/range'/);
  assert.match(range,/رصيد أول الفترة/);
  assert.match(range,/المسدّد من الرصيد السابق/);
  assert.match(range,/متبقي الرصيد السابق/);
});

test('range print starts from the exact website docCli renderer',()=>{
  assert.match(range,/window\.docCli\(employee,arabicSector\(sector\)\)/);
  assert.match(range,/window\.preview\(documentData\.html,documentData\.title\)/);
  assert.match(range,/sheet\.innerHTML=documentData\.html;window\.print\(\)/);
  assert.match(range,/bhSendPrintedButtonToTelegram/);
  assert.doesNotMatch(range,/renderCustomerPortfolioDeclaration/);
});

test('exact print capture carries portfolio metadata to the server',()=>{
  assert.match(capture,/bhSetNextPrintMetadata/);
  assert.match(capture,/metadata:snapshot\.metadata\|\|null/);
  assert.match(capture,/data-bh-exact-print-copy/);
  assert.match(archive,/archiveExactPortfolio/);
  assert.match(archive,/portfolio-documents\/latest-\$\{metadata\.periodMode\}-\$\{metadata\.portfolioType\}\.json/);
  assert.match(archive,/source:'website-exact-print'/);
});

test('manual exact print resolves latest actual activity date before stored local date',()=>{
  assert.match(bridge,/route:'customer-portfolio\/range'/);
  assert.match(bridge,/data\.latestActivityDate\|\|data\.to/);
  const activity=bridge.indexOf('await latestActivityDate(kind,employee)'),stored=bridge.indexOf('iso(storedDate(employee,kind))');
  assert.ok(activity>=0&&stored>activity);
});

test('Telegram bot reuses exact stored website PDF before server fallback',()=>{
  assert.match(bot,/downloadObject/);
  assert.match(bot,/function pointerPath\(type,mode='daily'\)/);
  assert.match(bot,/readExactPointer\(type,'daily'\)/);
  assert.match(bot,/sendExactDailyPortfolio/);
  assert.match(bot,/exactWebsitePrint:true/);
  const exactCall=bot.indexOf('const exact=await sendExactDailyPortfolio'),fallbackCall=bot.indexOf('const generated=await generateCustomerPortfolioPdfs');
  assert.ok(exactCall>=0&&fallbackCall>exactCall);
});

test('new assets load after exact capture and before range use',()=>{
  const capturePos=index.indexOf('telegram-pdf-declarations.js?v=20260724-10'),bridgePos=index.indexOf('exact-portfolio-metadata-bridge.js?v=20260724-2'),dailyPos=index.indexOf('daily-portfolio-declarations.js?v=20260724-2'),rangePos=index.indexOf('customer-portfolio-range.js?v=20260724-1');
  assert.ok(capturePos>=0&&bridgePos>capturePos&&dailyPos>bridgePos&&rangePos>dailyPos);
});
