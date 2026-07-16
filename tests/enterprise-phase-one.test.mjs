import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('Telegram registration points only to webhook v3',async()=>{
  const register=await read('api/_lib/routes/telegram-admin.js');
  assert.match(register,/\/api\/telegram\/webhook-v3/);
  assert.doesNotMatch(register,/const url=`\$\{base\}\/api\/telegram\/webhook-v2`/);
  assert.match(register,/getWebhookInfo/);
});

test('webhook v3 uses the secure gateway and shared enterprise implementation outside function routes',async()=>{
  const webhook=await read('api/telegram/webhook-v3.js');
  const gateway=await read('api/_lib/telegram-webhook-gateway.js');
  const engine=await read('api/_lib/telegram-webhook-handler.js');
  assert.match(webhook,/telegram-webhook-gateway\.js/);
  assert.match(gateway,/telegram-webhook-handler\.js/);
  assert.match(gateway,/bot-procurement-secure\.js/);
  assert.match(gateway,/bot-sales-secure\.js/);
  assert.match(gateway,/bot-mechanic-secure\.js/);
  assert.match(gateway,/bot-attendance-secure\.js/);
  assert.match(engine,/handleEnterpriseTextCommand/);
  assert.match(engine,/handleAttendanceCallback/);
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
  for(const table of ['operational_records','sales_orders','inventory_items','inventory_movements','purchase_requests','supplier_quotes','collection_events','quality_cases','operational_tasks','notification_outbox'])assert.match(sql,new RegExp(`create table if not exists public\\.${table}`));
  assert.match(sql,/audit_sales_projection_trigger/);
  assert.match(sql,/audit_operational_projection_trigger/);
});

test('central router preserves protected operations and conversation endpoints',async()=>{
  const router=await read('api/router.js');
  const management=await read('api/_lib/routes/management.js');
  assert.match(router,/'operations':management\.operations/);
  assert.match(router,/'conversations':management\.conversations/);
  assert.match(management,/requireAdmin\(req\)/);
});

test('Vercel rewrites preserve all legacy endpoint URLs',async()=>{
  const config=JSON.parse(await read('vercel.json'));
  const sources=new Set((config.rewrites||[]).map(item=>item.source));
  for(const route of ['/api/admin/groups','/api/admin/users','/api/dashboard','/api/conversations','/api/operations','/api/imports/status','/api/system/database-readiness','/api/system/status','/api/telegram/register','/api/telegram/status','/api/telegram/test','/api/telegram/webhook','/api/telegram/webhook-v2'])assert.ok(sources.has(route),`missing rewrite ${route}`);
});
