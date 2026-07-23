import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalReferenceId } from '../api/_lib/routes/canonical-master-data.js';

test('canonical master data tolerates assets without ERP metadata',()=>{
  assert.equal(canonicalReferenceId(null),'');
  assert.equal(canonicalReferenceId({}),'');
  assert.equal(canonicalReferenceId({metadata:{}}),'');
  assert.equal(canonicalReferenceId({metadata:{erpReference:null}}),'');
  assert.equal(canonicalReferenceId({metadata:{erpReference:'legacy-text'}}),'');
  assert.equal(canonicalReferenceId({metadata:{erpReference:{externalId:'erp-42'}}}),'erp-42');
  assert.equal(canonicalReferenceId({metadata:{erpReference:{externalKey:'legacy-7'}}}),'legacy-7');
});
