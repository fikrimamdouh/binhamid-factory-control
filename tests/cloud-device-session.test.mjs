import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('browser creates an automatic signed device session before cloud control',()=>{
  const index=read('index.html'),client=read('assets/cloud-device-autolink.js');
  assert.match(index,/cloud-device-autolink\.js/);
  assert.match(index,/bhCloudDeviceReady/);
  assert.match(client,/\/api\/device\/session/);
  assert.match(client,/device-session/);
  assert.doesNotMatch(client,/BINHAMID_ADMIN_TOKEN/);
});

test('device cookie is HttpOnly same-site short lived user-bound and technically limited',()=>{
  const source=read('api/_lib/device-session.js');
  assert.match(source,/HttpOnly/);
  assert.match(source,/SameSite=Strict/);
  assert.match(source,/SESSION_VERSION=3/);
  assert.match(source,/appUserId:boundUser\|\|null/);
  assert.match(source,/30\*24\*60\*60/);
  assert.match(source,/state\.read/);
  assert.match(source,/state\.write/);
  assert.match(source,/imports\.read/);
  assert.match(source,/imports\.status\.sync/);
  assert.doesNotMatch(source,/daily_report\.approve/);
  assert.doesNotMatch(source,/dashboard\.manager/);
  assert.doesNotMatch(source,/governance\.view/);
  assert.doesNotMatch(source,/imports\.manage/);
  assert.doesNotMatch(source,/admin\/users/);
  assert.doesNotMatch(source,/telegram\/register/);
});

test('device enrollment is approved server-side before business identity is signed',()=>{
  const route=read('api/_lib/routes/device-session.js'),migration=read('supabase/migrations/021_device_identity_binding.sql');
  assert.match(route,/approvedBinding/);
  assert.match(route,/approve_device_enrollment/);
  assert.match(route,/requireAdmin\(req\)/);
  assert.match(route,/issueDeviceSession\(req,res,deviceId,binding\?\.user\?\.id\|\|''\)/);
  assert.match(migration,/device_enrollments/);
  assert.match(migration,/status in \('pending','approved','revoked'\)/);
  assert.match(migration,/DEVICE_APP_USER_NOT_ACTIVE/);
});

test('cloud state and inbox polling accept unbound device while business endpoints require bound users',()=>{
  const state=read('api/state.js'),telegram=read('api/_lib/routes/telegram-admin.js'),admin=read('api/_lib/routes/admin.js'),imports=read('api/_lib/routes/imports.js'),dashboard=read('api/_lib/routes/manager-dashboard.js'),permissions=read('api/_lib/permissions.js');
  assert.match(state,/requireAdminOrDevice/);
  assert.match(state,/DEVICE_ID_MISMATCH/);
  assert.match(telegram,/requireAdmin\(req\)/);
  assert.match(telegram,/requireCapability\(req,'daily_report\.approve'\)/);
  assert.match(admin,/requireAdmin/);
  assert.match(imports,/opened_in_program.*requireAdminOrDevice\(req,'imports\.status\.sync'\)/s);
  assert.match(imports,/requireCapability\(req,'imports\.manage'\)/);
  assert.match(dashboard,/requireAdminOrDevice\(req,'imports\.read'\)/);
  assert.match(dashboard,/deviceInboxOnly/);
  assert.match(permissions,/DEVICE_USER_NOT_BOUND/);
  assert.match(permissions,/DEVICE_USER_MISMATCH/);
  assert.match(permissions,/APP_USER_REQUIRED/);
});

test('router and Vercel expose device session without adding a serverless function',()=>{
  const router=read('api/router.js'),vercel=read('vercel.json');
  assert.match(router,/'device\/session'/);
  assert.match(vercel,/\/api\/device\/session/);
  assert.match(vercel,/\/api\/router\?route=device\/session/);
});
