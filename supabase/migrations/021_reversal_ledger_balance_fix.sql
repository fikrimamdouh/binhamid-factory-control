-- Bin Hamid Factory Control — preserve the original and reversal entries in ledger balances
-- Run after 020_accounting_reversal_and_projection_safety.sql.
-- Idempotent and non-destructive.

do $$ begin
  if not exists(select 1 from public.migration_history where version=20) then
    raise exception 'MIGRATION_020_REQUIRED';
  end if;
end $$;

-- The original entry remains legal evidence after reversal. The reversing entry is
-- posted separately; including both entries produces the intended net-zero effect.
create or replace view public.general_ledger as
select je.id journal_entry_id,je.reference_no,je.entry_date,je.description,
  je.source_type,je.source_id,je.source_batch_id,je.status,je.currency,
  jel.line_no,coa.account_code,coa.account_name_ar,coa.account_type,
  jel.debit,jel.credit,jel.customer_external_id,jel.cost_center_code,jel.memo,
  sum(case when coa.normal_side='debit' then jel.debit-jel.credit else jel.credit-jel.debit end)
    over(partition by coa.account_code order by je.entry_date,je.created_at,je.id,jel.line_no rows unbounded preceding) running_balance
from public.journal_entries je
join public.journal_entry_lines jel on jel.journal_entry_id=je.id
join public.chart_of_accounts coa on coa.id=jel.account_id
where je.status in ('posted','reversed');

create or replace view public.trial_balance as
with ledger_lines as (
  select l.account_id,l.debit,l.credit
  from public.journal_entry_lines l
  join public.journal_entries e on e.id=l.journal_entry_id
  where e.status in ('posted','reversed')
)
select coa.account_code,coa.account_name_ar,coa.account_type,coa.normal_side,
  coalesce(sum(ll.debit),0)::numeric(18,2) total_debit,
  coalesce(sum(ll.credit),0)::numeric(18,2) total_credit,
  case when coa.normal_side='debit'
    then coalesce(sum(ll.debit-ll.credit),0)
    else coalesce(sum(ll.credit-ll.debit),0)
  end::numeric(18,2) balance
from public.chart_of_accounts coa
left join ledger_lines ll on ll.account_id=coa.id
where coa.active=true
group by coa.account_code,coa.account_name_ar,coa.account_type,coa.normal_side;

-- Keep migration 019's original six columns stable and leave reversed_entries
-- appended in the seventh position introduced by migration 020.
create or replace view public.accounting_integrity_report as
select
  (select count(*) from public.journal_entries where status='draft') draft_entries,
  (select count(*) from public.journal_entries where status='posted') posted_entries,
  (select count(*) from public.journal_entries e
    where e.status in ('posted','reversed')
      and not exists(select 1 from public.journal_entry_lines l where l.journal_entry_id=e.id)) entries_without_lines,
  (select count(*) from (
    select l.journal_entry_id
    from public.journal_entry_lines l
    join public.journal_entries e on e.id=l.journal_entry_id
    where e.status in ('posted','reversed')
    group by l.journal_entry_id
    having round(sum(l.debit),2)<>round(sum(l.credit),2)
  ) x) unbalanced_entries,
  (select coalesce(sum(total_debit),0) from public.trial_balance) total_debit,
  (select coalesce(sum(total_credit),0) from public.trial_balance) total_credit,
  (select count(*) from public.journal_entries where status='reversed') reversed_entries;

insert into public.migration_history(version,migration_name)
values(21,'021_reversal_ledger_balance_fix')
on conflict(version) do update set migration_name=excluded.migration_name;
