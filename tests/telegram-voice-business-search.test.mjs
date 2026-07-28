import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mergeBusinessResults,businessSearchScope } from '../api/_lib/bot-business-directory.js';
import { speechText } from '../api/_lib/bot-voice.js';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('voice reply text removes Telegram HTML and keeps Arabic financial wording readable',()=>{
  const text=speechText('<b>تم التنفيذ</b><br>الإجمالي: <code>1,440.00</code> ر.س &amp; الرصيد النهائي');
  assert.equal(text,'تم التنفيذ. الإجمالي: 1,440.00 ر.س & الرصيد النهائي');
  assert.doesNotMatch(text,/<[^>]+>/);
});

test('business directory merges Google and official web records without dropping web-only companies',()=>{
  const rows=mergeBusinessResults([
    {id:'p1',name:'شركة النور للمضخات',address:'نجران',phone:'0500000000',rating:4.5,reviews:20,matchRank:0}
  ],[
    {name:'شركة النور للمضخات',category:'مضخات خرسانة',city:'نجران',address:'نجران',phone:'+966500000000',website:'https://alnoor.example',source_type:'official_company',confidence:'high',evidence:'الموقع الرسمي يذكر توريد المضخات'},
    {name:'مصنع الجنوب للخراطيم',category:'خراطيم صناعية',city:'نجران',address:'المدينة الصناعية',phone:'0170000000',website:'https://south.example',source_type:'official_company',confidence:'high',evidence:'مصنع منشور في موقعه الرسمي'}
  ]);
  assert.equal(rows.length,2);
  assert.equal(rows[0].name,'شركة النور للمضخات');
  assert.equal(rows[0].origin,'combined');
  assert.equal(rows[0].sourceType,'official_company');
  assert.ok(rows.some(row=>row.name==='مصنع الجنوب للخراطيم'));
});

test('deep business scope explicitly includes companies factories agents shops and specialist sources',()=>{
  const scope=businessSearchScope('مضخات خرسانة','نجران');
  for(const value of ['شركة','مصنع','وكيل','مورد','محل','ورشة'])assert.ok(scope.entityTypes.includes(value));
  assert.match(scope.location,/نجران/);
  assert.ok(scope.sourceTypes.length>=5);
});

test('Telegram procurement and voice contracts use the new deep-search and speech paths',async()=>{
  const [secure,flow,directory,voice,telegram,context]=await Promise.all([
    read('api/_lib/bot-procurement-secure.js'),read('api/_lib/bot-business-directory-flow.js'),read('api/_lib/bot-business-directory.js'),
    read('api/_lib/bot-voice.js'),read('api/_lib/telegram.js'),read('api/_lib/bot-voice-context.js')
  ]);
  assert.match(secure,/بحث شامل شركات ومحلات/);
  assert.match(secure,/startDeepBusinessSearch/);
  assert.match(flow,/searchComprehensiveBusinessDirectory/);
  assert.match(directory,/tools:\[\{type:'web_search',search_context_size:'high'/);
  assert.match(directory,/places\.googleapis\.com\/v1\/places:searchText/);
  assert.match(voice,/audio\/speech/);
  assert.match(voice,/gpt-4o-mini-tts/);
  assert.match(telegram,/shouldSpeakTelegramText/);
  assert.match(telegram,/sendVoiceBuffer\(chatId,speech\.buffer\)/);
  assert.match(context,/AsyncLocalStorage/);
});
