import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const tracked=spawnSync('git',['ls-files','-z'],{encoding:'buffer'});
if(tracked.error||tracked.status!==0){console.error('Unable to enumerate tracked files.');process.exit(1);}
const files=tracked.stdout.toString('utf8').split('\0').filter(Boolean);
const skip=file=>/\.(?:png|jpe?g|gif|webp|ico|xlsx?|pdf|zip|gz|enc|woff2?|ttf|eot)$/i.test(file)||file==='package-lock.json'||file==='scripts/scan-sensitive-material.mjs';
const patterns=[
  ['OPENAI_KEY',new RegExp(['s','k','-','[A-Za-z0-9_-]{24,}'].join(''),'g')],
  ['GITHUB_TOKEN',new RegExp(['g','h','[pousr]','_','[A-Za-z0-9]{24,}'].join(''),'g')],
  ['TELEGRAM_TOKEN',new RegExp(['\\b\\d{6,12}',':','[A-Za-z0-9_-]{25,}\\b'].join(''),'g')],
  ['DATABASE_URL_WITH_PASSWORD',new RegExp(['postgres(?:ql)?','://','[^:\\s/]+',':','[^@\\s/]+','@[^\\s/]+'].join(''),'gi')],
  ['PRIVATE_KEY',new RegExp(['-----BEGIN ','(?:RSA |EC |OPENSSH )?','PRIVATE KEY-----'].join(''),'g')],
  ['AWS_ACCESS_KEY',new RegExp(['AKIA','[A-Z0-9]{16}'].join(''),'g')]
];
const localDatabaseExample=value=>/^postgres(?:ql)?:\/\/postgres:postgres@(?:127\.0\.0\.1|localhost)(?::\d+)?\//i.test(value);
const findings=[];
for(const file of files){
  if(skip(file))continue;
  let text;try{text=readFileSync(file,'utf8');}catch{continue;}
  for(const [code,pattern] of patterns){
    pattern.lastIndex=0;
    for(const match of text.matchAll(pattern)){
      if(code==='DATABASE_URL_WITH_PASSWORD'&&localDatabaseExample(match[0]))continue;
      const line=text.slice(0,match.index).split(/\r?\n/).length;
      findings.push({file,line,code});
    }
  }
  const lines=text.split(/\r?\n/);
  lines.forEach((line,index)=>{
    if(/console\.(?:log|info|warn|error).*?(?:telegramToken|supabaseKey|adminToken|dbUrl|databaseUrl|encryptionKey)/i.test(line)&&!/replace|mask|redact|code:/i.test(line))findings.push({file,line:index+1,code:'POTENTIAL_SECRET_LOG'});
  });
}
if(findings.length){
  for(const item of findings)console.error(`${item.code} ${item.file}:${item.line}`);
  process.exit(1);
}
console.log(`SENSITIVE_MATERIAL_SCAN_OK=${files.length}`);
