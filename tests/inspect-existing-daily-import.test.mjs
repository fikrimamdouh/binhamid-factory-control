import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(new URL('..',import.meta.url).pathname);
const source=fs.readFileSync(path.join(root,'legacy.html'),'utf8');

function extractFrom(marker){
  const start=source.indexOf(marker);
  if(start<0)return '';
  const brace=source.indexOf('{',start);
  if(brace<0)return source.slice(start,start+2000);
  let depth=0,quote='',escaped=false,templateDepth=0;
  for(let i=brace;i<source.length;i++){
    const ch=source[i],next=source[i+1];
    if(quote){
      if(escaped){escaped=false;continue;}
      if(ch==='\\'){escaped=true;continue;}
      if(quote==='`'&&ch==='$'&&next==='{'){templateDepth++;i++;continue;}
      if(quote==='`'&&ch==='}'&&templateDepth){templateDepth--;continue;}
      if(ch===quote&&!templateDepth)quote='';
      continue;
    }
    if(ch==='"'||ch==="'"||ch==='`'){quote=ch;continue;}
    if(ch==='{')depth++;
    else if(ch==='}'&&--depth===0)return source.slice(start,i+1);
  }
  return source.slice(start,start+12000);
}

test('inspect existing daily summary and movement report importers',()=>{
  const markers=[
    'function bh12ParseSales',
    'function bh12ParseCollections',
    'function bh12ParseDailyWorkbook',
    'window.opsImportDailySummary=async function',
    'function opsParseMovementWorkbook',
    'async function opsImportDailyMovement'
  ];
  console.log('LEGACY_IMPORT_FUNCTIONS_START');
  for(const marker of markers){
    const text=extractFrom(marker);
    console.log(`FUNCTION_MARKER ${marker} FOUND ${Boolean(text)} LENGTH ${text.length}`);
    console.log(text);
    console.log('END_FUNCTION_MARKER');
  }
  console.log('LEGACY_IMPORT_FUNCTIONS_END');
});
