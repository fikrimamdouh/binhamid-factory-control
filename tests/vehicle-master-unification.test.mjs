import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const route=read('api/_lib/routes/master-data.js');
const page=read('master-data.html');
const runtime=read('assets/vehicle-master-link.js');
const index=read('index.html');
const cleanup=read('api/_lib/routes/permanent-cleanup.js');
const fuelControl=read('assets/internal-fuel-control.js');

test('exact plate matches link diesel identity to one ERP asset without a migration',()=>{
  assert.match(route,/auto_link_erp_references/);
  assert.match(route,/auto_exact_plate/);
  assert.match(route,/normalizePlate/);
  assert.match(route,/matches\.length>1/);
  assert.match(route,/unifiedAssets/);
  assert.match(route,/linkedErpIds/);
});

test('master data page collapses linked ERP rows into one visible asset',()=>{
  assert.match(page,/ربط اللوحات المتطابقة تلقائيًا/);
  assert.match(page,/function unifiedAssets\(\)/);
  assert.match(page,/referencedErpIds/);
  assert.match(page,/موحد: ديزل \+ ERP/);
  assert.match(page,/stats\.unifiedAssets/);
  assert.match(page,/action:'auto_link_erp_references'/);
});

test('legacy vehicle state and fuel costs share the canonical vehicle id',()=>{
  assert.match(runtime,/exact plate duplicates share one vehicle id/);
  assert.match(runtime,/vehicles\.splice/);
  assert.match(runtime,/row\.vehicleId=id/);
  assert.match(runtime,/rewriteObject\(ops,aliases,canonicalId/);
  assert.match(index,/vehicle-master-link\.js\?v=20260722-1/);
});

test('vehicle renderer globals exist before legacy navigation starts',()=>{
  assert.match(index,/src="about:blank" data-src="\/legacy\.html\?v=20260722-vehicle-preflight-1"/);
  assert.match(index,/const vehiclePreflight=setInterval/);
  assert.match(index,/installVehicleGlobals\(frame\.contentWindow\);legacyStarted=true;frame\.src=frame\.dataset\.src/);
  assert.match(index,/typeof win\.bh4DieselExpected!=='function'/);
});

test('DGD-7293 Renault is removed from equipment while diesel exclusion stays unchanged',()=>{
  assert.match(cleanup,/DGD7293/);
  assert.match(cleanup,/dieselExclusionChanged:false/);
  assert.match(cleanup,/requireCapability\(req,'assets\.manage'\)/);
  assert.match(fuelControl,/excludedVehicle:'Renault'/);
  assert.match(fuelControl,/excludedDriver:'فكري ممدوح'/);
  assert.doesNotMatch(fuelControl,/DGD-7293/);
});
