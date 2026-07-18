import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const db=String(process.env.SUPABASE_DB_URL||'').trim();
const output='test-sales-order-cleanup.json';
const refs=['BH-BSO-2026-00001','BH-CSO-2026-00001'];
const write=report=>writeFileSync(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});
const stop=(code,details={})=>{write({ok:false,code,refs,...details});console.error(`[test-sales-cleanup] ${code}`);process.exit(1);};
if(!db)stop('DATABASE_URL_EMPTY');
const run=sql=>spawnSync('psql',[db,'-X','-t','-A','-v','ON_ERROR_STOP=1','-c',sql],{encoding:'utf8',timeout:120000,env:process.env});
const list=refs.map(value=>`'${value}'`).join(',');
const pre=run(`select json_build_object(
  'createdEvents',(select count(*) from audit_log where action='sales_order_created' and entity_id in (${list})),
  'protectedSalesRows',(select count(*) from sales_orders where reference_no in (${list}) and (status in ('invoiced','collected') or coalesce(paid_amount,0)>0)),
  'invoiceLines',(select count(*) from daily_report_sales_lines where invoice_no in (${list})),
  'journalEntries',(select count(*) from journal_entries where source_id in (${list}) or reference_no in (${list})),
  'operationalRows',(select count(*) from operational_records where reference_no in (${list})),
  'salesRows',(select count(*) from sales_orders where reference_no in (${list}))
)::text;`);
if(pre.error||pre.status!==0)stop('PRECHECK_QUERY_FAILED');
let checks;try{checks=JSON.parse(String(pre.stdout||'').trim());}catch{stop('PRECHECK_INVALID_JSON');}
const alreadyGone=Number(checks.createdEvents)===0&&Number(checks.operationalRows)===0&&Number(checks.salesRows)===0;
if(alreadyGone){const report={ok:true,code:'TEST_SALES_ORDERS_ALREADY_REMOVED',refs,checks,remaining:{remainingAudit:0,remainingSales:0,remainingOperational:0},checkedAt:new Date().toISOString()};write(report);console.log(`[test-sales-cleanup] ${report.code}`);process.exit(0);}
if(Number(checks.createdEvents)!==2)stop('TARGET_EVENT_COUNT_MISMATCH',{checks});
if(Number(checks.protectedSalesRows)||Number(checks.invoiceLines)||Number(checks.journalEntries))stop('FINANCIAL_LINK_FOUND',{checks});
const sql=`begin;
create temporary table cleanup_messages on commit drop as
select distinct details->>'chat_id' chat_id,details->>'source_message_id' message_id
from audit_log where entity_id in (${list}) and action in ('sales_order_created','sales_order_updated','sales_order_cancelled');
with deleted as (delete from telegram_messages t using cleanup_messages m where t.chat_id=m.chat_id and t.message_id=m.message_id returning t.id) select count(*) from deleted;
with deleted as (delete from sales_orders where reference_no in (${list}) returning id) select count(*) from deleted;
with deleted as (delete from operational_records where reference_no in (${list}) returning id) select count(*) from deleted;
with deleted as (delete from audit_log where entity_id in (${list}) and action in ('sales_order_created','sales_order_updated','sales_order_cancelled') returning id) select count(*) from deleted;
commit;`;
const result=run(sql);if(result.error||result.status!==0)stop('DELETE_TRANSACTION_FAILED',{checks});
const verify=run(`select json_build_object(
  'remainingAudit',(select count(*) from audit_log where entity_id in (${list}) and action in ('sales_order_created','sales_order_updated','sales_order_cancelled')),
  'remainingSales',(select count(*) from sales_orders where reference_no in (${list})),
  'remainingOperational',(select count(*) from operational_records where reference_no in (${list}))
)::text;`);
if(verify.error||verify.status!==0)stop('VERIFY_QUERY_FAILED',{checks});
let remaining;try{remaining=JSON.parse(String(verify.stdout||'').trim());}catch{stop('VERIFY_INVALID_JSON',{checks});}
const ok=Object.values(remaining).every(value=>Number(value)===0),report={ok,code:ok?'TEST_SALES_ORDERS_REMOVED':'CLEANUP_INCOMPLETE',refs,checks,remaining,removedAt:new Date().toISOString()};
write(report);console.log(`[test-sales-cleanup] ${report.code}`);if(!ok)process.exit(1);
