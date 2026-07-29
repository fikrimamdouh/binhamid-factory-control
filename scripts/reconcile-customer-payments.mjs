import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const endpoint=String(process.env.BINHAMID_ERP_URL||'https://binhamid-factory-control.vercel.app/api/erp/daily-report').trim();
const token=String(process.env.ERP_SYNC_TOKEN||'').trim();
const action=process.argv.includes('--commit')?'commit':'preview';
const files=process.argv.slice(2).filter(value=>!value.startsWith('--'));
if(!token)throw new Error('ERP_SYNC_TOKEN is required');
if(!files.length)throw new Error('Pass one or more XLSX files');

for(const file of files){
  const body=await readFile(file);
  const name=basename(file);
  const response=await fetch(endpoint,{
    method:'POST',
    headers:{
      'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'x-erp-sync-token':token,
      'x-erp-mode':'customer-payments',
      'x-erp-action':action,
      'x-erp-filename-b64':Buffer.from(name,'utf8').toString('base64'),
      'x-erp-send-reports':'0'
    },
    body
  });
  const text=await response.text();
  let payload;try{payload=JSON.parse(text);}catch{payload={raw:text};}
  console.log(JSON.stringify({file:name,status:response.status,...payload},null,2));
  if(!response.ok)process.exitCode=1;
}
