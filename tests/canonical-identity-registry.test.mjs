import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const route=read('api/_lib/routes/canonical-master-data.js');
const router=read('api/router.js');
const masterUi=read('assets/master-data-canonical-ui.js');
const attendanceUi=read('assets/attendance-canonical-employees.js');
const employeeSync=read('assets/employee-declaration-sync.js');
const attendanceSafe=read('api/_lib/routes/attendance-safe.js');
const nav=read('assets/admin-nav.js');

test('canonical asset registry preserves raw sources but returns one visible row',()=>{
  assert.match(route,/canonicalProjection/);
  assert.match(route,/source_type:linked\?'diesel_erp'/);
  assert.match(route,/source_rows:linked\?2:1/);
  assert.match(route,/referenced\.has/);
  assert.match(route,/canonicalAssets/);
  assert.doesNotMatch(route,/delete\(|remove\(/);
});

test('editing either diesel or ERP resolves to one canonical identity and saves both sources',()=>{
  assert.match(route,/function resolveCanonical/);
  assert.match(route,/canonical_asset_updated/);
  assert.match(route,/canonicalOverrides/);
  assert.match(route,/if\(erp\)/);
  assert.match(route,/patch\('vehicles'/);
  assert.match(route,/assignCostCenter/);
  assert.match(route,/CANONICAL_PLATE_DUPLICATE/);
});

test('master data page hides split source tables and exposes one editor',()=>{
  assert.match(masterUi,/السجل الموحد/);
  assert.match(masterUi,/حالة الموظفين\|توحيد سيارات الديزل\|حالة المركبات والمعدات/);
  assert.match(masterUi,/تعديل وحفظ/);
  assert.match(masterUi,/حفظ الأصل الواحد/);
  assert.match(masterUi,/update_asset/);
  assert.match(masterUi,/link_erp/);
  assert.match(masterUi,/unlink_erp/);
  assert.match(masterUi,/مصدران داخليان · صف واحد/);
});

test('linked Telegram account is displayed inside the employee row, not as a second employee',()=>{
  assert.match(route,/canonicalEmployees/);
  assert.match(route,/telegram:user/);
  assert.match(attendanceUi,/سجل واحد لكل شخص/);
  assert.match(attendanceUi,/لا تُعرض كموظف ثانٍ/);
  assert.match(attendanceUi,/oldEmployee\.style\.display='none'/);
  assert.match(attendanceUi,/oldAssignments\.style\.display='none'/);
  assert.match(attendanceUi,/حسابات Telegram غير المرتبطة ليست موظفين إضافيين/);
});

test('legacy employee synchronization collapses linked user aliases and rewrites references',()=>{
  assert.match(employeeSync,/canonical-identity/);
  assert.match(employeeSync,/linkedIds/);
  assert.match(employeeSync,/telegram_external_id/);
  assert.match(employeeSync,/rewriteAliases/);
  assert.match(employeeSync,/local\.splice/);
  assert.match(employeeSync,/employeeAliases/);
  assert.match(attendanceSafe,/scope==='employee-sites'/);
  assert.match(attendanceSafe,/telegram_external_id/);
});

test('admin navigation loads the canonical interfaces only on their pages',()=>{
  assert.match(nav,/master-data-canonical-ui\.js\?v=20260722-1/);
  assert.match(nav,/attendance-canonical-employees\.js\?v=20260722-1/);
  assert.match(nav,/ensureCanonicalMasterUi/);
  assert.match(nav,/ensureAttendanceCanonicalEmployees/);
  assert.match(router,/canonical-master-data/);
  assert.match(router,/canonicalMasterData\.canonicalMasterData/);
});
