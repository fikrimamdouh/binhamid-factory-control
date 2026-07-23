import test from 'node:test';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../legacy.html',import.meta.url),'utf8');
const lines=source.split(/\r?\n/);
const patterns=[
  /إقرار|اقرار|العهدة|عهدة/,
  /vehicle|driver|declaration|acknowledg|receipt/i,
  /function\s+doc|window\.doc|doc[A-Z]|print/i,
  /D\.veh|D\.emp|vehSel|empSel|p-print|p-doc/i,
  /english|arabic|bilingual|language|lang/i
];

test('inspect existing declaration structure',()=>{
  const indexes=[];
  for(let i=0;i<lines.length;i++)if(patterns.some(pattern=>pattern.test(lines[i])))indexes.push(i);
  const selected=[];
  for(const index of indexes){
    if(selected.length>=180)break;
    if(selected.some(existing=>Math.abs(existing-index)<3))continue;
    selected.push(index);
  }
  for(const index of selected){
    const start=Math.max(0,index-2),end=Math.min(lines.length,index+3);
    console.log(`\n--- legacy lines ${start+1}-${end} ---`);
    for(let i=start;i<end;i++)console.log(`${i+1}: ${lines[i]}`);
  }
});
