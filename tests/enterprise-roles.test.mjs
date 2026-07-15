import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES, ROLE_LABELS, allowed } from '../api/_lib/domain.js';
import { roleHomeRows } from '../api/_lib/bot-enterprise-defs.js';

const requiredRoles=['admin','manager','accountant','mechanic','block_sales','concrete_sales','collector','driver','employee','warehouse','fuel_operator','hr','procurement','quality'];

test('all operational roles are available',()=>{
  for(const role of requiredRoles){
    assert.ok(ROLES.includes(role),`${role} should be registered`);
    assert.ok(ROLE_LABELS[role],`${role} should have a label`);
  }
});

test('driver and employee permissions remain restricted',()=>{
  assert.equal(allowed('driver','attendance'),true);
  assert.equal(allowed('driver','fuel'),true);
  assert.equal(allowed('driver','approve'),false);
  assert.equal(allowed('employee','attendance'),true);
  assert.equal(allowed('employee','finance'),false);
});

test('manager role menu contains approvals and operational dashboard',()=>{
  const callbacks=roleHomeRows('manager').flat().map(button=>button.callback_data);
  assert.ok(callbacks.includes('ent:approvals'));
  assert.ok(callbacks.includes('ent:operations'));
  assert.ok(callbacks.includes('ent:finance_menu'));
});
