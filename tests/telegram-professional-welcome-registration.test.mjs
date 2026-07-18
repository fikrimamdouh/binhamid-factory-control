import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=parts=>fs.readFileSync(new URL(parts.join('/'),import.meta.url),'utf8');

test('bot help presents all factory jobs in a professional compact catalog',()=>{
  const source=read(['..','api','_lib','bot-help.js']);
  for(const label of ['الحسابات','مبيعات البلوك','مبيعات الخرسانة','التحصيل','الورشة والميكانيكي','السائقون','العمال والموظفون','المخزن','الديزل والأسطول','الموارد البشرية','المشتريات','الجودة والرقابة'])assert.match(source,new RegExp(label));
  assert.match(source,/مساعد مصنع بن حامد/);
  assert.match(source,/ثلاث خطوات/);
  assert.doesNotMatch(source,/يعمل على مدار 24 ساعة طوال أيام الأسبوع/);
});

test('pending users receive a guided three-step registration without automatic privileges',()=>{
  const source=read(['..','api','_lib','bot-registration.js']);
  assert.match(source,/registration_name/);
  assert.match(source,/registration_role/);
  assert.match(source,/registration_employee_id/);
  assert.match(source,/registration_confirm/);
  assert.match(source,/registration_submitted/);
  assert.match(source,/لا تُمنح أي صلاحية قبل الاعتماد/);
  assert.match(source,/عامل \/ موظف عام/);
  assert.match(source,/سائق/);
  assert.match(source,/الورشة \/ ميكانيكي/);
  assert.doesNotMatch(source,/role:'admin'/);
});

test('registration callbacks and pending text sessions are handled before approval checks',()=>{
  const gateway=read(['..','api','_lib','telegram-webhook-gateway.js']);
  const registrationCallback=gateway.indexOf("if(action==='reg')");
  const inactiveCallback=gateway.indexOf('if(!identity.active)');
  assert.ok(registrationCallback>=0&&inactiveCallback>registrationCallback);
  assert.match(gateway,/continueRegistrationSession/);
  assert.match(gateway,/handleRegistrationTextCommand/);
  assert.match(gateway,/تسجيل الموظف يتم من المحادثة الخاصة/);
});

test('admin review shows the submitted job and preserves final role approval',()=>{
  const approvals=read(['..','api','_lib','bot-employee-approvals.js']);
  assert.match(approvals,/state=eq\.registration_submitted/);
  assert.match(approvals,/الوظيفة التي اختارها الموظف/);
  assert.match(approvals,/requested_role/);
  assert.match(approvals,/approved_role/);
  assert.match(approvals,/approve_telegram_user/);
});

test('Telegram command menu publishes help registration and invitation entry points',()=>{
  const admin=read(['..','api','_lib','routes','telegram-admin.js']);
  assert.match(admin,/command:'help'/);
  assert.match(admin,/command:'register'/);
  assert.match(admin,/command:'invite'/);
  assert.match(admin,/تسجيل أو تحديث بيانات الموظف/);
  assert.match(admin,/version:7/);
});
