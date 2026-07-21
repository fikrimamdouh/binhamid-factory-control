import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('diesel assignment remains the operational employee link',()=>{
  const route=read('api/_lib/routes/master-data.js');
  assert.match(route,/assignAssetEmployee/);
  assert.match(route,/MASTER_DIESEL_REQUIRED/);
  assert.match(route,/asset\.diesel_expected!==true/);
  assert.match(route,/assigned_employee_external_id:nextEmployeeExternalId/);
  assert.match(route,/driver_external_id:nextEmployeeExternalId/);
  assert.match(route,/master_diesel_employee_linked/);
  assert.match(route,/master_diesel_employee_unlinked/);
});

test('ERP reference is financial metadata and does not replace diesel assignment',()=>{
  const route=read('api/_lib/routes/master-data.js');
  assert.match(route,/assignErpReference/);
  assert.match(route,/action==='assign_erp_reference'/);
  assert.match(route,/erpReference:reference/);
  assert.match(route,/manualErpReference:reference/);
  assert.match(route,/purchaseCost/);
  assert.doesNotMatch(route,/assignErpReference[\s\S]{0,1800}assigned_employee_external_id:/);
});

test('employee and asset statuses can be managed and survive imports',()=>{
  const route=read('api/_lib/routes/master-data.js');
  assert.match(route,/updateEmployeeStatus/);
  assert.match(route,/manualWorkStatus/);
  assert.match(route,/updateAssetStatus/);
  assert.match(route,/manualOperationalStatus/);
  assert.match(route,/manualStatus\|\|row\.workStatus/);
  assert.match(route,/manualOperationalStatus\|\|row\.operationalStatus/);
});

test('workbook parser supports new ERP plate and source statuses',()=>{
  const parser=read('api/_lib/master-data-workbook.js');
  assert.match(parser,/اللوحة الجديدة \/ لوحة الديزل/);
  assert.match(parser,/matchedFuelPlateKey/);
  assert.match(parser,/sourceErpReference/);
  assert.match(parser,/حالة الدوام/);
  assert.match(parser,/الحالة الفعلية من ERP/);
  assert.match(parser,/sourceOperationalStatus/);
  assert.match(parser,/dieselExpected:true/);
});

test('master data page separates employee diesel link from ERP reference',()=>{
  const page=read('master-data.html');
  assert.match(page,/لوحة الديزل هي الربط التشغيلي الأساسي/);
  assert.match(page,/data-diesel-employee/);
  assert.match(page,/data-diesel-erp/);
  assert.match(page,/action:'assign_asset_employee'/);
  assert.match(page,/action:'assign_erp_reference'/);
  assert.match(page,/action:'update_employee_status'/);
  assert.match(page,/action:'update_asset_status'/);
  assert.match(page,/تم تحديث مرجع ERP المالي دون تغيير ربط الديزل/);
});
