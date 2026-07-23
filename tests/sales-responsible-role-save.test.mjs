import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveEmployeeDeclarationRole } from '../api/_lib/employee-declaration-role.js';

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('Arabic sales job titles resolve to the canonical declaration roles',()=>{
  assert.equal(resolveEmployeeDeclarationRole({jobTitle:'مسؤول مبيعات الخرسانة'}).role,'concrete_sales');
  assert.equal(resolveEmployeeDeclarationRole({jobTitle:'مسؤول مبيعات البلوك'}).role,'block_sales');
});

test('canonical employee save verifies the final role while preserving the visible job title',()=>{
  const route=read('api/_lib/routes/canonical-master-data.js');
  assert.match(route,/resolveEmployeeDeclarationRole\(\{jobTitle,telegramRole:/);
  assert.match(route,/metadata=\{\.\.\.existingMetadata,jobTitle,/);
  assert.match(route,/job_title:clean\(metadata\.jobTitle/);
  assert.match(route,/jobTitle=clean\(object\(employee\.metadata\)\.jobTitle/);
});

test('the fixed employee identities are the sole block and concrete sales references',()=>{
  const route=read('api/_lib/routes/canonical-master-data.js');
  assert.match(route,/nationalId:'2414111530',role:'concrete_sales',jobTitle:'مسؤول مبيعات الخرسانة',costCenterCode:'concrete'/);
  assert.match(route,/nationalId:'2370328136',role:'block_sales',jobTitle:'مسؤول مبيعات البلوك',costCenterCode:'block'/);
  assert.match(route,/canonical_sales_responsible_fixed/);
  assert.match(route,/employee_assignments[\s\S]*job_title:target\.jobTitle/);
  assert.match(route,/app_users[\s\S]*role:target\.role/);
});

test('browser read-back verifies the visible title and legacy import accepts canonical roles',()=>{
  const guard=read('assets/master-data-workspace-guards.js');
  const legacy=read('legacy.html');
  assert.match(guard,/row\.job_title\|\|row\.role/);
  assert.match(legacy,/concrete_sales/);
  assert.match(legacy,/block_sales/);
  assert.match(legacy,/declarationRole/);
});
