import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const directory=read('api/_lib/bot-master-directory.js');
const enterprise=read('api/_lib/bot-enterprise.js');
const portfolio=read('api/_lib/customer-portfolio-pdf.js');
const pdfService=read('api/_lib/pdf-service.js');

test('Telegram exposes searchable employee and vehicle directories',()=>{
  assert.match(directory,/employeeDirectoryRows/);
  assert.match(directory,/vehicleDirectoryRows/);
  assert.match(directory,/active=eq\.true&select=external_id,employee_no,national_id,full_name/);
  assert.match(directory,/unified_assets/);
  assert.match(directory,/hr_employee_directory/);
  assert.match(directory,/fuel_vehicle_directory/);
  assert.match(directory,/بحث موظف/);
  assert.match(directory,/بحث مركبه|بحث مركبة/);
});

test('employee details hide full identity and use one car-or-no-car state',()=>{
  assert.match(directory,/••••\$\{digits\.slice\(-4\)\}/);
  assert.match(directory,/السيارة:/);
  assert.match(directory,/غير مرتبط بسيارة/);
  assert.match(directory,/employee_assignments/);
  assert.match(directory,/work_sites/);
  assert.doesNotMatch(directory,/المركبات:/);
});

test('vehicle directory collapses linked ERP duplicates and shows working-or-stopped only',()=>{
  assert.match(directory,/linkedErpIds/);
  assert.match(directory,/metadata\)\.erpReference/);
  assert.match(directory,/diesel_expected===true\|\|!linkedErpIds\.has/);
  assert.match(directory,/ديزل \+ ERP/);
  assert.match(directory,/simpleVehicleState/);
  assert.match(directory,/موجودة \/ تعمل/);
  assert.match(directory,/واقفة/);
  assert.match(directory,/أصل واحد موحد/);
});

test('portfolio command opens separate block and concrete choices',()=>{
  assert.match(directory,/showPortfolioMenu/);
  assert.match(directory,/portfolio_block/);
  assert.match(directory,/portfolio_concrete/);
  assert.match(directory,/🧱 إقرار البلوك/);
  assert.match(directory,/🏗️ إقرار الخرسانة/);
  assert.match(directory,/كل إقرار يُنشأ ويرسل منفصلًا/);
  assert.match(enterprise,/📑 إقرار محفظة العملاء/);
});

test('each Telegram request generates only the selected portfolio PDF',()=>{
  assert.match(directory,/generateCustomerPortfolioPdfs\(\{\},'telegram-current-portfolio',\[requestedType\]\)/);
  assert.match(directory,/يوجد إقرار قيد الإنشاء لحسابك/);
  assert.match(directory,/portfolioJobs/);
  assert.match(portfolio,/requestedTypes=\['block','concrete'\]/);
  assert.match(portfolio,/for\(const type of types\)/);
  assert.doesNotMatch(portfolio,/Promise\.all\(\['block','concrete'\]/);
});

test('Cloudflare PDF requests are queued and rate limits retry automatically',()=>{
  assert.match(pdfService,/let cloudflareQueue=Promise\.resolve\(\)/);
  assert.match(pdfService,/cloudflareQueue\.then\(execute,execute\)/);
  assert.match(pdfService,/for\(let attempt=0;attempt<4;attempt\+\+\)/);
  assert.match(pdfService,/retry-after/);
  assert.match(pdfService,/retryable:true/);
});

test('main Telegram router wires text callbacks and lookup sessions',()=>{
  assert.match(enterprise,/bot-master-directory\.js/);
  assert.match(enterprise,/handleMasterDirectoryTextCommand/);
  assert.match(enterprise,/continueMasterDirectorySession/);
  assert.match(enterprise,/handleMasterDirectoryCallback/);
  assert.match(enterprise,/👥 دليل الموظفين/);
  assert.match(enterprise,/🚚 دليل المركبات والمعدات/);
});

test('portfolio PDF reads cloud employees as well as legacy app state',()=>{
  assert.match(portfolio,/mergeEmployeeSources/);
  assert.match(portfolio,/select\('employees','active=eq\.true/);
  assert.match(portfolio,/employees:mergeEmployeeSources\(legacy\?\.emp,cloudEmployees\)/);
  assert.match(portfolio,/external_id,national_id,employee_no,full_name,phone,role/);
});
