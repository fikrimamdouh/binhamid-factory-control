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
  assert.match(source,/\.\.\.reasoningFor\(model,'minimal',\{withTools:true\}\)/);
  assert.match(source,/search_context_size:'low'/);
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
  assert.ok(TRANSCRIBE_TIMEOUT_MS>=15000,`transcription timeout too short: ${TRANSCRIBE_TIMEOUT_MS}`);
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
  assert.match(assistant,/body\.slice\(0,3900\),\{\.\.\.\(gulfButton\|\|\{\}\),disable_voice_reply:true\}/);
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

test('one invocation deadline is shared by every stage of the webhook',async()=>{
  const { budgetFor, remainingMs, startInvocation, INVOCATION_LIMIT_MS, SAFETY_MARGIN_MS }=await import('../api/_lib/bot-deadline.js');
  assert.equal(INVOCATION_LIMIT_MS,60000);
  startInvocation();
  const left=remainingMs();
  assert.ok(left<=INVOCATION_LIMIT_MS-SAFETY_MARGIN_MS&&left>40000,`unexpected remaining: ${left}`);
  assert.equal(budgetFor(5000),5000);
  assert.equal(budgetFor(90000,50000),Math.min(90000,left-50000));
  assert.equal(budgetFor(5000,999999),0);
  const gateway=await read('api/_lib/telegram-webhook-gateway.js');
  assert.match(gateway,/export default async function handler\(req,res\)\{\s*startInvocation\(\);/);
  const telegram=await read('api/_lib/telegram.js');
  assert.match(telegram,/&&remainingMs\(\)>12000/);
});

test('the price stage leaves room for the summary and the spoken reply',async()=>{
  const { PRICE_RESEARCH_BUDGET_MS, SUMMARY_RESERVE_MS, IMAGE_PRICE_BUDGET_MS, IMAGE_VISION_BUDGET_MS }=await import('../api/_lib/bot-product-assistant.js');
  const { FAST_RESEARCH_LIMITS }=await import('../api/_lib/product-market-research-fast.js');
  const { TRANSCRIBE_TIMEOUT_MS, TTS_TIMEOUT_MS }=await import('../api/_lib/bot-voice.js');
  assert.ok(FAST_RESEARCH_LIMITS.totalMs<=PRICE_RESEARCH_BUDGET_MS);
  assert.ok(SUMMARY_RESERVE_MS>=TTS_TIMEOUT_MS);
  const voiceFlow=TRANSCRIBE_TIMEOUT_MS+PRICE_RESEARCH_BUDGET_MS+TTS_TIMEOUT_MS;
  assert.ok(voiceFlow<60000,`voice flow ${voiceFlow}ms exceeds the function limit`);
  assert.ok(IMAGE_VISION_BUDGET_MS+IMAGE_PRICE_BUDGET_MS+TTS_TIMEOUT_MS<60000);
});

test('conversational filler never reaches the search engine',async()=>{
  const { stripConversationalFiller }=await import('../api/_lib/bot-query-clean.js');
  assert.equal(stripConversationalFiller('يعني أنت مش عارف تبحث على رمان بلي'),'تبحث على رمان بلي');
  assert.equal(stripConversationalFiller('رمان بلي 6205 SKF'),'رمان بلي 6205 SKF');
  const { extractProductMarketQuery }=await import('../api/_lib/bot-product-assistant.js');
  assert.equal(extractProductMarketQuery('يعني أنت مش عارف تبحث على رمان بلي'),'رمان بلي');
});

test('a vision description is cut down to a query a search engine can match',async()=>{
  const { shortPhrase }=await import('../api/_lib/product-image-identification.js');
  const blob='KBC bearings محامل كيه بي سي محمل كراتي مغلق (sealed) / deep groove ball bearing معدات صناعية عامة';
  const query=shortPhrase(blob,90);
  assert.ok(query.length<=90,`query too long: ${query.length}`);
  assert.doesNotMatch(query,/[/()]/);
  assert.equal(shortPhrase('معدات صناعية عامة / محركات وناقلات حركة',30),'معدات صناعية عامة');
});

test('the product flow announces itself once, not twice',async()=>{
  const [assistant,flow]=await Promise.all([read('api/_lib/bot-product-assistant.js'),read('api/_lib/bot-business-directory-flow.js')]);
  assert.match(assistant,/sendDeepBusinessResults\(message,identity,clean,city,\{announce:false\}\)/);
  assert.match(flow,/sendDeepBusinessResults\(message,identity,query,city,\{announce=true\}=\{\}\)/);
  assert.match(flow,/if\(announce\)await sendMessage/);
});

test('the strongest model is tried first and a missing one is never retried',async()=>{
  const { markModelUnavailable, usableModels, isModelKnownUnavailable }=await import('../api/_lib/openai-responses.js');
  const { visionModelCandidates, PREFERRED_VISION_MODELS }=await import('../api/_lib/product-image-identification.js');
  assert.equal(visionModelCandidates()[0],PREFERRED_VISION_MODELS[0]);
  assert.ok(visionModelCandidates().length>1,'a fallback model must exist');
  markModelUnavailable('__missing-model__');
  assert.equal(isModelKnownUnavailable('__missing-model__'),true);
  assert.deepEqual(usableModels(['__missing-model__','good-model']),['good-model']);
  assert.deepEqual(usableModels(['__missing-model__']),['__missing-model__'],'never return an empty candidate list');
  const vision=await read('api/_lib/product-image-identification.js');
  assert.match(vision,/markModelUnavailable\(model\)/);
  const fast=await read('api/_lib/product-market-research-fast.js');
  assert.match(fast,/if\(modelUnavailable\(error\)\)\{markModelUnavailable\(model\);continue;\}/);
  const configSource=await read('api/_lib/config.js');
  assert.match(configSource,/textModel:text\('OPENAI_TEXT_MODEL'\),/);
});

test('supplier search asks for the trade category, not the literal part name',async()=>{
  const { fallbackPlan, placeSafeTerm, planPlaceQueries, SUPPLY_HUBS }=await import('../api/_lib/supplier-search-plan.js');
  assert.equal(placeSafeTerm('عمود كردان 50 سم'),'عمود كردان','sizes must not reach a place-name search');
  const plan=fallbackPlan('عمود كردان 50 سم');
  assert.ok(plan.categoriesAr.some(term=>/معدات ثقيلة|كردان/.test(term)));
  assert.ok(plan.categoriesAr.every(term=>!/\d/.test(term)),'no digits in a place query');
  const bearings=fallbackPlan('رمان بلي 6205');
  assert.ok(bearings.categoriesAr.some(term=>/محامل/.test(term)));
  const queries=planPlaceQueries(bearings,'نجران');
  assert.ok(queries.length>0,'a chosen city must still produce queries');
  assert.ok(queries.every(q=>q.includes('نجران')),'a chosen city must not be diluted by other cities');
  const wider=planPlaceQueries(bearings,'نجران',{expand:true});
  assert.ok(wider.every(q=>!q.includes('نجران')),'expansion covers only the other hubs');
  assert.ok(SUPPLY_HUBS.some(hub=>wider.some(q=>q.includes(hub))));
  const nationwide=planPlaceQueries(bearings,'كل السعودية');
  assert.ok(nationwide.length>=8,`too few nationwide queries: ${nationwide.length}`);
  assert.ok(new Set(nationwide).size===nationwide.length,'queries must be unique');
  const generic=planPlaceQueries(fallbackPlan('حاجة غريبة'),'كل السعودية');
  assert.ok(generic.length>0,'an unknown part still produces queries');
});

test('parts sellers outrank repair workshops',async()=>{
  const { supplierKind, mergeBusinessResults, KIND_LABEL }=await import('../api/_lib/bot-business-directory.js');
  assert.equal(supplierKind({name:'ورشة عبد الرحمن إصلاح عمود كردان',category:'تصليح سيارات'}),'repair');
  assert.equal(supplierKind({name:'مخرطة عامود كردان',category:''}),'repair');
  assert.equal(supplierKind({name:'مؤسسة النور لقطع الغيار',category:'متجر'}),'seller');
  const merged=mergeBusinessResults([
    {name:'ورشة تصليح كردان',phone:'0500000001',category:'تصليح سيارات'},
    {name:'مؤسسة قطع غيار النور',phone:'0500000002',category:'متجر'}
  ],[]);
  assert.equal(merged[0].kind,'seller','a seller must come first');
  assert.equal(merged[1].kind,'repair');
  assert.equal(KIND_LABEL.repair,'ورشة تصليح');
  const flow=await read('api/_lib/bot-business-directory-flow.js');
  assert.match(flow,/KIND_LABEL\[row\.kind\]/,'the list must label each entry');
});

test('the directory web search is one call, not two chained thirty second calls',async()=>{
  const directory=await read('api/_lib/bot-business-directory.js');
  assert.equal((directory.match(/await openAiResponse\(/g)||[]).length,1,'a second chained call reintroduces the 60s timeout');
  assert.doesNotMatch(directory,/,30000\)/);
  assert.match(directory,/const plan=await buildSupplierSearchPlan\(query\)/);
  assert.match(directory,/planPlaceQueries\(plan,city,\{maxQueries:18\}\)/);
});

test('generic company words never decide whether a place sells or repairs',async()=>{
  const { supplierKind, KIND_LABEL }=await import('../api/_lib/bot-business-directory.js');
  assert.equal(supplierKind({name:'مؤسسة الرياض التجارية',category:'شركة'}),'other','generic words must not mean seller');
  assert.equal(supplierKind({name:'محل قطع غيار النور',category:'متجر'}),'seller');
  assert.equal(supplierKind({name:'مخرطة عامود كردان',category:'تصليح سيارات'}),'repair');
  assert.equal(supplierKind({name:'شركة الابتسام لاعمدة الكردان',category:'مركز صيانة سيارات'}),'repair');
  assert.equal(supplierKind({name:'مؤسسة الخير لقطع الغيار وورشة الصيانة',category:''}),'mixed');
  assert.equal(KIND_LABEL.mixed,'بائع وورشة');
});

test('classified listings keep only real links and rank priced ones first',async()=>{
  const { normalizeListings, MARKETPLACE_SITES }=await import('../api/_lib/marketplace-listings.js');
  assert.ok(MARKETPLACE_SITES.includes('haraj.com.sa'));
  const rows=normalizeListings([
    {title:'بدون سعر',price:0,url:'https://haraj.com.sa/1'},
    {title:'مستعمل',price:800,contact:'0501234567',url:'https://haraj.com.sa/2'},
    {title:'مكرر',price:900,url:'https://haraj.com.sa/2'},
    {title:'رابط مزيف',price:500,url:'javascript:alert(1)'},
    {title:'بلا رابط',price:400,url:''}
  ]);
  assert.equal(rows.length,2,'invalid and duplicate links must be dropped');
  assert.equal(rows[0].price,800,'a priced listing outranks one without a price');
  assert.ok(rows.every(row=>row.url.startsWith('https://')));
});

test('classified prices are shown as their own section and never mixed with supplier quotes',async()=>{
  const { renderMarketplace, voiceSummary }=await import('../api/_lib/bot-product-assistant.js');
  assert.equal(renderMarketplace({listings:[]}),'','no section when there is nothing to show');
  const body=renderMarketplace({listings:[{title:'كردان',price:800,currency:'ريال',city:'الرياض',condition:'مستعمل',posted:'',contact:'0501234567',url:'https://haraj.com.sa/2',site:'haraj.com.sa'}],note:''});
  assert.match(body,/مواقع الإعلانات/);
  assert.match(body,/افتح الرابط وتأكد/,'the user must be warned to verify');
  assert.match(body,/https:\/\/haraj\.com\.sa\/2/);
  assert.match(voiceSummary('كردان',null,[],{listings:[{price:800}]}),/إعلان مستعمل بسعر معلن/);
  const assistant=await read('api/_lib/bot-product-assistant.js');
  assert.match(assistant,/searchMarketplaceListings\(clean,\{city\}\)\.catch/,'a failing marketplace must not break the search');
});

test('minimal reasoning is never sent together with a built-in tool',async()=>{
  const { reasoningFor, MIN_EFFORT_WITH_TOOLS }=await import('../api/_lib/openai-responses.js');
  assert.deepEqual(reasoningFor('gpt-5-mini','minimal',{withTools:true}),{reasoning:{effort:MIN_EFFORT_WITH_TOOLS}});
  assert.deepEqual(reasoningFor('gpt-5-mini','minimal'),{reasoning:{effort:'minimal'}});
  assert.deepEqual(reasoningFor('gpt-5-mini','high',{withTools:true}),{reasoning:{effort:'high'}});
  assert.deepEqual(reasoningFor('gpt-4o-mini','minimal',{withTools:true}),{});
  // الحارس البنيوي: أي ملف يستدعي أداة مدمجة يجب أن يمرر withTools، وإلا عاد الخطأ 400.
  const files=['api/_lib/product-market-research-fast.js','api/_lib/marketplace-listings.js','api/_lib/supplier-search-plan.js','api/_lib/product-image-identification.js'];
  for(const file of files){
    const source=await read(file);
    if(!/type:'web_search'/.test(source))continue;
    const minimalCalls=source.match(/reasoningFor\([^)]*'minimal'[^)]*\)/g)||[];
    for(const call of minimalCalls)assert.match(call,/withTools:true/,`${file} sends minimal effort with a built-in tool`);
  }
});

