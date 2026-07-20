import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('operations actions only enhance a real operation-details modal',async()=>{
  const ui=await read('assets/cloud-operations-actions.js');
  assert.match(ui,/function ensureStyle\(\)/);
  assert.match(ui,/bh-operations-actions-style/);
  assert.match(ui,/!card\.querySelector\('\.bh-ops-detail'\)/);
  assert.match(ui,/dataset\.modalKind==='create-task'/);
  assert.match(ui,/modal\('إنشاء مهمة إدارية',[\s\S]*'create-task'\)/);
  assert.match(ui,/buttons\.forEach\(item=>item\.disabled=true\)/);
});

test('notification outbox remains HTML-safe but is disconnected from proactive cron execution',async()=>{
  const safe=await read('api/_lib/bot-notifications-safe.js');
  const implementation=await read('api/_lib/bot-notifications.js');
  const cron=await read('api/cron/manager-brief.js');
  assert.match(safe,/from '\.\/bot-notifications\.js'/);
  assert.match(implementation,/const html=value=>/);
  assert.match(implementation,/const title=html/);
  assert.match(implementation,/message=html/);
  assert.match(implementation,/recipient_chat_id/);
  assert.match(implementation,/status:'failed'/);
  assert.match(implementation,/status:'sent'/);
  assert.match(cron,/onDemandOnly:true/);
  assert.match(cron,/enabled:false/);
  assert.doesNotMatch(cron,/bot-notifications-safe\.js|processNotificationOutbox|retryFailedNotifications|sendMeaningfulAlerts/);
});

test('procurement specialists use the guarded workflow and RFQ projection',async()=>{
  const secure=await read('api/_lib/bot-procurement-secure.js');
  const migration=await read('supabase/migrations/007_procurement_projection_and_permissions.sql');
  assert.match(secure,/adaptedIdentity/);
  assert.match(secure,/procurement/);
  assert.match(secure,/warehouse/);
  assert.match(secure,/legacy\.startProcurementAction\(message,adaptedIdentity\(identity\),action\)/);
  assert.match(secure,/purchase_requests/);
  assert.match(migration,/supplier_quote_request_projection_trigger/);
});
