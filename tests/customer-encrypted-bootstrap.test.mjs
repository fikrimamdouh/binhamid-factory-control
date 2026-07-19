import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('encrypted customer bootstrap is loaded without embedding customer data in the repository',async()=>{
  const [bootstrap,index]=await Promise.all([
    read('assets/customer-opening-balances-bootstrap.js'),
    read('index.html')
  ]);
  for(const marker of [
    "PACKAGE_MARKER='binhamid-customer-opening-package-v1'",
    "HASH_PARAM='customer-seed'",
    "crypto.subtle.importKey",
    "AES-GCM",
    "DecompressionStream",
    "sourceHash===seed.sha",
    "customerOpeningBalanceImport",
    "stateRequest('/api/state'",
    "credentials:'same-origin'"
  ])assert.ok(bootstrap.includes(marker),`missing ${marker}`);
  assert.ok(!bootstrap.includes('2792 عميل'), 'customer rows must not be embedded in the public bootstrap source');
  assert.match(index,/customer-opening-balances-bootstrap\.js\?v=20260719-1/);
});
