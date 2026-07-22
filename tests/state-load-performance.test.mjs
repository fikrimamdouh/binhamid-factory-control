import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here=dirname(fileURLToPath(import.meta.url));
const read=(...parts)=>readFileSync(join(here,'..',...parts),'utf8');
const stateApi=read('api','state.js');
const loginSync=read('assets','login-sync.js');
const bootGuard=read('assets','state-load-performance.js');
const index=read('index.html');

test('state endpoint offers metadata without enriching the full payload',()=>{
  assert.match(stateApi,/metaOnly/);
  assert.match(stateApi,/key,revision,updated_at,updated_by,device_id/);
  assert.match(stateApi,/if\(metaOnly\)return json/);
  const metaBranch=stateApi.slice(stateApi.indexOf('if(metaOnly)return json'),stateApi.indexOf('const payload=await enrichStatePayload'));
  assert.doesNotMatch(metaBranch,/enrichStatePayload/);
});

test('login sync checks revision before downloading state',()=>{
  assert.match(loginSync,/pullMeta\(\)/);
  assert.match(loginSync,/revisionBefore===remoteRevision/);
  assert.match(loginSync,/\/api\/state\?full=1/);
  assert.match(loginSync,/revision unchanged/);
  assert.doesNotMatch(loginSync,/retryTimer/);
  assert.doesNotMatch(loginSync,/setTimeout\(function\(\)\{if\(userId\(\)&&!localClientCount/);
});

test('automatic cloud boot state request is deferred until an approved session exists',()=>{
  assert.match(bootGuard,/automatic full state request replaced with session-gated revision metadata/);
  assert.match(bootGuard,/bootStateRequestHandled/);
  assert.match(bootGuard,/\/api\/state\?meta=1/);
  assert.match(bootGuard,/info\.url\.pathname==='\/api\/state'/);
  assert.match(bootGuard,/X-App-User-Id/);
  assert.match(bootGuard,/Authorization/);
  assert.match(bootGuard,/credentials='same-origin'/);
  assert.match(bootGuard,/session&&session\.bound===true/);
  assert.match(bootGuard,/deferredAuth:true/);
  assert.doesNotMatch(bootGuard,/bhRefreshOwnerSession/);
});

test('boot reveals after auth and revision scripts while optional modules load later',()=>{
  const critical=index.slice(index.indexOf('const criticalExtensions=['),index.indexOf('const optionalExtensions=['));
  assert.match(critical,/owner-web-login/);
  assert.match(critical,/login-sync/);
  assert.doesNotMatch(critical,/attendance-control/);
  assert.doesNotMatch(critical,/telegram-pdf-declarations/);
  assert.match(index,/state-load-performance\.js\?v=20260722-3/);
  assert.ok(index.indexOf('state-load-performance.js')<index.indexOf('cloud-control.js'));
  assert.match(index,/}},6000\)/);
});