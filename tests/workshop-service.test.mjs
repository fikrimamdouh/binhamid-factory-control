import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { workshopServiceInternals } from '../api/_lib/workshop-service.js';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('workshop service routes all state changes through atomic RPC commands',async()=>{
  const source=await read('api/_lib/workshop-service.js');
  assert.match(source,/workshop_create_order/);
  assert.match(source,/workshop_transition_order/);
  assert.match(source,/workshop_assign_technician/);
  assert.match(source,/validateWorkshopTransition/);
  assert.doesNotMatch(source,/patch\('maintenance_orders',[^\n]*\{status:/);
  for(const marker of ['requestId','expectedVersion','maintenance_status_history','workshop_order_cost_summary'])assert.match(source,new RegExp(marker));
});

test('workshop API is capability scoped and registered under one router function',async()=>{
  const [route,router,vercel,permissions]=await Promise.all([
    read('api/_lib/routes/workshop.js'),read('api/router.js'),read('vercel.json'),read('api/_lib/permissions.js')
  ]);
  for(const capability of ['workshop.view','workshop.create','workshop.update','workshop.manage','workshop.approve','workshop.close','workshop.diagnose','workshop.labor','workshop.parts.manage'])assert.match(`${route}\n${permissions}`,new RegExp(capability.replace('.','\\.')));
  assert.match(router,/'workshop':workshop\.workshop/);
  assert.match(vercel,/"source":"\/api\/workshop","destination":"\/api\/router\?route=workshop"/);
});

test('service migrations protect idempotency, optimistic locking and source synchronization',async()=>{
  const [service,compatibility]=await Promise.all([
    read('supabase/migrations/026_workshop_service_rpcs.sql'),read('supabase/migrations/027_workshop_service_compatibility.sql')
  ]);
  for(const marker of ['workshop_command_receipts','pg_advisory_xact_lock','WORKSHOP_VERSION_CONFLICT','workshop_create_order','workshop_transition_order','workshop_assign_technician','maintenance_order_id','workshop.approve'])assert.match(service,new RegExp(marker));
  assert.match(service,/update public\.operational_records[\s\S]*status=v_updated\.status/);
  assert.match(service,/revoke all on function public\.workshop_transition_order/);
  assert.match(compatibility,/maintenance_orders add column if not exists metadata/);
  assert.match(compatibility,/maintenance_diagnostics_request_full_uidx/);
  assert.doesNotMatch(`${service}\n${compatibility}`,/truncate\s+table/i);
});

test('service error mapping keeps conflicts actionable',()=>{
  const mapped=workshopServiceInternals.mapServiceError(new Error('WORKSHOP_VERSION_CONFLICT:3:2'));
  assert.equal(mapped.status,409);
  assert.equal(mapped.code,'WORKSHOP_VERSION_CONFLICT');
  assert.match(mapped.message,/مستخدم آخر/);
});
