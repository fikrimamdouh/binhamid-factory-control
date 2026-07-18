const {spawnSync}=require('node:child_process');
const {appendFileSync}=require('node:fs');

const raw=String(process.env.SUPABASE_DB_URL||'').trim();
if(!raw)throw new Error('SUPABASE_DB_URL_EMPTY');
const configured=new URL(raw);
const probe=url=>{
  const target=new URL(url);
  target.searchParams.set('sslmode','require');
  target.searchParams.set('connect_timeout','4');
  const result=spawnSync('psql',[target.toString(),'-X','-t','-A','-v','ON_ERROR_STOP=1','-c','select 1;'],{encoding:'utf8',timeout:9000,stdio:['ignore','pipe','pipe']});
  return{ok:!result.error&&result.status===0&&String(result.stdout||'').trim()==='1',url:target.toString()};
};
let effective='';
if(String(configured.hostname||'').endsWith('.pooler.supabase.com'))effective=probe(configured.toString()).ok?configured.toString():'';
else{
  const match=String(configured.hostname||'').match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
  if(!match)throw new Error('SUPABASE_DIRECT_HOST_INVALID');
  const ref=match[1],override=String(process.env.SUPABASE_POOLER_HOST||'').trim();
  const regions=['eu-central-1','ap-south-1','ap-southeast-1','me-central-1','us-east-1','us-west-1','us-west-2','us-east-2','ca-central-1','eu-west-1','eu-west-2','eu-west-3','eu-central-2','eu-north-1','ap-northeast-1','ap-northeast-2','ap-southeast-2','sa-east-1'];
  const hosts=[override,...regions.flatMap(region=>[`aws-0-${region}.pooler.supabase.com`,`aws-1-${region}.pooler.supabase.com`])].filter(Boolean);
  for(const host of [...new Set(hosts)]){
    const candidate=new URL(configured.toString());
    candidate.protocol='postgresql:';
    candidate.username=`postgres.${ref}`;
    candidate.hostname=host;
    candidate.port='5432';
    const checked=probe(candidate.toString());
    if(checked.ok){effective=checked.url;break;}
  }
}
if(!effective)throw new Error('SUPABASE_SESSION_POOLER_NOT_RESOLVED');
process.stdout.write(`::add-mask::${effective}\n`);
appendFileSync(process.env.GITHUB_ENV,`EFFECTIVE_DB_URL=${effective}\n`,{mode:0o600});
console.log('Supabase Session pooler resolved.');
