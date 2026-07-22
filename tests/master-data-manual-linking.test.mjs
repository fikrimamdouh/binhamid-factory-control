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

test('exact plate matches can be unified while ambiguous matches remain manual',()=>{
  const route=read('api/_lib/routes/master-data.js');
  assert.match(route,/autoLinkExactPlatePairs/);
  assert.match(route,/auto_link_erp_references/);
  assert.match(route,/matches\.length>1/);
  assert.match(route,/auto_exact_plate/);
  assert.match(route,/ambiguousCount/);
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

test('unified page keeps manual employee ERP status and type controls in one editor',()=>{
  const page=read('master-data.html'),canonical=read('api/_lib/routes/canonical-master-data.js'),guard=read('assets/master-data-workspace-guards.js');
  assert.match(page,/السيارة وERP والديزل يظهرون كأصل واحد/);
  assert.match(page,/id="assetEmployee"/);
  assert.match(page,/id="assetErp"/);
  assert.match(page,/id="assetStatus"/);
  assert.match(page,/id="assetType"/);
  assert.match(page,/action:'save_asset'/);
  assert.match(page,/action:'auto_link_exact_plate'/);
  assert.match(canonical,/assignVehicle/);
  assert.match(canonical,/erpReference/);
  assert.match(canonical,/operationalStatus/);
  assert.match(guard,/ensureCurrentErp/);
  assert.match(guard,/assetMismatches/);
});