import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const botFiles=fs.readFileSync(new URL('../api/_lib/bot-files.js',import.meta.url),'utf8');
const portfolio=fs.readFileSync(new URL('../api/_lib/customer-portfolio-pdf.js',import.meta.url),'utf8');
const portfolioBatch=fs.readFileSync(new URL('../api/_lib/customer-portfolio-batch.js',import.meta.url),'utf8');
const portfolioSnapshot=fs.readFileSync(new URL('../api/_lib/customer-portfolio-snapshot.js',import.meta.url),'utf8');
const portfolioDocument=fs.readFileSync(new URL('../api/_lib/customer-portfolio-document.js',import.meta.url),'utf8');
const settlement=fs.readFileSync(new URL('../api/_lib/customer-settlement.js',import.meta.url),'utf8');
const botPortfolio=fs.readFileSync(new URL('../api/_lib/bot-portfolio-reports.js',import.meta.url),'utf8');
const botReports=fs.readFileSync(new URL('../api/_lib/bot-reports.js',import.meta.url),'utf8');
const renderer=fs.readFileSync(new URL('../shared/customer-portfolio-declaration.js',import.meta.url),'utf8');

test('Telegram daily Excel flow sends customer portfolio PDFs to the source chat',()=>{
  assert.match(botFiles,/generateCustomerPortfolioPdfs/);
  assert.match(botFiles,/sendDocumentBuffer\(chatId,portfolio\.pdf/);
  assert.match(botFiles,/relayPdfToOwner\(chatId,portfolio\.pdf/);
  assert.match(botFiles,/recognizedDaily&&result\?\.status!==['"]failed['"]/);
});

test('portfolio declarations require an approved date and never silently use today',()=>{
  assert.match(portfolio,/resolveReportDate/);
  assert.match(portfolio,/PORTFOLIO_REPORT_DATE_REQUIRED/);
  assert.match(portfolio,/dateGregorian:reportDate/);
  assert.doesNotMatch(portfolio,/return riyadhDate\(\)/);
});

test('Telegram command selects latest committed non-empty batch',()=>{
  assert.match(botPortfolio,/latestApprovedReportWithSales/);
  assert.match(botPortfolio,/status=eq\.approved/);
  assert.match(botPortfolio,/order=committed_at\.desc\.nullslast,approved_at\.desc\.nullslast,report_date\.desc&limit=30/);
  assert.match(botPortfolio,/salesByBatch/);
  assert.match(botPortfolio,/Number\(item\.amount\|\|0\)>0/);
  assert.match(botPortfolio,/const batch=batches\.find/);
});

test('Telegram command reads original Excel date before trusting wrong stored date',()=>{
  assert.match(botPortfolio,/import \* as XLSX from 'xlsx'/);
  assert.match(botPortfolio,/downloadObject/);
  assert.match(botPortfolio,/detectOriginalReportDate/);
  assert.match(botPortfolio,/reportDate:detected\?\.date\|\|storedReportDate/);
  assert.match(botPortfolio,/تم منع إرسال إقرار بتاريخ اليوم/);
});

test('daily sales reports menu includes both portfolio declarations',()=>{
  assert.match(botReports,/إقرارا محفظة البلوك والخرسانة/);
  assert.match(botReports,/callback_data:'ent:portfolio_current'/);
});

test('portfolio customers come from section sales, not every debtor',()=>{
  assert.match(portfolio,/loadCustomerAnalytics/);
  assert.match(portfolio,/beforeDate:reportDate/);
  assert.match(portfolio,/buildReportActivityIndex/);
  assert.match(portfolio,/hasSectionSales/);
  assert.match(portfolio,/settlement\.remainingPriorSales/);
  assert.doesNotMatch(portfolio,/assignedToRep/);
});

test('Telegram PDF shows new-old classification and payment allocation',()=>{
  assert.match(portfolioDocument,/تصنيف والحالة/);
  assert.match(portfolioDocument,/الرصيد السابق/);
  assert.match(portfolioDocument,/مشتريات التقرير/);
  assert.match(portfolioDocument,/من المشتريات/);
  assert.match(portfolioDocument,/من السابق/);
  assert.match(portfolioDocument,/المتبقي النهائي/);
  assert.match(settlement,/عميل قديم — سدد الجديد وجزءًا من السابق/);
  assert.match(settlement,/عميل جديد — سدد مشتريات التقرير بالكامل/);
});

test('payment term is shown only in declaration obligations',()=>{
  assert.match(portfolioDocument,/removeRepeatedPaymentTerms/);
  assert.match(portfolioDocument,/مهلة السداد المعتمدة/);
  assert.match(portfolioDocument,/مهلة السداد<\\\/th>/);
  assert.match(portfolioDocument,/تظل مثبتة مرة واحدة ضمن بنود الإقرار/);
});

test('concrete classifier accepts canonical and ready-mix values',()=>{
  assert.match(settlement,/خرسان\|concrete\|ready\\s\*mix\|readymix\|rmc/);
});

test('server fallback uses the same website document system',()=>{
  assert.match(portfolio,/renderCustomerPortfolioDeclaration/);
  assert.match(portfolio,/company:state\.company/);
  assert.match(renderer,/primary-owner-cross-sector-v2/);
  for(const marker of ['class="doc"','class="spine"','class="mast"','class="tbar"','class="dg"','class="led"','class="cov"','class="exe"','IBM Plex Sans Arabic','Reem Kufi','width:210mm;height:297mm'])assert.match(renderer,new RegExp(marker));
});

test('website-style fallback splits only at complete A4 pages',()=>{
  assert.match(renderer,/chunks\(model\.customers,10\)/);
  assert.match(renderer,/page-break-after:always/);
  assert.match(renderer,/break-after:page/);
  assert.match(renderer,/break-inside:avoid/);
  assert.match(renderer,/execution\(model,reference,model\.dateGregorian\)/);
  assert.match(renderer,/pages\.push\(page/);
});

test('bot prefers fixed historical snapshot then generates only missing departments',()=>{
  assert.match(botPortfolio,/readExactPointer/);
  assert.match(botPortfolio,/snapshotVersion!=='portfolio-settlement-v3-cross-sector'/);
  assert.match(botPortfolio,/const needsGeneration=\[\]/);
  assert.match(botPortfolio,/generateAvailablePortfolioPdfs/);
  assert.match(botPortfolio,/persistPortfolioReportSnapshot/);
  assert.match(portfolioBatch,/for\(const type of types\)/);
  assert.match(portfolioBatch,/missingTypes\.push\(type\)/);
  assert.match(portfolioSnapshot,/existingSnapshot/);
  assert.match(portfolioSnapshot,/if\(existing\)return\{\.\.\.existing,reused:true\}/);
  const exact=botPortfolio.indexOf('const exact=await sendExactDailyPortfolio'),generated=botPortfolio.indexOf('const generated=await generateAvailablePortfolioPdfs');
  assert.ok(exact>=0&&generated>exact);
});

test('employee selection is exact and prioritizes residency without name fallback',()=>{
  assert.match(portfolio,/ROLE_ALIASES/);
  assert.match(portfolio,/if\(!roleMatches\(employee,type\)\)return-1/);
  assert.match(portfolio,/digits\(employee\?\.nid\|\|employee\?\.national_id\)\.length>=10/);
  assert.doesNotMatch(portfolio,/role\.includes\(token\)/);
  assert.match(portfolio,/تم منع إصدار الإقرار باسم موظف غير صحيح/);
  assert.match(portfolio,/role:ROLE_BY_TYPE\[type\]/);
});

test('priced declaration keeps the signature block on its own page so it is never clipped',async()=>{
  const { renderCustomerPortfolioDeclaration }=await import('../shared/customer-portfolio-declaration.js');
  const customers=Array.from({length:8},(_,index)=>({name:`عميل ${index}`,code:`C${index}`,phone:'050',creditLimit:5000,paymentDays:3,sales:1000,paid:400,outstanding:600,quantity:12,item:'خرسانة'}));
  const priced=renderCustomerPortfolioDeclaration({type:'concrete',companyName:'بن حامد',employee:{name:'خالد عبد الله',nationalId:'2414111530'},customers,days:3,dateGregorian:'2026-07-23'});
  assert.match(priced.document,/إقرار الذمة والتوقيع/);
  assert.match(priced.document,/المندوب المُقِر/);
  const plain=renderCustomerPortfolioDeclaration({type:'concrete',companyName:'بن حامد',employee:{name:'خالد عبد الله'},customers:customers.map(({sales,paid,outstanding,quantity,item,...rest})=>rest),days:3,dateGregorian:'2026-07-23'});
  assert.doesNotMatch(plain.document,/إقرار الذمة والتوقيع/);
  assert.match(plain.document,/المندوب المُقِر/);
  assert.ok(priced.model.pageCount>plain.model.pageCount);
});
