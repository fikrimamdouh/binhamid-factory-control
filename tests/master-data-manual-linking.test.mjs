import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('master data route links and unlinks an asset in both persistent tables',()=>{
  const route=read('api/_lib/routes/master-data.js');
  assert.match(route,/assignAssetEmployee/);
  assert.match(route,/action==='assign_asset_employee'/);
  assert.match(route,/requireCapability\(req,'assets\.manage'\)/);
  assert.match(route,/patch\('unified_assets'/);
  assert.match(route,/assigned_employee_external_id:nextEmployeeExternalId/);
  assert.match(route,/patch\('vehicles'/);
  assert.match(route,/driver_external_id:nextEmployeeExternalId/);
  assert.match(route,/master_asset_employee_linked/);
  assert.match(route,/master_asset_employee_unlinked/);
  assert.match(route,/unlinkedDieselAssets/);
});

test('master data page displays unlinked diesel plates and saves a selected employee',()=>{
  const page=read('master-data.html');
  assert.match(page,/ربط لوحات الديزل بالموظفين/);
  assert.match(page,/data-asset-select/);
  assert.match(page,/data-link-asset/);
  assert.match(page,/data-unlink-asset/);
  assert.match(page,/diesel_expected===true/);
  assert.match(page,/action:'assign_asset_employee'/);
  assert.match(page,/employeeExternalId/);
  assert.match(page,/غير المرتبطة فقط/);
});
