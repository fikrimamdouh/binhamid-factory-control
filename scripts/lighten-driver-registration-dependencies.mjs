import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const path=join(root,'api/_lib/bot-driver-pool-registration.js');
let content=readFileSync(path,'utf8');

content=content.replace("import { getBotSession, clearMaintenanceSession } from './bot-maintenance.js';\n",'');

const anchor=`async function setSession(chatId,userId,state,context={}){
  return upsert('bot_sessions',[{channel:'telegram',chat_id:String(chatId),external_user_id:String(userId),state,context,updated_at:now()}],'channel,chat_id,external_user_id');
}`;
const replacement=`${anchor}

async function getBotSession(chatId,userId){
  return (await select('bot_sessions','channel=eq.telegram&chat_id=eq.'+encodeURIComponent(String(chatId))+'&external_user_id=eq.'+encodeURIComponent(String(userId))+'&select=*&limit=1').catch(()=>[]))?.[0]||null;
}

async function clearMaintenanceSession(chatId,userId){
  return patch('bot_sessions','channel=eq.telegram&chat_id=eq.'+encodeURIComponent(String(chatId))+'&external_user_id=eq.'+encodeURIComponent(String(userId)),{state:'idle',context:{},updated_at:now()}).catch(()=>[]);
}`;
if(!content.includes('async function getBotSession(chatId,userId){')){
  if(!content.includes(anchor))throw new Error('Driver lightweight session anchor missing');
  content=content.replace(anchor,replacement);
}
writeFileSync(path,content,'utf8');
console.log('Removed bot-maintenance dependency from driver registration module.');
