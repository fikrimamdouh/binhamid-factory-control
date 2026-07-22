import test from 'node:test';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../legacy.html',import.meta.url),'utf8');

test('print declaration text sources and restore controls',()=>{
  const lines=source.split(/\r?\n/),matched=[];
  const pattern=/استرجاع|النصوص الأصلية|إعادة.*النص|restore|reset.*text|declaration|إقرار|ألتزم|clauses|terms|default.*text|original.*text|txt[A-Z]|TEXTS|DEFAULTS/i;
  for(let i=0;i<lines.length;i++){
    if(!pattern.test(lines[i]))continue;
    const start=Math.max(0,i-3),end=Math.min(lines.length,i+5);
    matched.push(`--- ${i+1} ---\n${lines.slice(start,end).join('\n')}`);
  }
  console.log('\nDECLARATION_TEXTS_BEGIN\n'+matched.join('\n')+'\nDECLARATION_TEXTS_END');
});
