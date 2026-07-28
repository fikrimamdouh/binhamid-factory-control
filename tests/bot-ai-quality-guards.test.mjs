import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertResponseComplete, isReasoningModel, modelUnavailable, reasoningFor, responsesOutputText } from '../api/_lib/openai-responses.js';
import { speechText, SPEECH_MAX_CHARS, TRANSCRIBE_TIMEOUT_MS, TTS_TIMEOUT_MS, transcriptionHint } from '../api/_lib/bot-voice.js';
import { detectVoiceFormat } from '../api/_lib/telegram.js';
import { VISION_LIMITS, visionModelCandidates } from '../api/_lib/product-image-identification.js';
import { FAST_RESEARCH_LIMITS } from '../api/_lib/product-market-research-fast.js';
import { IMAGE_PRICE_BUDGET_MS, IMAGE_VISION_BUDGET_MS, PRICE_RESEARCH_BUDGET_MS } from '../api/_lib/bot-product-assistant.js';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
const VERCEL_FUNCTION_LIMIT_MS=60000;

test('truncated model answers surface as a clear error instead of empty output',()=>{
  assert.throws(
    ()=>assertResponseComplete({status:'incomplete',incomplete_details:{reason:'max_output_tokens'}},{code:'X',model:'gpt-5-mini'}),
    error=>error.code==='X'&&/سقف التوكنات/.test(error.message)
  );
  assert.doesNotThrow(()=>assertResponseComplete({status:'completed'}));
  assert.equal(responsesOutputText({output:[{content:[{type:'output_text',text:'نتيجة'}]}]}),'نتيجة');
});

test('reasoning effort is lowered only for reasoning models so the token cap feeds the answer',()=>{
  assert.equal(isReasoningModel('gpt-5.4-mini'),true);
  assert.equal(isReasoningModel('gpt-4o-mini'),false);
  assert.deepEqual(reasoningFor('gpt-5.6'),{reasoning:{effort:'low'}});
  assert.deepEqual(reasoningFor('gpt-4o-mini'),{});
});

test('only model availability errors justify trying the next model',()=>{
  assert.equal(modelUnavailable({status:404,message:'model not found'}),true);
  assert.equal(modelUnavailable({status:429,message:'rate limit'}),false);
  assert.equal(modelUnavailable({status:400,message:'invalid schema'}),false);
});

