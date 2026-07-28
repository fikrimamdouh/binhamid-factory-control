import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { supplierSearchQueries } from '../api/_lib/bot-procurement.js';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('workshop menu keeps product and supplier actions inside workshop',async()=>{
  const source=await read('api/_lib/bot-mechanic-secure.js');
  for(const marker of ['proc:product','proc:product_image','proc:search','proc:rfq','proc:open','mech:price_requests'])assert.ok(source.includes(marker),`missing ${marker}`);
  assert.match(source,/بحث قطعة ومورد/);
  assert.match(source,/نتائج الموردين وأرقام الاتصال تظهر داخل البوت فقط/);
});

test('product text and image searches run price and supplier research automatically',async()=>{
  const source=await read('api/_lib/bot-product-assistant.js');
  assert.match(source,/researchProductMarket/);
  assert.match(source,/الأسعار المنشورة استرشادية/);
  assert.doesNotMatch(source,/href="https?:/);
  assert.match(source,/replace\(\/https\?:/);
  assert.match(source,/sendDeepBusinessResults/);
  assert.match(source,/supplierPromise=sendDeepBusinessResults/);
  assert.match(source,/product_image_waiting/);
  assert.match(source,/تحليل ChatGPT للصورة/);
  assert.doesNotMatch(source,/supplier_search_city/);
});

test('bearing search expands from exact item to specialist and general parts shops',()=>{
  const queries=supplierSearchQueries('رولمان بلي 6205','نجران');
  assert.equal(queries.length,3);
  assert.match(queries[0],/رولمان بلي 6205 نجران السعودية/);
  assert.match(queries[1],/رولمان بلي ومحامل وسيور صناعية/);
  assert.match(queries[2],/قطع غيار صناعية وسيارات وشاحنات ومعدات ثقيلة/);
});

test('supplier results contain copyable phone numbers and no external links',async()=>{
  const source=await read('api/_lib/bot-procurement.js');
  assert.match(source,/href="tel:\$\{esc\(tel\)\}"/);
  assert.match(source,/function callable\(phone\)/);
  assert.doesNotMatch(source,/href="https?:/);
  assert.match(source,/التوفر والسعر يتأكدان بالاتصال/);
  assert.doesNotMatch(source,/توفر القطعة المطلوبة: <b>يتأكد بالاتصال<\/b>/);
  assert.doesNotMatch(source,/googleMapsUri/);
  assert.doesNotMatch(source,/websiteUri/);
  assert.doesNotMatch(source,/url:place\./);
  assert.doesNotMatch(source,/خريطة \$\{index\}/);
  assert.doesNotMatch(source,/الموقع \$\{index\}/);
});

test('supplier directory searches fallback scopes in parallel within Vercel budget',async()=>{
  const source=await read('api/_lib/bot-procurement.js');
  assert.match(source,/Promise\.allSettled/);
  assert.match(source,/AbortSignal\.timeout\(9000\)/);
  assert.match(source,/محل متخصص/);
  assert.match(source,/قطع غيار عام/);
  assert.match(source,/مطابق للقطعة/);
  assert.match(source,/كل السعودية/);
  assert.match(source,/return \{places:usable\.slice\(0,18\),searchQueries,expanded/);
});

test('secure procurement menu describes in-bot intelligent search only',async()=>{
  const source=await read('api/_lib/bot-procurement-secure.js');
  assert.match(source,/لا توجد روابط خارجية/);
  assert.match(source,/بحث أسعار وقطع/);
  assert.match(source,/بحث شامل شركات ومحلات/);
  assert.doesNotMatch(source,/text:'طلب عرض سعر'/);
});

test('search widens by equipment type and brand so results are purchasable', async () => {
  const { supplierSearchQueries, equipmentSearchTerm, brandSearchTerm } = await import('../api/_lib/bot-procurement.js');
  assert.match(equipmentSearchTerm('فلتر شيول'), /wheel loader/);
  assert.match(equipmentSearchTerm('قطع خلاطة خرسانة'), /concrete mixer/);
  assert.match(brandSearchTerm('شيول فولفو'), /Volvo/);
  assert.match(brandSearchTerm('بريك كتربلر'), /Caterpillar/);
  const queries = supplierSearchQueries('فلتر زيت شيول فولفو', 'نجران');
  assert.ok(queries.some(q => /Volvo/.test(q) && /wheel loader/.test(q)));
  assert.ok(queries.some(q => /وكيل قطع غيار Volvo/.test(q)));
  assert.ok(queries.indexOf(queries.find(q => /Volvo/.test(q))) < queries.length - 1);
});

test('image reading reports ChatGPT brand equipment codes confidence and automatic search', async () => {
  const vision = await read('api/_lib/product-image-identification.js');
  const assistant = await read('api/_lib/bot-product-assistant.js');
  assert.match(vision, /BRAND/);
  assert.match(vision, /EQUIPMENT/);
  assert.match(vision, /if\(brand&&!has\(brand\)\)query=/);
  assert.match(vision, /if\(equipment&&!has\(equipment\)\)query=/);
  assert.match(vision, /analysisPasses:passes/);
  assert.match(assistant, /تحليل ChatGPT للصورة/);
  assert.match(assistant, /الماركة:/);
  assert.match(assistant, /المعدة:/);
  assert.match(assistant, /مراحل التحليل:/);
  assert.match(assistant, /بدأ الآن بحث الأسعار والمحلات والموردين تلقائيًا/);
});

test('brand matching covers the fleet makes and never fires on lookalike words', async () => {
  const { brandSearchTerm } = await import('../api/_lib/bot-procurement.js');
  for (const [text, expected] of [['قطع سكانيا', /Scania/], ['شاحنة مرسيدس اكتروس', /Mercedes/],
    ['شيول دوسان', /Doosan/], ['مضخة بوتزمايستر', /Putzmeister/], ['محرك كمنز', /Cummins/],
    ['قلاب هينو', /Hino/], ['شاحنات مان', /MAN/]]) assert.match(brandSearchTerm(text), expected);
  for (const text of ['رولمان بلي 6205', 'عثمان للتجارة', 'كيسة اسمنت', 'فلتر زيت'])
    assert.equal(brandSearchTerm(text), '', `false brand match on: ${text}`);
});

test('supplier results check factory stock first and never list one shop twice', async () => {
  const source = await read('api/_lib/bot-procurement.js');
  assert.match(source, /internalStockMatches/);
  assert.match(source, /موجود في مخزن المصنع/);
  assert.match(source, /select\('inventory_items'/);
  assert.match(source, /const byPhone=new Map\(\)/);
  assert.match(source, /const rate=row=>Number\(row\?\.rating\|\|0\)/);
  assert.doesNotMatch(source, /\|\|b\.rating-a\.rating\|\|/);
});

test('price research prefers the free provider and falls back without dying', async () => {
  const assistant = await read('api/_lib/bot-product-assistant.js');
  const free = await read('api/_lib/product-market-research-free.js');
  const configSource = await read('api/_lib/config.js');
  assert.match(assistant, /if\(config\.openaiKey\)providers\.push\(\['openai'/);
  assert.match(assistant, /if\(config\.geminiKey\)providers\.push\(\['gemini'/);
  assert.ok(assistant.indexOf("providers.push(['openai'") < assistant.indexOf("providers.push(['gemini'"));
  assert.match(assistant, /PRICE_RESEARCH_BUDGET_MS=32000/);
  assert.match(assistant, /const DEADLINE=Date\.now\(\)\+Math\.max\(8000,Math\.min\(PRICE_RESEARCH_BUDGET_MS/);
  assert.match(assistant, /if\(remaining<6000\)break/);
  assert.match(assistant, /for\(const\[name,run\]of providers\)/);
  assert.match(configSource, /geminiKey:text\('GEMINI_API_KEY'\)/);
  assert.match(free, /google_search/);
  assert.match(free, /for\(const grounded of \[true,false\]\)/);
  assert.match(free, /لا تضع روابط/);
  assert.doesNotMatch(free, /href=/);
});

test('quote requests become real purchase requests instead of audit-log notes', async () => {
  const source = await read('api/_lib/bot-procurement.js');
  assert.match(source, /insert\('purchase_requests'/);
  assert.match(source, /request_type:'rfq'/);
  assert.match(source, /status:'open'/);
  assert.match(source, /select\('purchase_requests','request_type=eq\.rfq/);
  assert.doesNotMatch(source, /action=eq\.supplier_quote_request&entity_type/);
  assert.match(source, /في السجل فقط — راجع مركز المشتريات/);
});

test('a quote request notifies management naming the requesting department', async () => {
  const source = await read('api/_lib/bot-procurement.js');
  assert.match(source, /const DEPARTMENT=\{mechanic:'الورشة',warehouse:'المخزن'/);
  assert.match(source, /طلبت عرض سعر/);
  assert.match(source, /notifyProcurementApprovers/);
  assert.match(source, /config\.telegramOwnerId/);
  assert.match(source, /APPROVER_ROLES=new Set\(\['admin','manager'\]\)/);
  assert.match(source, /notifyProcurementApprovers\(details,department,\[String\(message\.chat\.id\)\]\)/);
  assert.match(source, /urgent\?'🚨':'🛒'/);
  assert.match(source, /لم يُبلَّغ أحد بعد/);
});

test('free price search fits the function budget and never passes off unsearched numbers', async () => {
  const free = await read('api/_lib/product-market-research-free.js');
  assert.match(free, /TOTAL_BUDGET_MS=32000/);
  assert.match(free, /deadline=Date\.now\(\)\+Math\.max\(6000,Math\.min\(TOTAL_BUDGET_MS/);
  assert.match(free, /if\(remaining<3000\)break/);
  assert.match(free, /const trusted=searched\?offers:\[\]/);
  assert.match(free, /لم تُرصد أسعار منشورة موثوقة/);
  assert.match(free, /grounded:searched/);
});
