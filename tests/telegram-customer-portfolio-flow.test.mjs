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
  assert.doesNotMatch(botPortfolio,/report_date=eq\./);
});

test('Telegram command reads original Excel date before trusting wrong stored date',()=>{
  assert.match(botPortfolio,/import \* as XLSX from 'xlsx'/);
  assert.match(botPortfolio,/downloadObject/);
  assert.match(botPortfolio,/detectOriginalReportDate/);
  // التاريخ المقروء من ملف Excel الأصلي يسبق التاريخ المخزّن دائمًا. الحارس على المنطق
  // نفسه لا على نص الرسالة، لأن الشروح التقنية أُزيلت من رسائل البوت.
  assert.match(botPortfolio,/reportDate:detected\?\.date\|\|storedReportDate/);
  assert.match(botPortfolio,/تم منع إرسال إقرار بتاريخ اليوم/);
});

test('daily sales reports menu includes both portfolio declarations',()=>{
  assert.match(botReports,/إقرارا محفظة البلوك والخرسانة/);
  assert.match(botReports,/callback_data:'ent:portfolio_current'/);
});

test('portfolio customers come directly from approved sales lines',()=>{
  assert.match(portfolio,/directDailyCustomers/);
  assert.match(portfolio,/analysis\?\.sales/);
  assert.match(portfolio,/row\?\.customerCode\|\|row\?\.customer_code/);
  assert.match(portfolio,/saleType\(row\)!==type/);
  assert.match(portfolio,/if\(!direct\.length\)/);
});

test('Telegram PDF includes exact batch invoice evidence',()=>{
  assert.match(portfolio,/function invoiceRows/);
  assert.match(portfolio,/data-telegram-portfolio-proof="1"/);
  assert.match(portfolio,/فواتير الدفعة/);
  assert.match(portfolio,/أرقام الفواتير/);
  assert.match(portfolio,/invoiceCount:invoices\.length/);
});

test('concrete classifier accepts canonical and ready-mix values',()=>{
  assert.match(portfolio,/raw\.includes\('خرسان'\)/);
  assert.match(portfolio,/raw\.includes\('concrete'\)/);
  assert.match(portfolio,/raw\.includes\('ready mix'\)/);
  assert.match(portfolio,/raw==='rmc'/);
});

test('server fallback uses the same website docCli document system',()=>{
  assert.match(portfolio,/renderCustomerPortfolioDeclaration/);
  assert.match(portfolio,/company:state\.company/);
  assert.match(renderer,/website-docCli-exact-v1/);
  for(const marker of ['class="doc"','class="spine"','class="mast"','class="tbar"','class="dg"','class="led"','class="cov"','class="exe"','IBM Plex Sans Arabic','Reem Kufi','width:210mm;height:297mm'])assert.match(renderer,new RegExp(marker));
  assert.match(renderer,/background:linear-gradient\(180deg,#0B2233/);
});

test('website-style fallback splits only at complete A4 pages',()=>{
  assert.match(renderer,/chunks\(model\.customers,10\)/);
  assert.match(renderer,/page-break-after:always/);
  assert.match(renderer,/break-after:page/);
  assert.match(renderer,/break-inside:avoid/);
  assert.match(renderer,/execution\(model,reference,model\.dateGregorian\)/);
  assert.match(renderer,/pages\.push\(page/);
});

test('bot generates the priced declaration first and keeps the archived print as fallback',()=>{
  assert.match(botPortfolio,/readExactPointer/);
  assert.match(botPortfolio,/sendExactDailyPortfolio/);
  assert.match(botPortfolio,/exactWebsitePrint:true/);
  // الأرقام (المشتريات/المسدَّد/المتبقي) وإجمالي ذمة المندوب لا توجد في نسخة الموقع
  // المؤرشفة، لذلك يُولَّد الإقرار المسعَّر أولًا وتبقى النسخة المؤرشفة احتياطًا.
  const generated=botPortfolio.indexOf('const generated=await generateCustomerPortfolioPdfs'),exact=botPortfolio.indexOf('const exact=await sendExactDailyPortfolio');
  assert.ok(generated>=0&&exact>generated);
});

test('employee selection is exact, prioritizes residency, and never falls back to mechanic',()=>{
  assert.match(portfolio,/ROLE_ALIASES/);
  assert.match(portfolio,/if\(!roleMatches\(employee,type\)\)return-1/);
  assert.match(portfolio,/digits\(employee\?\.nid\|\|employee\?\.national_id\)\.length>=10/);
  assert.doesNotMatch(portfolio,/role\.includes\(token\)/);
  assert.doesNotMatch(portfolio,/byName\.get/);
  assert.match(portfolio,/تم منع إصدار الإقرار باسم موظف غير صحيح/);
  assert.match(portfolio,/role:ROLE_BY_TYPE\[type\]/);
});

test('priced declaration keeps the signature block on its own page so it is never clipped',async()=>{
  const { renderCustomerPortfolioDeclaration }=await import('../shared/customer-portfolio-declaration.js');
  const customers=Array.from({length:8},(_,index)=>({name:`عميل ${index}`,code:`C${index}`,phone:'050',creditLimit:5000,paymentDays:3,sales:1000,paid:400,outstanding:600,quantity:12,item:'خرسانة'}));
  const priced=renderCustomerPortfolioDeclaration({type:'concrete',companyName:'بن حامد',employee:{name:'خالد عبد الله',nationalId:'2414111530'},customers,days:3,dateGregorian:'2026-07-23'});
  // صفحة الوثيقة ارتفاعها ثابت مع overflow:hidden، فإدراج صندوق الذمة مع الالتزامات كان
  // يدفع خانة التوقيع خارج الصفحة فتُقصّ. الآن للتوقيع صفحته المستقلة.
  assert.match(priced.document,/إقرار الذمة والتوقيع/);
  assert.match(priced.document,/المندوب المُقِر/);
  // وثيقة الموقع (بلا أرقام) تبقى بلا صفحة إضافية كما كانت.
  const plain=renderCustomerPortfolioDeclaration({type:'concrete',companyName:'بن حامد',employee:{name:'خالد عبد الله'},customers:customers.map(({sales,paid,outstanding,quantity,item,...rest})=>rest),days:3,dateGregorian:'2026-07-23'});
  assert.doesNotMatch(plain.document,/إقرار الذمة والتوقيع/);
  assert.match(plain.document,/المندوب المُقِر/);
  assert.ok(priced.model.pageCount>plain.model.pageCount);
});
