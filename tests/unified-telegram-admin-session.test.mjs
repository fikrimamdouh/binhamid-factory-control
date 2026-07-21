import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('all standalone admin pages load one Telegram owner session',async()=>{
  const nav=await read('assets/admin-nav.js');
  assert.match(nav,/owner-web-login\.js/);
  assert.match(nav,/الموظفون والمعدات/);
  assert.match(nav,/\/master-data\.html/);
  assert.match(nav,/binhamid-owner-authenticated/);
  assert.match(nav,/refreshCurrentPage/);
  assert.doesNotMatch(nav,/\['🔗','ربط جهاز بمستخدم'/);
  assert.match(nav,/name==='device-access'\)location\.replace\('\/control-center\.html'\)/);
});

test('approved Telegram device session refreshes silently and removes legacy token state',async()=>{
  const login=await read('assets/owner-web-login.js');
  assert.match(login,/refreshExistingSession/);
  assert.match(login,/\/api\/device\/session/);
  assert.match(login,/data\.bound===true/);
  assert.match(login,/sessionStorage\.removeItem\('binhamid_admin_token'\)/);
  assert.match(login,/هذا الجهاز أصبح معتمدًا ولن يطلب اعتمادًا آخر/);
  assert.match(login,/REFRESH_INTERVAL=6\*60\*60\*1000/);
});

test('signed device cookie is long-lived while business permissions remain server-side',async()=>{
  const session=await read('api/_lib/device-session.js');
  const permissions=await read('api/_lib/permissions.js');
  assert.match(session,/MAX_AGE_SECONDS=365\*24\*60\*60/);
  assert.match(session,/HttpOnly; SameSite=Lax/);
  assert.match(session,/DEVICE_CAPABILITIES=Object\.freeze\(\[\]\)/);
  assert.match(permissions,/requireCapability/);
  assert.match(permissions,/role_capabilities/);
  assert.match(permissions,/user_capabilities/);
});

test('master data import still requires an authenticated authorized user',async()=>{
  const route=await read('api/_lib/routes/master-data.js');
  assert.match(route,/requireCapability\(req,'governance\.view'\)/);
  assert.match(route,/requireCapability\(req,'assets\.manage'\)/);
  assert.doesNotMatch(route,/requireAdmin\(/);
});
