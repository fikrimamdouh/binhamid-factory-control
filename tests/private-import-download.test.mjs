import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('private import download remains admin-only and streams stored bytes',async()=>{
  const route=await read('api/_lib/routes/imports.js');
  for(const marker of ['requireAdmin(req)','downloadObject(record.file_path)','Content-Disposition','Cache-Control','no-store, private','Content-Length'])assert.ok(route.includes(marker),`missing ${marker}`);
  assert.match(route,/id=eq\.\$\{encodeURIComponent\(id\)\}/);
  assert.doesNotMatch(route,/storage\/v1\/object\/public/);
  assert.doesNotMatch(route,/signedUrl|createSignedUrl/i);
});

test('router and Vercel expose one consolidated protected file route',async()=>{
  const router=await read('api/router.js'),vercel=JSON.parse(await read('vercel.json'));
  assert.match(router,/'imports\/file':imports\.download/);
  assert.ok(vercel.rewrites.some(item=>item.source==='/api/imports/file'&&item.destination==='/api/router?route=imports/file'));
  assert.equal(Object.keys(vercel.functions).length,1);
});
