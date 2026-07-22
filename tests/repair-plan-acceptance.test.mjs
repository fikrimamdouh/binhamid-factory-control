import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('boot remains interactive and optional modules load sequentially in idle slices',async()=>{
  const index=await read('index.html'),state=await read('assets/state-load-performance.js');
  assert.match(index,/requestIdleCallback/);
  assert.match(index,/for\s*\(\s*const\s*\[\s*id\s*,\s*src\s*\]\s*of\s*extensions\s*\)/);
  assert.doesNotMatch(index,/Promise\.all\(optionalExtensions/);
  assert.match(index,/optional modules loading in idle slices/);
  assert.match(index,/optional modules loaded/);
  assert.match(index,/revealFrame\(\);\}\},6000/);
  assert.match(index,/vehiclePreflight/);
  assert.match(index,/installVehicleGlobals/);
  assert.match(state,/automatic full state request replaced with session-gated revision metadata/);
  assert.match(state,/\/api\/state\?meta=1/);
  assert.match(state,/X-App-User-Id/);
  assert.match(state,/deferredAuth:true/);
  assert.doesNotMatch(state,/bhRefreshOwnerSession/);
});

test('revision conflicts stop writes until a clean cloud pull replaces local state',async()=>{
  const guard=await read('assets/sync-integrity-guard.js'),index=await read('index.html');
  assert.match(guard,/REVISION_CONFLICT_LOCKED/);
  assert.match(guard,/syntheticConflict/);
  assert.match(guard,/if\(existing\)return syntheticConflict\(existing\)/);
  assert.match(guard,/response\.status===409/);
  assert.match(guard,/binhamid-cloud-state-pulled/);
  assert.match(guard,/سحب وتنظيف النسخة المحلية/);
  assert.match(guard,/function cleanProgramLocalState\(\)/);
  assert.match(guard,/function writePulledState\(data\)/);
  assert.doesNotMatch(guard,/binhamid_conflict_backup_/);
  assert.ok(index.indexOf('cloud-control.js')<index.indexOf('sync-integrity-guard.js'),'conflict guard must wrap cloud state requests after cloud-control loads');
});

test('employee site selection and geofenced attendance preserve auditable GPS evidence',async()=>{
  const ui=await read('assets/attendance-control.js'),api=await read('api/admin/attendance.js');
  for(const marker of ['FACTORY_MAIN','STATION_MAIN','assign_employee_site','attendanceSiteId','linkedUsers'])assert.match(ui,new RegExp(marker));
  for(const marker of ['haversine','horizontal_accuracy_m','distance_from_site_m','within_geofence','check_in','check_out','ATTENDANCE_GPS_ACCURACY','ATTENDANCE_ASSIGNMENT_REQUIRED'])assert.match(api,new RegExp(marker));
  assert.match(api,/distance<=Number\(site\.radius_m\|\|250\)/);
});

test('print-to-Telegram uses the original print path and releases stale captures',async()=>{
  const print=await read('assets/telegram-pdf-declarations.js'),route=await read('api/_lib/routes/reports-telegram.js');
  assert.match(print,/printButton\.click\(\)/);
  assert.match(print,/clonePrintSheet/);
  assert.match(print,/document-ready/);
  assert.match(print,/if\(captureRequest\)settle\(captureRequest,'reject'/);
  assert.match(print,/زر الطباعة لم يُنشئ ورقة جديدة/);
  assert.doesNotMatch(print,/يوجد مستند آخر قيد التجهيز/);
  assert.match(print,/ورقة الطباعة فارغة/);
  assert.doesNotMatch(print.match(/function captureByClick[\s\S]*?window\.addEventListener\('pagehide'/)?.[0]||'',/setTimeout/);
  assert.match(route,/reports\.send_telegram/);
});

test('bot modules apply the same deny policy to buttons text callbacks voice and sessions',async()=>{
  const policy=await read('api/_lib/bot-menu-permissions.js'),gateway=await read('api/_lib/telegram-webhook-handler.js');
  assert.match(policy,/BOT_MENU_CATALOG/);
  assert.match(policy,/ownerOnly:true/);
  assert.match(policy,/requiredSelect\('user_capabilities'/);
  for(const marker of ['moduleForButton','moduleForText','moduleForCallback','moduleForSession'])assert.match(policy,new RegExp(marker));
  assert.match(gateway,/denyBotModule/);
  assert.match(gateway,/result\.text\?handleText/);
  assert.match(gateway,/moduleForSession\(session\?\.state\)/);
});

test('Excel import is previewed, fingerprinted, deduplicated and cannot erase data with an empty file',async()=>{
  const guard=await read('assets/import-file-validation.js'),existing=await read('assets/existing-daily-import-fix.js');
  assert.ok(guard.includes("const ALLOWED_EXT=/\\.(xlsx|xls)$/i;"));
  assert.match(guard,/SHA-256/);
  assert.match(guard,/المقبول/);assert.match(guard,/المرفوض/);assert.match(guard,/المكرر/);assert.match(guard,/الناقص/);
  assert.match(guard,/لا توجد صفوف صالحة للاستيراد/);
  assert.match(guard,/لم يتم حذف أو استبدال أي بيانات سابقة/);
  assert.match(existing,/sourceFileFingerprint/);
  assert.match(existing,/duplicateBatch\(hash,reportDate\)/);
  assert.match(existing,/wrappedSave/);
});

test('backup and restore evidence is encrypted checksummed manifested and isolated from production',async()=>{
  const backup=await read('scripts/backup-supabase.mjs'),restore=await read('scripts/restore-supabase.mjs'),pkg=JSON.parse(await read('package.json'));
  for(const marker of ['aes-256-gcm','checksumSha256','manifest','schemaVersion','pg_dump'])assert.match(backup,new RegExp(marker));
  for(const marker of ['ALLOW_RESTORE_TEST_DATABASE','Restore target must not equal the production source database','Backup checksum mismatch','criticalCounts','restore-result.json'])assert.match(restore,new RegExp(marker));
  assert.equal(pkg.scripts.backup,'node scripts/backup-supabase.mjs');
  assert.equal(pkg.scripts['restore:test'],'node scripts/restore-supabase.mjs');
});

test('critical code-risk findings are a blocking gate',async()=>{
  const audit=await read('scripts/audit-code-risks.mjs');
  assert.match(audit,/if\(\(counts\.P0\|\|0\)>0\)/);
  assert.match(audit,/process\.exitCode=1/);
});