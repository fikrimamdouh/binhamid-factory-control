import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../assets/owner-web-login.js',import.meta.url),'utf8');

test('existing device session check cannot keep the page locked indefinitely',()=>{
  assert.match(source,/SESSION_TIMEOUT=2500/);
  assert.match(source,/new AbortController\(\)/);
  assert.match(source,/setTimeout\(\(\)=>controller\.abort\(\),timeout\)/);
  assert.match(source,/binhamid-session-degraded/);
  assert.match(source,/استمر النظام بالجلسة المحلية دون تعطيل الصفحة/);
  assert.match(source,/function scheduleSessionRetry\(\)/);
  assert.match(source,/sessionRetryCount>=4/);
  assert.match(source,/1500\*\(2\*\*\(sessionRetryCount-1\)\)/);
  assert.match(source,/if\(ok\)\{unlock\(\);return true;\}/);
});

test('invalid bound session still clears local access and shows the login gate',()=>{
  assert.match(source,/data\.bound===false\)\{sessionRetryCount=0;clearTimeout\(sessionRetryTimer\);clearLocalSession\(\);return false;\}/);
  assert.match(source,/response\.status===401\|\|response\.status===403/);
  assert.match(source,/resetGate\(\);show\(\);lock\(\);return false/);
});

test('cloud writers receive a signal only after the server verifies the session',()=>{
  assert.match(source,/SESSION_VERIFIED_KEY='binhamid_owner_session_verified_v1'/);
  assert.match(source,/function markVerifiedSession/);
  assert.match(source,/sessionStorage\.setItem\(SESSION_VERIFIED_KEY,id\)/);
  assert.match(source,/binhamid-owner-session-verified/);
  assert.match(source,/data\.bound===true\)\{restoreCloudMarker\(\);markVerifiedSession\(\);return true;\}/);
  assert.match(source,/clearVerifiedSession\(\);\n    try\{/);
});

test('the mandatory login gate cannot be dismissed into a blank locked screen',()=>{
  assert.doesNotMatch(source,/id="bhOwnerCancel"/);
  assert.doesNotMatch(source,/box\.classList\.remove\('on'\)/);
  assert.match(source,/id="bhOwnerSend"/);
});
