import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(new URL('..',import.meta.url).pathname);

test('loader injects cloud assets into preserved legacy program',()=>{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.match(html,/legacy\.html/);
  assert.match(html,/cloud-control\.js/);
  assert.match(html,/cloud-control\.css/);
});

test('migration contains atomic revision control and private storage',()=>{
  const sql=fs.readFileSync(path.join(root,'supabase/migrations/001_initial_schema.sql'),'utf8');
  assert.match(sql,/save_app_state/);
  assert.match(sql,/revision conflict/);
  assert.match(sql,/enable row level security/);
  assert.match(sql,/factory-documents/);
});

test('no secrets are committed in the environment example',()=>{
  const env=fs.readFileSync(path.join(root,'.env.example'),'utf8');
  assert.doesNotMatch(env,/sk-[A-Za-z0-9]{20,}/);
  assert.match(env,/REPLACE_IN_VERCEL_ONLY/);
});
