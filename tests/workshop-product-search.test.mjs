import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildFastPriceLevel, FAST_RESEARCH_LIMITS } from '../api/_lib/product-market-research-fast.js';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('workshop menu contains product, image, supplier and quotation actions',async()=>{
  const source=await read('api/_lib/bot-mechanic-secure.js');
  for(const marker of ['proc:product','proc:product_image','proc:search','proc:rfq','proc:open','mech:price_requests'])assert.ok(source.includes(marker),`missing ${marker}`);
  assert.match(source,/أعمال الورشة وقطع الغيار والمنتجات والأسعار أصبحت في قائمة واحدة/);
});

test('secure procurement routes image search to the product assistant',async()=>{
  const source=await read('api/_lib/bot-procurement-secure.js');
  assert.match(source,/startProductImageAssistant/);
  assert.match(source,/value==='product_image'/);
  assert.match(source,/product_image_waiting/);
});

test('product assistant uses bounded fast research and always provides a terminal reply',async()=>{
  const assistant=await read('api/_lib/bot-product-assistant.js');
  const research=await read('api/_lib/product-market-research-fast.js');
  assert.match(assistant,/product-market-research-fast\.js/);
  assert.match(assistant,/تعذر إكمال بحث السعر/);
  assert.match(research,/AbortSignal\.timeout/);
  assert.ok(FAST_RESEARCH_LIMITS.totalMs<30000);
  assert.ok(FAST_RESEARCH_LIMITS.attemptMs<FAST_RESEARCH_LIMITS.totalMs);
});

test('fast product research calculates a stable price band',()=>{
  const level=buildFastPriceLevel([
    {price_sar:90,quality_tier:'aftermarket',seller:'A'},
    {price_sar:100,quality_tier:'aftermarket',seller:'B'},
    {price_sar:120,quality_tier:'original',seller:'C'},
    {price_sar:110,quality_tier:'compatible',seller:'D'}
  ]);
  assert.equal(level.available,true);
  assert.equal(level.overall.min,90);
  assert.equal(level.overall.max,120);
  assert.equal(level.overall.typical,105);
  assert.equal(level.overall.sampleCount,4);
});
