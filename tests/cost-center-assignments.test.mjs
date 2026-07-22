import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const route=read('api/_lib/routes/cost-center-assignments.js');
const router=read('api/router.js');
const ui=read('assets/master-data-cost-centers.js');
const nav=read('assets/admin-nav.js');
const engine=read('api/_lib/cost-engine.js');

test('only general block and concrete are accepted for this workflow',()=>{
  assert.match(route,/new Set\(\['general','block','concrete'\]\)/);
  assert.match(route,/general:'عام'/);
  assert.match(route,/block:'بلوك'/);
  assert.match(route,/concrete:'خرسانة'/);
  assert.doesNotMatch(route,/fleet:'أسطول'/);
});

test('employee selection writes a 100 percent active accounting assignment',()=>{
  assert.match(route,/employee_cost_assignments/);
  assert.match(route,/allocation_percent:100/);
  assert.match(route,/effective_from:effectiveFrom/);
  assert.match(route,/active:true/);
  assert.match(route,/assign_employee_cost_center/);
  assert.match(route,/costCenterCode/);
});

test('vehicle and equipment selection writes the canonical asset assignment',()=>{
  assert.match(route,/asset_cost_center_assignments/);
  assert.match(route,/asset_external_id:assetExternalId/);
  assert.match(route,/canonicalAsset:true/);
  assert.match(route,/cost_center_code:costCenterCode/);
  assert.match(route,/erpExternalId/);
  assert.match(route,/linkedErpIds/);
});

test('cost center page exposes filters and save actions for both entity types',()=>{
  assert.match(ui,/مراكز التكلفة: عام \/ بلوك \/ خرسانة/);
  assert.match(ui,/assign_employee_cost_center/);
  assert.match(ui,/assign_asset_cost_center/);
  assert.match(ui,/حفظ مركز الموظف/);
  assert.match(ui,/حفظ مركز الأصل/);
  assert.match(ui,/غير مصنف/);
});

test('master data navigation loads the cost center control and router exposes it',()=>{
  assert.match(nav,/master-data-cost-centers\.js\?v=20260722-1/);
  assert.match(nav,/ensureMasterCostCenters/);
  assert.match(router,/cost-center-assignments/);
  assert.match(router,/costCenterAssignments\.costCenterAssignments/);
});

test('assignments feed the existing cost engine setup',()=>{
  assert.match(engine,/asset_cost_center_assignments/);
  assert.match(engine,/employee_cost_assignments/);
  assert.match(engine,/cost_centers/);
});
