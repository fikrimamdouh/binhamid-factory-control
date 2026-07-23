import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('boot reveals the app after critical modules without waiting for every extension',()=>{
  assert.match(index,/const criticalExtensions=\[/);
  assert.match(index,/const optionalExtensions=\[/);
  assert.match(index,/await Promise\.all\(criticalExtensions/);
  assert.match(index,/void loadOptionalExtensions\(win,optionalExtensions,load,sequence\)/);
  assert.match(index,/revealFrame\(\)/);
});

test('optional modules load sequentially in idle slices instead of one blocking burst',()=>{
  assert.match(index,/function browserIdle\(win\)/);
  assert.match(index,/requestIdleCallback/);
  assert.match(index,/for\s*\(\s*const\s*\[\s*id\s*,\s*src\s*\]\s*of\s*extensions\s*\)/);
  assert.match(index,/await browserIdle\(win\)/);
  assert.doesNotMatch(index,/Promise\.all\(optionalExtensions/);
});

test('slow optional modules do not trigger the old false timeout error',()=>{
  assert.match(index,/if\(frameLoaded&&!completed\)/);
  assert.match(index,/استكمال الوحدات في الخلفية/);
  assert.match(index,/if\(!frameLoaded\)fail/);
  assert.doesNotMatch(index,/if\(!completed\)fail\(new Error\('استغرق التحميل وقتًا أطول من المتوقع/);
});

test('the iframe and repaired modules have explicit cache revisions',()=>{
  assert.match(index,/legacy\.html\?v=20260722-vehicle-preflight-1/);
  assert.match(index,/owner-web-login\.js\?v=20260723-final-lock-1/);
  assert.match(index,/single-master-workspace\.js\?v=20260723-1/);
  assert.doesNotMatch(index,/attendance-control\.js\?v=/);
  assert.match(index,/state-load-performance\.js\?v=20260722-3/);
  assert.match(index,/sync-integrity-guard\.js\?v=20260723-5/);
  assert.match(index,/canonical-declaration-texts\.js\?v=20260722-2/);
  assert.match(index,/telegram-pdf-declarations\.js\?v=20260723-8/);
  assert.match(index,/default-sales-reps\.js\?v=20260722-4/);
  assert.match(index,/vehicle-master-link\.js\?v=20260723-2/);
  assert.match(index,/declaration-workspace-fixes\.js\?v=20260723-1/);
});
