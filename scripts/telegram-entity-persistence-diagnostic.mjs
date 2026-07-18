import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const db=String(process.env.SUPABASE_DB_URL||'').trim(),output='telegram-entity-persistence-diagnostic.json';
const report={ok:false,sections:{}};
if(!db){writeFileSync(output,JSON.stringify({ok:false,code:'DATABASE_URL_EMPTY'},null,2));process.exit(0);}
function query(name,sql){
  const result=spawnSync('psql',[db,'-X','-t','-A','-v','ON_ERROR_STOP=1','-c',sql],{encoding:'utf8',timeout:120000,env:process.env});
  if(result.error||result.status!==0){report.sections[name]={ok:false,code:/column .* does not exist/i.test(String(result.stderr||''))?'COLUMN_MISSING':/relation .* does not exist/i.test(String(result.stderr||''))?'RELATION_MISSING':/permission denied/i.test(String(result.stderr||''))?'PERMISSION_DENIED':'QUERY_FAILED'};return;}
  try{report.sections[name]={ok:true,...JSON.parse(String(result.stdout||'').trim())};}
  catch{report.sections[name]={ok:false,code:'INVALID_JSON'};}
}
query('schema',`select json_build_object(
  'operationalRecordColumns',(select json_agg(column_name order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='operational_records'),
  'auditLogColumns',(select json_agg(column_name order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='audit_log'),
  'salesOrderColumns',(select json_agg(column_name order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='sales_orders'),
  'customerColumns',(select json_agg(column_name order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='customers'),
  'employeeColumns',(select json_agg(column_name order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='employees')
)::text;`);
query('salesOrders',`select json_build_object(
  'createdEvents',(select count(*) from audit_log where action='sales_order_created'),
  'cancelEvents',(select count(*) from audit_log where action='sales_order_cancelled'),
  'updateEvents',(select count(*) from audit_log where action='sales_order_updated'),
  'latest',(select coalesce(json_agg(x),'[]'::json) from (
    select a.entity_id reference_no,a.entity_type,a.created_at,coalesce(a.details->>'customer_name','') customer_name,coalesce(a.details->>'item','') item,coalesce(a.details->>'status','') status,
      exists(select 1 from operational_records o where row_to_json(o)::text like '%'||a.entity_id||'%') projected_to_web
    from audit_log a where a.action='sales_order_created' order by a.created_at desc limit 10
  ) x),
  'unprojected',(select count(*) from audit_log a where a.action='sales_order_created' and not exists(select 1 from operational_records o where row_to_json(o)::text like '%'||a.entity_id||'%'))
)::text;`);
query('webProjection',`select json_build_object(
  'triggerExists',(select exists(select 1 from pg_trigger where tgname='audit_operational_projection_trigger' and not tgisinternal)),
  'operationalRecords',(select count(*) from operational_records),
  'latestRecords',(select coalesce(json_agg(row_to_json(x)),'[]'::json) from (select * from operational_records order by updated_at desc nulls last limit 12) x)
)::text;`);
query('invoices',`select json_build_object(
  'directTelegramEvents',(select count(*) from audit_log where action in ('invoice_created','sales_invoice_created','invoice_registered')),
  'salesOrdersInvoiced',(select count(*) from audit_log where action='sales_order_updated' and details->>'status'='invoiced'),
  'excelSalesLines',(select count(*) from daily_report_sales_lines),
  'latestExcelSaleAt',(select max(created_at) from daily_report_sales_lines)
)::text;`);
query('quotations',`select json_build_object(
  'rfqEvents',(select count(*) from audit_log where action='supplier_quote_request'),
  'latestRfqEvents',(select coalesce(json_agg(x),'[]'::json) from (select entity_id reference_no,details->>'item' item,details->>'status' status,created_at from audit_log where action='supplier_quote_request' order by created_at desc limit 10) x),
  'supplierQuotes',(select count(*) from supplier_quotes),
  'purchaseRequests',(select count(*) from purchase_requests),
  'quotationImports',(select count(*) from imports where report_type='quotation')
)::text;`);
query('customers',`select json_build_object(
  'customers',(select count(*) from customers),
  'telegramCreateEvents',(select count(*) from audit_log where action in ('customer_created','customer_registered','customer_master_created')),
  'latestRows',(select coalesce(json_agg(row_to_json(x)),'[]'::json) from (select * from customers order by created_at desc nulls last limit 5) x)
)::text;`);
query('employees',`select json_build_object(
  'employees',(select count(*) from employees),
  'activeUsers',(select count(*) from app_users where active),
  'pendingUsers',(select count(*) from app_users where not active or role='pending'),
  'approvedRegistrationEvents',(select count(*) from audit_log where action='approve_telegram_employee_registration'),
  'latestEmployees',(select coalesce(json_agg(row_to_json(x)),'[]'::json) from (select * from employees order by created_at desc nulls last limit 5) x)
)::text;`);
report.ok=Object.values(report.sections).some(section=>section.ok);
writeFileSync(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});
