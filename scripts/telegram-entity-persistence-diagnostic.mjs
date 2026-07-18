import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const db=String(process.env.SUPABASE_DB_URL||'').trim(),output='telegram-entity-persistence-diagnostic.json';
if(!db){writeFileSync(output,JSON.stringify({ok:false,code:'DATABASE_URL_EMPTY'},null,2));process.exit(0);}
const sql=`select json_build_object(
  'salesOrders',json_build_object(
    'createdEvents',(select count(*) from audit_log where action='sales_order_created'),
    'cancelEvents',(select count(*) from audit_log where action='sales_order_cancelled'),
    'latest',(select coalesce(json_agg(x),'[]'::json) from (
      select a.entity_id reference_no,a.entity_type,a.created_at,
        coalesce(a.details->>'customer_name','') customer_name,
        coalesce(a.details->>'item','') item,
        coalesce(a.details->>'status','') status,
        exists(select 1 from operational_records o where o.reference_no=a.entity_id or (o.source_event_type='audit_log' and o.source_event_id=a.id::text)) projected_to_web
      from audit_log a where a.action='sales_order_created'
      order by a.created_at desc limit 10
    ) x),
    'unprojected',(select count(*) from audit_log a where a.action='sales_order_created' and not exists(select 1 from operational_records o where o.reference_no=a.entity_id or (o.source_event_type='audit_log' and o.source_event_id=a.id::text)))
  ),
  'invoices',json_build_object(
    'directTelegramEvents',(select count(*) from audit_log where action in ('invoice_created','sales_invoice_created','invoice_registered')),
    'excelSalesLines',(select count(*) from daily_report_sales_lines),
    'latestExcelSaleAt',(select max(created_at) from daily_report_sales_lines)
  ),
  'quotations',json_build_object(
    'supplierQuotes',(select count(*) from supplier_quotes),
    'purchaseRequests',(select count(*) from purchase_requests),
    'quotationImports',(select count(*) from imports where report_type='quotation'),
    'latestSupplierQuoteAt',(select max(created_at) from supplier_quotes),
    'latestPurchaseRequestAt',(select max(created_at) from purchase_requests)
  ),
  'customers',json_build_object(
    'customers',(select count(*) from customers),
    'telegramCustomerEvents',(select count(*) from audit_log where action in ('customer_created','customer_registered','customer_master_created')),
    'latestCustomerAt',(select max(created_at) from customers)
  ),
  'employees',json_build_object(
    'employees',(select count(*) from employees),
    'activeUsers',(select count(*) from app_users where active),
    'registrationRequests',(select count(*) from hr_requests where request_type in ('employee_registration','registration')),
    'latestEmployeeAt',(select max(created_at) from employees)
  ),
  'webProjection',json_build_object(
    'triggerExists',(select exists(select 1 from pg_trigger where tgname='audit_operational_projection_trigger' and not tgisinternal)),
    'operationalRecords',(select count(*) from operational_records),
    'latestRecords',(select coalesce(json_agg(x),'[]'::json) from (
      select reference_no,record_type,status,created_at,updated_at from operational_records order by updated_at desc nulls last limit 10
    ) x)
  )
)::text;`;
const result=spawnSync('psql',[db,'-X','-t','-A','-v','ON_ERROR_STOP=1','-c',sql],{encoding:'utf8',timeout:120000,env:process.env});
if(result.error||result.status!==0){writeFileSync(output,JSON.stringify({ok:false,code:/column .* does not exist/i.test(String(result.stderr||''))?'COLUMN_MISSING':/relation .* does not exist/i.test(String(result.stderr||''))?'RELATION_MISSING':'QUERY_FAILED'},null,2));process.exit(0);}
try{const data=JSON.parse(String(result.stdout||'').trim());writeFileSync(output,JSON.stringify({ok:true,...data},null,2)+'\n',{mode:0o600});}
catch{writeFileSync(output,JSON.stringify({ok:false,code:'INVALID_JSON'},null,2));}
