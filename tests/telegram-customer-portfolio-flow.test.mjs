import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const botFiles=fs.readFileSync(new URL('../api/_lib/bot-files.js',import.meta.url),'utf8');
const portfolio=fs.readFileSync(new URL('../api/_lib/customer-portfolio-pdf.js',import.meta.url),'utf8');
const botPortfolio=fs.readFileSync(new URL('../api/_lib/bot-portfolio-reports.js',import.meta.url),'utf8');
const botReports=fs.readFileSync(new URL('../api/_lib/bot-reports.js',import.meta.url),'utf8');
const renderer=fs.readFileSync(new URL('../shared/customer-portfolio-declaration.js',import.meta.url),'utf8');

test('Telegram daily Excel flow sends customer portfolio PDFs to the source chat',()=>{
  assert.match(botFiles,/generateCustomerPortfolioPdfs/);
  assert.match(botFiles,/sendDocumentBuffer\(chatId,portfolio\.pdf/);
  assert.match(botFiles,/relayPdfToOwner\(chatId,portfolio\.pdf/);
  assert.match(botFiles,/recognizedDaily&&result\?\.status!==['"]failed['"]/);
});

test('portfolio declarations require an approved operational date and never silently use today',()=>{
  assert.match(portfolio,/resolveReportDate/);
  assert.match(portfolio,/daily_report_batches/);
  assert.match(portfolio,/report_date/);
  assert.match(portfolio,/dateGregorian:reportDate/);
  assert.match(portfolio,/PORTFOLIO_REPORT_DATE_REQUIRED/);
  assert.doesNotMatch(portfolio,/return riyadhDate\(\)/);
});

test('Telegram portfolio command selects the latest committed non-empty batch',()=>{
  assert.match(botPortfolio,/latestApprovedReportWithSales/);
  assert.match(botPortfolio,/status=eq\.approved/);
  assert.match(botPortfolio,/order=committed_at\.desc\.nullslast,approved_at\.desc\.nullslast,report_date\.desc&limit=30/);
  assert.match(botPortfolio,/salesByBatch/);
  assert.match(botPortfolio,/Number\(item\.amount\|\|0\)>0/);
  assert.doesNotMatch(botPortfolio,/order=report_date\.desc,committed_at/);
  assert.doesNotMatch(botPortfolio,/report_date=eq\./);
});

test('Telegram portfolio command reads the original Excel date before trusting an incorrect stored date',()=>{
  assert.match(botPortfolio,/import \* as XLSX from 'xlsx'/);
  assert.match(botPortfolio,/downloadObject/);
  assert.match(botPortfolio,/file_storage_path/);
  assert.match(botPortfolio,/posted_batch_id=eq\./);
  assert.match(botPortfolio,/detectOriginalReportDate/);
  assert.match(botPortfolio,/تاريخ التقرير: <b>\$\{date\}<\/b>/);
  assert.match(botPortfolio,/تم تصحيح التاريخ المسجل/);
  assert.match(botPortfolio,/تم منع إرسال إقرار بتاريخ اليوم/);
});

test('daily sales reports menu includes the two portfolio declarations',()=>{
  assert.match(botReports,/إقرارا محفظة البلوك والخرسانة/);
  assert.match(botReports,/callback_data:'ent:portfolio_current'/);
});

test('portfolio declarations build report-day customers directly from approved sales lines',()=>{
  assert.match(portfolio,/directDailyCustomers/);
  assert.match(portfolio,/analysis\?\.sales/);
  assert.match(portfolio,/row\?\.customerCode\|\|row\?\.customer_code/);
  assert.match(portfolio,/saleType\(row\)!==type/);
  assert.match(portfolio,/if\(!direct\.length\)/);
});

test('Telegram PDF shows exact invoice evidence from the selected batch',()=>{
  assert.match(portfolio,/function invoiceRows/);
  assert.match(portfolio,/data-telegram-portfolio-proof="1"/);
  assert.match(portfolio,/فواتير الدفعة/);
  assert.match(portfolio,/أرقام الفواتير/);
  assert.match(portfolio,/invoiceCount:invoices\.length/);
  assert.match(portfolio,/نسخة تيليجرام الجديدة/);
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

test('portfolio PDF is split into explicit complete A4 pages without cutting signatures or tables',()=>{
  assert.match(renderer,/chunks\(customers,10\)/);
  assert.match(renderer,/portfolio-page/);
  assert.match(renderer,/height:281mm/);
  assert.match(renderer,/break-after:page/);
  assert.match(renderer,/page-break-inside:avoid/);
  assert.match(renderer,/signatures/);
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
