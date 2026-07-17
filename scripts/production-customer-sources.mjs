import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const db=String(process.env.SUPABASE_DB_URL||'').trim();
const output='production-customer-sources.json';
const save=value=>writeFileSync(output,`${JSON.stringify({format:'binhamid-customer-source-audit-v1',checkedAt:new Date().toISOString(),...value},null,2)}\n`,{mode:0o600});
const stop=(code,reason)=>{save({ok:false,code,reason});console.error(`[customer-source-audit] ${code}`);process.exit(1);};
const query=sql=>{const result=spawnSync('psql',[db,'-X','-t','-A','-v','ON_ERROR_STOP=1','-c',sql],{encoding:'utf8',env:process.env,timeout:120000});if(result.error||result.status!==0)stop('QUERY_FAILED','A read-only source audit query failed.');return String(result.stdout||'').trim();};
if(!db)stop('DATABASE_URL_EMPTY','The resolved database connection is empty.');
const report=JSON.parse(query(`select json_build_object(
'salesOrderColumns',(select coalesce(json_agg(column_name order by ordinal_position),'[]'::json) from information_schema.columns where table_schema='public' and table_name='sales_orders'),
'importColumns',(select coalesce(json_agg(column_name order by ordinal_position),'[]'::json) from information_schema.columns where table_schema='public' and table_name='imports'),
'salesOrders',(select coalesce(json_agg(json_build_object(
'id',s.id,
'customerCode',coalesce(to_jsonb(s)->>'customer_external_id',to_jsonb(s)->>'customer_code'),
'customerName',coalesce(to_jsonb(s)->>'customer_name',to_jsonb(s)->>'customer'),
'status',to_jsonb(s)->>'status',
'totalAmount',to_jsonb(s)->>'total_amount',
'createdAt',to_jsonb(s)->>'created_at') order by s.created_at desc),'[]'::json) from public.sales_orders s),
'latestImports',(select case when to_regclass('public.imports') is null then '[]'::json else (select coalesce(json_agg(json_build_object(
'id',to_jsonb(i)->>'id',
'originalName',to_jsonb(i)->>'original_name',
'reportType',to_jsonb(i)->>'report_type',
'status',to_jsonb(i)->>'status',
'filePath',to_jsonb(i)->>'file_path',
'rowCount',to_jsonb(i)->>'row_count',
'summary',to_jsonb(i)->'summary',
'createdAt',to_jsonb(i)->>'created_at') order by (to_jsonb(i)->>'created_at') desc),'[]'::json) from (select * from public.imports limit 20) i) end)
)::text;`));
const result={ok:true,readOnly:true,...report};
save(result);
console.log(`[customer-source-audit] salesOrders=${result.salesOrders.length}; imports=${result.latestImports.length}`);
