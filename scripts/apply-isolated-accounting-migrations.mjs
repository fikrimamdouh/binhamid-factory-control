import { mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const databaseUrl=String(process.env.LOCAL_DATABASE_URL||'').trim();
const resultPath=String(process.env.ISOLATED_MIGRATION_APPLY_RESULT||'isolated-migration-apply.json');
const target=Number(process.env.ISOLATED_MIGRATION_TARGET||20);
const save=value=>writeFileSync(resultPath,`${JSON.stringify(value,null,2)}\n`,{mode:0o600});
const redact=value=>String(value||'').replace(/postgres(?:ql)?:\/\/[^\s]+/gi,'[DATABASE_URL]').slice(-4000);
const fail=(code,reason,evidence={})=>{save({ok:false,code,reason,evidence});console.error(`[isolated-migration] ${code}: ${reason}`);process.exit(1);};
const psql=args=>spawnSync('psql',[databaseUrl,'-X','-v','ON_ERROR_STOP=1',...args],{encoding:'utf8',env:process.env,timeout:600000});
if(!databaseUrl)fail('LOCAL_DATABASE_URL_EMPTY','The isolated database connection is missing.');
const roles=spawnSync(process.execPath,['scripts/ensure-isolated-supabase-roles.mjs'],{encoding:'utf8',env:{...process.env,LOCAL_DATABASE_URL:databaseUrl,ISOLATED_ROLE_RESULT:'isolated-role-result.json'},timeout:120000});
if(roles.error||roles.status!==0)fail('ISOLATED_ROLE_GATE_FAILED','The local Supabase role gate failed.',{exitCode:roles.status??-1,stderr:redact(roles.stderr)});
const versionResult=psql(['-t','-A','-c','select coalesce(max(version),0) from public.migration_history;']);
if(versionResult.error||versionResult.status!==0)fail('CURRENT_VERSION_QUERY_FAILED','Could not read the isolated schema version.',{stderr:redact(versionResult.stderr)});
const currentVersion=Number(String(versionResult.stdout||'').trim());
if(!Number.isInteger(currentVersion)||currentVersion<1||currentVersion>target)fail('CURRENT_VERSION_INVALID','The isolated schema version is outside the allowed range.',{currentVersion,target});
if(currentVersion===target){save({ok:true,code:'ALREADY_AT_TARGET',currentVersion,target,applied:[],rolesReady:true});console.log(`[isolated-migration] already at ${target}`);process.exit(0);}
const directory=resolve('supabase/migrations'),names=readdirSync(directory).filter(name=>/^\d{3}_.+\.sql$/.test(name));
const selected=[];
for(let version=currentVersion+1;version<=target;version++){
  const prefix=String(version).padStart(3,'0')+'_',name=names.find(item=>item.startsWith(prefix));
  if(!name)fail('MIGRATION_FILE_MISSING','A required migration file is missing.',{version});
  selected.push({version,name,path:join(directory,name)});
}
const temp=mkdtempSync(join(tmpdir(),'binhamid-isolated-migration-')),sqlPath=join(temp,'pending.sql');
try{
  writeFileSync(sqlPath,selected.map(item=>`\n-- BEGIN ${item.name}\n${readFileSync(item.path,'utf8')}\n-- END ${item.name}\n`).join(''),{mode:0o600});
  const apply=psql(['--single-transaction','--file',sqlPath]);
  if(apply.error||apply.status!==0){
    const stderr=redact(apply.stderr),lastError=stderr.split(/\r?\n/).filter(line=>/ERROR:|psql:.*error:/i.test(line)).at(-1)||'PostgreSQL rejected the migration transaction.';
    fail('MIGRATION_TRANSACTION_FAILED',lastError,{currentVersion,target,files:selected.map(item=>item.name),stderr});
  }
  const after=psql(['-t','-A','-c','select coalesce(max(version),0) from public.migration_history;']);
  const finalVersion=Number(String(after.stdout||'').trim());
  if(after.error||after.status!==0||finalVersion!==target)fail('TARGET_VERSION_NOT_REACHED','The isolated transaction did not reach the target schema.',{currentVersion,finalVersion,target,stderr:redact(after.stderr)});
  save({ok:true,code:'ISOLATED_MIGRATION_APPLIED',currentVersion,finalVersion,target,applied:selected.map(item=>item.version),files:selected.map(item=>item.name),rolesReady:true});
  console.log(`[isolated-migration] ${currentVersion}->${target}; files=${selected.length}`);
}finally{rmSync(temp,{recursive:true,force:true});}
