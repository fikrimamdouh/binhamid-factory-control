import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const ROOT=process.cwd();
const EXCLUDED=new Set(['.git','node_modules','.vercel','dist','coverage','backups','artifacts']);
const ALLOWED=new Set(['.js','.mjs','.cjs','.html','.json','.yml','.yaml','.md']);
const TERMS=[
  ['gps',/\bgps\b|GPS_|gps_|Gps|Traccar|traccar/gi],
  ['session',/binhamid_cloud_app_user_id|binhamid_cloud_access_token|binhamid_cloud_device_id|device\/session|logout|signout|تسجيل خروج/gi],
  ['navigation',/admin-nav-tabs|\bid=['"]tabs['"]|class=['"][^'"]*tabs|topbar|control-center\.html|attendance-admin\.html|device-access\.html/gi]
];

async function walk(dir='.'){
  const rows=[];
  for(const entry of await readdir(dir,{withFileTypes:true})){
    if(EXCLUDED.has(entry.name))continue;
    const path=join(dir,entry.name);
    if(entry.isDirectory())rows.push(...await walk(path));
    else if(ALLOWED.has(extname(entry.name)))rows.push(path);
  }
  return rows;
}
const lineAt=(text,index)=>text.slice(0,index).split('\n').length;
const snippet=(text,index)=>text.slice(Math.max(0,index-100),Math.min(text.length,index+260)).replace(/\s+/g,' ').trim();
const files=await walk('.'),findings=[];
for(const file of files){
  const path=relative(ROOT,file).replaceAll('\\','/'),text=await readFile(file,'utf8');
  for(const [category,re] of TERMS){
    re.lastIndex=0;
    for(const match of text.matchAll(re))findings.push({category,file:path,line:lineAt(text,match.index),match:match[0],snippet:snippet(text,match.index)});
  }
}
findings.sort((a,b)=>a.category.localeCompare(b.category)||a.file.localeCompare(b.file)||a.line-b.line);
const counts=findings.reduce((out,row)=>{out[row.category]=(out[row.category]||0)+1;return out;},{});
await mkdir('artifacts/gps-ui-session-audit',{recursive:true});
await writeFile('artifacts/gps-ui-session-audit/report.json',JSON.stringify({generatedAt:new Date().toISOString(),filesScanned:files.length,counts,findings},null,2));
await writeFile('artifacts/gps-ui-session-audit/report.md',[
  '# GPS / UI / Session Audit','',
  `- Files scanned: ${files.length}`,
  `- GPS references: ${counts.gps||0}`,
  `- Session references: ${counts.session||0}`,
  `- Navigation references: ${counts.navigation||0}`,'',
  '| Category | File | Line | Match | Snippet |','|---|---|---:|---|---|',
  ...findings.map(row=>`| ${row.category} | \`${row.file}\` | ${row.line} | \`${String(row.match).replaceAll('|','\\|')}\` | ${row.snippet.replaceAll('|','\\|')} |`)
].join('\n'));
console.log(JSON.stringify({filesScanned:files.length,counts},null,2));
