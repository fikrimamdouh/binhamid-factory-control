import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const legacyRoute=read('api/_lib/routes/master-data.js');
const canonicalRoute=read('api/_lib/routes/canonical-master-data.js');
const page=read('master-data.html');
const guard=read('assets/master-data-workspace-guards.js');
const runtime=read('assets/vehicle-master-link.js');
const index=read('index.html');
const cleanup=read('api/_lib/routes/permanent-cleanup.js');
const fuelControl=read('assets/internal-fuel-control.js');

test('exact plate matches link diesel identity to one ERP asset without a migration',()=>{
  assert.match(legacyRoute,/auto_link_erp_references/);
  assert.match(legacyRoute,/auto_exact_plate/);
  assert.match(legacyRoute,/normalizePlate/);
  assert.match(legacyRoute,/matches\.length>1/);
  assert.match(canonicalRoute,/auto_link_exact_plate/);
  assert.match(canonicalRoute,/referenceId/);
});

test('master data page receives canonical rows and exposes one visible asset editor',()=>{
  assert.match(page,/دمج اللوحات المتطابقة/);
  assert.match(page,/state\.assets=Array\.isArray\(data\.canonicalAssets\)/);
  assert.match(page,/source_type==='diesel_erp'/);
  assert.match(page,/ديزل \+ ERP/);
  assert.match(page,/action:'auto_link_exact_plate'/);
  assert.match(page,/action:'save_asset'/);
  assert.match(canonicalRoute,/canonicalProjection/);
  assert.match(canonicalRoute,/referenced\.has/);
  assert.match(guard,/ensureCurrentErp/);
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