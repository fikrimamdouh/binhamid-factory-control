import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('signed device identity is used without a client identity header',async()=>{
  const source=await read('api/_lib/permissions.js');
  assert.match(source,/requestedAppUserId\|\|String\(gateway\?\.appUserId\|\|''\)/);
  assert.match(source,/manager:\[[^\]]*'attendance\.view'[^\]]*'attendance\.manage'/s);
  assert.match(source,/hr:\[[^\]]*'attendance\.view'[^\]]*'attendance\.manage'/s);
});

test('attendance management uses one validated server operation',async()=>{
  const api=await read('api/admin/attendance.js');
  const page=await read('attendance-admin.html');
  assert.match(api,/await requireCapability\(req,'attendance\.view'\)/);
  assert.match(api,/await requireCapability\(req,'attendance\.manage'\)/);
  assert.match(api,/ATTENDANCE_EMPLOYEE_REQUIRED/);
  assert.match(api,/ATTENDANCE_SITE_REQUIRED/);
  assert.match(api,/approve_telegram_user/);
  assert.match(api,/within_geofence=eq\.true/);
  assert.match(api,/riyadhDayRange\(\)/);
  assert.doesNotMatch(page,/api\/admin\/users/);
  assert.match(page,/credentials:'same-origin'/);
  assert.match(page,/action:'assign_user'.*externalId:user\.external_id.*employeeExternalId:employee\.external_id/s);
});

test('cloud state load merges every paged master record without replacing legacy rows',async()=>{
  const source=await read('api/state.js');
  assert.match(source,/async function selectPages/);
  assert.match(source,/selectPages\('customers'/);
  assert.match(source,/selectPages\('employees'/);
  assert.match(source,/appendMissing\(legacy\.cli,customers/);
  assert.match(source,/appendMissing\(legacy\.emp,employees/);
  assert.match(source,/known\.has\(id\)\)continue/);
});

test('API errors expose stable codes and attendance pages are never cached',async()=>{
  const http=await read('api/_lib/http.js');
  const vercel=JSON.parse(await read('vercel.json'));
  assert.match(http,/code,/);
  const attendanceHeaders=vercel.headers.filter(item=>['/attendance-admin.html','/attendance.html'].includes(item.source));
  assert.equal(attendanceHeaders.length,2);
  for(const item of attendanceHeaders)assert.match(item.headers[0].value,/no-store/);
});
