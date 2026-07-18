import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('invitations issued from owner chat auto-activate on acceptance',async()=>{
  const source=await read('api/_lib/bot-invitations.js');
  assert.match(source,/function ownerIssued\(invitation\)/);
  assert.match(source,/metadata\?\.source_chat_id/);
  assert.match(source,/activateInvitation\(invitation,String\(config\.telegramOwnerId\),'owner-auto'\)/);
  assert.match(source,/تم قبول الدعوة وتفعيل الحساب تلقائيًا/);
  assert.match(source,/clearMaintenanceSession\(invitation\.accepted_by_telegram_id,invitation\.accepted_by_telegram_id\)/);
});
