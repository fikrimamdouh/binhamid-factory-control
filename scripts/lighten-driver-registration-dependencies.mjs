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

content=content.replace(
  "return (employees||[]).filter(row=>driverRole(row.role)&&!linked.has(String(row.external_id))).map(row=>({",
  "return (employees||[]).filter(row=>!linked.has(String(row.external_id))).map(row=>({"
);
content=content.replace(
  "if(employees.length!==1||!driverRole(employees[0].role))return null;",
  "if(employees.length!==1)return null;"
);
content=content.replace(
  'لا توجد أسماء سائقين متاحة الآن؛ كل السائقين المسجلين مرتبطون بحسابات أو وظائفهم غير مسجلة كسائق.',
  'لا توجد أسماء موظفين متاحة الآن؛ كل الموظفين الفعالين مرتبطون بحسابات Telegram.'
);

writeFileSync(path,content,'utf8');
console.log('Prepared lightweight driver registration module with all unlinked active employees.');
