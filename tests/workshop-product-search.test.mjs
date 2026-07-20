import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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

test('supplier results contain copyable phone numbers and no external links',async()=>{
  const source=await read('api/_lib/bot-procurement.js');
  assert.match(source,/<code>\$\{esc\(place\.phone\)\}<\/code>/);
  assert.match(source,/اضغط مطولًا على رقم الاتصال داخل المربع لنسخه/);
  assert.match(source,/السعر: <b>يتأكد بالاتصال<\/b>/);
  assert.doesNotMatch(source,/googleMapsUri/);
  assert.doesNotMatch(source,/websiteUri/);
  assert.doesNotMatch(source,/url:place\./);
  assert.doesNotMatch(source,/خريطة \$\{index\}/);
  assert.doesNotMatch(source,/الموقع \$\{index\}/);
});

test('supplier directory stays within the Vercel request budget and rejects guesses',async()=>{
  const source=await read('api/_lib/bot-procurement.js');
  assert.match(source,/AbortSignal\.timeout\(12000\)/);
  assert.match(source,/لم يتم عرض أرقام غير مؤكدة/);
  assert.match(source,/لم يتم إنشاء نتيجة تخمينية/);
  assert.match(source,/return usable\.slice\(0,16\)/);
});

test('secure procurement menu describes in-bot results only',async()=>{
  const source=await read('api/_lib/bot-procurement-secure.js');
  assert.match(source,/لا توجد روابط خارجية/);
  assert.match(source,/السعر يتأكد بالاتصال/);
  assert.match(source,/بحث قطعة ومورد/);
});