test('a chosen city is honoured and anything outside it is labelled',async()=>{
  const { LOCAL_RESULT_FLOOR, mergeBusinessResults }=await import('../api/_lib/bot-business-directory.js');
  assert.ok(LOCAL_RESULT_FLOOR>0);
  const merged=mergeBusinessResults([
    {name:'مؤسسة قطع غيار الرياض',phone:'0500000001',category:'متجر',inCity:false},
    {name:'مؤسسة قطع غيار نجران',phone:'0500000002',category:'متجر',inCity:true}
  ],[]);
  assert.equal(merged[0].name,'مؤسسة قطع غيار نجران','in-city results must come first');
  assert.equal(merged[1].inCity,false);
  const directory=await read('api/_lib/bot-business-directory.js');
  assert.match(directory,/planPlaceQueries\(plan,city,\{maxQueries:18\}\)/);
  assert.match(directory,/local\.length<LOCAL_RESULT_FLOOR/,'widen only when local results are thin');
  const flow=await read('api/_lib/bot-business-directory-flow.js');
  assert.match(flow,/خارج \$\{esc\(clean\(city,40\)\)\}/);
  assert.match(flow,/من مدن أخرى/);
});

test('a new request replaces the previous one instead of piling onto it',async()=>{
  const { isSearchRefinement }=await import('../api/_lib/bot-business-directory-flow.js');
  assert.equal(isSearchRefinement('SKF','رمان بلي 6205'),true,'a short brand narrows the previous search');
  assert.equal(isSearchRefinement('6205','رمان بلي'),true,'a part number narrows');
  assert.equal(isSearchRefinement('2RS','رمان بلي 6205'),true,'a spec suffix narrows');
  assert.equal(isSearchRefinement('اصلي','رمان بلي 6205'),true,'original vs aftermarket narrows');
  assert.equal(isSearchRefinement('ديزل','رمان بلي 6205'),false,'another commodity is a new search, not a refinement');
  assert.equal(isSearchRefinement('زيت','رمان بلي 6205'),false);
  assert.equal(isSearchRefinement('مضخة','رمان بلي 6205'),false);
  assert.equal(isSearchRefinement('عمود كردان 50 سم','رمان بلي 6205'),false,'a full request is a new search');
  assert.equal(isSearchRefinement('فلتر زيت','رمان بلي 6205'),false,'naming another part is a new search');
  assert.equal(isSearchRefinement('SKF',''),false,'nothing to refine');
  const flow=await read('api/_lib/bot-business-directory-flow.js');
  assert.doesNotMatch(flow,/const merged=`\$\{context\.query\|\|''\} \$\{value\}`/,'the unbounded append must not return');
  assert.match(flow,/refining\?`\$\{context\.query\} \$\{value\}`\.trim\(\)\.slice\(0,160\):value/);
  assert.match(flow,/'طلب جديد'/,'the user must see which of the two happened');
});

