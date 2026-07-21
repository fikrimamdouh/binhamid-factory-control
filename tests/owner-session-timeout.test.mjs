import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../assets/owner-web-login.js',import.meta.url),'utf8');

test('existing device session check cannot keep the page locked indefinitely',()=>{
  assert.match(source,/SESSION_TIMEOUT=2500/);
  assert.match(source,/new AbortController\(\)/);
  assert.match(source,/setTimeout\(\(\)=>controller\.abort\(\),timeout\)/);
  assert.match(source,/session check timed out/);
  assert.match(source,/if\(ok\)\{unlock\(\);return true;\}/);
});

test('invalid bound session still clears local access and shows the login gate',()=>{
  assert.match(source,/data\.bound===false\)\{clearLocalSession\(\);return false;\}/);
  assert.match(source,/response\.status===401\|\|response\.status===403/);
  assert.match(source,/resetGate\(\);show\(\);lock\(\);return false/);
});
