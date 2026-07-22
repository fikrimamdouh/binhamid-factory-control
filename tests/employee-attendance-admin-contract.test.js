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

test('employee status and deletion are safe server actions',()=>{
  const client=read('assets/attendance-control.js');
  const api=read('api/admin/attendance.js');
  assert.match(client,/action:'update_employee_status'/);
  assert.match(client,/action:'deactivate_employee'/);
  assert.match(api,/EMPLOYEE_STATUSES/);
  assert.match(api,/employee_work_status_updated/);
  assert.match(api,/employee_deactivated/);
  assert.match(api,/active:false/);
  assert.match(api,/EMPLOYEE_OWNER_PROTECTED/);
  assert.doesNotMatch(api,/delete\s*\(/i);
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
  assert.match(page,/الموظفون وحالة التشغيل/);
});

test('session timeout remains non-blocking and professionally reported',()=>{
  const login=read('assets/owner-web-login.js');
  assert.match(login,/binhamid-session-degraded/);
  assert.match(login,/استمر النظام بالجلسة المحلية دون تعطيل الصفحة/);
  assert.doesNotMatch(login,/session check timed out; keeping existing local session/);
});

test('cache keys load the repaired employee and session modules',()=>{
  const index=read('index.html');
  const nav=read('assets/admin-nav.js');
  assert.match(index,/owner-web-login\.js\?v=20260722-1/);
  assert.match(index,/attendance-control\.js\?v=20260722-1/);
  assert.match(nav,/owner-web-login\.js\?v=20260722-1/);
});
