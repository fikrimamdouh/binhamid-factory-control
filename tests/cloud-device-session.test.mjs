import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('browser creates an automatic signed transport cookie before cloud control',()=>{
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
  assert.match(source,/SESSION_VERSION=4/);
  assert.match(source,/30\*24\*60\*60/);
  assert.match(source,/DEVICE_CAPABILITIES=Object\.freeze\(\[\]\)/);
  assert.match(source,/transport-only/);
  for(const capability of ['state.read','state.write','dashboard.manager','imports.manage','daily_report.approve','accounting.view'])assert.doesNotMatch(source,new RegExp(capability.replace('.','\\.')));
});

test('device transport alone cannot execute business capabilities',()=>{
  const device=read('api/_lib/device-session.js'),permissions=read('api/_lib/permissions.js'),imports=read('api/_lib/routes/imports.js');
  assert.match(device,/DEVICE_CAPABILITY_REQUIRED/);
  assert.match(permissions,/APP_USER_REQUIRED/);
  assert.match(permissions,/requireAdminOrDevice\(req,capability\)/);
  assert.match(imports,/requireCapability/);
  assert.doesNotMatch(imports,/requireAdminOrDevice/);
});

test('router and Vercel expose transport session without adding a serverless function',()=>{
  const router=read('api/router.js'),vercel=read('vercel.json');
  assert.match(router,/'device\/session'/);
  assert.match(vercel,/\/api\/device\/session/);
  assert.match(vercel,/\/api\/router\?route=device\/session/);
});

test('verified owner sessions survive reload and communication center navigation never hides every pane',()=>{
  const login=read('assets/owner-web-login.js'),navigation=read('assets/cloud-control-navigation-fix.js'),index=read('index.html');
  assert.match(login,/restoreCloudMarker/);
  assert.match(login,/localStorage\.setItem\(TOKEN_KEY,'device-session'\)/);
  assert.match(index,/owner-web-login\.js\?v=20260718-3/);
  assert.match(navigation,/This extension owns the communication-center tab/);
  assert.match(navigation,/window\.bhCloudView\?\.\('overview'\)/);
  assert.doesNotMatch(navigation,/runWithoutLegacyCommsNavigation/);
});

test('verified web login approval persists database-required approval metadata',()=>{
  const source=read('api/_lib/routes/web-auth.js'),verifyPath=source.slice(source.indexOf('export async function verifyWebLogin'));
  const approvedEnrollment=verifyPath.match(/saveEnrollment\(deviceId,\{status:'approved'[^;]+/u)?.[0]||'';
  assert.match(approvedEnrollment,/approved_at:new Date\(\)\.toISOString\(\)/);
  assert.match(approvedEnrollment,/approved_by:`telegram:\$\{telegramId\}`/);
});
