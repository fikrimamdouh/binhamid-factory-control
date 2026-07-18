import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('device session grants no inbox or administrator capability',()=>{
  const source=read('api/_lib/device-session.js');
  assert.match(source,/DEVICE_CAPABILITIES=Object\.freeze\(\[\]\)/);
  for(const capability of ['imports.read','imports.manage','dashboard.manager','admin/users','telegram/register'])assert.doesNotMatch(source,new RegExp(capability.replace('/','\\/')));
});

test('dashboard returns Telegram inbox data only through authenticated access',()=>{
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

test('import status transitions require role capability and return to Telegram',()=>{
  const source=read('api/_lib/routes/imports.js');
  assert.match(source,/requireCapability/);
  assert.match(source,/daily_report\.view/);
  assert.match(source,/imports\.manage/);
  assert.match(source,/source_chat_id/);
  assert.match(source,/import_status_changed/);
  assert.match(source,/opened_in_program/);
  assert.match(source,/approved/);
  assert.doesNotMatch(source,/requireAdminOrDevice/);
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

test('browser polls Telegram reports only with protected administrator access',()=>{
  const source=read('assets/telegram-site-two-way.js'),index=read('index.html');
  assert.match(index,/telegram-site-two-way\.js/);
  assert.match(source,/POLL_MS=15000/);
  assert.match(source,/TOKEN_KEY='binhamid_cloud_access_token'/);
  assert.match(source,/Authorization:'Bearer '\+token/);
  assert.match(source,/bhCloudApplyImport/);
  assert.match(source,/\/api\/dashboard/);
  assert.match(source,/\/api\/imports\/status/);
  assert.match(source,/opened_in_program/);
  assert.match(source,/localStorage\.getItem\(AUTO_KEY\)==='1'/);
});
