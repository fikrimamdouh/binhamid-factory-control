import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('employee page merges the permanent employees table into the legacy list',()=>{
  const source=read('assets/attendance-control.js');
  assert.match(source,/attendance-safe&scope=employee-sites/);
  assert.match(source,/mergeCloudEmployees/);
  assert.match(source,/state\.cloudEmployees/);
  assert.match(source,/local\.push\(incoming\)/);
  assert.match(source,/byId\.get\(id\)\|\|byName\.get\(name\)/);
  assert.match(source,/window\.rEmp\(\)/);
});

test('permanent tombstones remove deleted employees and block roster resurrection',()=>{
  const client=read('assets/attendance-control.js');
  const safe=read('api/_lib/routes/attendance-safe.js');
  const management=read('api/_lib/routes/employee-management.js');
  assert.match(client,/purgeDeletedEmployees/);
  assert.match(client,/state\.deletedEmployees/);
  assert.match(client,/action:'permanent_delete_employee'/);
  assert.match(safe,/deletedEmployees/);
  assert.match(safe,/permanentlyDeleted/);
  assert.match(management,/permanentlyDeleted:true/);
  assert.match(management,/employee_permanently_hidden/);
  assert.doesNotMatch(management,/\bdelete\s*\(/i);
});

test('employee status remains a non-destructive server action',()=>{
  const client=read('assets/attendance-control.js');
  const api=read('api/admin/attendance.js');
  assert.match(client,/action:'update_employee_status'/);
  assert.match(api,/EMPLOYEE_STATUSES/);
  assert.match(api,/employee_work_status_updated/);
  assert.match(api,/active:false/);
  assert.match(api,/EMPLOYEE_OWNER_PROTECTED/);
});

test('employee site linking saves the database before the local cloud snapshot',()=>{
  const source=read('assets/attendance-control.js');
  const assignStart=source.indexOf('async function assign(');
  const assignEnd=source.indexOf('async function updateStatus',assignStart);
  const assignBody=source.slice(assignStart,assignEnd);
  assert.ok(assignBody.indexOf("action:'assign_employee_site'")>=0);
  assert.ok(assignBody.indexOf("action:'assign_employee_site'")<assignBody.indexOf('pushLocalSnapshot()'));
  assert.match(assignBody,/تم حفظ الربط في قاعدة البيانات/);
});

test('existing Telegram users transfer to uploaded employees without recreation',()=>{
  const api=read('api/_lib/routes/employee-management.js');
  const ui=read('assets/employee-link-transfer.js');
  assert.match(api,/transferTelegramEmployee/);
  assert.match(api,/action==='transfer_telegram_employee'/);
  assert.match(api,/approve_telegram_user/);
  assert.match(api,/conversationHistory:true/);
  assert.match(api,/preservedRole:user\.role/);
  assert.doesNotMatch(api,/\bdelete\s*\(\s*['"]user_channels/i);
  assert.match(ui,/نقل \/ تحديث الربط/);
  assert.match(ui,/action:'transfer_telegram_employee'/);
  assert.match(ui,/هوية Telegram والدور والمحادثات لن تتغير/);
});

test('vehicle unlink and task edits do not recreate or delete Telegram accounts',()=>{
  const api=read('api/_lib/routes/employee-management.js');
  const ui=read('assets/employee-link-transfer.js');
  assert.match(api,/unlinkEmployeeVehicle/);
  assert.match(api,/updateAssignmentTask/);
  assert.match(api,/vehicle_external_id:null/);
  assert.match(api,/employee_assignment_task_updated/);
  assert.match(ui,/فك ربط المركبة/);
  assert.match(ui,/تغيير المهمة فقط/);
});

test('attendance loading isolates optional table failures and avoids embedded relations',()=>{
  const safe=read('api/_lib/routes/attendance-safe.js');
  const admin=read('api/admin/attendance.js');
  assert.match(safe,/safeSelect/);
  assert.doesNotMatch(safe,/app_users\(/);
  assert.doesNotMatch(safe,/work_sites\(/);
  assert.match(admin,/async function attendanceOverview/);
  assert.match(admin,/degraded:warnings\.length>0/);
  assert.doesNotMatch(admin,/select=\*,work_sites\(/);
});

test('attendance page uses the resilient read route and includes site testing',()=>{
  const page=read('attendance-admin.html');
  assert.match(page,/api\/router\?route=attendance-safe/);
  assert.match(page,/FACTORY_MAIN/);
  assert.match(page,/STATION_MAIN/);
  assert.match(page,/testCurrentLocation/);
  assert.match(page,/سيُقبل الحضور/);
  assert.match(page,/سيُرفض الحضور/);
  assert.match(page,/إدارة الموظفين والمركبات من السجل الموحد/);
  assert.match(page,/<section class="card c12" hidden>/);
  assert.match(page,/href='\/master-data\.html'/);
});

test('session timeout remains non-blocking and professionally reported',()=>{
  const login=read('assets/owner-web-login.js');
  assert.match(login,/binhamid-session-degraded/);
  assert.match(login,/استمر النظام بالجلسة المحلية دون تعطيل الصفحة/);
  assert.doesNotMatch(login,/session check timed out; keeping existing local session/);
});

test('runtime uses the single master workspace instead of loading duplicate employee editors',()=>{
  const index=read('index.html');
  const nav=read('assets/admin-nav.js');
  assert.match(index,/owner-web-login\.js\?v=20260723-final-lock-1/);
  assert.match(index,/single-master-workspace\.js\?v=20260723-1/);
  assert.doesNotMatch(index,/attendance-control\.js\?v=/);
  assert.match(nav,/owner-web-login\.js\?v=20260722-1/);
  assert.doesNotMatch(nav,/employee-link-transfer\.js\?v=/);
  assert.doesNotMatch(nav,/attendance-canonical-employees\.js\?v=/);
  assert.match(nav,/الحضور والمواقع/);
});
