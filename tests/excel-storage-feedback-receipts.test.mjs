import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('Excel parsing and registration survive original Storage upload failure',async()=>{
  const source=await read('api/_lib/bot-files.js');
  assert.match(source,/storagePending=duplicate\?\.summary\?\.storage\?\.saved===false/);
  assert.match(source,/\[telegram excel storage fallback\]/);
  assert.match(source,/telegram_file_id:String\(document\.file_id/);
  assert.match(source,/ORIGINAL_STORAGE_FAILED/);
  assert.match(source,/تمت قراءة الملف وتسجيل بياناته؛ نسخة التخزين السحابي فقط معلقة/);
  assert.match(source,/لم تُهمل نتيجة القراءة/);
});

test('management feedback distinguishes delivery from explicit manager viewing',async()=>{
  const forms=await read('api/_lib/bot-enterprise-forms.js');
  const status=await read('api/_lib/bot-enterprise-status.js');
  const store=await read('api/_lib/bot-enterprise-store.js');
  assert.match(forms,/text:'تم الاطلاع'/);
  assert.match(forms,/إثبات تسليم فقط، وليس إثبات مشاهدة/);
  assert.match(forms,/سيصلك إشعار باسم المدير ووقت الاطلاع/);
  assert.match(status,/feedback&&!canManage\(identity\.role\)/);
  assert.match(status,/feedbackEmployeeText/);
  assert.match(status,/seen_at:updatedAt/);
  assert.match(status,/management_feedback_status/);
  assert.match(store,/seen_by_name/);
  assert.match(store,/تم الاطلاع وقيد المراجعة/);
});
