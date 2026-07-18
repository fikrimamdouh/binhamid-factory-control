import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('shell keeps iframe hidden until cloud extensions finish loading',async()=>{
  const source=await read('index.html');
  assert.match(source,/await Promise\.all\(extensions\.map/);
  assert.match(source,/frame\.style\.visibility='hidden'/);
  assert.match(source,/frame\.style\.visibility='visible'/);
  assert.match(source,/sequence!==loadSequence/);
  assert.match(source,/script\.dataset\.loaded='1'/);
});
