import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=parts=>fs.readFileSync(new URL(parts.join('/'),import.meta.url),'utf8');

test('driver registration collects identity licence vehicle documents and language',()=>{
  const source=read(['..','api','_lib','bot-driver-registration.js']);
  for(const token of ['registration_driver_language','registration_driver_phone','registration_driver_iqama','registration_driver_license','registration_driver_vehicle','registration_driver_iqama_doc','registration_driver_license_doc','preferredLanguage','vehicleExternalId','driverDocuments'])assert.match(source,new RegExp(token));
  for(const language of ['العربية','English','اردو','हिन्दी','বাংলা'])assert.match(source,new RegExp(language));
  assert.match(source,/application\/pdf/);
  assert.match(source,/8\*1024\*1024/);
  assert.doesNotMatch(source,/role:'admin'/);
});

test('generic registration routes the driver role through the full form',()=>{
  const source=read(['..','api','_lib','bot-registration.js']);
  assert.match(source,/role==='driver'/);
  assert.match(source,/startDriverRegistration/);
  assert.match(source,/driverRegistrationReady/);
  assert.match(source,/فورم السائق غير مكتمل/);
});

test('registration media is intercepted before generic document processing',()=>{
  const gateway=read(['..','api','_lib','telegram-webhook-gateway.js']);
  const driverMedia=gateway.indexOf('handleDriverRegistrationMedia');
  const genericReturn=gateway.indexOf('if(message.voice||message.document||message.photo?.length)return false');
  assert.ok(driverMedia>=0&&genericReturn>driverMedia);
  assert.match(gateway,/مستندات تسجيل السائق تُرسل في المحادثة الخاصة فقط/);
});

test('driver approval validates the form and creates vehicle assignment before activation',()=>{
  const source=read(['..','api','_lib','bot-employee-approvals.js']);
  assert.match(source,/prepareDriverAssignment/);
  assert.match(source,/employee_assignments/);
  assert.match(source,/driverRegistrationReady/);
  assert.match(source,/driver_documents/);
  assert.ok(source.indexOf('prepareDriverAssignment(row,role)')<source.indexOf("rpc('approve_telegram_user'"));
});
