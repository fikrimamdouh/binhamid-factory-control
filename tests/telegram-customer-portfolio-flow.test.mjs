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

test('portfolio declarations use the approved report date instead of browser date',()=>{
  assert.match(portfolio,/resolveReportDate/);
  assert.match(portfolio,/daily_report_batches/);
  assert.match(portfolio,/report_date/);
  assert.match(portfolio,/dateGregorian:reportDate/);
});

test('Telegram portfolio command skips newer empty approved batches',()=>{
  assert.match(botPortfolio,/latestApprovedReportWithSales/);
  assert.match(botPortfolio,/status=eq\.approved/);
  assert.match(botPortfolio,/order=report_date\.desc,committed_at\.desc\.nullslast,approved_at\.desc\.nullslast&limit=30/);
  assert.match(botPortfolio,/salesByBatch/);
  assert.match(botPortfolio,/Number\(item\.amount\|\|0\)>0/);
  assert.match(botPortfolio,/const batch=batches\.find/);
  assert.doesNotMatch(botPortfolio,/report_date=eq\./);
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

test('concrete classifier accepts canonical and ready-mix values',()=>{
  assert.match(portfolio,/raw\.includes\('خرسان'\)/);
  assert.match(portfolio,/raw\.includes\('concrete'\)/);
  assert.match(portfolio,/raw\.includes\('ready mix'\)/);
  assert.match(portfolio,/raw==='rmc'/);
});

test('server PDF uses the same website docCli document system',()=>{
  assert.match(portfolio,/renderCustomerPortfolioDeclaration/);
  assert.match(portfolio,/company:state\.company/);
  assert.match(renderer,/website-docCli-exact-v1/);
  assert.match(renderer,/class="doc"/);
  assert.match(renderer,/class="spine"/);
  assert.match(renderer,/class="mast"/);
  assert.match(renderer,/class="tbar"/);
  assert.match(renderer,/class="dg"/);
  assert.match(renderer,/class="led"/);
  assert.match(renderer,/class="cov"/);
  assert.match(renderer,/class="exe"/);
  assert.match(renderer,/IBM Plex Sans Arabic/);
  assert.match(renderer,/Reem Kufi/);
  assert.match(renderer,/width:210mm;height:297mm/);
  assert.match(renderer,/background:linear-gradient\(180deg,#0B2233/);
});

test('website-style PDF splits only at complete A4 document pages',()=>{
  assert.match(renderer,/chunks\(model\.customers,10\)/);
  assert.match(renderer,/page-break-after:always/);
  assert.match(renderer,/break-after:page/);
  assert.match(renderer,/break-inside:avoid/);
  assert.match(renderer,/execution\(model,reference,model\.dateGregorian\)/);
  assert.match(renderer,/pages\.push\(page/);
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
