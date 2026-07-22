import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cleanup=readFileSync(new URL('../assets/default-sales-reps.js',import.meta.url),'utf8');
const stateLoad=readFileSync(new URL('../assets/state-load-performance.js',import.meta.url),'utf8');
const index=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('placeholder sales employees are permanently removed and never recreated',()=>{
  assert.match(cleanup,/مسؤول مبيعات البلوك/);
  assert.match(cleanup,/مسؤول مبيعات الخرسانة/);
  assert.match(cleanup,/permanent_delete_employee/);
  assert.match(cleanup,/list\.splice\(index,1\)/);
  assert.doesNotMatch(cleanup,/D\.emp\.push/);
  assert.doesNotMatch(cleanup,/PLACEHOLDERS/);
  assert.match(index,/default-sales-reps\.js\?v=20260722-3/);
});

test('boot metadata request is deferred until an approved session exists',()=>{
  assert.match(stateLoad,/session-gated revision metadata/);
  assert.match(stateLoad,/session&&session\.bound===true/);
  assert.match(stateLoad,/deferredAuth:true/);
  assert.match(stateLoad,/response\.status===401\|\|response\.status===403/);
  assert.doesNotMatch(stateLoad,/refreshSessionOnce/);
  assert.match(index,/state-load-performance\.js\?v=20260722-3/);
});
