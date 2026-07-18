import { randomBytes } from 'node:crypto';
import { writeFileSync,rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const databaseUrl=String(process.env.TEST_DATABASE_URL||process.env.LOCAL_DATABASE_URL||'').trim();
const outputPath=String(process.env.FINAL_ACCEPTANCE_DB_RESULT||'final-acceptance-database.json');
const run=randomBytes(5).toString('hex').toUpperCase();
const sqlPath=`/tmp/binhamid-final-acceptance-${run}.sql`;
const fail=(code,reason,extra={})=>{const report={ok:false,checkedAt:new Date().toISOString(),code,reason,...extra};writeFileSync(outputPath,`${JSON.stringify(report,null,2)}\n`,{mode:0o600});console.error(`[final-db-acceptance] ${code}: ${reason}`);process.exit(1);};
if(!databaseUrl)fail('TEST_DATABASE_URL_EMPTY','The isolated test database URL is empty.');

const sql=String.raw`
\set ON_ERROR_STOP on
begin;

do $$
begin
  if (select coalesce(max(version),0) from public.migration_history)<20 then
    raise exception 'SCHEMA_20_REQUIRED';
  end if;
end $$;

insert into public.customers(external_id,customer_code,customer_name,segment,credit_limit,payment_days,active,source_updated_at)
values('ACC-${run}','ACC-${run}','عميل اختبار قبول ${run}','acceptance',1000000,30,true,now())
on conflict(external_id) do update set credit_limit=excluded.credit_limit,active=true,updated_at=now();

insert into public.imports(source,department,report_type,status,original_name,mime_type,file_path,file_hash,row_count,valid_count,warning_count,error_count,summary,source_chat_id,source_message_id)
values('acceptance','finance','daily_movement','ready','acceptance-${run}.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','acceptance/${run}/source.xlsx','HASH-${run}',3,3,0,0,'{}'::jsonb,'acceptance-chat','acceptance-message')
returning id as import_id \gset

select public.transition_import_status(:'import_id'::uuid,'processing'::text,'acceptance-test'::text,'بدء اختبار الترحيل'::text,null::uuid,'{}'::jsonb);

select public.commit_daily_report(
  date '2099-12-31',
  'acceptance-${run}.xlsx',
  'HASH-${run}',
  'CONTENT-${run}',
  jsonb_build_object(
    'summary',jsonb_build_object('totalSales',3000,'collectionTotal',300),
    'sales',jsonb_build_array(
      jsonb_build_object('sourceRowNo',1,'invoiceNo','B-${run}','salesType','block','customerCode','ACC-${run}','customerName','عميل اختبار قبول ${run}','item','بلوك اختبار','quantity',100,'unit','قطعة','amount',1000,'paymentTerms','آجل','issues','[]'::jsonb),
      jsonb_build_object('sourceRowNo',2,'invoiceNo','C-${run}','salesType','concrete','customerCode','ACC-${run}','customerName','عميل اختبار قبول ${run}','item','خرسانة اختبار','quantity',10,'unit','م3','amount',2000,'paymentTerms','آجل','issues','[]'::jsonb)
    ),
    'cashMovements',jsonb_build_array(
      jsonb_build_object('sourceRowNo',3,'treasuryCode','101','treasuryName','الخزينة النقدية','debit',300,'credit',0,'accountName','عميل اختبار قبول ${run}','accountType','عميل','accountCode','ACC-${run}','description','تحصيل اختبار','movementType','استلام تحصيل عميل','voucherNo','R-${run}','movementDate','2099-12-31','paymentMethod','نقدي','isCustomerCollection',true)
    ),
    'treasuries','[]'::jsonb,
    'inventory','[]'::jsonb
  ),
  'acceptance-test'
) as first_commit \gset

select (:'first_commit'::jsonb->>'id')::uuid as batch_id \gset

select public.transition_import_status(:'import_id'::uuid,'posted'::text,'acceptance-test'::text,'تم اختبار الترحيل'::text,:'batch_id'::uuid,jsonb_build_object('acceptance',true));

select public.commit_daily_report(
  date '2099-12-31','acceptance-${run}.xlsx','HASH-${run}','CONTENT-${run}',
  jsonb_build_object('summary','{}'::jsonb,'sales','[]'::jsonb,'cashMovements','[]'::jsonb,'treasuries','[]'::jsonb,'inventory','[]'::jsonb),
  'acceptance-test'
) as duplicate_commit \gset

select public.claim_telegram_update('ACCEPTANCE-${run}','document') as claim_one \gset
select public.claim_telegram_update('ACCEPTANCE-${run}','document') as claim_two \gset
select public.complete_telegram_update('ACCEPTANCE-${run}');
select public.claim_telegram_update('ACCEPTANCE-${run}','document') as claim_three \gset

select id as original_entry_id from public.journal_entries where source_batch_id=:'batch_id'::uuid and source_type='daily_report_sale' order by reference_no limit 1 \gset
select public.reverse_journal_entry(:'original_entry_id'::uuid,'acceptance-test','اختبار العكس المحاسبي') as reversal \gset

select json_build_object(
  'schemaVersion',(select max(version) from public.migration_history),
  'batchId',:'batch_id',
  'importId',:'import_id',
  'firstDuplicate',coalesce((:'first_commit'::jsonb->>'duplicate')::boolean,false),
  'secondDuplicate',coalesce((:'duplicate_commit'::jsonb->>'duplicate')::boolean,false),
  'journalCount',(select count(*) from public.journal_entries where source_batch_id=:'batch_id'::uuid and source_type in ('daily_report_sale','daily_report_collection')),
  'journalLines',(select count(*) from public.journal_entry_lines l join public.journal_entries e on e.id=l.journal_entry_id where e.source_batch_id=:'batch_id'::uuid and e.source_type in ('daily_report_sale','daily_report_collection')),
  'journalDebit',(select coalesce(sum(l.debit),0) from public.journal_entry_lines l join public.journal_entries e on e.id=l.journal_entry_id where e.source_batch_id=:'batch_id'::uuid and e.source_type in ('daily_report_sale','daily_report_collection')),
  'journalCredit',(select coalesce(sum(l.credit),0) from public.journal_entry_lines l join public.journal_entries e on e.id=l.journal_entry_id where e.source_batch_id=:'batch_id'::uuid and e.source_type in ('daily_report_sale','daily_report_collection')),
  'salesOrders',(select count(*) from public.sales_orders where reference_no like 'DR-20991231-S-%' and customer_external_id='ACC-${run}'),
  'collections',(select count(*) from public.collection_events where reference_no like 'DR-20991231-C-%' and customer_external_id='ACC-${run}'),
  'customerBalance',(select coalesce(sum(total_amount-paid_amount),0) from public.sales_orders where customer_external_id='ACC-${run}' and status not in ('cancelled','rejected')),
  'importPosted',(select status='posted' and posted_batch_id=:'batch_id'::uuid from public.imports where id=:'import_id'::uuid),
  'claimOne',coalesce((:'claim_one'::jsonb->>'claimed')::boolean,false),
  'claimTwo',coalesce((:'claim_two'::jsonb->>'claimed')::boolean,false),
  'claimThree',coalesce((:'claim_three'::jsonb->>'claimed')::boolean,false),
  'reversalCreated',coalesce((:'reversal'::jsonb->>'ok')::boolean,false),
  'reversalBalanced',(select public.assert_journal_entry_balanced((:'reversal'::jsonb->>'reversalEntryId')::uuid)->>'balanced'),
  'unbalancedEntries',(select unbalanced_entries from public.accounting_integrity_report),
  'entriesWithoutLines',(select entries_without_lines from public.accounting_integrity_report)
)::text;

rollback;
`;
writeFileSync(sqlPath,sql,{mode:0o600});
try{
  const result=spawnSync('psql',[databaseUrl,'-X','-q','-t','-A','-f',sqlPath],{encoding:'utf8',env:process.env,timeout:600000});
  if(result.error||result.status!==0)fail('ACCEPTANCE_SQL_FAILED','The isolated database acceptance transaction failed.',{exitCode:result.status??-1,stderr:String(result.stderr||'').split(/\r?\n/).filter(Boolean).slice(-8).map(line=>line.replace(/postgres(?:ql)?:\/\/[^\s]+/gi,'[DATABASE_URL]'))});
  const lines=String(result.stdout||'').split(/\r?\n/).map(line=>line.trim()).filter(line=>line.startsWith('{')&&line.endsWith('}'));
  if(!lines.length)fail('ACCEPTANCE_RESULT_MISSING','The isolated database acceptance result is missing.');
  const evidence=JSON.parse(lines.at(-1)),blockers=[];
  if(Number(evidence.schemaVersion)<20)blockers.push('schema_version');
  if(evidence.firstDuplicate)blockers.push('first_commit_marked_duplicate');
  if(!evidence.secondDuplicate)blockers.push('duplicate_commit_not_detected');
  if(Number(evidence.journalCount)!==3||Number(evidence.journalLines)!==6)blockers.push('journal_count');
  if(Number(evidence.journalDebit)!==3300||Number(evidence.journalCredit)!==3300)blockers.push('journal_balance');
  if(Number(evidence.salesOrders)!==2||Number(evidence.collections)!==1)blockers.push('operational_projection');
  if(Number(evidence.customerBalance)!==2700)blockers.push('customer_balance');
  if(!evidence.importPosted)blockers.push('import_not_posted');
  if(!evidence.claimOne||evidence.claimTwo||evidence.claimThree)blockers.push('telegram_idempotency');
  if(!evidence.reversalCreated||String(evidence.reversalBalanced)!=='true')blockers.push('journal_reversal');
  if(Number(evidence.unbalancedEntries)!==0||Number(evidence.entriesWithoutLines)!==0)blockers.push('accounting_integrity');
  const report={ok:blockers.length===0,checkedAt:new Date().toISOString(),code:blockers.length?'FINAL_DATABASE_ACCEPTANCE_FAILED':'FINAL_DATABASE_ACCEPTANCE_PASSED',transactionRolledBack:true,productionDataTouched:false,blockers,evidence};
  writeFileSync(outputPath,`${JSON.stringify(report,null,2)}\n`,{mode:0o600});
  if(blockers.length){console.error(`[final-db-acceptance] blockers=${blockers.join(',')}`);process.exit(1);}
  console.log(`[final-db-acceptance] PASSED batch=${evidence.batchId}; debit=${evidence.journalDebit}; credit=${evidence.journalCredit}`);
}finally{rmSync(sqlPath,{force:true});}
