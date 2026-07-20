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

test('Telegram product flow no longer quotes observed web prices or exposes sources',async()=>{
  const source=await read('api/_lib/product-market-research.js');
  const assistant=await read('api/_lib/bot-product-assistant.js');
  assert.match(source,/function buildPriceLevel/);
  assert.doesNotMatch(assistant,/product-market-research/);
  assert.doesNotMatch(assistant,/سعر القطعة في السوق الآن/);
  assert.doesNotMatch(assistant,/النطاق المرصود/);
  assert.doesNotMatch(assistant,/price_level:result\.priceLevel/);
  assert.match(assistant,/supplier_search_city/);
  assert.match(assistant,/السعر يُؤكد بالاتصال/);
});

test('Telegram image search identifies the item then routes to copyable supplier lookup',async()=>{
  const source=await read('api/_lib/bot-product-assistant.js');
  const vision=await read('api/_lib/product-image-identification.js');
  assert.match(source,/startProductImageAssistant/);
  assert.match(source,/identifyProductImage/);
  assert.match(source,/product_image_waiting/);
  assert.match(source,/<code>\$1<\/code>/);
  assert.match(source,/callback_data:'proc:product_image'/);
  assert.match(source,/supplier_search_city/);
  assert.match(vision,/attempt:2/);
  assert.match(vision,/second pass/);
  assert.match(vision,/needsMoreDetail/);
});

test('supplier directory uses one bounded Places request and no external URL fields',async()=>{
  const source=await read('api/_lib/bot-procurement.js');
  assert.match(source,/pageSize:20/);
  assert.match(source,/AbortSignal\.timeout\(12000\)/);
  assert.match(source,/return usable\.slice\(0,16\)/);
  assert.match(source,/<code>\$\{esc\(place\.phone\)\}<\/code>/);
  assert.doesNotMatch(source,/nextPageToken/);
  assert.doesNotMatch(source,/googleMapsUri/);
  assert.doesNotMatch(source,/websiteUri/);
});
