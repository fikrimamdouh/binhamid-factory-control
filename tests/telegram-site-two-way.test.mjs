import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('device session can poll inbox without administrative capabilities',()=>{
  const source=read('api/_lib/device-session.js');
  assert.match(source,/imports\.read/);
  assert.match(source,/imports\.status\.sync/);
  assert.doesNotMatch(source,/imports\.manage/);
  assert.doesNotMatch(source,/admin\/users/);
  assert.doesNotMatch(source,/telegram\/register/);
});

test('dashboard returns a restricted Telegram inbox to a device and full data to a manager',()=>{
  const source=read('api/_lib/routes/manager-dashboard.js');
  assert.match(source,/requireCapability\(req,'dashboard\.manager'\)/);
  assert.match(source,/requireAdminOrDevice\(req,'imports\.read'\)/);
  assert.match(source,/deviceInboxOnly/);
  assert.match(source,/restricted:true/);
  assert.match(source,/groups:\[\],users:\[\],snapshot:null/);
  assert.match(source,/safeSelect\('telegram_groups'/);
  assert.match(source,/safeSelect\('user_channels'/);
  assert.match(source,/imports,groups,users/);
  assert.match(source,/twoWay:true/);
});

test('only the opened status is technical while business transitions require an active user',()=>{
  const source=read('api/_lib/routes/imports.js');
  assert.match(source,/requireAdminOrDevice\(req,'imports\.status\.sync'\)/);
  assert.match(source,/requireCapability\(req,'imports\.manage'\)/);
  assert.match(source,/source_chat_id/);
  assert.match(source,/import_status_changed/);
  assert.match(source,/opened_in_program/);
  assert.match(source,/approved/);
});

test('Telegram uploads are stored for the site and relayed to the owner',()=>{
  const source=read('api/_lib/bot-files.js');
  assert.match(source,/insert\('imports'/);
  assert.match(source,/relayToOwner/);
  assert.match(source,/sendDocumentBuffer/);
  assert.match(source,/file_hash/);
});

test('website approval requires a user and sends summary and original file to Telegram',()=>{
  const source=read('api/_lib/routes/telegram-admin.js');
  assert.match(source,/requireCapability\(req,'daily_report\.approve'\)/);
  assert.match(source,/findApprovedBatch/);
  assert.match(source,/linkedImport/);
  assert.match(source,/downloadObject/);
  assert.match(source,/sendDocumentBuffer/);
  assert.match(source,/source_import_approved/);
  assert.match(source,/status:'approved'/);
});

test('browser polls and stages recognized Telegram reports automatically',()=>{
  const source=read('assets/telegram-site-two-way.js'),index=read('index.html');
  assert.match(index,/telegram-site-two-way\.js/);
  assert.match(source,/POLL_MS=15000/);
  assert.match(source,/bhCloudApplyImport/);
  assert.match(source,/\/api\/dashboard/);
  assert.match(source,/\/api\/imports\/status/);
  assert.match(source,/opened_in_program/);
  assert.match(source,/binhamid_cloud_auto_import/);
});
