import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('shell waits for critical extensions and loads optional modules in idle background slices',async()=>{
  const source=await read('index.html');
  assert.match(source,/await Promise\.all\(criticalExtensions\.map/);
  assert.match(source,/void loadOptionalExtensions\(win,optionalExtensions,load,sequence\)/);
  assert.match(source,/requestIdleCallback/);
  assert.match(source,/await browserIdle\(win\)/);
  assert.match(source,/frame\.style\.visibility='hidden'/);
  assert.match(source,/revealFrame\(\)/);
  assert.match(source,/sequence!==loadSequence/);
  assert.match(source,/script\.dataset\.loaded='1'/);
  assert.doesNotMatch(source,/Promise\.all\(optionalExtensions\.map/);
  assert.doesNotMatch(source,/await Promise\.all\(extensions\.map/);
});
