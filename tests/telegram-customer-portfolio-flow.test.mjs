import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const botFiles=fs.readFileSync(new URL('../api/_lib/bot-files.js',import.meta.url),'utf8');
const portfolio=fs.readFileSync(new URL('../api/_lib/customer-portfolio-pdf.js',import.meta.url),'utf8');
const botPortfolio=fs.readFileSync(new URL('../api/_lib/bot-portfolio-reports.js',import.meta.url),'utf8');
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

test('Telegram portfolio command selects the newest approved report date, not today or last approval click',()=>{
  assert.match(botPortfolio,/status=eq\.approved/);
  assert.match(botPortfolio,/order=report_date\.desc,committed_at\.desc\.nullslast,approved_at\.desc\.nullslast/);
  assert.match(botPortfolio,/لا يعتمد الإقرار على تاريخ اليوم/);
  assert.doesNotMatch(botPortfolio,/report_date=eq\./);
});

test('portfolio declarations build report-day customers directly from approved sales lines',()=>{
  assert.match(portfolio,/directDailyCustomers/);
  assert.match(portfolio,/analysis\?\.sales/);
  assert.match(portfolio,/row\?\.customerCode\|\|row\?\.customer_code/);
  assert.match(portfolio,/saleType\(row\)!==type/);
  assert.match(portfolio,/if\(!direct\.length\)/);
});

test('concrete classifier accepts canonical and ready-mix values',()=>{
  assert.match(portfolio,/raw\.includes\('خرسان'\)/);
  assert.match(portfolio,/raw\.includes\('concrete'\)/);
  assert.match(portfolio,/raw\.includes\('ready mix'\)/);
  assert.match(portfolio,/raw==='rmc'/);
});

test('server PDF reuses the canonical customer portfolio declaration renderer',()=>{
  assert.match(portfolio,/renderCustomerPortfolioDeclaration/);
  assert.match(portfolio,/CUSTOMER_PORTFOLIO_DECLARATION/);
  assert.match(renderer,/إقرار مسؤولية عن محفظة عملاء/);
});

test('employee selection is exact, prioritizes residency, and never falls back to a mechanic',()=>{
  assert.match(portfolio,/ROLE_ALIASES/);
  assert.match(portfolio,/if\(!roleMatches\(employee,type\)\)return-1/);
  assert.match(portfolio,/digits\(employee\?\.nid\|\|employee\?\.national_id\)\.length>=10/);
  assert.doesNotMatch(portfolio,/role\.includes\(token\)/);
  assert.doesNotMatch(portfolio,/byName\.get/);
  assert.match(portfolio,/تم منع إصدار الإقرار باسم موظف غير صحيح/);
  assert.match(portfolio,/role:ROLE_BY_TYPE\[type\]/);
});
