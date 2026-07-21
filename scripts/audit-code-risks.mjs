import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const ROOT=process.cwd();
const OUT='artifacts/code-risk-audit';
const EXCLUDED=new Set(['.git','node_modules','.vercel','dist','coverage','backups','artifacts']);
const ALLOWED=new Set(['.js','.mjs','.cjs','.html']);
const P0_HINT=/(account|ledger|trial|financial|finance|sales|collection|payment|invoice|inventory|cost|journal)/i;

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

function lineAt(text,index){return text.slice(0,index).split('\n').length;}
function compact(text){return text.replace(/\s+/g,' ').trim().slice(0,260);}
function severity(path){return P0_HINT.test(path)?'P0':'P1';}

function findSilentFailures(path,text){
  const findings=[];
  const patterns=[
    {kind:'promise_fallback',re:/\.catch\(\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)?\s*=>\s*(\[\s*\]|0|null|false|\{\s*\})\s*\)/g},
    {kind:'catch_return_fallback',re:/catch\s*\([^)]*\)\s*\{[\s\S]{0,500}?return\s+(\[\s*\]|0|null|false|\{\s*\})\s*;?[\s\S]{0,120}?\}/g}
  ];
  for(const {kind,re} of patterns){
    for(const match of text.matchAll(re))findings.push({type:'silent_failure',kind,severity:severity(path),file:path,line:lineAt(text,match.index),fallback:match[1],snippet:compact(match[0])});
  }
  return findings;
}

function findHtmlSinks(path,text){
  if(!/\.(?:html|js|mjs|cjs)$/i.test(path))return[];
  const findings=[];
  const patterns=[
    {kind:'innerHTML',re:/\.innerHTML\s*(?:\+?=)/g},
    {kind:'insertAdjacentHTML',re:/\.insertAdjacentHTML\s*\(/g},
    {kind:'documentWrite',re:/document\.write\s*\(/g}
  ];
  for(const {kind,re} of patterns){
    for(const match of text.matchAll(re)){
      const start=Math.max(0,match.index-80),end=Math.min(text.length,match.index+320),snippet=compact(text.slice(start,end));
      const emptyClear=/innerHTML\s*=\s*(['"])\1/.test(snippet);
      const dynamic=/\$\{|\b(row|item|data|user|name|text|message|customer|client|employee|error|result|value|record)\b/i.test(snippet);
      findings.push({type:'html_sink',kind,severity:dynamic?'P1':'P2',file:path,line:lineAt(text,match.index),emptyClear,dynamic,snippet});
    }
  }
  return findings;
}

const files=await walk('.');
const findings=[];
for(const file of files){
  const path=relative(ROOT,file).replaceAll('\\','/');
  if(path==='scripts/audit-code-risks.mjs')continue;
  const text=await readFile(file,'utf8');
  findings.push(...findSilentFailures(path,text),...findHtmlSinks(path,text));
}
findings.sort((a,b)=>a.severity.localeCompare(b.severity)||a.file.localeCompare(b.file)||a.line-b.line);
const counts=findings.reduce((out,row)=>{out[row.type]=(out[row.type]||0)+1;out[row.severity]=(out[row.severity]||0)+1;return out;},{});
const report={generated_at:new Date().toISOString(),files_scanned:files.length,counts,findings};
await mkdir(OUT,{recursive:true});
await writeFile(`${OUT}/report.json`,JSON.stringify(report,null,2));
const lines=[
  '# Code Risk Audit',
  '',
  `- Files scanned: ${files.length}`,
  `- Silent failure fallbacks: ${counts.silent_failure||0}`,
  `- HTML sinks: ${counts.html_sink||0}`,
  `- P0 findings: ${counts.P0||0}`,
  `- P1 findings: ${counts.P1||0}`,
  `- P2 findings: ${counts.P2||0}`,
  '',
  '| Severity | Type | Kind | File | Line | Snippet |',
  '|---|---|---|---|---:|---|',
  ...findings.map(row=>`| ${row.severity} | ${row.type} | ${row.kind} | \`${row.file}\` | ${row.line} | ${row.snippet.replaceAll('|','\\|')} |`)
];
await writeFile(`${OUT}/report.md`,lines.join('\n'));
console.log(JSON.stringify({files_scanned:files.length,counts},null,2));
