import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const path=join(root,'api/_lib/bot-invitations.js');
let content=readFileSync(path,'utf8');

const newLookup=`  const targetName='فيصل سيد احمد';
  const matches=(employees||[]).filter(row=>norm(row.full_name)===targetName);
  if(matches.length!==1)return sendMessage(message.chat.id,matches.length?'يوجد أكثر من موظف فعال باسم فيصل سيد أحمد. يلزم تصحيح التكرار في سجل الموظفين أولًا.':'لم أجد موظفًا فعالًا بالاسم الكامل «فيصل سيد أحمد» في سجل الموظفين.');`;

if(!content.includes(newLookup)){
  const startMarker="  const named=(employees||[]).filter(row=>norm(row.full_name).includes('فيصل'));";
  const endMarker="  if(matches.length!==1)return sendMessage(message.chat.id,matches.length?'يوجد أكثر من موظف باسم فيصل في سجل الموظفين. يلزم تمييز الاسم أو الرقم الوظيفي أولًا.':'لم أجد موظفًا فعالًا باسم فيصل ووظيفته محاسب في سجل الموظفين.');";
  const start=content.indexOf(startMarker);
  const end=start<0?-1:content.indexOf(endMarker,start);
  if(start<0||end<0)throw new Error('Faisal lookup block not found');
  content=content.slice(0,start)+newLookup+content.slice(end+endMarker.length);
}

content=content.replace("{text:'دعوة فيصل — المحاسبة',callback_data:'ent:inv|faisal'}","{text:'دعوة فيصل سيد أحمد — المحاسبة',callback_data:'ent:inv|faisal'}");
writeFileSync(path,content,'utf8');
console.log('Applied exact employee match for Faisal Sayed Ahmed without requiring an accountant job title.');
