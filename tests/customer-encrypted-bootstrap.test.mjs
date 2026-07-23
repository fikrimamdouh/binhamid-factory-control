import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('encrypted customer bootstrap persists the package until authenticated cloud save succeeds',async()=>{
  const [bootstrap,index,login]=await Promise.all([
    read('assets/customer-opening-balances-bootstrap.js'),
    read('index.html'),
    read('assets/owner-web-login.js')
  ]);
  for(const marker of [
    "PACKAGE_MARKER='binhamid-customer-opening-package-v1'",
    "PENDING_KEY='binhamid_customer_seed_pending_v1'",
    'sessionStorage',
    'rememberPackage(pack)',
    'pendingPackage()',
    "error.status=response.status",
    "error?.status===401||error?.status===403",
    'requestOwnerLogin(pack)',
    'binhamid-owner-authenticated',
    'clearPackage()',
    'crypto.subtle.importKey',
    'AES-GCM',
    'DecompressionStream',
    "sourceHash===seed.sha",
    "stateRequest('/api/state'",
    "credentials:'same-origin'"
  ])assert.ok(bootstrap.includes(marker),`missing ${marker}`);
  assert.ok(!bootstrap.includes('2792 عميل'), 'customer rows must not be embedded in the public bootstrap source');
  for(const marker of ['r.status===429','Retry-After','cooldownUntil','button.disabled=true','binhamid-owner-authenticated','SESSION_TIMEOUT=2500'])assert.ok(login.includes(marker),`missing login guard ${marker}`);
  assert.match(index,/owner-web-login\.js\?v=20260723-final-lock-1/);
  assert.match(index,/customer-opening-balances-bootstrap\.js\?v=20260719-2/);
  assert.match(index,/loadOptionalExtensions\(win,optionalExtensions,load,sequence\)/);
});
