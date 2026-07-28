import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('legacy market research module remains isolated and source-aware',async()=>{
  const source=await read('api/_lib/product-market-research.js');
  assert.match(source,/key:'saudi'/);
  assert.match(source,/key:'gulf'/);
  assert.match(source,/key:'global'/);
  assert.match(source,/search_context_size:'high'/);
  assert.match(source,/found\.slice\(0,24\)/);
  assert.match(source,/الهاتف غير منشور/);
});

test('Telegram product flow searches observed prices and suppliers automatically without external links',async()=>{
  const source=await read('api/_lib/product-market-research.js');
  const assistant=await read('api/_lib/bot-product-assistant.js');
  assert.match(source,/function buildPriceLevel/);
  assert.match(assistant,/researchProductMarket/);
  assert.doesNotMatch(assistant,/🔗/);
  assert.match(assistant,/الأسعار المنشورة استرشادية/);
  assert.match(assistant,/sendDeepBusinessResults/);
  assert.match(assistant,/supplierPromise=sendDeepBusinessResults/);
  assert.match(assistant,/لم يظهر سعر منشور موثوق؛ راجع الموردين والمحلات أدناه/);
});

test('Telegram image search uses vision then starts price and supplier research automatically',async()=>{
  const source=await read('api/_lib/bot-product-assistant.js');
  const vision=await read('api/_lib/product-image-identification.js');
  assert.match(source,/startProductImageAssistant/);
  assert.match(source,/identifyProductImage/);
  assert.match(source,/product_image_waiting/);
  assert.match(source,/<code>\$1<\/code>/);
  assert.match(source,/callback_data:'proc:product_image'/);
  assert.match(source,/تحليل الصورة/);
  assert.doesNotMatch(source,/ChatGPT/);
  assert.match(source,/await sendProductResearch\(message,identity,query/);
  assert.match(vision,/api\.openai\.com\/v1\/responses/);
  assert.match(vision,/type:'input_image'/);
  assert.match(vision,/detail:'high'/);
  assert.match(vision,/attempt:2/);
  assert.match(vision,/second pass/);
  assert.match(vision,/needsMoreDetail/);
});

test('supplier directory broadens exact product lookup without external URL fields',async()=>{
  const source=await read('api/_lib/bot-procurement.js');
  assert.match(source,/supplierSearchQueries/);
  assert.match(source,/Promise\.allSettled/);
  assert.match(source,/pageSize:20/);
  assert.match(source,/AbortSignal\.timeout\(9000\)/);
  assert.match(source,/usable\.slice\(0,18\)/);
  assert.match(source,/href="tel:\$\{esc\(tel\)\}"/);
  assert.match(source,/محلات رولمان بلي ومحامل وسيور صناعية/);
  assert.match(source,/محلات قطع غيار صناعية وسيارات وشاحنات ومعدات ثقيلة/);
  assert.doesNotMatch(source,/nextPageToken/);
  assert.doesNotMatch(source,/googleMapsUri/);
  assert.doesNotMatch(source,/websiteUri/);
});
