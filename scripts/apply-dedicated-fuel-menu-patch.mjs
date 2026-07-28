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
const dieselReportRow="    [{text:'الديزل',callback_data:'report:fuel'},{text:'الورشة',callback_data:'report:workshop'}]";
const workshopOnlyRow="    [{text:'الورشة',callback_data:'report:workshop'}]";
if(!reports.includes(dieselReportRow)){
  reports=replaceOnce(reports,workshopOnlyRow,dieselReportRow,'restore diesel button in generic report keyboard');
}
write(reportsPath,reports);

const commandsPath='api/_lib/bot-commands.js';
let commands=read(commandsPath);
const legacyDieselCommand="    {re:/^(تقرير الديزل|ديزل اليوم|وقود اليوم|تقرير الوقود)$/,kind:'fuel'},\n";
if(commands.includes(legacyDieselCommand))commands=commands.replace(legacyDieselCommand,'');
write(commandsPath,commands);

const handlerPath='api/_lib/telegram-webhook-handler.js';
let handler=read(handlerPath);
const modernFuelRedirect="    if(value==='fuel')return showFuelMenu({...message,from:query.from},identity);";
if(!handler.includes(modernFuelRedirect)){
  handler=replaceOnce(
    handler,
    "  if(action==='report'){\n    if(value==='concrete_file')return sendStoredReportRequest(message.chat.id,identity,'concrete');",
    "  if(action==='report'){\n"+modernFuelRedirect+"\n    if(value==='concrete_file')return sendStoredReportRequest(message.chat.id,identity,'concrete');",
    'redirect report fuel callback to modern fuel menu'
  );
}
write(handlerPath,handler);

const testPath='tests/dedicated-fuel-report-menu.test.mjs';
write(testPath,`import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');

test('diesel button stays in reports and opens the modern diesel menu',()=>{
  const reports=read('api/_lib/bot-reports.js');
  const commands=read('api/_lib/bot-commands.js');
  const handler=read('api/_lib/telegram-webhook-handler.js');
  assert.match(reports,/text:'الديزل',callback_data:'report:fuel'/);
  assert.doesNotMatch(commands,/kind:'fuel'/);
  assert.match(handler,/if\(value==='fuel'\)return showFuelMenu/);
});
`);

console.log('Diesel report button preserved and redirected to the modern fuel reports menu.');
