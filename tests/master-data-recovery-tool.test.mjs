import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page=readFileSync(new URL('../master-data-recovery.html',import.meta.url),'utf8');

test('master data recovery is preview-first and uses only canonical master data',()=>{
  assert.match(page,/binhamid-master-data-recovery/);
  assert.match(page,/معاينة الفروق/);
  assert.match(page,/duplicate_erp_mapping/);
  assert.match(page,/route=canonical-master-data/);
  assert.match(page,/لم تُكتب أي بيانات/);
  assert.match(page,/لا توجد عمليات حذف/);
  assert.doesNotMatch(page,/\/api\/telegram/);
  assert.doesNotMatch(page,/\/api\/customers/);
  assert.doesNotMatch(page,/\/api\/reports/);
  assert.doesNotMatch(page,/delete_employee/);
  assert.doesNotMatch(page,/delete_asset/);
});

test('master data recovery preserves unrelated employee and asset fields',()=>{
  assert.match(page,/telegramUserId:clean\(row\.telegram\?\.id\)/);
  assert.match(page,/employeeExternalId:clean\(row\.employee_external_id\)/);
  assert.match(page,/dieselExpected:row\.diesel_expected===true/);
  assert.match(page,/تطابق موظف متعدد/);
});
