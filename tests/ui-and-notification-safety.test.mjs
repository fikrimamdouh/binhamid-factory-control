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

test('scheduled notification outbox escapes dynamic Telegram HTML',async()=>{
  const safe=await read('api/_lib/bot-notifications-safe.js');
  const cron=await read('api/cron/manager-brief.js');
  assert.match(safe,/const html=value=>/);
  assert.match(safe,/const title=html/);
  assert.match(safe,/const message=html/);
  assert.match(safe,/recipient_chat_id/);
  assert.match(safe,/status:'failed'/);
  assert.match(safe,/status:'sent'/);
  assert.match(cron,/bot-notifications-safe\.js/);
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
