import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const api=readFileSync(new URL('../api/admin/'+'attendance.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('../assets/'+'attendance-control.js',import.meta.url),'utf8');

test('employee page exposes saved attendance work sites without editing legacy employee code',()=>{
  assert.match(ui,/bhEmployeeAttendanceSiteHeader/);
  assert.match(ui,/موقع الحضور/);
  assert.match(ui,/FACTORY_MAIN/);
  assert.match(ui,/STATION_MAIN/);
  assert.match(ui,/attendanceSiteId/);
  assert.match(ui,/assign_employee_site/);
  assert.doesNotMatch(ui,/latitude\s*[:=]\s*\d/);
  assert.doesNotMatch(ui,/longitude\s*[:=]\s*\d/);
});

test('employee site selection updates linked attendance assignments',()=>{
  assert.match(api,/async function setEmployeeSite/);
  assert.match(api,/employee_external_id=eq\./);
  assert.match(api,/upsert\('employee_assignments'/);
  assert.match(api,/action==='assign_employee_site'/);
  assert.match(api,/site_id:null,active:false/);
});

test('attendance falls back to the site saved beside the employee',()=>{
  assert.match(api,/async function defaultSiteForEmployee/);
  assert.match(api,/payload->legacy->emp/);
  assert.match(api,/attendanceSiteId\|\|employee\?\.workSiteId\|\|employee\?\.siteId/);
  assert.match(api,/assignmentFor\(identity\.userId,identity\.employee_external_id\)/);
  assert.match(api,/inherited_site:true/);
});

test('telegram user linking uses the employee saved site when site is omitted',()=>{
  assert.match(api,/if\(!siteId&&employeeExternalId\)siteId=/);
  assert.match(api,/اختر موقع العمل من صفحة الموظفين أو شاشة الحضور/);
});
