import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const permissions=readFileSync(new URL('../api/_lib/permissions.js',import.meta.url),'utf8');
const masterData=readFileSync(new URL('../api/_lib/routes/master-data.js',import.meta.url),'utf8');

test('manager and accountant can persist vehicle and ERP master-data links',()=>{
  assert.match(permissions,/manager:\[[^\]]*'assets\.manage'/s);
  assert.match(permissions,/accountant:\[[^\]]*'assets\.manage'/s);
  assert.match(permissions,/mechanic:\[[^\]]*'assets\.manage'/s);
});

test('vehicle linking and status writes remain protected by assets.manage',()=>{
  assert.match(masterData,/assignAssetEmployee[\s\S]*requireCapability\(req,'assets\.manage'\)/);
  assert.match(masterData,/assignErpReference[\s\S]*requireCapability\(req,'assets\.manage'\)/);
  assert.match(masterData,/auto_link_erp_references'[\s\S]*requireCapability\(req,'assets\.manage'\)/);
  assert.match(masterData,/updateAssetStatus[\s\S]*requireCapability\(req,'assets\.manage'\)/);
});

test('read-only fuel operator does not receive asset mutation rights',()=>{
  assert.match(permissions,/fuel_operator:\['fuel\.import','assets\.view'\]/);
  assert.doesNotMatch(permissions,/fuel_operator:\[[^\]]*'assets\.manage'/s);
});
