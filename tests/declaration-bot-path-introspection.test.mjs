import test from 'node:test';
import { readdirSync,readFileSync,statSync } from 'node:fs';
import { join,relative } from 'node:path';

const root=new URL('..',import.meta.url).pathname;
const skip=new Set(['node_modules','.git','.vercel']);
function files(dir,out=[]){for(const name of readdirSync(dir)){if(skip.has(name))continue;const full=join(dir,name),st=statSync(full);if(st.isDirectory())files(full,out);else if(/\.(?:js|mjs|html|md)$/i.test(name))out.push(full);}return out;}

test('print declaration and Telegram PDF paths',()=>{
  const patterns=[/إقرار/g,/اقرار/g,/declaration/gi,/acknowledg/gi,/block.*pdf/gi,/concrete.*pdf/gi,/sendDocumentBuffer/g,/htmlToPdf/g];
  const hits=[];
  for(const file of files(root)){
    const text=readFileSync(file,'utf8');
    if(patterns.some(pattern=>{pattern.lastIndex=0;return pattern.test(text)})){
      const lines=text.split(/\r?\n/),matched=[];
      for(let i=0;i<lines.length;i++)if(/إقرار|اقرار|declaration|acknowledg|htmlToPdf|sendDocumentBuffer/i.test(lines[i]))matched.push(`${i+1}: ${lines[i].slice(0,500)}`);
      if(matched.length)hits.push(`FILE ${relative(root,file)}\n${matched.slice(0,80).join('\n')}`);
    }
  }
  console.log('\nDECLARATION_BOT_PATHS_BEGIN\n'+hits.join('\n\n')+'\nDECLARATION_BOT_PATHS_END');
});
