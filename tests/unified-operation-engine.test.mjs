import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('migration 025 creates an atomic concurrent-safe operation envelope and durable outbox',async()=>{
  const sql=await read('supabase/migrations/025_unified_operation_engine.sql');
  assert.match(sql,/begin;/);
  assert.match(sql,/operational_records_idempotency_uidx/);
  assert.match(sql,/pg_advisory_xact_lock\(hashtextextended\(v_key,0\)\)/);
  assert.match(sql,/create table if not exists public\.operation_events/);
  assert.match(sql,/notification_outbox_dedupe_uidx/);
  assert.match(sql,/execute_unified_operation/);
  assert.match(sql,/transition_unified_operation/);
  assert.match(sql,/operation_transition_allowed/);
  assert.match(sql,/queue_operation_notifications/);
  assert.match(sql,/commit;/);
});

test('shared server service owns operation identity, lifecycle and outbox dispatch',async()=>{
  const source=await read('api/_lib/operation-engine.js');
  assert.match(source,/buildIdempotencyKey/);
  assert.match(source,/sourceReference\?\{operationType,source,sourceReference\}/);
  assert.match(source,/payload->>idempotency_key/);
  assert.match(source,/buildOperationEnvelope/);
  assert.match(source,/lifecycleForStatus/);
  assert.match(source,/rpc\('execute_unified_operation'/);
  assert.match(source,/rpc\('transition_unified_operation'/);
  assert.match(source,/dispatchOperationNotifications/);
  assert.match(source,/chatForUser/);
  assert.match(source,/attempt_count\|\|row\.attempts/);
  assert.match(source,/dead_letter/);
  assert.match(source,/duplicateTransitionResult/);
  assert.match(source,/allowSameStatus/);
  assert.match(source,/compatibilityMode:true/);
});

test('Telegram form confirmation saves through the shared engine before notifications',async()=>{
  const source=await read('api/_lib/bot-enterprise-forms.js');
  const executeIndex=source.indexOf('await executeOperation('),dispatchIndex=source.indexOf('await dispatchOperationNotifications(');
  assert.ok(executeIndex>0);
  assert.ok(dispatchIndex>executeIndex);
  assert.doesNotMatch(source,/action:'enterprise_operation_created'/);
  assert.match(source,/domainRecord=details\.category==='task'/);
  assert.match(source,/العملية .* محفوظة مسبقًا/);
  assert.match(source,/item:'الصنف\/الخلطة'/);
  assert.match(source,/phone:'الجوال'/);
});

test('Telegram status changes use the same transition service and outbox',async()=>{
  const source=await read('api/_lib/bot-enterprise-status.js');
  assert.match(source,/getOperationByReference/);
  assert.match(source,/transitionOperation/);
  assert.match(source,/dispatchOperationNotifications/);
  assert.doesNotMatch(source,/logEnterpriseEvent/);
});

test('Telegram read models include legacy and unified operation events',async()=>{
  const source=await read('api/_lib/bot-enterprise-store.js');
  assert.match(source,/unified_operation_created/);
  assert.match(source,/unified_operation_status/);
  assert.match(source,/enterprise_operation_created/);
  assert.match(source,/enterprise_operation_status/);
});

test('website management actions use stable request ids and the shared operation service',async()=>{
  const [source,ui]=await Promise.all([read('api/_lib/routes/management.js'),read('assets/cloud-operations-actions.js')]);
  assert.match(source,/executeOperation/);
  assert.match(source,/transitionOperation/);
  assert.match(source,/dispatchOperationNotifications/);
  assert.match(source,/operationType:'management_task'/);
  assert.match(source,/operationType:'manual_notification'/);
  assert.doesNotMatch(source,/action:'enterprise_operation_created'/);
  assert.match(ui,/const requestId=prefix/);
  assert.match(ui,/requestId:operationRequestId/);
  assert.match(ui,/statusButton\.dataset\.requestId/);
});

test('scheduled outbox processing shares retry and dead-letter rules with immediate dispatch',async()=>{
  const source=await read('api/_lib/bot-notifications.js');
  assert.match(source,/dispatchOperationNotifications/);
  assert.match(source,/status=in\.\(pending,failed,retrying\)/);
  assert.match(source,/next_attempt_at/);
  assert.match(source,/attempt_count=gte\.5/);
  assert.match(source,/status:'dead_letter'/);
});
