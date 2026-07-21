import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('owner invitations use identity-first activation and preserve owner legacy fallback',async()=>{
  const source=await read('api/_lib/bot-invitations.js');
  assert.match(source,/function ownerIssued\(invitation\)/);
  assert.match(source,/metadata\?\.source_chat_id/);
  assert.match(source,/state:'invitation_national_id'|invitation_national_id/);
  assert.match(source,/resolveEmployeeIdentity\(nationalId\)/);
  assert.match(source,/activateInvitation\(linked,telegramId,'identity-auto'\)/);
  assert.match(source,/تمت مطابقة الهوية وتفعيل الحساب تلقائيًا/);
  assert.match(source,/activateInvitation\(invitation,String\(config\.telegramOwnerId\),'owner-auto'\)/);
  assert.match(source,/تم تفعيل الحساب وفق مسار الدعوة القديم/);
  assert.match(source,/clearMaintenanceSession\(invitation\.accepted_by_telegram_id,invitation\.accepted_by_telegram_id\)/);
});
