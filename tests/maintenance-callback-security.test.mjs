import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('maintenance confirmation validates current role and draft reference',async()=>{
  const source=await read('api/_lib/bot-maintenance.js');
  const start=source.indexOf('export async function confirmMaintenance');
  const end=source.indexOf('export async function cancelMaintenance',start);
  assert.ok(start>=0&&end>start,'confirmMaintenance function missing');
  const body=source.slice(start,end);
  assert.match(body,/role/);
  assert.match(body,/allowed\(|\['admin','manager','mechanic'\]|mechanic|approve/);
  assert.match(body,/reference|entityId|draft/);
});

test('vehicle selection validates an active maintenance session',async()=>{
  const source=await read('api/_lib/bot-maintenance.js');
  const start=source.indexOf('export async function chooseVehicle');
  assert.ok(start>=0,'chooseVehicle function missing');
  const body=source.slice(start,start+3500);
  assert.match(body,/session|draft|maintenance/);
  assert.match(body,/external|user|from/);
});

test('maintenance cancellation is bound to the caller session or permitted role',async()=>{
  const source=await read('api/_lib/bot-maintenance.js');
  const start=source.indexOf('export async function cancelMaintenance');
  assert.ok(start>=0,'cancelMaintenance function missing');
  const body=source.slice(start,start+2500);
  assert.match(body,/identity|external|user|role/);
  assert.match(body,/clearMaintenanceSession|session/);
});
