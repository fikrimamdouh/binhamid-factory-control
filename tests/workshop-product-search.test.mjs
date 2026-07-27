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

test('product text and image searches route to supplier city selection',async()=>{
  const source=await read('api/_lib/bot-product-assistant.js');
  // بحث الأسعار أُعيد تفعيله بطلب صريح من المالك؛ يظل مسار الموردين قائمًا بعده،
  // وتُوسم الأسعار بأنها استرشادية والسعر النهائي بعرض سعر رسمي.
  assert.match(source,/researchProductMarket/);
  assert.match(source,/الأسعار استرشادية/);
  assert.match(source,/عرض سعر رسمي/);
  assert.doesNotMatch(source,/href="https?:/);
  assert.match(source,/replace\(\/https\?:/);
  assert.match(source,/supplier_search_query/);
  assert.match(source,/supplier_search_city/);
  assert.match(source,/product_image_waiting/);
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
  // الرقم صار قابلًا للاتصال بضغطة عبر رابط tel بدل نسخه يدويًا من مربع نص،
  // وتنبيه «التوفر والسعر يتأكدان بالاتصال» يُذكر مرة واحدة بدل تكراره تحت كل مورد.
  // الاتصال بضغطة مطلوب: رابط tel يفتح المتصل. الممنوع هو الروابط الإلكترونية.
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
  // تسميات درجة المطابقة صارت شارات مختصرة بأيقونة بدل جملة نصية تحت كل نتيجة.
  assert.match(source,/محل متخصص/);
  assert.match(source,/قطع غيار عام/);
  assert.match(source,/مطابق للقطعة/);
  assert.match(source,/كل السعودية/);
  assert.match(source,/return \{places:usable\.slice\(0,18\),searchQueries,expanded/);
});

test('secure procurement menu describes in-bot results only',async()=>{
  const source=await read('api/_lib/bot-procurement-secure.js');
  assert.match(source,/لا توجد روابط خارجية/);
  assert.match(source,/السعر يتأكد بالاتصال/);
  assert.match(source,/بحث قطعة ومورد/);
});

test('search widens by equipment type and brand so results are purchasable', async () => {
  const { supplierSearchQueries, equipmentSearchTerm, brandSearchTerm } = await import('../api/_lib/bot-procurement.js');
  assert.match(equipmentSearchTerm('فلتر شيول'), /wheel loader/);
  assert.match(equipmentSearchTerm('قطع خلاطة خرسانة'), /concrete mixer/);
  assert.match(brandSearchTerm('شيول فولفو'), /Volvo/);
  assert.match(brandSearchTerm('بريك كتربلر'), /Caterpillar/);
  const queries = supplierSearchQueries('فلتر زيت شيول فولفو', 'نجران');
  // الأدق أولًا: الماركة مع المعدة، ثم وكيل الماركة، ثم المعدة، ثم العام.
  assert.ok(queries.some(q => /Volvo/.test(q) && /wheel loader/.test(q)));
  assert.ok(queries.some(q => /وكيل قطع غيار Volvo/.test(q)));
  assert.ok(queries.indexOf(queries.find(q => /Volvo/.test(q))) < queries.length - 1);
});

test('image reading reports brand and equipment and asks for what is missing', async () => {
  const vision = await read('api/_lib/product-image-identification.js');
  const assistant = await read('api/_lib/bot-product-assistant.js');
  // النموذج مُلزَم بإخراج الماركة والمعدة، وتُحقن في عبارة البحث إن أغفلها.
  assert.match(vision, /BRAND/);
  assert.match(vision, /EQUIPMENT/);
  assert.match(vision, /if\(brand&&!has\(brand\)\)query=/);
  assert.match(vision, /if\(equipment&&!has\(equipment\)\)query=/);
  assert.match(assistant, /🏷️ الماركة/);
  assert.match(assistant, /🚜 المعدة/);
  assert.match(assistant, /لنتائج أدق/);
});

test('brand matching covers the fleet makes and never fires on lookalike words', async () => {
  const { brandSearchTerm } = await import('../api/_lib/bot-procurement.js');
  for (const [text, expected] of [['قطع سكانيا', /Scania/], ['شاحنة مرسيدس اكتروس', /Mercedes/],
    ['شيول دوسان', /Doosan/], ['مضخة بوتزمايستر', /Putzmeister/], ['محرك كمنز', /Cummins/],
    ['قلاب هينو', /Hino/], ['شاحنات مان', /MAN/]]) assert.match(brandSearchTerm(text), expected);
  // «مان» و«كيس» تظهران داخل كلمات شائعة، فمطابقتهما الحرة كانت ستُفسد كل بحث.
  for (const text of ['رولمان بلي 6205', 'عثمان للتجارة', 'كيسة اسمنت', 'فلتر زيت'])
    assert.equal(brandSearchTerm(text), '', `false brand match on: ${text}`);
});

test('supplier results check factory stock first and never list one shop twice', async () => {
  const source = await read('api/_lib/bot-procurement.js');
  // شراء قطعة موجودة في المخزن هدر مباشر، فتُفحص قبل عرض الموردين.
  assert.match(source, /internalStockMatches/);
  assert.match(source, /موجود في مخزن المصنع/);
  assert.match(source, /select\('inventory_items'/);
  // نفس المحل يعود بمعرّفات مختلفة من استعلامات متعددة؛ التوحيد بالهاتف يمنع تكراره.
  assert.match(source, /const byPhone=new Map\(\)/);
  // التقييم غير المنشور كان ينتج NaN في المقارنة فيُفسد الترتيب.
  assert.match(source, /const rate=row=>Number\(row\?\.rating\|\|0\)/);
  assert.doesNotMatch(source, /\|\|b\.rating-a\.rating\|\|/);
});

test('price research prefers the free provider and falls back without dying', async () => {
  const assistant = await read('api/_lib/bot-product-assistant.js');
  const free = await read('api/_lib/product-market-research-free.js');
  const configSource = await read('api/_lib/config.js');
  // المجاني أولًا حتى لا يتوقف البحث على مفتاح مدفوع، والمدفوع بديل عند فشله.
  assert.match(assistant, /if\(config\.geminiKey\)providers\.push\(\['gemini'/);
  assert.match(assistant, /if\(config\.openaiKey\)providers\.push\(\['openai'/);
  assert.match(assistant, /for\(const\[name,run\]of providers\)/);
  assert.match(configSource, /geminiKey:text\('GEMINI_API_KEY'\)/);
  // البحث المجاني مؤسَّس على بحث Google، ويعيد المحاولة بلا أداة إن رُفضت.
  assert.match(free, /google_search/);
  assert.match(free, /for\(const grounded of \[true,false\]\)/);
  // ولا يُخرج روابط إطلاقًا.
  assert.match(free, /لا تضع روابط/);
  assert.doesNotMatch(free, /href=/);
});
