import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(new URL('..',import.meta.url).pathname);
const source=fs.readFileSync(path.join(root,'legacy.html'),'utf8');

function contexts(term,radius=1400){
  const rows=[];
  let from=0;
  while(true){
    const index=source.indexOf(term,from);
    if(index<0)break;
    rows.push(source.slice(Math.max(0,index-radius),Math.min(source.length,index+term.length+radius)));
    from=index+term.length;
  }
  return rows;
}

test('inspect existing daily summary and movement report importers',()=>{
  const terms=['ملخص اليوم','استيراد تقرير الحركة','تقرير الحركة','XLSX','FileReader','readAsArrayBuffer','sheet_to_json'];
  console.log('LEGACY_IMPORT_INSPECTION_START');
  for(const term of terms){
    const found=contexts(term);
    console.log(`TERM ${term} COUNT ${found.length}`);
    found.forEach((text,index)=>console.log(`CONTEXT ${term} #${index+1}\n${text}\nEND_CONTEXT`));
  }
  console.log('LEGACY_IMPORT_INSPECTION_END');
});
