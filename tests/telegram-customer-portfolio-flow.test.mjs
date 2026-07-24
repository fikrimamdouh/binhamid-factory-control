import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const botFiles=fs.readFileSync(new URL('../api/_lib/bot-files.js',import.meta.url),'utf8');
const portfolio=fs.readFileSync(new URL('../api/_lib/customer-portfolio-pdf.js',import.meta.url),'utf8');
const renderer=fs.readFileSync(new URL('../shared/customer-portfolio-declaration.js',import.meta.url),'utf8');

test('Telegram daily Excel flow sends customer portfolio PDFs to the source chat',()=>{
  assert.match(botFiles,/generateCustomerPortfolioPdfs/);
  assert.match(botFiles,/sendDocumentBuffer\(chatId,portfolio\.pdf/);
  assert.match(botFiles,/relayPdfToOwner\(chatId,portfolio\.pdf/);
  assert.match(botFiles,/recognizedDaily&&result\?\.status!==['"]failed['"]/);
});

test('portfolio declarations use the approved report date instead of browser date',()=>{
  assert.match(portfolio,/resolveReportDate/);
  assert.match(portfolio,/daily_report_batches/);
  assert.match(portfolio,/report_date/);
  assert.match(portfolio,/dateGregorian:reportDate/);
});

test('portfolio declarations include only customers affected by the report day',()=>{
  assert.match(portfolio,/dailyOnly=options\?\.dailyOnly!==false/);
  assert.match(portfolio,/hasCurrentActivity/);
  assert.match(portfolio,/currentSales/);
  assert.match(portfolio,/currentApplied/);
  assert.match(portfolio,/loadProjectedCumulativeDailyReport\(analysis,reportDate,\{currentBatch:true\}\)/);
});

test('server PDF reuses the canonical customer portfolio declaration renderer',()=>{
  assert.match(portfolio,/renderCustomerPortfolioDeclaration/);
  assert.match(portfolio,/CUSTOMER_PORTFOLIO_DECLARATION/);
  assert.match(renderer,/إقرار مسؤولية عن محفظة عملاء/);
});

test('employee selection gives priority to a residency identity',()=>{
  assert.match(portfolio,/digits\(employee\?\.nid\|\|employee\?\.national_id\)\.length>=10/);
  assert.match(portfolio,/byNationalId\.get\(nationalId\)\?\?byName\.get/);
});
