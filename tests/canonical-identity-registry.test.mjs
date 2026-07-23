import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const route=read('api/_lib/routes/canonical-master-data.js');
const router=read('api/router.js');
const page=read('master-data.html');
const employeeSync=read('assets/employee-declaration-sync.js');
const attendanceSafe=read('api/_lib/routes/attendance-safe.js');
const nav=read('assets/admin-nav.js');
const saveGuard=read('assets/master-data-workspace-guards.js');
const singleMaster=read('assets/single-master-workspace.js');
const attendancePage=read('attendance-admin.html');

test('canonical asset registry preserves raw sources but returns one visible row',()=>{
  assert.match(route,/canonicalProjection/);
  assert.match(route,/source_type:linked\?/);
  assert.match(route,/diesel_erp/);
  assert.match(route,/erp_linked/);
  assert.match(route,/source_rows:linked\?2:1/);
  assert.match(route,/referenced\.has/);
  assert.match(route,/canonicalAssets/);
  assert.doesNotMatch(route,/\bremove\(/);
});

test('editing either source resolves to one canonical identity and mirrors both records',()=>{
  assert.match(route,/function resolveCanonical/);
  assert.match(route,/canonical_asset_updated/);
  assert.match(route,/canonicalOverrides/);
  assert.match(route,/selectedErp/);
  assert.match(route,/patch\('vehicles'/);
  assert.match(route,/assignAssetCostCenter/);
  assert.match(route,/CANONICAL_PLATE_DUPLICATE/);
});

test('master data is a native one-page editor rather than injected split tables',()=>{
  assert.match(page,/السجل الموحد للموظفين والمركبات/);
  assert.match(page,/شاشة الإضافة والتعديل الوحيدة/);
  assert.match(page,/data-tab="employees"/);
  assert.match(page,/data-tab="assets"/);
  assert.match(page,/action:'save_asset'/);
  assert.match(page,/action:'save_employee'/);
  assert.match(page,/ديزل \+ ERP/);
  assert.doesNotMatch(nav,/master-data-canonical-ui\.js/);
  assert.doesNotMatch(nav,/master-data-cost-centers\.js/);
});

test('linked Telegram account is displayed inside the employee row, not as a second employee',()=>{
  assert.match(route,/canonicalEmployees/);
  assert.match(route,/telegram:user/);
  assert.match(page,/row\.telegram\?/);
  assert.match(attendancePage,/إدارة الموظفين والمركبات من السجل الموحد/);
  assert.match(attendancePage,/<section class="card c12" hidden>/);
});

test('legacy employee synchronization collapses linked user aliases and rewrites references',()=>{
  assert.match(employeeSync,/canonical-roster-sync/);
  assert.match(employeeSync,/const authenticated=/);
  assert.match(employeeSync,/route=canonical-master-data/);
  assert.match(employeeSync,/linkedIds/);
  assert.match(employeeSync,/telegram_external_id/);
  assert.match(employeeSync,/rewriteAliases/);
  assert.match(employeeSync,/local\.splice/);
  assert.match(employeeSync,/employeeAliases/);
  assert.match(attendanceSafe,/scope==='employee-sites'/);
  assert.match(attendanceSafe,/telegram_external_id/);
});

test('admin navigation and legacy shortcuts expose only one employee and asset editor',()=>{
  assert.doesNotMatch(nav,/attendance-canonical-employees\.js/);
  assert.doesNotMatch(nav,/employee-link-transfer\.js/);
  assert.match(nav,/الحضور والمواقع/);
  assert.match(nav,/master-data-workspace-guards\.js\?v=20260723-2/);
  assert.match(nav,/ensureMasterWorkspaceGuards/);
  assert.match(singleMaster,/master-data\.html\?tab=/);
  assert.match(singleMaster,/window\.empForm/);
  assert.match(singleMaster,/window\.vehForm/);
  assert.doesNotMatch(nav,/ensureCanonicalMasterUi/);
  assert.doesNotMatch(nav,/ensureMasterCostCenters/);
  assert.match(saveGuard,/cloud writes are read back and verified/);
  assert.match(router,/canonical-master-data/);
  assert.match(router,/canonicalMasterData\.canonicalMasterData/);
});
