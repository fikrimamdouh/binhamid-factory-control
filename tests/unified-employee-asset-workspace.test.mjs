import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const page=read('master-data.html');
const route=read('api/_lib/routes/canonical-master-data.js');
const nav=read('assets/admin-nav.js');
const guards=read('assets/master-data-workspace-guards.js');

test('master data is one native workspace without injected legacy overlays',()=>{
  assert.match(page,/الموظفون والمركبات — مكان واحد/);
  assert.match(page,/كل تعديل يُحفظ مباشرة في السحابة/);
  assert.match(page,/data-tab="employees"/);
  assert.match(page,/data-tab="assets"/);
  assert.doesNotMatch(nav,/master-data-cost-centers\.js/);
  assert.doesNotMatch(nav,/master-data-canonical-ui\.js/);
  assert.match(nav,/unified-workspace-guards/);
  assert.match(nav,/master-data-workspace-guards\.js/);
});

test('employee form can add edit link vehicle link Telegram and delete in the same page',()=>{
  assert.match(page,/＋ إضافة موظف/);
  assert.match(page,/id="empVehicle"/);
  assert.match(page,/id="empTelegram"/);
  assert.match(page,/id="empCenter"/);
  assert.match(page,/action:'save_employee'/);
  assert.match(page,/action:'delete_employee'/);
  assert.match(route,/async function saveEmployee/);
  assert.match(route,/async function deleteEmployee/);
  assert.match(route,/assignTelegram/);
  assert.match(route,/assignVehicle/);
});

test('Telegram account is projected inside the employee instead of a second employee row',()=>{
  assert.match(route,/canonicalEmployees=\(employees\|\|\[\]\)\.map/);
  assert.match(route,/telegram:user\?/);
  assert.match(route,/unlinkedTelegramUsers/);
  assert.match(page,/row\.telegram\?/);
  assert.doesNotMatch(page,/telegramUsers\.map\(row=>`<tr/);
});

test('asset form supports create edit delete type conversion and cloud status',()=>{
  assert.match(page,/＋ إضافة سيارة أو أصل/);
  assert.match(page,/option value="vehicle">سيارة/);
  assert.match(page,/option value="equipment">معدة/);
  assert.match(page,/option value="fixed_asset">أصل ثابت/);
  assert.match(page,/action:'save_asset'/);
  assert.match(page,/action:'delete_asset'/);
  assert.match(route,/async function saveAsset/);
  assert.match(route,/async function deleteAsset/);
  assert.match(route,/assetType==='fixed_asset'/);
  assert.match(route,/active:false,driver_external_id:null/);
});

test('diesel and ERP remain one canonical row and edits mirror both source records',()=>{
  assert.match(route,/source_type:linked\?'diesel_erp'/);
  assert.match(route,/referenced\.has/);
  assert.match(route,/linkedErp/);
  assert.match(route,/erpReference/);
  assert.match(page,/sourceLabel\(row\)/);
  assert.match(page,/دمج اللوحات المتطابقة/);
  assert.match(guards,/ensureCurrentErp/);
});

test('cost centers write actual employee and asset assignments',()=>{
  assert.match(route,/employee_cost_assignments/);
  assert.match(route,/asset_cost_center_assignments/);
  assert.match(route,/allocation_percent:100/);
  assert.match(route,/cost_center_code/);
  assert.match(page,/عام/);
  assert.match(page,/بلوك/);
  assert.match(page,/خرسانة/);
});

test('save buttons use stable ids and verify the cloud read-back before closing',()=>{
  assert.match(guards,/stableId/);
  assert.match(guards,/cloudRequest/);
  assert.match(guards,/cloudRead/);
  assert.match(guards,/employeeMismatches/);
  assert.match(guards,/assetMismatches/);
  assert.match(guards,/CLOUD_SAVE_NOT_CONFIRMED/);
  assert.match(guards,/stopImmediatePropagation/);
  assert.match(guards,/attempt<=3/);
  assert.match(guards,/تم حفظ \$\{label\} في السحابة والتأكد من جميع البيانات/);
  assert.doesNotMatch(guards,/localStorage\.setItem/);
});

test('all edits call the cloud API and no local program state is written',()=>{
  assert.match(page,/fetch\('\/api\/router\?route=canonical-master-data'/);
  assert.match(guards,/fetch\('\/api\/router\?route=canonical-master-data'/);
  assert.match(page,/credentials:'same-origin'/);
  assert.match(guards,/cache:'no-store'/);
  assert.doesNotMatch(page,/localStorage\.setItem/);
  assert.doesNotMatch(page,/window\.save\(/);
  assert.doesNotMatch(page,/\bsave\(\)/);
});