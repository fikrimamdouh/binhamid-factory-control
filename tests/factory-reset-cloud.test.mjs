import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('factory reset is a protected cloud operation that keeps backups and identities',async()=>{
  const route=await read('api/_lib/routes/factory-reset.js'),router=await read('api/router.js'),vercel=await read('vercel.json'),migration=await read('supabase/migrations/023_factory_reset_operational_data.sql'),client=await read('assets/factory-reset-cloud.js'),index=await read('index.html');
  assert.match(route,/requireCapability\(req,'factory\.reset'\)/);
  assert.match(route,/RESET_FACTORY_OPERATIONAL_DATA/);
  assert.match(router,/'factory-reset':factoryReset\.factoryReset/);
  assert.match(vercel,/\/api\/factory-reset/);
  for(const marker of ['reset_factory_operational_data','telegram_messages','daily_report_batches','operational_alerts','storage.objects','backupsPreserved','identitiesPreserved','revoke all on function'])assert.ok(migration.includes(marker),`missing ${marker}`);
  assert.doesNotMatch(migration,/truncate table public\.backup_runs/i);
  assert.match(client,/opsSnapshot\('قبل إعادة ضبط المصنع السحابية'\)/);
  assert.match(client,/window\.opsFactoryReset=reset/);
  assert.match(client,/window\.wipe=reset/);
  assert.match(index,/factory-reset-cloud\.js/);
});
