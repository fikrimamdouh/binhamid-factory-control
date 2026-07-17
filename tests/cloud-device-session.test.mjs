import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('browser creates an automatic signed bootstrap cookie before cloud control',()=>{
  const index=read('index.html'),client=read('assets/cloud-device-autolink.js');
  assert.match(index,/cloud-device-autolink\.js/);
  assert.match(index,/bhCloudDeviceReady/);
  assert.match(client,/\/api\/device\/session/);
  assert.match(client,/device-session/);
  assert.doesNotMatch(client,/BINHAMID_ADMIN_TOKEN/);
});

test('device cookie is HttpOnly same-site and grants no business-data capability',()=>{
  const source=read('api/_lib/device-session.js');
  assert.match(source,/HttpOnly/);
  assert.match(source,/SameSite=Strict/);
  assert.match(source,/DEVICE_CAPABILITIES=Object\.freeze\(\[\]\)/);
  assert.match(source,/bootstrap-only/);
  assert.match(source,/AUTHENTICATED_USER_REQUIRED/);
  assert.doesNotMatch(source,/state\.write/);
  assert.doesNotMatch(source,/daily_report\.approve/);
});

test('cloud and Telegram write routes require authenticated admin or user capability',()=>{
  const state=read('api/state.js'),telegram=read('api/_lib/routes/telegram-admin.js'),admin=read('api/_lib/routes/admin.js'),device=read('api/_lib/device-session.js');
  assert.match(state,/requireAdminOrDevice/);
  assert.match(state,/DEVICE_ID_MISMATCH/);
  assert.match(telegram,/requireAdmin\(req\)/);
  assert.match(telegram,/requireAdminOrDevice\(req,'daily_report\.approve'\)/);
  assert.match(admin,/requireAdmin/);
  assert.match(device,/throw Object\.assign\(new Error\('هذه العملية تتطلب تسجيل دخول مستخدم معتمد\.'/);
});

test('router and Vercel expose bootstrap session without adding a serverless function',()=>{
  const router=read('api/router.js'),vercel=read('vercel.json');
  assert.match(router,/'device\/session'/);
  assert.match(vercel,/\/api\/device\/session/);
  assert.match(vercel,/\/api\/router\?route=device\/session/);
});
