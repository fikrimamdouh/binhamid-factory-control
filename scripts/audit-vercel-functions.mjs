import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const apiRoot=path.join(root,'api');
const limit=12;

function walk(dir){
  if(!fs.existsSync(dir))return[];
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
    const full=path.join(dir,entry.name);
    if(entry.isDirectory()){
      if(entry.name.startsWith('_'))return[];
      return walk(full);
    }
    if(!entry.isFile()||!/[.](?:mjs|cjs|js|ts)$/.test(entry.name)||entry.name.startsWith('_'))return[];
    return[full];
  });
}

const files=walk(apiRoot).map(file=>path.relative(root,file).replaceAll(path.sep,'/')).sort();
console.log('VERCEL_FUNCTION_INVENTORY_START');
for(const file of files)console.log(file);
console.log('VERCEL_FUNCTION_INVENTORY_END');
console.log(`VERCEL_FUNCTION_COUNT=${files.length}`);
if(process.argv.includes('--assert')&&files.length>limit){
  console.error(`Vercel Hobby limit exceeded: ${files.length} functions; maximum ${limit}.`);
  process.exit(1);
}
