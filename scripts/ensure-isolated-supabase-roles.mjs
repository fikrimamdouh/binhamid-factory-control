import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const databaseUrl=String(process.env.LOCAL_DATABASE_URL||'').trim();
const outputPath=String(process.env.ISOLATED_ROLE_RESULT||'isolated-role-result.json');
const save=value=>writeFileSync(outputPath,`${JSON.stringify(value,null,2)}\n`,{mode:0o600});
const fail=(code,reason,evidence={})=>{save({ok:false,code,reason,evidence});console.error(`[isolated-roles] ${code}: ${reason}`);process.exit(1);};
if(!databaseUrl)fail('LOCAL_DATABASE_URL_EMPTY','The isolated database connection is missing.');
let parsed;try{parsed=new URL(databaseUrl);}catch{fail('LOCAL_DATABASE_URL_INVALID','The isolated database connection is invalid.');}
if(!['127.0.0.1','localhost','::1'].includes(parsed.hostname))fail('NON_LOCAL_DATABASE_BLOCKED','Supabase placeholder roles may only be created on a local isolated database.',{hostname:parsed.hostname});
const sql=`do $$
begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;`;
const result=spawnSync('psql',[databaseUrl,'-X','-v','ON_ERROR_STOP=1','-c',sql],{encoding:'utf8',env:process.env,timeout:120000});
if(result.error||result.status!==0)fail('ISOLATED_ROLE_CREATION_FAILED','Could not create local Supabase placeholder roles.',{exitCode:result.status??-1});
save({ok:true,code:'ISOLATED_SUPABASE_ROLES_READY',localOnly:true,hostname:parsed.hostname,roles:['anon','authenticated','service_role']});
console.log('[isolated-roles] READY local-only roles=3');
