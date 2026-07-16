import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('conversation API supports protected replies and stored media downloads',async()=>{
  const source=await read('api/_lib/routes/management.js');
  assert.match(source,/method\(req,res,\['GET','POST'\]\)/);
  assert.match(source,/sendMessage\(chatId/);
  assert.match(source,/action_name:'admin_reply'/);
  assert.match(source,/downloadObject\(filePath\)/);
  assert.match(source,/filePath\.startsWith\('telegram\/'\)/);
  assert.match(source,/telegram_admin_reply/);
});

test('conversation center exposes filters, admin composer, history and export',async()=>{
  const source=await read('assets/cloud-conversations.js');
  for(const marker of ['bhConvRole','bhConvType','bhConvDirection','bhConvMessageType','bhConvFrom','bhConvTo','bhConvReply','bhConvSend','bhConvOlder','bhConvExport'])assert.match(source,new RegExp(marker));
  assert.match(source,/method:'POST'/);
  assert.match(source,/downloadMedia/);
  assert.match(source,/exportCsv/);
  assert.match(source,/setInterval[\s\S]*30000/);
});

test('conversation improvements remain behind the existing central router',async()=>{
  const router=await read('api/router.js');
  const config=JSON.parse(await read('vercel.json'));
  assert.match(router,/'conversations':management\.conversations/);
  assert.equal(config.rewrites.find(item=>item.source==='/api/conversations')?.destination,'/api/router?route=conversations');
});
