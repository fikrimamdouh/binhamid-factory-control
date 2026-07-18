import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { invitationRoleAllowed, invitationTokenHash, maskInvitationPhone, normalizeInvitationPhone } from '../api/_lib/bot-invitations.js';

const read=path=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('invitation phone normalization produces E.164 values',()=>{
  assert.equal(normalizeInvitationPhone('051 234 5678'),'+966512345678');
  assert.equal(normalizeInvitationPhone('00966512345678'),'+966512345678');
  assert.equal(normalizeInvitationPhone('+201012345678'),'+201012345678');
  assert.throws(()=>normalizeInvitationPhone('123'),error=>error?.code==='INVITATION_PHONE_INVALID');
  assert.equal(maskInvitationPhone('+966512345678'),'+966****678');
});

test('invitation tokens are hashed deterministically and never treated as roles',()=>{
  const hash=invitationTokenHash('one-time-secret');
  assert.match(hash,/^[a-f0-9]{64}$/);
  assert.equal(hash,invitationTokenHash('one-time-secret'));
  assert.notEqual(hash,invitationTokenHash('different-secret'));
});

test('manager can invite operational roles but cannot invite finance or admin',()=>{
  const manager={active:true,role:'manager',external_id:'200'};
  assert.equal(invitationRoleAllowed(manager,'driver'),true);
  assert.equal(invitationRoleAllowed(manager,'quality'),true);
  assert.equal(invitationRoleAllowed(manager,'accountant'),false);
  assert.equal(invitationRoleAllowed(manager,'admin'),false);
  assert.equal(invitationRoleAllowed({...manager,active:false},'driver'),false);
});

test('invitation schema stores only a hash and enforces single use and approval states',()=>{
  const migration=read('supabase/migrations/019_accounting_import_and_telegram_integrity.sql');
  assert.match(migration,/token_hash text not null unique/);
  assert.doesNotMatch(migration,/raw_token|token_raw/);
  assert.match(migration,/user_invitations_open_phone_uidx/);
  assert.match(migration,/accepted_pending_approval/);
  assert.match(migration,/INVITATION_ALREADY_ACCEPTED/);
  assert.match(migration,/not \(requested_capabilities \? '\*'\)/);
});

test('Telegram invitation flow uses 256-bit tokens without logging the raw deep link',()=>{
  const source=read('api/_lib/bot-invitations.js');
  assert.match(source,/crypto\.randomBytes\(32\)/);
  assert.match(source,/invitationTokenHash\(token\)/);
  assert.match(source,/sendSensitiveLink/);
  assert.match(source,/telegram\('sendMessage'/);
  assert.doesNotMatch(source,/token_hash:token\b/);
  assert.match(source,/requested_capabilities:\[\]/);
  assert.match(source,/role:'pending',active:false/);
  assert.match(source,/accepted_by_telegram_id/);
  assert.match(source,/لا يجوز اعتماد حسابك بنفسك/);
});

test('deep links are routed before normal registration and invitations appear in management menu',()=>{
  const registration=read('api/_lib/bot-registration.js'),enterprise=read('api/_lib/bot-enterprise.js'),admin=read('api/_lib/routes/telegram-admin.js');
  assert.match(registration,/handleInvitationStart/);
  assert.match(registration,/start.*invite_/s);
  assert.match(enterprise,/دعوات المستخدمين/);
  assert.match(enterprise,/handleInvitationCallback/);
  assert.match(enterprise,/continueInvitationSession/);
  assert.match(admin,/command:'invite'/);
});
