import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCapabilityGateway } from '../api/_lib/permissions.js';

const userId='11111111-1111-4111-8111-111111111111',otherUserId='22222222-2222-4222-8222-222222222222';
const device={kind:'device',role:'device',actor:'device:dev-test-12345678',deviceId:'dev-test-12345678',appUserId:null,capabilities:['state.read','state.write','imports.read','imports.status.sync']};
const boundDevice={...device,appUserId:userId};
const admin={kind:'admin',role:'admin',actor:'web-admin'};

test('missing app user never becomes an administrator through an unbound device session',()=>{
  assert.throws(()=>resolveCapabilityGateway(device,'','daily_report.approve'),error=>error?.status===401&&error?.code==='APP_USER_REQUIRED'&&error?.capability==='daily_report.approve');
});

test('unbound device cannot supply an arbitrary active user id',()=>{
  assert.throws(()=>resolveCapabilityGateway(device,userId,'daily_report.approve'),error=>error?.status===403&&error?.code==='DEVICE_USER_NOT_BOUND');
});

test('bound device rejects a different user header',()=>{
  assert.throws(()=>resolveCapabilityGateway(boundDevice,otherUserId,'daily_report.approve'),error=>error?.status===403&&error?.code==='DEVICE_USER_MISMATCH');
});

test('bound device continues to database role verification with its signed user id',()=>{
  const noHeader=resolveCapabilityGateway(boundDevice,'','daily_report.approve'),matchingHeader=resolveCapabilityGateway(boundDevice,userId,'daily_report.approve');
  assert.equal(noHeader.lookupAppUserId,userId);
  assert.equal(matchingHeader.lookupAppUserId,userId);
  assert.equal(noHeader.gateway.deviceId,boundDevice.deviceId);
});

test('unbound device can execute only an explicitly signed technical capability',()=>{
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

test('admin token with an explicit user id continues to database role verification',()=>{
  const resolution=resolveCapabilityGateway(admin,userId,'daily_report.approve');
  assert.equal(resolution.lookupAppUserId,userId);
  assert.equal(resolution.gateway.kind,'admin');
});
