import test from 'node:test';
import fs from 'node:fs';

function extractFunction(source,name){
  const marker=`function ${name}`;
  const start=source.indexOf(marker);
  if(start<0)throw new Error(`${marker} not found`);
  const brace=source.indexOf('{',start);
  let depth=0,quote='',escaped=false,templateDepth=0;
  for(let i=brace;i<source.length;i++){
    const ch=source[i],next=source[i+1];
    if(quote){
      if(escaped){escaped=false;continue;}
      if(ch==='\\'){escaped=true;continue;}
      if(quote==='`'&&ch==='$'&&next==='{'){templateDepth++;i++;continue;}
      if(quote==='`'&&templateDepth&&ch==='}'){templateDepth--;continue;}
      if(ch===quote&&!templateDepth)quote='';
      continue;
    }
    if(ch==='"'||ch==="'"||ch==='`'){quote=ch;continue;}
    if(ch==='/'&&next==='/'){i=source.indexOf('\n',i);if(i<0)break;continue;}
    if(ch==='/'&&next==='*'){i=source.indexOf('*/',i+2)+1;continue;}
    if(ch==='{')depth++;
    if(ch==='}'&&--depth===0)return source.slice(start,i+1);
  }
  throw new Error(`unterminated ${name}`);
}
function emit(label,text){
  const encoded=Buffer.from(text,'utf8').toString('base64');
  console.log(`BH_EXTRACT_BEGIN:${label}:${encoded.length}`);
  for(let i=0;i<encoded.length;i+=6000)console.log(`BH_EXTRACT:${label}:${String(i/6000).padStart(4,'0')}:${encoded.slice(i,i+6000)}`);
  console.log(`BH_EXTRACT_END:${label}`);
}

test('extract exact portfolio website renderer',()=>{
  const source=fs.readFileSync(new URL('../legacy.html',import.meta.url),'utf8');
  for(const name of ['docCli','prCli'])emit(name,extractFunction(source,name));
  const cssStart=source.indexOf('/* ═══════════════════════════════════════════════════════════\n   DOCUMENT SYSTEM');
  const cssEnd=source.indexOf('</style>',cssStart);
  if(cssStart<0||cssEnd<0)throw new Error('document CSS not found');
  emit('documentCss',source.slice(cssStart,cssEnd));
});
