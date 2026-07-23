import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../legacy.html',import.meta.url),'utf8');
const lines=source.split(/\r?\n/);

test('inspect driver language declaration field',()=>{
  const indexes=[];
  for(let i=0;i<lines.length;i++){
    if(/لغة\s*السائق|driver\s*language|driverLang|drvLang|langDrv/i.test(lines[i]))indexes.push(i);
  }
  assert.ok(indexes.length,'driver language field not found');
  for(const index of indexes){
    const start=Math.max(0,index-15),end=Math.min(lines.length,index+35);
    console.log(`\n--- DRIVER LANGUAGE CONTEXT ${start+1}-${end} ---`);
    for(let i=start;i<end;i++)console.log(`${i+1}: ${lines[i]}`);
  }
});
