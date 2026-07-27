import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';

const read=path=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const route=read('api/_lib/routes/customer-portfolio-range.js');
const router=read('api/router.js');
const analysis=read('assets/customer-portfolio-range-analysis.js');
const control=read('assets/customer-portfolio-range-control.js');
const capture=read('assets/telegram-pdf-declarations.js');
const bridge=read('assets/exact-portfolio-metadata-bridge.js');
const archive=read('api/_lib/routes/reports-telegram.js');
const bot=read('api/_lib/bot-portfolio-reports.js');
const snapshot=read('api/_lib/customer-portfolio-snapshot.js');
const batch=read('api/_lib/customer-portfolio-batch.js');
const index=read('index.html');

for(const file of ['api/_lib/routes/customer-portfolio-range.js','api/_lib/routes/reports-telegram.js','api/_lib/bot-portfolio-reports.js','assets/customer-portfolio-range-analysis.js','assets/telegram-pdf-declarations.js','assets/exact-portfolio-metadata-bridge.js']){
  test(`syntax check ${file}`,()=>{
    const result=spawnSync(process.execPath,['--check',new URL(`../${file}`,import.meta.url).pathname],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr||result.stdout);
  });
}

test('period API is protected, registered, and reads all financial sources',()=>{
  assert.match(router,/customer-portfolio\/range/);
  assert.match(route,/requireCapability\(req,'daily_report\.view'\)/);
  for(const table of ['customer_opening_balances','daily_report_batches','daily_report_sales_lines','daily_report_cash_movements'])assert.match(route,new RegExp(table));
  assert.doesNotMatch(route,/paged\([^\n]+\)\.catch\(\(\)=>\[\]\)/);
});

test('collections settle old balance first and never silently invent zero',()=>{
  assert.match(route,/row\.openingDebt=row\.baseOpening\+row\.priorSales-row\.priorCollections/);
  assert.match(route,/row\.oldDebtPaid=Math\.min\(Math\.max\(row\.openingDebt,0\),Math\.max\(row\.periodCollections,0\)\)/);
  assert.match(route,/row\.oldDebtRemaining=Math\.max\(row\.openingDebt-row\.oldDebtPaid,0\)/);
  assert.match(route,/row\.currentSalesPaid=Math\.min\(Math\.max\(row\.periodSales,0\),remainingCollection\)/);
  assert.match(route,/row\.advance=Math\.max\(remainingCollection-row\.currentSalesPaid,0\)/);
  assert.match(route,/row\.closingBalance=row\.openingDebt\+row\.periodSales-row\.periodCollections/);
  assert.match(route,/latestActivityDate/);
  for(const status of ['settled','partial','unpaid','no_prior_debt','new_debt'])assert.match(route,new RegExp(status));
});

test('analysis UI offers requested ranges and payment status filters',()=>{
  for(const text of ['آخر 7 أيام','آخر 10 أيام','آخر 30 يومًا','الشهر الحالي','صفّى الرصيد السابق','سداد جزئي للقديم','لم يسدد من القديم'])assert.match(analysis,new RegExp(text));
  for(const id of ['pcFrom','pcTo','pcEmp','pcSeg','bhPortfolioStatus','bhPortfolioSearch'])assert.match(analysis,new RegExp(id));
  for(const label of ['رصيد أول الفترة','مبيعات الفترة','تحصيلات الفترة','المسدّد من القديم','متبقي القديم','الرصيد الختامي'])assert.match(analysis,new RegExp(label));
});

test('analysis layer does not own or wrap printing and approval',()=>{
  assert.doesNotMatch(analysis,/window\.prCli\s*=/);
  assert.doesNotMatch(analysis,/window\.fetch\s*=/);
  assert.doesNotMatch(analysis,/window\.opsOpenModal\s*=/);
  assert.doesNotMatch(analysis,/bhSendPrintedButtonToTelegram/);
  assert.match(analysis,/declarationButton\(\)/);
  assert.match(control,/window\.prCli=wrapped/);
  assert.match(control,/window\.bhAfterDailyReportApproved=afterApproved/);
});

test('exact website print is archived with portfolio metadata',()=>{
  assert.match(capture,/bhSetNextPrintMetadata/);
  assert.match(capture,/metadata:snapshot\.metadata\|\|null/);
  assert.match(bridge,/latestActivityDate/);
  assert.match(bridge,/await metadata\(\)/);
  assert.match(archive,/archiveExactPortfolio/);
  assert.match(archive,/portfolio-documents\/latest-\$\{metadata\.periodMode\}-\$\{metadata\.portfolioType\}\.json/);
  assert.match(archive,/source:'website-exact-print'/);
});

test('bot prefers the fixed financial snapshot and generates only missing departments',()=>{
  assert.match(bot,/downloadObject/);
  assert.match(bot,/sendExactDailyPortfolio/);
  assert.match(bot,/snapshotVersion!=='portfolio-settlement-v3-cross-sector'/);
  assert.match(bot,/persistPortfolioReportSnapshot/);
  assert.match(batch,/generateAvailablePortfolioPdfs/);
  assert.match(batch,/missingTypes\.push\(type\)/);
  assert.match(snapshot,/existingSnapshot/);
  assert.match(snapshot,/reused:true/);
  const exactCall=bot.indexOf('const exact=await sendExactDailyPortfolio'),generated=bot.indexOf('const generated=await generateAvailablePortfolioPdfs');
  assert.ok(exactCall>=0&&generated>exactCall);
});

test('load order has one print owner followed by metadata, range owner, and analysis',()=>{
  const capturePos=index.indexOf('telegram-pdf-declarations.js?v=20260724-10');
  const bridgePos=index.indexOf('exact-portfolio-metadata-bridge.js?v=20260727-primary-owner-1');
  const controlPos=index.indexOf('customer-portfolio-range-control.js?v=20260727-primary-owner-2');
  const analysisPos=index.indexOf('customer-portfolio-range-analysis.js?v=20260724-1');
  const retiredPos=index.indexOf('daily-portfolio-declarations.js?v=20260724-2');
  assert.ok(capturePos>=0&&bridgePos>capturePos&&controlPos>bridgePos&&analysisPos>controlPos&&retiredPos>analysisPos);
});