test('price research gets a token budget large enough to emit its offers',async()=>{
  const source=await read('api/_lib/product-market-research-fast.js');
  const cap=Number((source.match(/max_output_tokens:(\d+)/)||[])[1]);
  assert.ok(cap>=4000,`max_output_tokens too small: ${cap}`);
  assert.match(source,/\.\.\.reasoningFor\(model\)/);
  assert.match(source,/assertResponseComplete\(data,\{code:'PRODUCT_RESEARCH_FAST_TRUNCATED'/);
});

test('image identification gets a token budget and a stronger model than plain text',async()=>{
  const source=await read('api/_lib/product-image-identification.js');
  const cap=Number((source.match(/max_output_tokens:(\d+)/)||[])[1]);
  assert.ok(cap>=3000,`vision max_output_tokens too small: ${cap}`);
  assert.match(source,/\.\.\.reasoningFor\(model\)/);
  assert.match(source,/assertResponseComplete\(data,\{code:'PRODUCT_IMAGE_TRUNCATED'/);
  assert.doesNotMatch(source,/AbortSignal\.timeout\(30000\)/);
  const candidates=visionModelCandidates();
  assert.ok(candidates.length>=1);
  assert.ok(candidates.every(model=>typeof model==='string'&&model.length>1));
});

test('every AI stage stays inside the 60 second Vercel function limit',()=>{
  assert.ok(FAST_RESEARCH_LIMITS.totalMs<=PRICE_RESEARCH_BUDGET_MS);
  assert.ok(FAST_RESEARCH_LIMITS.attemptMs<FAST_RESEARCH_LIMITS.totalMs);
  assert.ok(VISION_LIMITS.firstPassMs+VISION_LIMITS.secondPassMs<=VISION_LIMITS.totalMs+VISION_LIMITS.secondPassMs);
  const textFlow=PRICE_RESEARCH_BUDGET_MS+TTS_TIMEOUT_MS;
  const imageFlow=IMAGE_VISION_BUDGET_MS+IMAGE_PRICE_BUDGET_MS+TTS_TIMEOUT_MS;
  assert.ok(textFlow<VERCEL_FUNCTION_LIMIT_MS,`text flow budget ${textFlow}ms`);
  assert.ok(imageFlow<VERCEL_FUNCTION_LIMIT_MS,`image flow budget ${imageFlow}ms`);
});

test('whisper prompt stays under the 224 token cap while richer models keep the full glossary',()=>{
  const short=transcriptionHint('whisper-1'),full=transcriptionHint('gpt-4o-mini-transcribe');
  assert.ok(short.length<=260,`whisper prompt too long: ${short.length}`);
  assert.ok(full.length>short.length);
  for(const phrase of ['تقرير مسبق','ميزان مراجعة','دفتر أستاذ','مدير مالي','كنية الموظف'])assert.ok(short.includes(phrase),`missing ${phrase}`);
});

test('transcription allows a full recording and retries without forcing Arabic',async()=>{
  const source=await read('api/_lib/bot-voice.js');
  assert.ok(TRANSCRIBE_TIMEOUT_MS>=20000,`transcription timeout too short: ${TRANSCRIBE_TIMEOUT_MS}`);
  assert.match(source,/index===0\?primary:''/);
  assert.match(source,/if\(language\)form\.append\('language',language\)/);
  assert.match(source,/reason:'empty_audio'/);
});

test('voice replies are short, spoken as native Telegram audio, and never fail silently',async()=>{
  const [voice,telegram]=await Promise.all([read('api/_lib/bot-voice.js'),read('api/_lib/telegram.js')]);
  assert.ok(SPEECH_MAX_CHARS<=900,`speech too long for a voice note: ${SPEECH_MAX_CHARS}`);
  const long=speechText(`${'قياس طويل جدا. '.repeat(200)}`);
  assert.ok(long.length<=SPEECH_MAX_CHARS);
  assert.doesNotMatch(long,/\s$/);
  assert.equal(speechText('<b>تم التنفيذ</b><br>الإجمالي: <code>1,440.00</code> ر.س'),'تم التنفيذ. الإجمالي: 1,440.00 ر.س');
  assert.match(voice,/response_format:'opus'/);
  assert.match(voice,/contentType:'audio\/ogg'/);
  assert.deepEqual(detectVoiceFormat(Buffer.from('OggS----')),{contentType:'audio/ogg',filename:'reply.ogg'});
  assert.deepEqual(detectVoiceFormat(Buffer.from([0xff,0xfb,0x90,0x00])),{contentType:'audio/mpeg',filename:'reply.mp3'});
  assert.match(telegram,/telegram voice synthesis/);
});

test('a price request reaches the price assistant instead of being swallowed by the directory',async()=>{
  const gateway=await read('api/_lib/telegram-webhook-gateway.js');
  assert.match(gateway,/canUseProductAssistant\(identity\)&&await handleProductTextCommand\(message,identity,raw\)/);
  const productAt=gateway.indexOf('handleProductTextCommand(message,identity,raw)');
  const directoryAt=gateway.indexOf('return handleDirectBusinessSearchCommand(message,identity,raw)');
  assert.ok(productAt>0&&productAt<directoryAt,'price assistant must be tried before the directory');
});

test('a city survives the full stop that speech transcription adds',async()=>{
  const { directBusinessSearchCity }=await import('../api/_lib/bot-business-directory-flow.js');
  assert.equal(directBusinessSearchCity('ابحث لي على سعر عمود كردان يكون في نجران.'),'نجران');
  assert.equal(directBusinessSearchCity('سعر عمود كردان في جدة!'),'جدة');
  assert.equal(directBusinessSearchCity('سعر عمود كردان'),'كل السعودية');
});

test('a homophone is only corrected inside a mechanical sentence',async()=>{
  const { correctTranscription }=await import('../api/_lib/bot-voice.js');
  assert.match(correctTranscription('ابحث لي على شعر عمود كردان خمسين سنتي.'),/سعر عمود كردان/);
  assert.equal(correctTranscription('مركز تركيب الشعر الطبيعي'),'مركز تركيب الشعر الطبيعي');
  assert.equal(correctTranscription('صالون شعر في نجران'),'صالون شعر في نجران');
});

test('a new part name is never replaced by the previous search',async()=>{
  const flow=await read('api/_lib/bot-business-directory-flow.js');
  assert.match(flow,/const fallback=PROCUREMENT_HINT\.test\(fresh\)&&!NON_MARKET_HINT\.test\(fresh\)\?fresh:priorQuery/);
  assert.match(flow,/const query=GENERIC_REFERENCE\.test\(extracted\)\?priorQuery:extracted\|\|fallback/);
});

test('the bot never names its AI provider to the user and speaks only the closing summary',async()=>{
  const [assistant,flow]=await Promise.all([read('api/_lib/bot-product-assistant.js'),read('api/_lib/bot-business-directory-flow.js')]);
  assert.doesNotMatch(assistant,/ChatGPT/);
  assert.doesNotMatch(flow,/ChatGPT/);
  const { voiceSummary }=await import('../api/_lib/bot-product-assistant.js');
  const priced=voiceSummary('عمود كردان',{priceLevel:{available:true,overall:{typical:1250,typicalLow:900,typicalHigh:1600,sampleCount:6}}},[1,2,3]);
  assert.match(priced,/1,250 ريال/);
  assert.match(priced,/3 جهة/);
  assert.match(voiceSummary('عمود كردان',null,[]),/لم أجد سعرًا منشورًا/);
  assert.match(flow,/\{\.\.\.keyboard\(buttons\),disable_voice_reply:true\}/);
  assert.match(assistant,/body\.slice\(0,3900\),\{disable_voice_reply:true\}/);
});

test('a bare part photo is understood without pressing a button first',async()=>{
  const files=await read('api/_lib/bot-files.js');
  assert.match(files,/impliedPartPhoto=canUseProductAssistant\(identity\)&&!DOCUMENT_CAPTION\.test\(caption\)&&PHOTO_SEARCH_STATES\.has\(photoState\)/);
  assert.match(files,/photoState==='product_image_waiting'\|\|askedByCaption\|\|impliedPartPhoto/);
  assert.match(files,/فاتور\|عرض سعر/);
  const assistant=await read('api/_lib/bot-product-assistant.js');
  assert.match(assistant,/ابعت صورة القطعة أو الملصق/);
  assert.doesNotMatch(assistant,/سيحللها/);
});
