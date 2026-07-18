import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('accepted Telegram invitations remain actionable from the invitation list',async()=>{
  const source=await read('api/_lib/bot-invitations.js');
  assert.match(source,/function invitationActionRows\(row\)/);
  assert.match(source,/row\?\.status==='accepted_pending_approval'/);
  assert.match(source,/callback_data:`ent:inv\|approve\|\$\{row\.id\}`/);
  assert.match(source,/callback_data:`ent:inv\|edit\|\$\{row\.id\}`/);
  assert.match(source,/callback_data:`ent:inv\|reject\|\$\{row\.id\}`/);
  assert.match(source,/buttons\.push\(\.\.\.invitationActionRows\(row\)\)/);
});

test('approving an invitation clears any duplicate registration session',async()=>{
  const source=await read('api/_lib/bot-invitations.js');
  assert.match(source,/clearMaintenanceSession\(invitation\.accepted_by_telegram_id,invitation\.accepted_by_telegram_id\)/);
  assert.match(source,/role:invitation\.requested_role,active:true/);
  assert.match(source,/استخدم \/menu لفتح العمليات/);
});
