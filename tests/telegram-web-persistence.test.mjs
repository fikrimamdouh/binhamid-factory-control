import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('confirmed Telegram enterprise forms persist through the shared operation engine for website records',async()=>{
  const forms=await read('api/_lib/bot-enterprise-forms.js'),engine=await read('api/_lib/operation-engine.js'),migration=await read('supabase/migrations/025_unified_operation_engine.sql'),management=await read('api/_lib/routes/management.js'),router=await read('api/router.js');
  assert.match(forms,/executeOperation/);assert.match(forms,/entityType:details\.category/);assert.match(forms,/source:'telegram'/);assert.doesNotMatch(forms,/action:'enterprise_operation_created'/);
  assert.match(engine,/rpc\('execute_unified_operation'/);assert.match(migration,/insert into public\.operational_records/);assert.match(migration,/operational_records_idempotency_uidx/);assert.match(migration,/operation_events/);
  assert.match(management,/select=id,reference_no,entity_type,department,status,title,summary,amount,payload/);assert.match(management,/select\('operational_records',query\)/);assert.match(router,/'operations':management\.operations/);
});

test('legacy audit projection remains available for historical enterprise events',async()=>{
  const migration=await read('supabase/migrations/004_operational_projection_backfill.sql');assert.match(migration,/create trigger audit_operational_projection_trigger/);assert.match(migration,/after insert on public\.audit_log/);assert.match(migration,/insert into public\.operational_records/);
});

test('Telegram Excel files are registered for the website imports center even when object Storage is pending',async()=>{
  const files=await read('api/_lib/bot-files.js'),dashboard=await read('api/_lib/routes/manager-dashboard.js');assert.match(files,/insert\('imports'/);assert.match(files,/ready_for_review/);assert.match(files,/ORIGINAL_STORAGE_FAILED/);assert.match(dashboard,/const importsQuery='select=id,source,department,report_type,status,original_name/);assert.match(dashboard,/safeSelect\('imports',importsQuery\)/);
});

test('general AI conversation is visible in the website conversation center but is not falsely posted as a business transaction',async()=>{
  const routing=await read('api/_lib/bot-routing.js'),conversations=await read('api/_lib/routes/management.js');assert.match(routing,/related_entity_type:operational\?/);assert.match(routing,/:'conversation'/);assert.match(routing,/محفوظة في مركز الاتصال ولم تُرحّل نهائيًا بعد/);assert.match(conversations,/select\('telegram_messages'/);
});
