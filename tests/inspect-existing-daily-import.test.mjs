import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(new URL('..',import.meta.url).pathname);
const source=fs.readFileSync(path.join(root,'legacy.html'),'utf8');

function extractAt(start){
  if(start<0)return '';
  const brace=source.indexOf('{',start);
  if(brace<0)return source.slice(start,start+2500);
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
  return source.slice(start,start+30000);
}
function first(marker){return extractAt(source.indexOf(marker));}
function last(marker){return extractAt(source.lastIndexOf(marker));}
function context(marker,radius=3000){const i=source.lastIndexOf(marker);return i<0?'':source.slice(Math.max(0,i-radius),Math.min(source.length,i+marker.length+radius));}

test('inspect existing daily summary and movement report importers',()=>{
  const entries=[
    ['bh12ParseSales',first('function bh12ParseSales')],
    ['bh12ParseCollections',first('function bh12ParseCollections')],
    ['bh12ParseDailyWorkbook',first('function bh12ParseDailyWorkbook')],
    ['active opsImportDailySummary',last('window.opsImportDailySummary=async function')],
    ['opsParseMovementWorkbook',first('function opsParseMovementWorkbook')],
    ['active opsImportDailyMovement',last('async function opsImportDailyMovement')],
    ['bh12ResolveClient',first('function bh12ResolveClient')],
    ['collection save context',context('freshCollections.forEach')],
    ['collection key context',context('function bh12CollectionKey')]
  ];
  console.log('LEGACY_IMPORT_FUNCTIONS_START');
  for(const [label,text] of entries){console.log(`FUNCTION_MARKER ${label} FOUND ${Boolean(text)} LENGTH ${text.length}`);console.log(text);console.log('END_FUNCTION_MARKER');}
  console.log('LEGACY_IMPORT_FUNCTIONS_END');
});
