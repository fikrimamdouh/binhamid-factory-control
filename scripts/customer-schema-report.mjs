import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const db=String(process.env.SUPABASE_DB_URL||'').trim();
const output='customer-schema-report.json';
const stop=code=>{writeFileSync(output,`${JSON.stringify({ok:false,code},null,2)}\n`);console.error(`[customer-schema] ${code}`);process.exit(1);};
if(!db)stop('DATABASE_URL_EMPTY');
const sql=`select json_build_object(
'columns',(select json_agg(json_build_object('name',column_name,'type',data_type,'nullable',is_nullable='YES','default',column_default) order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='customers'),
'constraints',(select json_agg(json_build_object('name',conname,'type',contype,'definition',pg_get_constraintdef(oid)) order by conname) from pg_constraint where conrelid='public.customers'::regclass)
)::text;`;
const result=spawnSync('psql',[db,'-X','-t','-A','-v','ON_ERROR_STOP=1','-c',sql],{encoding:'utf8',env:process.env,timeout:120000});
if(result.error||result.status!==0)stop('SCHEMA_QUERY_FAILED');
let schema;try{schema=JSON.parse(String(result.stdout||'').trim());}catch{stop('SCHEMA_JSON_INVALID');}
writeFileSync(output,`${JSON.stringify({ok:true,table:'customers',...schema},null,2)}\n`,{mode:0o600});
console.log(`[customer-schema] columns=${schema.columns?.length||0}; constraints=${schema.constraints?.length||0}`);
