import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const db=String(process.env.SUPABASE_DB_URL||'').trim(),output='production-data-integrity.json';
const stop=(code,reason)=>{writeFileSync(output,JSON.stringify({ok:false,code,reason},null,2));console.error(`[data-integrity] ${code}`);process.exit(1);};
if(!db)stop('DATABASE_URL_EMPTY','Database connection is empty.');
const sql=`select json_build_object(
'counts',json_build_object('customers',(select count(*) from customers),'salesOrders',(select count(*) from sales_orders),'collections',(select count(*) from collection_events),'allocations',(select count(*) from sales_payment_allocations),'dailySales',(select count(*) from daily_report_sales_lines)),
'checks',json_build_object(
'invalidSalesBalances',(select count(*) from sales_orders where coalesce(paid_amount,0)<0 or coalesce(paid_amount,0)>coalesce(total_amount,0)+0.01),
'orphanSalesCustomers',(select count(*) from sales_orders s where nullif(trim(s.customer_external_id),'') is not null and not exists(select 1 from customers c where c.external_id=s.customer_external_id or c.customer_code=s.customer_external_id)),
'invalidCollectionBalances',(select count(*) from collection_events where abs(coalesce(amount,0)-coalesce(allocated_amount,0)-coalesce(unallocated_amount,0))>0.01),
'orphanCollectionCustomers',(select count(*) from collection_events e where nullif(trim(e.customer_external_id),'') is not null and not exists(select 1 from customers c where c.external_id=e.customer_external_id or c.customer_code=e.customer_external_id)),
'orphanActiveAllocations',(select count(*) from sales_payment_allocations a left join collection_events c on c.id=a.collection_id left join sales_orders s on s.id=a.sales_order_id where a.active and (c.id is null or s.id is null)),
'duplicateDailySaleIdentity',(select count(*) from (select line_identity from daily_report_sales_lines where line_identity is not null group by line_identity having count(*)>1) q)
))::text;`;
const result=spawnSync('psql',[db,'-X','-t','-A','-v','ON_ERROR_STOP=1','-c',sql],{encoding:'utf8',env:process.env,timeout:120000});
if(result.error||result.status!==0)stop('QUERY_FAILED','Read-only integrity query failed.');
let data;try{data=JSON.parse(String(result.stdout||'').trim());}catch{stop('INVALID_JSON','Integrity query returned invalid JSON.');}
const critical=Object.entries(data.checks).filter(([,count])=>Number(count)>0).map(([name,count])=>({name,count:Number(count)}));
const warnings=[];if(Number(data.counts.customers)===0)warnings.push({code:'CUSTOMERS_EMPTY'});if(Number(data.counts.dailySales)===0)warnings.push({code:'DAILY_SALES_EMPTY'});
const report={ok:critical.length===0,code:critical.length?'DATA_INTEGRITY_FAILED':'DATA_INTEGRITY_VERIFIED',...data,critical,warnings,readOnly:true};
writeFileSync(output,`${JSON.stringify(report,null,2)}\n`,{mode:0o600});
console.log(`[data-integrity] ${report.code}; critical=${critical.length}`);
if(critical.length)process.exit(1);
