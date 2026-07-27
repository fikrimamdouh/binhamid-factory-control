import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseFuelWorkbook, buildFuelControlReport, plateKey, fuelCategory } from '../api/_lib/fuel-summary-parser.js';
import { buildStatement, statementRange, monthStart, yesterday, riyadhToday, storeFailureReason } from '../api/_lib/fuel-analytics.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

// رؤوس وصفوف حقيقية من ملف «اكسيل» الذي تصدّره المحطة، بلا تعديل، حتى يختبر
// المحلّل الصيغة الفعلية لا صيغة مفترضة.
const HEADERS = ['رقم الإيصال','السائق','المحطة','المركبة','رقم اللوحة','المبلغ','نوع الوقود','التاريخ','سعر اللتر بالمحطة','الكمية','المبلغ قبل الضريبة','الضريبة','الصافي شامل الضريبة','قراءة العداد السابقة','قراءة العداد الحالية','عدد كيلوات الخدمة'];
const STATION_ROWS = [
  ['2306700','aymanmech','نــــــــــــور الغويلا','aymannew','اوك - kua - 3777','85','petrol 95','2026-07-27 09:00:58','2.33','36.48','73.91','11.0865','85.00 ر.س','0','0','0'],
  ['2306644','Tank','نــــــــــــور الحصينية','1964 اسيزو','أرس - SRA - 1964','900','Diesel','2026-07-27 08:33:05','1.79','502.79','782.61','117.3915','900.00 ر.س','0','0','0'],
  ['2304197','Tank','نــــــــــــور الحصينية','1964 اسيزو','ارس - SRA - 1964','1800','Diesel','2026-07-26 07:40:09','1.79','1005.59','1565.22','234.783','1800.00 ر.س','0','0','0'],
  ['2304946','Hussain','نــــــــــــورالملك سعود','HussainFord','ريي - VVR - 4935','85','petrol 91','2026-07-26 13:30:54','2.18','38.99','73.91','11.0865','85.00 ر.س','0','0','0']
];
const stationWorkbook = () => ({ SheetNames: ['Worksheet'], Sheets: { Worksheet: [HEADERS, ...STATION_ROWS] } });
const fakeXlsx = { utils: { sheet_to_json: sheet => sheet.map(row => row.slice()) } };

