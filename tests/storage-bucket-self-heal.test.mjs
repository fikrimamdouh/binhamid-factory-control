import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('missing Supabase Storage bucket is created privately and upload is retried once',async()=>{
  const source=await read('api/_lib/supabase.js');
  for(const marker of ["NoSuchBucket","/storage/v1/bucket","public:false","upload_after_bucket_create","x-upsert","storageOperation:'create_bucket'"]){
    assert.ok(source.includes(marker),`missing ${marker}`);
  }
  assert.match(source,/await createPrivateStorageBucket\(bucket\)/);
  assert.match(source,/try\{return await upload\(\);\}/);
});

test('new Supabase secret keys stay in the apikey header instead of Bearer authorization',async()=>{
  const source=await read('api/_lib/supabase.js');
  assert.match(source,/!key\.startsWith\('sb_secret_'\)/);
  assert.match(source,/headers = \{ apikey: key/);
});
