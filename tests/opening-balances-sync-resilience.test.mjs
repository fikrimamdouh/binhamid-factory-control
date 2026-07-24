// يتحقق من الإصلاح الجذري لتجمّد الواجهة بعد تحميل بيانات كبيرة:
// مزامنة الأرصدة الافتتاحية كانت تعيد رفع كل الصفوف (٢٩٢٠) من الصفر عند أي فشل
// جزئي، وإلى الأبد. هنا نثبت سلوكيًا أنها تستأنف من آخر تقدّم محفوظ، ونثبت
// تعاقديًا وجود قاطع الدائرة ومُركِّب opsPersist المنتهي ذاتيًا وحارس الأداء.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const read = (...parts) => readFileSync(join(here, '..', ...parts), 'utf8');
const syncSource = read('assets', 'opening-balances-chunked-sync.js');
const perfGuard = read('assets', 'perf-guard.js');

// يُنشئ بيئة متصفح مصغّرة ويشغّل ملف المزامنة داخلها، مع تحكّم كامل في fetch.
// يقبل store قائمًا لمحاكاة تحديث الصفحة مع بقاء localStorage.
function loadSync({ rows, store = Object.create(null) }) {
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  store['binhamid_factory_control_v3'] = JSON.stringify({ customerOpeningBalances: rows });

  const calls = [];
  let failIndexes = new Set();
  const fetchMock = async (url, opts) => {
    const idx = calls.length;
    calls.push({ url: String(url), opts });
    if (failIndexes.has(idx)) {
      return { ok: false, status: 500, json: async () => ({ error: 'boom' }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };

  const windowObj = { opsToast() {}, toast() {} };
  function Storage() {}
  Storage.prototype.setItem = function () {};

  const sandbox = {
    window: windowObj,
    document: { getElementById: () => null },
    localStorage,
    Storage,
    fetch: fetchMock,
    console: { log() {}, warn() {}, error() {} },
    // مؤقتات معطّلة كي لا تتكرر حلقة إعادة التركيب أثناء الاختبار.
    setTimeout: () => 0,
    setInterval: () => 0,
    clearInterval: () => {},
    JSON, Math, String, Array, Number, Object, isFinite, parseInt, parseFloat,
  };
  windowObj.fetch = fetchMock;
  vm.runInNewContext(syncSource, sandbox);
  return {
    push: (reason) => windowObj.bhPushOpeningBalances(reason),
    calls,
    store,
    setFailures: (set) => { failIndexes = set; },
  };
}

test('chunked opening-balances sync resumes from saved progress instead of re-uploading every row', async () => {
  const rows = Array.from({ length: 600 }, (_, i) => ({
    customerCode: 'C' + i, customerName: 'عميل ' + i, amount: i, previous: 0,
    debit: 0, credit: 0, cheques: 0, difference: 0, date: '2026-07-24',
  }));
  const env = loadSync({ rows });

  // 600 صف / 250 = 3 دفعات. نُفشل الدفعة الثانية (index 1).
  env.setFailures(new Set([1]));
  await assert.rejects(() => env.push('مزامنة'), /boom/);

  // نجحت الدفعة الأولى فقط: طلبان اثنان (نجاح ثم فشل)، والتقدّم محفوظ عند 250.
  assert.equal(env.calls.length, 2, 'يتوقف عند أول فشل، لا يتابع بقية الدفعات');
  const progress = JSON.parse(env.store['bh_opening_push_progress_v1']);
  assert.equal(progress.sent, 250, 'يحفظ آخر تقدّم ناجح (250 صفًا)');
  assert.notEqual(env.store['bh_opening_externalized_v1'], '1', 'لا يُعلن الاكتمال بعد فشل جزئي');

  // إعادة المحاولة تنجح بالكامل وتستأنف من 250 — لا تعيد رفع الدفعة الأولى.
  env.setFailures(new Set());
  const result = await env.push('إعادة');
  assert.equal(env.calls.length, 4, 'أضافت دفعتين فقط (250→500→600) دون إعادة الدفعة الأولى');
  assert.equal(result.sent, 600);
  assert.equal(env.store['bh_opening_externalized_v1'], '1', 'يعلن الاكتمال بعد رفع كل الصفوف');
  assert.equal(env.store['bh_opening_push_progress_v1'], undefined, 'يمسح التقدّم بعد الاكتمال');
});

test('resume progress survives a page reload (fresh module load, same localStorage)', async () => {
  const rows = Array.from({ length: 600 }, (_, i) => ({
    customerCode: 'C' + i, customerName: 'عميل ' + i, amount: i, previous: 0,
    debit: 0, credit: 0, cheques: 0, difference: 0, date: '2026-07-24',
  }));
  // التحميل الأول: يفشل بعد الدفعة الأولى ويحفظ التقدّم في localStorage.
  const first = loadSync({ rows });
  first.setFailures(new Set([1]));
  await assert.rejects(() => first.push('مزامنة'), /boom/);
  assert.equal(JSON.parse(first.store['bh_opening_push_progress_v1']).sent, 250);

  // «تحديث الصفحة»: نفس الـstore، تحميل جديد للوحدة، ثم رفع ناجح يستأنف من 250.
  const reloaded = loadSync({ rows, store: first.store });
  reloaded.setFailures(new Set());
  const result = await reloaded.push('استئناف بعد التحديث');
  assert.equal(reloaded.calls.length, 2, 'بعد التحديث يرفع الدفعتين المتبقيتين فقط (250→500→600)');
  assert.equal(result.sent, 600);
  assert.equal(reloaded.store['bh_opening_externalized_v1'], '1');
  assert.equal(reloaded.store['bh_opening_push_progress_v1'], undefined);
});

test('source contract: consecutive-failure circuit breaker halts silent infinite retries', () => {
  assert.match(syncSource, /MAX_CONSECUTIVE_FAILURES\s*=\s*3/);
  // ensurePushed يتوقف نهائيًا عند فتح القاطع (aborted) أو اكتمال الرفع (FLAG).
  assert.match(syncSource, /if\(pushing\|\|aborted\|\|localStorage\.getItem\(FLAG\)==='1'\)return/);
  assert.match(syncSource, /consecutiveFailures>=MAX_CONSECUTIVE_FAILURES/);
  assert.match(syncSource, /aborted=true/);
  // الاستدعاء اليدوي يُعيد ضبط القاطع كي تُتاح إعادة المحاولة دون تحديث الصفحة.
  assert.match(syncSource, /bhPushOpeningBalances=function\(reason\)\{aborted=false;consecutiveFailures=0;/);
});

test('source contract: opsPersist re-hook is self-terminating (no runaway setInterval)', () => {
  // لم يعد هناك مؤقت دائم يعيد التركيب كل ثانيتين.
  assert.doesNotMatch(syncSource, /setInterval\(hookPersist/);
  // الحلقة تعتمد setTimeout وتتوقف بعد استقرار الربط أو حد أقصى صارم.
  assert.match(syncSource, /rehookLoop/);
  assert.match(syncSource, /state\.stable>=20/);
  assert.match(syncSource, /state\.ticks>=600/);
});

test('source contract: perf-guard coalesces observers and no longer latches a permanent fetch breaker', () => {
  assert.match(perfGuard, /requestAnimationFrame/);
  assert.match(perfGuard, /CoalescedMutationObserver/);
  assert.match(perfGuard, /IDLE_CYCLES_BEFORE_STOP/);
  // قاطع fetch العالمي أُزيل: صار قاطع الأرصدة في مصدره قابلًا لإعادة الضبط.
  assert.doesNotMatch(perfGuard, /SYNC_CIRCUIT_OPEN/);
  assert.doesNotMatch(perfGuard, /window\.fetch=async function/);
});
