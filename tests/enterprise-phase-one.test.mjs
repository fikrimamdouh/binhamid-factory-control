import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('Telegram registration points only to webhook v3',async()=>{
  const register=await read('api/telegram/register.js');
  assert.match(register,/\/api\/telegram\/webhook-v3/);
  assert.doesNotMatch(register,/const url=`\$\{base\}\/api\/telegram\/webhook-v2`/);
  assert.match(register,/getWebhookInfo/);
});

test('webhook v3 uses the unified enterprise implementation',async()=>{
  const webhook=await read('api/telegram/webhook-v3.js');
  assert.match(webhook,/webhook-v2\.js/);
});

test('incoming and outgoing Telegram messages are persisted',async()=>{
  const telegram=await read('api/_lib/telegram.js');
  const core=await read('api/_lib/bot-webhook-core.js');
  assert.match(telegram,/direction:\s*'outgoing'/);
  assert.match(telegram,/upsert\('telegram_messages'/);
  assert.match(core,/direction:\s*'incoming'/);
  assert.match(core,/sender_name/);
});

test('conversation center is loaded by the application shell',async()=>{
  const index=await read('index.html');
  const ui=await read('assets/cloud-conversations.js');
  assert.match(index,/cloud-conversations\.js/);
  assert.match(ui,/\/api\/conversations/);
  assert.match(ui,/سجل المحادثات/);
});

test('enterprise migration creates direct operational tables',async()=>{
  const sql=await read('supabase/migrations/003_enterprise_operations_and_conversations.sql');
  for(const table of ['operational_records','sales_orders','inventory_items','inventory_movements','purchase_requests','supplier_quotes','collection_events','quality_cases','operational_tasks','notification_outbox']){
    assert.match(sql,new RegExp(`create table if not exists public\\.${table}`));
  }
  assert.match(sql,/audit_sales_projection_trigger/);
  assert.match(sql,/audit_operational_projection_trigger/);
});

test('direct operations API and conversation API require admin access',async()=>{
  for(const file of ['api/operations.js','api/conversations.js']){
    const source=await read(file);
    assert.match(source,/requireAdmin\(req\)/);
  }
});