test('fuel movements are persisted so consumption can be compared over time', async () => {
  const migration = await read('supabase/migrations/028_fuel_transactions_history.sql');
  const analytics = await read('api/_lib/fuel-analytics.js');
  const files = await read('api/_lib/bot-files.js');
  const pdf = await read('api/_lib/fuel-report-pdf.js');
  assert.match(migration, /create table if not exists public\.fuel_transactions/);
  // إعادة رفع نفس التقرير أو تداخل الفترات يجب ألّا يضاعف الاستهلاك.
  assert.match(migration, /fuel_transactions_identity_uidx/);
  assert.match(migration, /extensions\.digest/);
  assert.match(migration, /FUEL_PLATE_REQUIRED/);
  assert.match(analytics, /resolution=ignore-duplicates/);
  // on_conflict يُمرَّر في الاستعلام: خيار onConflict غير مدعوم في مساعد insert،
  // وبدونه يقارن PostgREST بالمفتاح الأساسي فتسقط كل دفعة عند إعادة الرفع.
  assert.match(analytics, /query:'on_conflict=line_identity'/);
  // العدد المعروض يجب أن يكون المُدرَج فعلًا لا عدد ما حاولنا إدراجه.
  assert.match(analytics, /return=representation/);
  assert.match(analytics, /Array\.isArray\(inserted\)\?inserted\.length/);
  // التقرير المبني يجمّع حسب اللوحة، فالصفوف الخام هي ما يُحفظ — وكلها لا الديزل
  // وحده، لأن تقرير المحطة يغطي الأسطول كاملًا.
  assert.match(pdf, /export async function generateFuelReportPdfs/);
  assert.match(files, /storeFuelRows\(fuelRows,\{sourceFile:name\}/);
});

test('the diesel section reports consumption, efficiency and review flags', async () => {
  const section = await read('api/_lib/bot-fuel-reports.js');
  const analytics = await read('api/_lib/fuel-analytics.js');
  const router = await read('api/_lib/telegram-webhook-handler.js');
  for (const view of ['summary', 'vehicles', 'flags', 'compare']) assert.ok(section.includes(`at('${view}'`), `missing ${view} button`);
  assert.match(section, /`fuel:\$\{view\}/, 'الأزرار تُبنى بالبادئة fuel:');
  assert.match(router, /if\(action==='fuel'\)return handleFuelCallback/);
  assert.match(router, /handleFuelTextCommand/);
  // لتر/100كم هو مؤشر الكفاءة الحقيقي، ويُحسب فقط بعدّاد سليم.
  assert.match(analytics, /row\.liters\/row\.km\*100/);
  assert.match(analytics, /curr>prev&&prev>0/);
  // إشارات المراجعة: كمية شاذة، عدّاد راجع، تكرار في اليوم.
  assert.match(analytics, /ضعف المعتاد/);
  assert.match(analytics, /عدّاد الكيلومترات راجع للخلف/);
  assert.match(analytics, /تعبئات في يوم واحد/);
  // إشارة تحقيق لا اتهام.
  assert.match(section, /قد يكون لها سبب تشغيلي/);
});

test('the station export is parsed with its real headers and every fill is kept', () => {
  const parsed = parseFuelWorkbook(stationWorkbook(), fakeXlsx);
  assert.equal(parsed.rowCount, 4, 'كل الصفوف تُقرأ');
  // البنزين كان يُسقَط قبل الحفظ، فتضيع تكلفة واستهلاك حقيقيان من السجل.
  assert.deepEqual(parsed.rows.map(row => row.category), ['petrol', 'diesel', 'diesel', 'petrol']);
  const first = parsed.rows[0];
  assert.equal(first.receipt, '2306700');
  assert.equal(first.liters, 36.48);
  assert.equal(first.amount, 85);
  assert.equal(first.price, 2.33);
  // «85.00 ر.س» نص وليس رقمًا: لا بد أن تُنزع العملة قبل الجمع.
  assert.equal(first.net, 85);
  assert.equal(first.date.slice(0, 10), '2026-07-27');
});

test('a plate written with and without hamza stays one vehicle', () => {
  // المحطة تكتب اللوحة نفسها «أرس» مرة و«ارس» مرة، وبلا توحيد ينقسم استهلاك
  // الشاحنة الواحدة على مركبتين وهميتين فيبدو كل نصف طبيعيًا.
  assert.equal(plateKey('أرس - SRA - 1964'), plateKey('ارس - SRA - 1964'));
  const diesel = parseFuelWorkbook(stationWorkbook(), fakeXlsx).rows.filter(row => row.category === 'diesel');
  const report = buildFuelControlReport(diesel);
  assert.equal(report.totals.plateCount, 1, 'التعبئتان للوحة واحدة');
  assert.equal(report.totals.fillCount, 2);
  assert.equal(report.vehicles[0].liters, 1508.38);
});

test('free-text fuel names from the station are classified once', () => {
  for (const [value, expected] of [['Diesel', 'diesel'], ['ديزل', 'diesel'], ['petrol 95', 'petrol'], ['petrol 91', 'petrol'], ['بنزين 91', 'petrol'], ['LPG', 'other'], ['', 'other']]) {
    assert.equal(fuelCategory(value), expected, `${value} -> ${expected}`);
  }
});

test('the diesel section keeps its fuel category when the period changes', async () => {
  const section = await read('api/_lib/bot-fuel-reports.js');
  // الفئة جزء من بيانات الزر: بدونها يقفز المستخدم من البنزين إلى الديزل لمجرد
  // أنه غيّر المدة.
  assert.match(section, /fuel:\$\{view\}:\$\{value\}:\$\{cat\}/);
  assert.match(section, /const\[view,slot,categoryRaw,fromRaw,toRaw\]/);
  assert.match(section, /CATEGORY_LABEL\[categoryRaw\]\?categoryRaw:'diesel'/);
  for (const category of ['diesel', 'petrol', 'all']) assert.ok(section.includes(`'${category}'`), `missing ${category}`);
  // «لا يوجد ديزل» و«لا يوجد شيء» حالتان مختلفتان بإرشاد مختلف.
  assert.match(section, /hasAnyData\?note\('توجد حركات وقود من فئة أخرى/);
});

// صفوف كما تُخزَّن في fuel_transactions، مشتقة من نفس ملف المحطة.
const STORED = [
  { transaction_date: '2026-07-27', plate_key: 'ارسSRA1964', vehicle_name: '1964 اسيزو', driver_name: 'Tank', station: 'نور الحصينية', fuel_type: 'Diesel', liters: 502.79, amount: 900, prev_odometer: 0, curr_odometer: 0 },
  { transaction_date: '2026-07-26', plate_key: 'ارسSRA1964', vehicle_name: '1964 اسيزو', driver_name: 'Tank', station: 'نور الحصينية', fuel_type: 'Diesel', liters: 1005.59, amount: 1800, prev_odometer: 0, curr_odometer: 0 },
  { transaction_date: '2026-07-26', plate_key: 'بابBAB3221', vehicle_name: 'Nur Nabi', driver_name: 'Nur Nabi', station: 'نور الغويلا', fuel_type: 'Diesel', liters: 195.53, amount: 350, prev_odometer: 0, curr_odometer: 0 },
  { transaction_date: '2026-07-26', plate_key: 'رييVVR4935', vehicle_name: 'HussainFord', driver_name: 'Hussain', station: 'نور الملك سعود', fuel_type: 'petrol 91', liters: 38.99, amount: 85, prev_odometer: 0, curr_odometer: 0 }
];

test('the vehicle statement totals each plate over an explicit period', () => {
  const statement = buildStatement(STORED, { from: '2026-07-01', to: '2026-07-27', category: 'diesel' });
  assert.equal(statement.totals.fills, 3);
  assert.equal(statement.totals.plates, 2);
  assert.equal(Math.round(statement.totals.liters), 1704);
  assert.equal(statement.totals.amount, 3050);
  // أعلى مركبة سحبًا تتصدر الكشف، وهي معيار المراجعة الأول.
  assert.equal(statement.vehicles[0].name, '1964 اسيزو');
  assert.equal(statement.vehicles[0].fills, 2);
  assert.equal(Math.round(statement.vehicles[0].liters), 1508);
  assert.equal(statement.vehicles[0].amount, 2700);
  // البنزين خارج كشف الديزل لكنه معروض كي لا يختفي.
  assert.equal(statement.otherTotals.fills, 1);
  assert.equal(statement.otherTotals.amount, 85);
  // التوزيع اليومي يكشف اليوم الذي ابتلع الفترة.
  assert.deepEqual(statement.days.map(day => day.date), ['2026-07-27', '2026-07-26']);
  assert.equal(statement.days[1].fills, 2);
  assert.ok(Math.abs(statement.perLiter - 3050 / 1703.91) < 0.01);
});

test('a single day statement answers "what was drawn yesterday"', () => {
  const day = buildStatement(STORED, { from: '2026-07-26', to: '2026-07-26', category: 'diesel' });
  // الفلترة بالتاريخ مسؤولية الاستعلام، لكن التجميع يجب أن يصمد على يوم واحد.
  const only = buildStatement(STORED.filter(row => row.transaction_date === '2026-07-26'), { from: '2026-07-26', to: '2026-07-26', category: 'diesel' });
  assert.equal(only.totals.fills, 2);
  assert.equal(only.totals.amount, 2150);
  assert.equal(only.totals.plates, 2);
  assert.ok(day.hasData);
});

test('the statement period defaults to the first of the month through yesterday', () => {
  const range = statementRange({});
  assert.equal(range.from, monthStart());
  assert.equal(range.to, yesterday());
  assert.match(range.from, /^\d{4}-\d{2}-01$/);
  assert.ok(range.to < riyadhToday(), 'اليوم الجاري مستبعد لأن تقريره لم يصل بعد');
  // مدى مقلوب يُصحَّح بدل أن يعيد صفرًا صامتًا يبدو كأنه «لا توجد حركات».
  assert.deepEqual(statementRange({ from: '2026-07-26', to: '2026-07-01' }), { from: '2026-07-01', to: '2026-07-26' });
  assert.deepEqual(statementRange({ from: '2026-07-01', to: '2026-07-26' }), { from: '2026-07-01', to: '2026-07-26' });
});

test('"today\'s report" stays the sales report and diesel uses its own wording', async () => {
  const section = await read('api/_lib/bot-fuel-reports.js');
  const router = await read('api/_lib/telegram-webhook-handler.js');
  // «تقرير اليوم» المجردة مملوكة للتقرير اليومي للمبيعات؛ خطفها يكسر تقريرًا قائمًا.
  assert.match(router, /\^\(تقرير اليوم\|التقرير اليومي/);
  assert.ok(!/\|تقرير اليوم\)/.test(section.match(/if\(\/\^\\\/\(fuel_today[\s\S]*?\n/)?.[0] || ''), 'الديزل لا يخطف «تقرير اليوم» المجردة');
  for (const phrase of ['تقرير الديزل اليوم', 'مسحوبات امس', 'كشف حساب المركبات']) assert.ok(section.includes(phrase), `missing ${phrase}`);
  assert.match(section, /statementView|dayView/);
});

test('a storage failure names its cause and its fix instead of failing silently', () => {
  const err = (message, code, upstreamStatus) => Object.assign(new Error(message), { data: code ? { code } : undefined, upstreamStatus });
  // الجدول غير موجود = migration 028 لم تُطبَّق. هذا هو السبب الأول المتوقع.
  assert.match(storeFailureReason(err("Could not find the table 'public.fuel_transactions' in the schema cache", 'PGRST205', 404)), /migration 028/);
  assert.match(storeFailureReason(err('relation "public.fuel_transactions" does not exist', '42P01', 404)), /migration 028/);
  // عمود ناقص رسالته تحتوي «does not exist» أيضًا، فيجب ألّا يُقرأ كجدول مفقود.
  assert.match(storeFailureReason(err('column "vehicle_external_id" does not exist', '42703', 400)), /أعمدة/);
  assert.doesNotMatch(storeFailureReason(err('column "fuel_type" does not exist', undefined, 400)), /غير موجود بعد/);
  assert.match(storeFailureReason(err('permission denied', '42501', 403)), /صلاحية/);
  assert.match(storeFailureReason(err('Supabase غير مضبوط على Vercel', undefined, 503)), /غير مضبوط/);
});

test('an unreadable fuel log is reported as an error, not as "no movements"', async () => {
  const analytics = await read('api/_lib/fuel-analytics.js');
  const section = await read('api/_lib/bot-fuel-reports.js');
  const files = await read('api/_lib/bot-files.js');
  // ابتلاع الخطأ إلى مصفوفة فارغة يجعل القسم يعلن «لا توجد حركات» إلى الأبد.
  assert.doesNotMatch(analytics, /select\('fuel_transactions'[\s\S]{0,400}?\.catch\(\(\)=>\[\]\)/);
  assert.match(analytics, /catch\(error\)\{console\.warn\('\[fuel fetch\]'/);
  assert.match(analytics, /error:storeFailureReason\(error\)/);
  assert.match(section, /error\?compose\(/);
  assert.match(section, /تعذّر قراءة سجل الوقود/);
  // رسالة الرفع تذكر السبب والإجراء بدل «راجع السجل».
  assert.match(files, /لم تُحفظ \$\{saved\.failed\} حركة/);
  assert.match(files, /saved\.reason/);
  assert.match(files, /storeFailureReason\(error\)/);
});

test('fuel fills are linked to the asset register instead of station free text', async () => {
  const analytics = await read('api/_lib/fuel-analytics.js');
  assert.match(analytics, /unified_assets/);
  assert.match(analytics, /vehicle_external_id:asset\?\.externalId\|\|null/);
  // الاسم المعتمد يسبق نص المحطة الحر («6512»، «sca»، «aymannew»).
  assert.match(analytics, /vehicle_name:asset\?\.name\|\|clean\(row\.vehicleName\)/);
});
