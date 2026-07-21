import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('Telegram AI uses strict structured output and model fallbacks',async()=>{
  const ai=await read('api/_lib/ai.js');
  const config=await read('api/_lib/config.js');
  assert.match(ai,/type:'json_schema'/);
  assert.match(ai,/strict:true/);
  assert.match(ai,/gpt-5-mini/);
  assert.match(ai,/gpt-4\.1-mini/);
  assert.match(ai,/hollowReply/);
  assert.match(ai,/ممنوع الرد بقوالب هروب/);
  assert.match(config,/textModel:text\('OPENAI_TEXT_MODEL'\)\|\|'gpt-5-mini'/);
});

test('Telegram routing never returns the old generic acknowledgement',async()=>{
  const routing=await read('api/_lib/bot-routing.js');
  assert.doesNotMatch(routing,/فهمت كلامك يا .*عندما يكون الطلب متعلقًا ببيانات المصنع سأحدد المسار والإجراء/);
  assert.match(routing,/تعذر تشغيل الفهم الذكي لهذه الرسالة الآن/);
  assert.match(routing,/action_name:directResponse\?'sales_guided_started':ai\?'ai_answered':'ai_fallback'/);
  assert.match(routing,/ai_ok:Boolean\(ai\)/);
  assert.match(routing,/state:'guided_sales_customer'/);
});
