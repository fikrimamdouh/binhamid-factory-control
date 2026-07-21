import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('logout clears signed cookie and requires same-origin request',async()=>{
  const route=await read('api/_lib/routes/device-session.js');
  const session=await read('api/_lib/device-session.js');
  assert.match(route,/input\.action==='logout'/);
  assert.match(route,/assertSameOrigin\(req\)/);
  assert.match(route,/clearDeviceSession\(req,res\)/);
  assert.match(route,/mode:'logged-out'/);
  assert.match(session,/Max-Age=0/);
  assert.match(session,/HttpOnly/);
  assert.match(session,/SameSite=Lax/);
});

test('browser logout removes identity and temporary sync markers but preserves business data',async()=>{
  const source=await read('assets/session-controls.js');
  for(const key of ['binhamid_cloud_app_user_id','binhamid_cloud_access_token','binhamid_cloud_device_id','binhamid_cloud_pending','binhamid_cloud_conflict_lock_v1','bh_login_sync_done_v2'])assert.match(source,new RegExp(key));
  assert.doesNotMatch(source,/removeItem\(['"]binhamid_v1['"]\)/);
  assert.doesNotMatch(source,/removeItem\(['"]binhamid_factory_control_v3['"]\)/);
  assert.doesNotMatch(source,/localStorage\.clear\s*\(/);
  assert.doesNotMatch(source,/sessionStorage\.clear\s*\(/);
  assert.match(source,/action:'logout'/);
  assert.match(source,/location\.replace\('\/\?renewSession=1'\)/);
});

test('main and admin shells load one reusable logout control',async()=>{
  const [index,nav]=await Promise.all([read('index.html'),read('assets/admin-nav.js')]);
  assert.match(index,/session-controls\.js/);
  assert.match(nav,/ensureSessionControls/);
  assert.match(nav,/session-controls\.js/);
});
