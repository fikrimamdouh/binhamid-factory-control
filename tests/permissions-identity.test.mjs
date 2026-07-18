import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCapabilityGateway } from '../api/_lib/permissions.js';

const device={kind:'device',role:'device',actor:'device:dev-test-12345678',deviceId:'dev-test-12345678',capabilities:['state.read','state.write','imports.status.sync']};
const admin={kind:'admin',role:'admin',actor:'web-admin'};

test('missing app user never becomes an administrator through a device session',()=>{
  assert.throws(
    ()=>resolveCapabilityGateway(device,'','daily_report.approve'),
    error=>error?.status===401&&error?.code==='APP_USER_REQUIRED'&&error?.capability==='daily_report.approve'
  );
});

test('device can execute only an explicitly signed technical capability without an app user',()=>{
  const identity=resolveCapabilityGateway(device,null,'state.read');
  assert.equal(identity.kind,'device');
  assert.equal(identity.role,'device');
  assert.equal(identity.appUserId,null);
  assert.deepEqual(identity.capabilities,device.capabilities);
});

test('real admin token may act as system administrator without an app user header',()=>{
  const identity=resolveCapabilityGateway(admin,'','daily_report.approve');
  assert.equal(identity.kind,'admin');
  assert.equal(identity.role,'admin');
  assert.deepEqual(identity.capabilities,['*']);
});

test('a supplied app user id always continues to database role verification',()=>{
  assert.equal(resolveCapabilityGateway(device,'user-123','daily_report.approve'),null);
  assert.equal(resolveCapabilityGateway(admin,'user-123','daily_report.approve'),null);
});
