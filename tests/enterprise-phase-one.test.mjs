import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('Telegram registration points only to webhook v3 through the central router',async()=>{
  const telegramAdmin=await read('api/_lib/routes/telegram-admin.js');
  const router=await read('api/router.js');
  const config=JSON.parse(await read('vercel.json'));
  assert.match(telegramAdmin,/\/api\/telegram\/webhook-v3/);
  assert.doesNotMatch(telegramAdmin,/const url=`\$\{base\}\/api\/telegram\/webhook-v2`/);
  assert.match(telegramAdmin,/getWebhookInfo/);
  assert.match(router,/'telegram\/register':telegramAdmin\.register/);
  assert.match(router,/'telegram\/status':telegramAdmin\.status/);
  assert.match(router,/'telegram\/test':telegramAdmin\.test/);
  assert.equal(config.rewrites.find(item=>item.source==='/api/telegram/register')?.destination,'/api/router?route=telegram/register');
  assert.equal(config.rewrites.find(item=>item.source==='/api/telegram/status')?.destination,'/api/router?route=telegram/status');
  assert.equal(config.rewrites.find(item=>item.source==='/api/telegram/test')?.destination,'/api/router?route=telegram/test');
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

test('consolidated operations and conversation APIs require admin access',async()=>{
  const router=await read('api/router.js');
  const management=await read('api/_lib/routes/management.js');
  assert.match(router,/'operations':management\.operations/);
  assert.match(router,/'conversations':management\.conversations/);
  assert.match(management,/export async function operations/);
  assert.match(management,/export async function conversations/);
  assert.match(management,/requireAdmin\(req\)/);
});
