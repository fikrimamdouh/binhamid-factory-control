import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const path=join(root,'api/_lib/bot-accountant-preview.js');
let content=readFileSync(path,'utf8');
const oldText="work_site_id:office.id";
const newText="site_id:office.id";
if(!content.includes(oldText)&&!content.includes(newText))throw new Error('Faisal office assignment column anchor missing');
content=content.replace(oldText,newText);
writeFileSync(path,content,'utf8');
console.log('Applied production site_id column for Faisal office attendance.');
