import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route=readFileSync(new URL('../api/_lib/routes/attendance-site-presets.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('../assets/attendance-site-presets.js',import.meta.url),'utf8');
const routerPath='../api/'+'router.js';
const router=readFileSync(new URL(routerPath,import.meta.url),'utf8');
const nav=readFileSync(new URL('../assets/admin-nav.js',import.meta.url),'utf8');

test('approved work-site presets are fixed in code',()=>{
  assert.match(route,/FACTORY_MAIN/);
  assert.match(route,/HZ877vVfkm7tp9e17/);
  assert.match(route,/radiusM:1000/);
  assert.match(route,/STATION_MAIN/);
  assert.match(route,/qSukur3khpuMS5PK9/);
  assert.match(route,/radiusM:250/);
});

test('preset route resolves and stores coordinates',()=>{
  assert.match(route,/coordinatesFromText/);
  assert.match(route,/redirect:'follow'/);
  assert.match(route,/upsert\('work_sites',rows,'code'\)/);
  assert.match(route,/latitude:site\.latitude/);
  assert.match(route,/longitude:site\.longitude/);
});

test('attendance admin loads preset integration',()=>{
  assert.match(router,/'attendance-site-presets'/);
  assert.match(nav,/attendance-site-presets\.js\?v=20260722-1/);
  assert.match(ui,/radiusM:1000/);
  assert.match(ui,/radiusM:250/);
});
