import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('product research searches Saudi Gulf and global scopes with many sources',async()=>{
  const source=await read('api/_lib/product-market-research.js');
  assert.match(source,/key:'saudi'/);
  assert.match(source,/key:'gulf'/);
  assert.match(source,/key:'global'/);
  assert.match(source,/search_context_size:'high'/);
  assert.match(source,/found\.slice\(0,24\)/);
  assert.match(source,/رقم الهاتف أو WhatsApp/);
});

test('Telegram product assistant supports image search and copyable numbers',async()=>{
  const source=await read('api/_lib/bot-product-assistant.js');
  assert.match(source,/startProductImageAssistant/);
  assert.match(source,/identifyProductImage/);
  assert.match(source,/product_image_waiting/);
  assert.match(source,/<code>\$1<\/code>/);
  assert.match(source,/callback_data:'proc:product_image'/);
});

test('supplier directory paginates Google Places up to three pages',async()=>{
  const source=await read('api/_lib/bot-procurement.js');
  assert.match(source,/for\(let page=0;page<3;page\+\+\)/);
  assert.match(source,/pageSize:20/);
  assert.match(source,/nextPageToken/);
  assert.match(source,/found\.slice\(0,60\)/);
  assert.match(source,/<code>\$\{esc\(place\.phone\)\}<\/code>/);
});
