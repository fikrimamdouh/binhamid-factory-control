import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const path=join(root,'api/_lib/bot-accountant-preview.js');
let content=readFileSync(path,'utf8');

const keyboardPattern=/export function accountantPreviewKeyboard\(\)\{[\s\S]*?\n\}\n\nexport async function sendAccountantPreviewHome/;
const keyboardReplacement=[
  "export function accountantPreviewKeyboard(){",
  "  return keyboard([[{text:'🕒 الحضور والانصراف',callback_data:'home:attendance'}]]);",
  "}",
  "",
  "export async function sendAccountantPreviewHome"
].join('\n');
if(!keyboardPattern.test(content))throw new Error('Faisal attendance-only keyboard anchor missing');
content=content.replace(keyboardPattern,keyboardReplacement);

const homePattern=/export async function sendAccountantPreviewHome\(message,identity,name='فيصل'\)\{[\s\S]*?\n\}/;
const homeReplacement=[
  "export async function sendAccountantPreviewHome(message,identity,name='فيصل'){",
  "  return sendMessage(message.chat.id,'<b>الحضور والانصراف</b>\\nمرحبًا '+name+'.\\n\\nتم تفعيل تسجيل الحضور والانصراف من المكتب لحسابك.',accountantPreviewKeyboard());",
  "}"
].join('\n');
if(!homePattern.test(content))throw new Error('Faisal attendance-only home anchor missing');
content=content.replace(homePattern,homeReplacement);

const noticePattern=/export async function sendAccountantPreviewNotice\(chatId\)\{[\s\S]*?\n\}/;
const noticeReplacement=[
  "export async function sendAccountantPreviewNotice(chatId){",
  "  return sendMessage(chatId,'المتاح لحسابك هو تسجيل الحضور والانصراف من المكتب فقط.');",
  "}"
].join('\n');
if(!noticePattern.test(content))throw new Error('Faisal attendance-only notice anchor missing');
content=content.replace(noticePattern,noticeReplacement);

writeFileSync(path,content,'utf8');
console.log('Applied attendance-only menu for Faisal Sayed Ahmed.');
