// عقود المصدر للإصلاحات الجذرية لمسار الاعتماد والمزامنة:
// 1) حارس /api/state لا يحجب الحفظ عندما تُستبعد الأرصدة الافتتاحية عمدًا.
// 2) غلاف استيراد التقرير يُركَّب فعليًا حتى لو تعذّرت إعادة تعريف الخاصية.
// 3) حفظ التحصيلات المحلي لا ينهار حين لا يظهر OPS على window.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(here, '..', ...p), 'utf8');
const stateApi = read('api', 'state.js');
const dailySrc = read('assets', 'daily-report-source-of-truth.js');
const existingFix = read('assets', 'existing-daily-import-fix.js');

test('state guard honors customerOpeningBalancesExternalized so externalized saves are not blocked', () => {
  assert.match(stateApi, /customerOpeningBalancesExternalized===true/);
  // العلم يعطّل اعتبار المجموعة فارغة، ويمنع إضافتها لقائمة المجموعات المحروسة.
  assert.match(stateApi, /const opsExternalized=input\.payload\?\.ops\?\.customerOpeningBalancesExternalized===true/);
  assert.match(stateApi, /!opsExternalized&&!\(input\.payload\?\.ops\?\.customerOpeningBalances\|\|\[\]\)\.length/);
  assert.match(stateApi, /if\(!opsExternalized\)groups\.push\(\['ops\.customerOpeningBalances'/);
  // ما زال يحرس مجموعة العملاء دائمًا.
  assert.match(stateApi, /\['legacy\.cli','بيانات العملاء'/);
});

test('daily-report import wrapper falls back to direct assignment when the property cannot be redefined', () => {
  // لم يعد يستسلم عند فشل defineProperty: يُسند حارس الرفض مباشرةً.
  assert.match(dailySrc, /guardedByAccessor/);
  assert.match(dailySrc, /catch\(error\)\{[\s\S]*?window\[name\]=blockedImport\(\)/);
  // وwrapImports يُسند الغلاف الحقيقي مباشرةً عند غياب الـaccessor.
  assert.match(dailySrc, /if\(!guardedByAccessor\.has\(name\)\)\{[\s\S]*?window\[name\]=wrapped/);
});

test('movement collection save guards against missing window.OPS instead of throwing', () => {
  assert.match(existingFix, /if\(!window\.OPS\|\|!Array\.isArray\(window\.OPS\.collections\)\)return\{count:0,amount:0,skipped:'no-local-ops'\}/);
});
