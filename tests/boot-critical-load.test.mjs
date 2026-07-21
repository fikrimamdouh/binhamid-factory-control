import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('boot reveals the app after critical modules without waiting for every extension',()=>{
  assert.match(index,/const criticalExtensions=\[/);
  assert.match(index,/const optionalExtensions=\[/);
  assert.match(index,/await Promise\.all\(criticalExtensions/);
  assert.match(index,/void Promise\.all\(optionalExtensions/);
  assert.match(index,/revealFrame\(\)/);
});

test('slow optional modules do not trigger the old false timeout error',()=>{
  assert.match(index,/if\(frameLoaded&&!completed\)/);
  assert.match(index,/استكمال الوحدات في الخلفية/);
  assert.match(index,/if\(!frameLoaded\)fail/);
  assert.doesNotMatch(index,/if\(!completed\)fail\(new Error\('استغرق التحميل وقتًا أطول من المتوقع/);
});

test('the iframe cache key changes for the revision-first boot contract',()=>{
  assert.match(index,/legacy\.html\?v=20260721-state-revision-1/);
  assert.match(index,/state-load-performance\.js\?v=20260721-1/);
});