test('the button flow reaches prices and listings, exactly like typing a part name',async()=>{
  const flow=await read('api/_lib/bot-business-directory-flow.js');
  assert.match(flow,/async function runSearch\(message,identity,query,city\)/);
  assert.match(flow,/assistant\.sendProductResearch\(message,identity,query,city\)/);
  assert.match(flow,/await import\('\.\/bot-product-assistant\.js'\)/,'dynamic import avoids the circular dependency');
  assert.equal((flow.match(/await runSearch\(/g)||[]).length,3,'every search entry point must share one route');
});

test('a school, a kindergarten and a poultry shop never appear in a bearings search',async()=>{
  const { filterRelevant, relevanceScore }=await import('../api/_lib/bot-business-directory.js');
  const terms=['رمان بلي','محامل ومحمل صناعي'];
  const junk=[
    {name:'المشواف لقطع غيار السيارات',category:'متجر قطع غيار سيارات'},
    {name:'مراطة للدواجن',category:'متجر أطعمة'},
    {name:'رجلاء',category:'مدرسة'},
    {name:'الروضة الأربعون',category:'رياض أطفال'},
    {name:'الشرفه',category:'مبنى سكني'},
    {name:'مكتبة أنوار',category:'متجر'},
    {name:'بارك للأثاث المكتبي',category:'متجر'},
    {name:'عذبة الوادي لفلاتر المياه',category:'قاعة مناسبات'},
    {name:'شركة الوابل للمضخات',category:'موّردون'}
  ];
  const kept=filterRelevant(junk,terms);
  const names=kept.map(row=>row.name);
  for(const bad of ['رجلاء','الروضة الأربعون','الشرفه','مراطة للدواجن','مكتبة أنوار','بارك للأثاث المكتبي','عذبة الوادي لفلاتر المياه'])
    assert.ok(!names.includes(bad),`${bad} must be filtered out`);
  assert.ok(names.includes('المشواف لقطع غيار السيارات'));
  assert.ok(names.includes('شركة الوابل للمضخات'));
  assert.ok(relevanceScore({name:'محامل الرياض',category:'موّردون'},terms)>relevanceScore({name:'مؤسسة عامة',category:'موّردون'},terms),'a name matching the part ranks higher');
  assert.equal(relevanceScore({name:'رجلاء',category:'مدرسة'},terms),-1);
  const flow=await read('api/_lib/bot-business-directory-flow.js');
  assert.match(flow,/لا يوجد في/,'an empty result must be stated honestly');
});

test('the price search stays inside Saudi Arabia unless the user asks to widen',async()=>{
  const fast=await read('api/_lib/product-market-research-fast.js');
  assert.match(fast,/scope==='gulf'/,'the scope must be a real branch, not a fixed instruction');
  assert.match(fast,/داخل السوق السعودي فقط/);
  assert.match(fast,/لا تدرج بائعًا خارج السعودية إطلاقًا/);
  assert.doesNotMatch(fast,/if\(parsed\.scope_note\)lines\.push/,'the search narration must not be printed');
  const assistant=await read('api/_lib/bot-product-assistant.js');
  assert.match(assistant,/scope==='gulf'\?null:keyboard/,'the widen button hides once already widened');
  assert.match(assistant,/market_scope:/);
  const procurement=await read('api/_lib/bot-procurement-secure.js');
  assert.match(procurement,/action==='market_scope'/);
  assert.match(procurement,/\{scope:'gulf'\}/);
  assert.match(procurement,/canUseProductAssistant\(identity\)/,'the widen action must respect permissions');
});

test('a cardboard factory and a gift shop never survive a bearings search',async()=>{
  const { filterRelevant, OUTSIDE_LIMIT, OUTSIDE_STRONG_MATCH }=await import('../api/_lib/bot-business-directory.js');
  const terms=['رمان بلي','محامل ومحمل صناعي'];
  const rows=[
    {name:'شركة مصادر الحركة موزع معتمد رمان بلي SKF',category:'موّردون',phone:'1',inCity:false},
    {name:'شركة الغدير محامل لقطع الغيار',category:'موّردون',phone:'1',inCity:false},
    {name:'إتش بي للتحف والهدايا',category:'محل هدايا',phone:'1',inCity:false},
    {name:'زاوية الروشن للكرتون',category:'مصنع',phone:'1',inCity:false},
    {name:'Najran Doors',category:'مصنع',phone:'1',inCity:true},
    {name:'وكالة نمران قطع غيار تويوتا',category:'متجر قطع غيار سيارات',phone:'1',inCity:true}
  ];
  const kept=filterRelevant(rows,terms).map(row=>row.name);
  for(const bad of ['إتش بي للتحف والهدايا','زاوية الروشن للكرتون','Najran Doors'])
    assert.ok(!kept.includes(bad),`${bad} must be filtered out`);
  assert.equal(kept[0],'وكالة نمران قطع غيار تويوتا','in-city results lead');
  assert.ok(kept.includes('شركة مصادر الحركة موزع معتمد رمان بلي SKF'));
  assert.equal(OUTSIDE_STRONG_MATCH,2,'out-of-city needs a real match, not a generic type');
  const many=Array.from({length:40},(_,i)=>({name:`محامل رقم ${i}`,category:'موّردون',phone:'1',inCity:false}));
  assert.equal(filterRelevant(many,terms).length,OUTSIDE_LIMIT,'the out-of-city tail must be capped');
  const directory=await read('api/_lib/bot-business-directory.js');
  assert.doesNotMatch(directory,/مستودع\|مصنع\|توريد/,'a generic factory type must not imply relevance');
});
