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

test('device cookie is HttpOnly same-site and capability limited',()=>{
  const source=read('api/_lib/device-session.js');
  assert.match(source,/HttpOnly/);
  assert.match(source,/SameSite=Strict/);
  assert.match(source,/state\.write/);
  assert.match(source,/daily_report\.approve/);
  assert.doesNotMatch(source,/admin\/users/);
  assert.doesNotMatch(source,/telegram\/register/);
});

test('cloud state accepts device session while admin endpoints remain admin-only',()=>{
  const state=read('api/state.js'),telegram=read('api/_lib/routes/telegram-admin.js'),admin=read('api/_lib/routes/admin.js');
  assert.match(state,/requireAdminOrDevice/);
  assert.match(state,/DEVICE_ID_MISMATCH/);
  assert.match(telegram,/requireAdmin\(req\)/);
  assert.match(telegram,/requireAdminOrDevice\(req,'daily_report\.approve'\)/);
  assert.match(admin,/requireAdmin/);
});

test('router and Vercel expose device session without adding a serverless function',()=>{
  const router=read('api/router.js'),vercel=read('vercel.json');
  assert.match(router,/'device\/session'/);
  assert.match(vercel,/\/api\/device\/session/);
  assert.match(vercel,/\/api\/router\?route=device\/session/);
});
