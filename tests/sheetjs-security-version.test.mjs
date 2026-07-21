import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readJson=async path=>JSON.parse(await readFile(new URL(`../${path}`,import.meta.url),'utf8'));
const OFFICIAL='https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz';

test('SheetJS uses the official 0.20.3 distribution',async()=>{
  const pkg=await readJson('package.json');
  const lock=await readJson('package-lock.json');
  assert.equal(pkg.dependencies.xlsx,OFFICIAL);
  assert.equal(pkg.overrides.xlsx,OFFICIAL);
  assert.equal(lock.packages[''].dependencies.xlsx,OFFICIAL);
  assert.equal(lock.packages['node_modules/xlsx'].version,'0.20.3');
  assert.equal(lock.packages['node_modules/xlsx'].resolved,OFFICIAL);
});

test('legacy vulnerable SheetJS dependency tree is absent',async()=>{
  const lock=await readJson('package-lock.json');
  const keys=Object.keys(lock.packages||{});
  assert.ok(!keys.includes('node_modules/adler-32'));
  assert.ok(!keys.includes('node_modules/cfb'));
  assert.ok(!keys.includes('node_modules/codepage'));
  assert.ok(!keys.includes('node_modules/wmf'));
  assert.notEqual(lock.packages['node_modules/xlsx'].version,'0.18.5');
});
