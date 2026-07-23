import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const route=read('api/_lib/routes/canonical-master-data.js');
const router=read('api/router.js');
const page=read('master-data.html');
const nav=read('assets/admin-nav.js');
const engine=read('api/_lib/cost-engine.js');

test('only general block and concrete are accepted in the unified workflow',()=>{
  assert.match(route,/new Set\(\['general','block','concrete'\]\)/);
  assert.match(page,/option value="general">عام/);
  assert.match(page,/option value="block">بلوك/);
  assert.match(page,/option value="concrete">خرسانة/);
  assert.doesNotMatch(page,/option value="fleet"/);
});

test('employee save writes a 100 percent active accounting assignment',()=>{
  assert.match(route,/employee_cost_assignments/);
  assert.match(route,/allocation_percent:100/);
  assert.match(route,/assignEmployeeCostCenter/);
  assert.match(route,/costCenterCode/);
  assert.match(page,/id="empCenter"/);
  assert.match(page,/action:'save_employee'/);
});

test('vehicle equipment and fixed asset save writes the canonical cost assignment',()=>{
  assert.match(route,/asset_cost_center_assignments/);
  assert.match(route,/asset_external_id:assetExternalId/);
  assert.match(route,/assignAssetCostCenter/);
  assert.match(route,/cost_center_code:costCenterCode/);
  assert.match(route,/linkedErpId/);
  assert.match(page,/id="assetCenter"/);
  assert.match(page,/action:'save_asset'/);
});

test('cost center selection is native to the one-page employee and asset editors',()=>{
  assert.match(page,/السجل الموحد للموظفين والمركبات/);
  assert.match(page,/مركز التكلفة/);
  assert.match(page,/حفظ الموظف وربط السيارة وTelegram ومركز التكلفة/);
  assert.match(page,/حفظ الأصل وتحديث السيارة وERP والموظف ومركز التكلفة/);
  assert.match(page,/غير مصنف/);
});

test('master data navigation does not inject the retired cost-center overlay',()=>{
  assert.doesNotMatch(nav,/master-data-cost-centers\.js/);
  assert.doesNotMatch(nav,/ensureMasterCostCenters/);
  assert.match(router,/canonical-master-data/);
  assert.match(router,/canonicalMasterData\.canonicalMasterData/);
});

test('assignments feed the existing cost engine setup',()=>{
  assert.match(engine,/asset_cost_center_assignments/);
  assert.match(engine,/employee_cost_assignments/);
  assert.match(engine,/cost_centers/);
});
