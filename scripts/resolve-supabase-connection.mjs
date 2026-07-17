import { appendFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const diagnosticPath=process.env.CONNECTION_DIAGNOSTIC_PATH||'connection-diagnostic.json';
const writeDiagnostic=(ok,stage,code,reason,extra={})=>writeFileSync(diagnosticPath,`${JSON.stringify({format:'binhamid-db-connection-diagnostic-v1',checkedAt:new Date().toISOString(),ok,stage,code,reason,...extra},null,2)}\n`,{mode:0o600});
const fail=(stage,code,reason,extra={})=>{writeDiagnostic(false,stage,code,reason,extra);console.error(`[db-connection] ${code}: ${reason}`);process.exit(1);};
const decode=value=>{try{return decodeURIComponent(value);}catch{fail('url-validation','DATABASE_URL_ENCODING_INVALID','The database username or password contains invalid URL encoding.');}};
const classify=stderr=>{
  const text=String(stderr||'').toLowerCase();
  if(text.includes('tenant or user not found'))return'SESSION_POOLER_USERNAME_REJECTED';
  if(text.includes('password authentication failed'))return'DATABASE_AUTHENTICATION_FAILED';
  if(text.includes('could not translate host name'))return'DATABASE_DNS_FAILED';
  if(text.includes('timeout expired')||text.includes('connection timed out'))return'DATABASE_CONNECTION_TIMEOUT';
  if(text.includes('connection refused'))return'DATABASE_CONNECTION_REFUSED';
  if(text.includes('no route to host')||text.includes('network is unreachable'))return'DATABASE_NETWORK_UNREACHABLE';
  if(text.includes('certificate')||text.includes('ssl'))return'DATABASE_TLS_FAILED';
  return'PSQL_CONNECTION_FAILED';
};
const probe=connectionUrl=>{
  const target=new URL(connectionUrl);
  target.searchParams.set('sslmode','require');
  target.searchParams.set('connect_timeout','4');
  const result=spawnSync('psql',[target.toString(),'-X','-t','-A','-v','ON_ERROR_STOP=1','-c','select 1;'],{encoding:'utf8',env:process.env,stdio:['ignore','pipe','pipe'],timeout:10000});
  return{ok:!result.error&&result.status===0&&String(result.stdout||'').trim()==='1',status:result.status,error:result.error,stderr:String(result.stderr||''),url:target.toString()};
};

const raw=String(process.env.SUPABASE_DB_URL||'').trim();
if(!raw)fail('configuration','SUPABASE_DB_URL_EMPTY','The database connection secret is empty.');
if(!process.env.GITHUB_ENV)fail('configuration','GITHUB_ENV_UNAVAILABLE','The GitHub runner environment file is unavailable.');
let configured;
try{configured=new URL(raw);}catch{fail('url-validation','DATABASE_URL_INVALID','The database connection secret is not a valid PostgreSQL URL.');}
if(!['postgres:','postgresql:'].includes(configured.protocol))fail('url-validation','DATABASE_URL_PROTOCOL_INVALID','The database URL protocol must be PostgreSQL.');
if(!configured.username||!configured.password)fail('url-validation','DATABASE_URL_CREDENTIALS_MISSING','The database URL must contain username and password.');
const username=decode(configured.username),password=decode(configured.password);
if(!password||password.includes('YOUR-PASSWORD'))fail('url-validation','DATABASE_URL_PASSWORD_PLACEHOLDER','The database URL contains a missing or placeholder password.');
if(!configured.pathname||configured.pathname==='/')fail('url-validation','DATABASE_NAME_MISSING','The database name is missing from the connection URL.');

const hostname=String(configured.hostname||'').toLowerCase();
let effectiveUrl='',resolution='configured-session-pooler',candidatesChecked=1;
if(hostname.endsWith('.pooler.supabase.com')){
  if(String(configured.port||'5432')!=='5432')fail('url-validation','SESSION_POOLER_PORT_INVALID','The Session pooler must use port 5432.');
  if(!/^postgres\.[a-z0-9]+$/i.test(username))fail('url-validation','SESSION_POOLER_USERNAME_INVALID','The Session pooler username must use postgres.project-ref format.');
  const result=probe(configured.toString());
  if(result.error)fail('authentication','PSQL_UNAVAILABLE','psql could not be executed.');
  if(!result.ok)fail('authentication',classify(result.stderr),'The configured Session pooler connection was rejected.',{psqlExitCode:result.status??-1});
  effectiveUrl=result.url;
}else{
  const directMatch=hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
  if(!directMatch)fail('url-validation','SUPABASE_HOST_INVALID','The database host is neither a Supabase Direct host nor a Session pooler host.');
  const projectRef=directMatch[1],overrideHost=String(process.env.SUPABASE_POOLER_HOST||'').trim().toLowerCase();
  if(overrideHost&&!/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/i.test(overrideHost))fail('url-validation','SESSION_POOLER_OVERRIDE_INVALID','The optional Session pooler host override is invalid.');
  const regions=['us-east-1','eu-central-1','ap-southeast-1','us-west-1','us-west-2','us-east-2','ca-central-1','eu-west-1','eu-west-2','eu-west-3','eu-central-2','eu-north-1','ap-south-1','ap-northeast-1','ap-northeast-2','ap-southeast-2','sa-east-1'];
  const hosts=[];
  for(const cluster of['0','1'])for(const region of regions)hosts.push(`aws-${cluster}-${region}.pooler.supabase.com`);
  const candidates=[...new Set([overrideHost,...hosts].filter(Boolean))],observed=new Set();
  candidatesChecked=0;
  for(const host of candidates){
    candidatesChecked+=1;
    const candidate=new URL(configured.toString());
    candidate.protocol='postgresql:';candidate.username=`postgres.${projectRef}`;candidate.password=password;candidate.hostname=host;candidate.port='5432';
    const result=probe(candidate.toString());
    if(result.error)fail('authentication','PSQL_UNAVAILABLE','psql could not be executed.');
    if(result.ok){effectiveUrl=result.url;resolution='derived-session-pooler';break;}
    observed.add(classify(result.stderr));
  }
  if(!effectiveUrl){
    const code=observed.has('DATABASE_AUTHENTICATION_FAILED')?'DATABASE_AUTHENTICATION_FAILED':observed.has('DATABASE_CONNECTION_TIMEOUT')?'SESSION_POOLER_CONNECTION_TIMEOUT':'SESSION_POOLER_DISCOVERY_FAILED';
    fail('session-pooler-discovery',code,'No authenticated Session pooler endpoint could be resolved.',{candidatesChecked});
  }
}

const readiness=spawnSync('pg_isready',['--dbname',effectiveUrl,'--timeout=15'],{encoding:'utf8',env:process.env,stdio:['ignore','pipe','pipe']});
if(readiness.error)fail('network-readiness','PG_ISREADY_UNAVAILABLE','pg_isready could not be executed.');
if(readiness.status!==0)fail('network-readiness','PG_ISREADY_FAILED','The database readiness check failed.',{pgIsReadyExitCode:readiness.status});
process.stdout.write(`::add-mask::${effectiveUrl}\n`);
appendFileSync(process.env.GITHUB_ENV,`SUPABASE_DB_URL<<BINHAMID_DB_URL\n${effectiveUrl}\nBINHAMID_DB_URL\n`,{encoding:'utf8',mode:0o600});
writeDiagnostic(true,'complete','CONNECTION_VALIDATED','An authenticated Supabase Session pooler connection is ready.',{resolution,candidatesChecked,pgIsReadyExitCode:readiness.status,psqlExitCode:0});
console.log(`[db-connection] CONNECTION_VALIDATED (${resolution})`);
