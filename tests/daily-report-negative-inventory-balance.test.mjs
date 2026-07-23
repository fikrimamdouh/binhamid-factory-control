import test from 'node:test';
import assert from 'node:assert/strict';
import {validateInventoryRows} from '../api/_lib/routes/daily-report.js';

test('negative opening inventory is preserved as a warning while movements stay non-negative',()=>{
  const result=validateInventoryRows([{
    itemCode:'10020006',
    itemName:'بلك اسود مقاس 20*20*40 سم',
    opening:-7362,
    received:10400,
    issued:1685,
    closing:1353
  }]);
  assert.equal(result.errors.length,0);
  assert.equal(result.warnings.length,1);
  assert.equal(result.warnings[0].code,'NEGATIVE_INVENTORY_BALANCE');
  assert.equal(result.warnings[0].path,'inventory[0].opening');
});

test('negative received or issued movement remains a blocking validation error',()=>{
  const result=validateInventoryRows([{
    itemCode:'10020006',
    itemName:'بلك',
    opening:10,
    received:-1,
    issued:0,
    closing:9
  }]);
  assert.equal(result.errors.length,1);
  assert.equal(result.errors[0].code,'NEGATIVE_INVENTORY_MOVEMENT');
  assert.equal(result.warnings.length,0);
});
