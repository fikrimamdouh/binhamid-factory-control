import { randomBytes } from 'node:crypto';
import { writeFileSync,rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const databaseUrl=String(process.env.TEST_DATABASE_URL||process.env.LOCAL_DATABASE_URL||'').trim();
const output=String(process.env.REVERSAL_ACCEPTANCE_RESULT||'reversal-ledger-acceptance.json');
const run=randomBytes(4).toString('hex').toUpperCase();
const file=`/tmp/reversal-ledger-${run}.sql`;
const fail=(code,reason,extra={})=>{writeFileSync(output,`${JSON.stringify({ok:false,code,reason,...extra},null,2)}\n`,{mode:0o600});console.error(`[reversal-acceptance] ${code}: ${reason}`);process.exit(1);};
if(!databaseUrl)fail('TEST_DATABASE_URL_EMPTY','The isolated database URL is empty.');
const sql=String.raw`
\set ON_ERROR_STOP on
begin;
do $$
begin
  if (select coalesce(max(version),0) from public.migration_history)<>24 then
    raise exception 'SCHEMA_24_REQUIRED';
  end if;
end $$;
select id as debit_account from public.chart_of_accounts where account_code='110100' \gset
select id as credit_account from public.chart_of_accounts where account_code='410100' \gset
insert into public.journal_entries(reference_no,entry_date,description,source_type,source_id,status,posted_by,posted_at)
values('TEST-${run}',current_date,'اختبار عكس محاسبي','acceptance_reversal','${run}','posted','acceptance',now()) returning id as original_id \gset
insert into public.journal_entry_lines(journal_entry_id,line_no,account_id,debit,credit,memo) values
(:'original_id'::uuid,1,:'debit_account'::uuid,500,0,'مدين اختبار'),
(:'original_id'::uuid,2,:'credit_account'::uuid,0,500,'دائن اختبار');
select public.reverse_journal_entry(:'original_id'::uuid,'acceptance','اختبار صافي العكس') as reversal \gset
select json_build_object(
  'schemaVersion',(select max(version) from public.migration_history),
  'reversalId',:'reversal'::jsonb->>'reversalEntryId',
  'ledgerRows',(select count(*) from public.general_ledger where journal_entry_id in (:'original_id'::uuid,(:'reversal'::jsonb->>'reversalEntryId')::uuid)),
  'maximumAccountDifference',(select coalesce(max(abs(amount)),0) from (select account_id,sum(debit-credit) amount from public.journal_entry_lines where journal_entry_id in (:'original_id'::uuid,(:'reversal'::jsonb->>'reversalEntryId')::uuid) group by account_id) x),
  'originalStatus',(select status from public.journal_entries where id=:'original_id'::uuid),
  'reversalStatus',(select status from public.journal_entries where id=(:'reversal'::jsonb->>'reversalEntryId')::uuid),
  'unbalanced',(select unbalanced_entries from public.accounting_integrity_report)
)::text;
rollback;
`;
writeFileSync(file,sql,{mode:0o600});
try{
  const result=spawnSync('psql',[databaseUrl,'-X','-q','-t','-A','-f',file],{encoding:'utf8',env:process.env,timeout:120000});
  if(result.error||result.status!==0)fail('REVERSAL_SQL_FAILED','The isolated reversal acceptance transaction failed.',{exitCode:result.status??-1,stderr:String(result.stderr||'').split(/\r?\n/).filter(Boolean).slice(-6)});
  const line=String(result.stdout||'').split(/\r?\n/).map(value=>value.trim()).find(value=>value.startsWith('{')&&value.endsWith('}'));
  if(!line)fail('REVERSAL_RESULT_MISSING','The reversal result is missing.');
  const evidence=JSON.parse(line),blockers=[];
  if(Number(evidence.schemaVersion)!==24)blockers.push('schema_version');
  if(Number(evidence.ledgerRows)!==4)blockers.push('ledger_rows');
  if(Number(evidence.maximumAccountDifference)!==0)blockers.push('non_zero_reversal_effect');
  if(evidence.originalStatus!=='reversed'||evidence.reversalStatus!=='posted')blockers.push('reversal_status');
  if(Number(evidence.unbalanced)!==0)blockers.push('unbalanced_entry');
  const report={ok:blockers.length===0,checkedAt:new Date().toISOString(),transactionRolledBack:true,blockers,evidence};
  writeFileSync(output,`${JSON.stringify(report,null,2)}\n`,{mode:0o600});
  if(blockers.length){console.error(`[reversal-acceptance] blockers=${blockers.join(',')}`);process.exit(1);}
  console.log('[reversal-acceptance] PASSED net-zero reversal');
}finally{rmSync(file,{force:true});}
