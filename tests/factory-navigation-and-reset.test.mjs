import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('control center routes accounting, inventory, daily-report and reporting workspaces into the preserved program',async()=>{
  const page=await read('control-center.html'),index=await read('index.html'),entry=await read('assets/governance-entry.js');
  for(const marker of ['/accounting.html','/?open=inventory','/?open=deliveries','/?open=reports'])assert.ok(page.includes(marker),`missing ${marker}`);
  assert.match(index,/openRequestedWorkspace/);assert.match(index,/win\.opsGo\(target\)/);
  assert.match(entry,/مركز إدارة المصنع/);assert.doesNotMatch(entry,/قيود وأستاذ|الحوكمة والتسليم/);
});

test('first-run setup preserves data while factory reset remains explicitly destructive and returns a fresh program',async()=>{
  const legacy=await read('legacy.html');
  assert.match(legacy,/هذه تهيئة آمنة ولا تمسح أي بيانات/);
  assert.match(legacy,/await opsPersist\('حفظ إعداد البرنامج لأول استخدام'\)/);
  assert.match(legacy,/مسح كل البيانات/);
  assert.match(legacy,/bh14OriginalReset/);
  assert.match(legacy,/حذف كل البيانات وإعادة ضبط المصنع/);
});
