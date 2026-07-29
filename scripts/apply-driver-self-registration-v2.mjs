import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const read=path=>readFileSync(join(root,path),'utf8');
const write=(path,content)=>writeFileSync(join(root,path),content,'utf8');

function replaceOnce(content,search,replacement,label){
  if(content.includes(replacement))return content;
  if(!content.includes(search))throw new Error(`Driver self-registration patch anchor missing: ${label}`);
  return content.replace(search,replacement);
}

let invitations=read('api/_lib/bot-invitations.js');
invitations=replaceOnce(
  invitations,
  `import { employeeAssetsSummary,maskNationalId,normalizeNationalId,resolveEmployeeIdentity } from './employee-identity-link.js';`,
  `import { employeeAssetsSummary,maskNationalId,normalizeNationalId,resolveEmployeeIdentity } from './employee-identity-link.js';
import { createDriverPoolLink, handleDriverPoolStart } from './bot-driver-pool-registration.js';`,
  'driver registration import'
);
invitations=replaceOnce(
  invitations,
  `function invitationMenu(){return keyboard([[{text:'دعوة فيصل سيد أحمد — رابط واحد',callback_data:'ent:inv|faisal'}],[{text:'دعوة مستخدم جديد',callback_data:'ent:inv|new'},{text:'قائمة الدعوات',callback_data:'ent:inv|list'}],[{text:'القائمة الرئيسية',callback_data:'ent:help'}]]);}`,
  `function invitationMenu(){return keyboard([[{text:'دعوة فيصل سيد أحمد — رابط واحد',callback_data:'ent:inv|faisal'}],[{text:'إنشاء رابط تسجيل السائقين',callback_data:'ent:inv|drivers'}],[{text:'دعوة مستخدم جديد',callback_data:'ent:inv|new'},{text:'قائمة الدعوات',callback_data:'ent:inv|list'}],[{text:'القائمة الرئيسية',callback_data:'ent:help'}]]);}`,
  'driver registration menu'
);
invitations=replaceOnce(
  invitations,
  String.raw`export async function handleInvitationStart(message,identity,text){
  const match=String(text||'').trim().match(/^\/start(?:@\w+)?\s+invite_([A-Za-z0-9_-]{30,100})$/i);`,
  String.raw`export async function handleInvitationStart(message,identity,text){
  const driverPoolMatch=String(text||'').trim().match(/^\/start(?:@\w+)?\s+driverpool_([A-Za-z0-9_-]{30,100})$/i);
  if(driverPoolMatch)return handleDriverPoolStart(message,identity,driverPoolMatch[1]);
  const match=String(text||'').trim().match(/^\/start(?:@\w+)?\s+invite_([A-Za-z0-9_-]{30,100})$/i);`,
  'driver pool start'
);
invitations=replaceOnce(
  invitations,
  String.raw`if(/^\/invite(?:@\w+)?$/i.test(raw)||/^(دعوه مستخدم|دعوة مستخدم|دعوه موظف|دعوة موظف|اداره الدعوات|إدارة الدعوات)$/.test(value))`,
  String.raw`if(/^(رابط السائقين|رابط تسجيل السائقين|دعوات السائقين|دعوات السواقين)$/.test(value)){await createDriverPoolLink(message,identity);return true;}if(/^\/invite(?:@\w+)?$/i.test(raw)||/^(دعوه مستخدم|دعوة مستخدم|دعوه موظف|دعوة موظف|اداره الدعوات|إدارة الدعوات)$/.test(value))`,
  'driver pool text command'
);
invitations=replaceOnce(
  invitations,
  `if(action==='new'){await startInvitation({...message,from},identity);return true;}`,
  `if(action==='drivers'){await createDriverPoolLink({...message,from},identity);return true;}if(action==='new'){await startInvitation({...message,from},identity);return true;}`,
  'driver pool admin callback'
);
write('api/_lib/bot-invitations.js',invitations);

let gateway=read('api/_lib/telegram-webhook-gateway.js');
gateway=replaceOnce(
  gateway,
  `import enterpriseHandler from './telegram-webhook-handler.js';`,
  `import enterpriseHandler from './telegram-webhook-handler.js';
import { handleDriverPoolCallback, continueDriverPoolSession } from './bot-driver-pool-registration.js';`,
  'gateway driver registration import'
);
gateway=replaceOnce(
  gateway,
  `  if(action==='reg'){`,
  `  if(action==='drvreg'){
    const identity=await ensureTelegramIdentity(query.from);await answerCallback(query.id);
    if(message.chat.type!=='private'){await sendMessage(message.chat.id,'تسجيل السائق يتم من المحادثة الخاصة مع البوت.');return true;}
    await handleDriverPoolCallback(message,query.from,identity,value);return true;
  }
  if(action==='reg'){`,
  'gateway driver registration callback'
);
gateway=replaceOnce(
  gateway,
  `  const raw=String(message.text||message.caption||'').trim(),normalized=norm(raw);`,
  `  const raw=String(message.text||message.caption||'').trim(),normalized=norm(raw);
  if(state.startsWith('driver_pool_')){
    if(message.chat.type!=='private'){await sendMessage(message.chat.id,'تسجيل السائق يتم من المحادثة الخاصة مع البوت.');return true;}
    if(!await logIntercepted(update,message,identity))return true;
    if(await continueDriverPoolSession(message,identity,session,raw))return true;
  }`,
  'gateway driver registration session'
);
write('api/_lib/telegram-webhook-gateway.js',gateway);

console.log('Applied shared driver registration link with name selection, free vehicle selection and manual plate entry.');
