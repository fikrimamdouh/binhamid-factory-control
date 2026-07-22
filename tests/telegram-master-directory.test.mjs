import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const directory=read('api/_lib/bot-master-directory.js');
const enterprise=read('api/_lib/bot-enterprise.js');
const portfolio=read('api/_lib/customer-portfolio-pdf.js');

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

test('employee details hide full identity and show operational links',()=>{
  assert.match(directory,/••••\$\{digits\.slice\(-4\)\}/);
  assert.match(directory,/مركز التكلفة/);
  assert.match(directory,/المركبات:/);
  assert.match(directory,/employee_assignments/);
  assert.match(directory,/work_sites/);
});

test('vehicle directory collapses linked ERP duplicates into one asset',()=>{
  assert.match(directory,/linkedErpIds/);
  assert.match(directory,/metadata\)\.erpReference/);
  assert.match(directory,/diesel_expected===true\|\|!linkedErpIds\.has/);
  assert.match(directory,/ديزل \+ ERP/);
  assert.match(directory,/assigned_employee_external_id/);
});

test('current customer portfolio declarations can be requested without uploading Excel',()=>{
  assert.match(directory,/sendCurrentPortfolioPdfs/);
  assert.match(directory,/generateCustomerPortfolioPdfs\(\{\},'telegram-current-portfolio'\)/);
  assert.match(directory,/دون الحاجة إلى رفع ملف Excel جديد/);
  assert.match(directory,/portfolio_current/);
  assert.match(enterprise,/📑 إقرار محفظة العملاء/);
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
