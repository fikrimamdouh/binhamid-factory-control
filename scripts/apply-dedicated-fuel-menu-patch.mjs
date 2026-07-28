import fs from 'node:fs';

function read(path){return fs.readFileSync(path,'utf8');}
function write(path,value){fs.writeFileSync(path,value,'utf8');}
function replaceOnce(source,before,after,label){
  const first=source.indexOf(before);
  if(first<0)throw new Error(`Missing target: ${label}`);
  if(source.indexOf(before,first+before.length)>=0)throw new Error(`Non-unique target: ${label}`);
  return source.slice(0,first)+after+source.slice(first+before.length);
}

const reportsPath='api/_lib/bot-reports.js';
let reports=read(reportsPath);
reports=replaceOnce(
  reports,
  "    [{text:'الديزل',callback_data:'report:fuel'},{text:'الورشة',callback_data:'report:workshop'}]",
  "    [{text:'الورشة',callback_data:'report:workshop'}]",
  'remove diesel from generic report keyboard'
);
write(reportsPath,reports);

const commandsPath='api/_lib/bot-commands.js';
let commands=read(commandsPath);
commands=replaceOnce(
  commands,
  "    {re:/^(تقرير الديزل|ديزل اليوم|وقود اليوم|تقرير الوقود)$/,kind:'fuel'},\n",
  '',
  'remove legacy diesel text command'
);
write(commandsPath,commands);

const handlerPath='api/_lib/telegram-webhook-handler.js';
let handler=read(handlerPath);
handler=replaceOnce(
  handler,
  "  if(action==='report'){\n    if(value==='concrete_file')return sendStoredReportRequest(message.chat.id,identity,'concrete');",
  "  if(action==='report'){\n    if(value==='fuel')return showFuelMenu({...message,from:query.from},identity);\n    if(value==='concrete_file')return sendStoredReportRequest(message.chat.id,identity,'concrete');",
  'redirect legacy report fuel callback'
);
write(handlerPath,handler);

const testPath='tests/dedicated-fuel-report-menu.test.mjs';
write(testPath,`import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');

test('diesel reports stay outside the generic reports menu',()=>{
  const reports=read('api/_lib/bot-reports.js');
  const commands=read('api/_lib/bot-commands.js');
  const handler=read('api/_lib/telegram-webhook-handler.js');
  assert.doesNotMatch(reports,/callback_data:'report:fuel'/);
  assert.doesNotMatch(commands,/kind:'fuel'/);
  assert.match(handler,/if\(value==='fuel'\)return showFuelMenu/);
});
`);

console.log('Dedicated diesel reporting menu patch applied.');
