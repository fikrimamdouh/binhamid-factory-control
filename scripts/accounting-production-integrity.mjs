import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const databaseUrl=String(process.env.SUPABASE_DB_URL||'').trim();
const outputPath=process.env.ACCOUNTING_INTEGRITY_PATH||'production-accounting-integrity.json';
const write=value=>writeFileSync(outputPath,`${JSON.stringify(value,null,2)}\n`,{mode:0o600});
const fail=(code,reason,evidence={})=>{const report={ok:false,checkedAt:new Date().toISOString(),code,reason,evidence};write(report);console.error(`[accounting-integrity] ${code}: ${reason}`);process.exit(1);};
if(!databaseUrl)fail('DATABASE_URL_EMPTY','The protected database URL is empty.');
const sql=`select json_build_object(
  'schemaVersion',(select coalesce(max(version),0) from public.migration_history),
  'journal',(select row_to_json(x) from public.accounting_integrity_report x),
  'approvedBatches',(select count(*) from public.daily_report_batches where status='approved'),
  'approvedBatchesWithoutJournal',(select count(*) from public.daily_report_batches b where b.status='approved' and (exists(select 1 from public.daily_report_sales_lines s where s.batch_id=b.id) or exists(select 1 from public.daily_report_cash_movements c where c.batch_id=b.id and c.is_customer_collection=true)) and not exists(select 1 from public.journal_entries j where j.source_batch_id=b.id)),
  'reversedEntriesWithoutPostedReversal',(select count(*) from public.journal_entries e where e.status='reversed' and not exists(select 1 from public.journal_entries r where r.reversal_of=e.id and r.status='posted')),
  'postedDailyImportsWithoutBatch',(select count(*) from public.imports where status='posted' and report_type in ('daily_movement','block_daily_movement','concrete_daily_movement') and posted_batch_id is null),
  'staleProcessingImports',(select count(*) from public.imports where status='processing' and processing_started_at<now()-interval '20 minutes'),
  'failedRetryableTelegramUpdates',(select count(*) from public.telegram_update_receipts where status='failed' and retryable=true),
  'salesWithoutSource',(select count(*) from public.sales_orders where nullif(reference_no,'') is null),
  'collectionsWithoutSource',(select count(*) from public.collection_events where nullif(reference_no,'') is null)
)::text;`;
const result=spawnSync('psql',[databaseUrl,'-X','-t','-A','-v','ON_ERROR_STOP=1','-c',sql],{encoding:'utf8',env:process.env,timeout:120000});
if(result.error||result.status!==0)fail('ACCOUNTING_QUERY_FAILED','The accounting integrity query failed.',{exitCode:result.status??-1});
let evidence;try{evidence=JSON.parse(String(result.stdout||'').trim());}catch{fail('ACCOUNTING_RESULT_INVALID','The accounting integrity result was not valid JSON.');}
const journal=evidence.journal||{},blockers=[];
if(Number(evidence.schemaVersion)!==23)blockers.push('schema_version');
if(Number(journal.unbalanced_entries||0)!==0)blockers.push('unbalanced_entries');
if(Number(journal.entries_without_lines||0)!==0)blockers.push('entries_without_lines');
if(Number(journal.total_debit||0)!==Number(journal.total_credit||0))blockers.push('trial_balance_difference');
if(Number(evidence.approvedBatchesWithoutJournal||0)!==0)blockers.push('approved_batches_without_journal');
if(Number(evidence.reversedEntriesWithoutPostedReversal||0)!==0)blockers.push('reversed_entries_without_reversal');
if(Number(evidence.postedDailyImportsWithoutBatch||0)!==0)blockers.push('posted_daily_imports_without_batch');
if(Number(evidence.staleProcessingImports||0)!==0)blockers.push('stale_processing_imports');
if(Number(evidence.salesWithoutSource||0)!==0)blockers.push('sales_without_source');
if(Number(evidence.collectionsWithoutSource||0)!==0)blockers.push('collections_without_source');
const report={ok:blockers.length===0,checkedAt:new Date().toISOString(),code:blockers.length?'ACCOUNTING_INTEGRITY_FAILED':'ACCOUNTING_INTEGRITY_PASSED',blockers,evidence};write(report);
if(blockers.length){console.error(`[accounting-integrity] blockers=${blockers.join(',')}`);process.exit(1);}
console.log(`[accounting-integrity] PASSED entries=${journal.posted_entries||0} debit=${journal.total_debit||0} credit=${journal.total_credit||0}`);
