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
  assert.doesNotMatch(source,/product-market-research-fast\.js/);
  assert.doesNotMatch(source,/researchProductMarket/);
  assert.match(source,/supplier_search_query/);
  assert.match(source,/supplier_search_city/);
  assert.match(source,/السعر يُؤكد بالاتصال/);
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
  assert.match(source,/href="tel:\$\{esc\(tel\)\}"/);
  assert.match(source,/function callable\(phone\)/);
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
