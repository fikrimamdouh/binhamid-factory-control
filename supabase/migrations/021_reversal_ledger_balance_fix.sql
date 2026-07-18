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

-- A report must never become approved before its file metadata, accounting
-- evidence, import status, and idempotency record agree. This RPC is invoked
-- by the server only; an exception rolls back the full acceptance transaction.
create or replace function public.commit_daily_report_acceptance(
  p_report_date date,
  p_original_name text,
  p_file_hash text,
  p_content_hash text,
  p_payload jsonb,
  p_actor text,
  p_file_storage_path text,
  p_preview_summary jsonb,
  p_validation_warnings jsonb,
  p_idempotency_key text,
  p_import_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_result jsonb;
  v_batch_id uuid;
  v_accounting jsonb;
  v_attempt_id uuid;
  v_entry_count integer;
  v_unposted integer;
  v_total_debit numeric(18,2);
  v_total_credit numeric(18,2);
begin
  if nullif(trim(coalesce(p_actor,'')),'') is null then raise exception 'DAILY_REPORT_ACTOR_REQUIRED'; end if;
  if nullif(trim(coalesce(p_file_storage_path,'')),'') is null then raise exception 'DAILY_REPORT_ORIGINAL_FILE_REQUIRED'; end if;

  if p_import_id is not null then
    perform public.transition_import_status(p_import_id,'processing',p_actor,'بدأ الترحيل المحاسبي',null,'{}'::jsonb);
  end if;

  v_result:=public.commit_daily_report(p_report_date,p_original_name,p_file_hash,p_content_hash,p_payload,p_actor);
  v_batch_id:=nullif(v_result->>'id','')::uuid;
  if v_batch_id is null then raise exception 'DAILY_REPORT_BATCH_MISSING'; end if;

  if coalesce((v_result->>'duplicate')::boolean,false)=false then
    update public.daily_report_batches
    set file_storage_path=p_file_storage_path,
        uploaded_by=p_actor,
        approved_by=p_actor,
        approved_at=now(),
        preview_summary=coalesce(p_preview_summary,'{}'::jsonb),
        validation_errors='[]'::jsonb,
        validation_warnings=coalesce(p_validation_warnings,'[]'::jsonb)
    where id=v_batch_id;
  end if;

  select count(*),
         count(*) filter(where status<>'posted'),
         coalesce(sum(total_debit),0),
         coalesce(sum(total_credit),0)
    into v_entry_count,v_unposted,v_total_debit,v_total_credit
  from (
    select e.id,e.status,sum(l.debit)::numeric(18,2) total_debit,sum(l.credit)::numeric(18,2) total_credit
    from public.journal_entries e
    join public.journal_entry_lines l on l.journal_entry_id=e.id
    where e.source_batch_id=v_batch_id
    group by e.id,e.status
  ) entries;
  v_accounting:=jsonb_build_object(
    'entryCount',v_entry_count,
    'totalDebit',round(v_total_debit,2),
    'totalCredit',round(v_total_credit,2),
    'balanced',v_entry_count>0 and v_unposted=0 and round(v_total_debit,2)=round(v_total_credit,2)
  );
  if coalesce((v_accounting->>'balanced')::boolean,false)=false then
    raise exception 'ACCOUNTING_POSTING_INVALID:%',v_batch_id;
  end if;

  v_attempt_id:=public.register_daily_report_attempt(
    p_report_date,p_original_name,p_file_hash,p_content_hash,p_idempotency_key,
    case when coalesce((v_result->>'duplicate')::boolean,false) then 'duplicate' else 'approved' end,
    v_batch_id,
    coalesce(p_preview_summary,'{}'::jsonb)||jsonb_build_object('accounting',v_accounting),
    '[]'::jsonb,coalesce(p_validation_warnings,'[]'::jsonb),p_actor
  );

  if p_import_id is not null then
    perform public.transition_import_status(
      p_import_id,'posted',p_actor,'تم الترحيل وإنشاء القيود المتوازنة',v_batch_id,
      jsonb_build_object('preview',coalesce(p_preview_summary,'{}'::jsonb),'accounting',v_accounting,'storagePath',p_file_storage_path,'attemptId',v_attempt_id)
    );
  end if;

  return v_result||jsonb_build_object(
    'accounting',v_accounting,
    'storagePath',p_file_storage_path,
    'sourceImportId',p_import_id,
    'attemptId',v_attempt_id
  );
end $$;

revoke all on function public.commit_daily_report(date,text,text,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.register_daily_report_attempt(date,text,text,text,text,text,uuid,jsonb,jsonb,jsonb,text) from public,anon,authenticated;
revoke all on function public.commit_daily_report_acceptance(date,text,text,text,jsonb,text,text,jsonb,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.commit_daily_report(date,text,text,text,jsonb,text),public.register_daily_report_attempt(date,text,text,text,text,text,uuid,jsonb,jsonb,jsonb,text),public.commit_daily_report_acceptance(date,text,text,text,jsonb,text,text,jsonb,jsonb,text,uuid) to service_role;

-- Additional Schema 21 features merged from the same release.
-- Bin Hamid Factory Control — bind physical device sessions to approved application users
-- Additional features for Schema 21, applied after Schema 20.
-- Idempotent and non-destructive.

create table if not exists public.device_enrollments (
  device_id text primary key check (device_id ~ '^dev-[A-Za-z0-9-]{8,150}$'),
  app_user_id uuid references public.app_users(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','approved','revoked')),
  requested_at timestamptz not null default now(),
  requested_from jsonb not null default '{}'::jsonb,
  approved_by text,
  approved_at timestamptz,
  revoked_by text,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  check ((status='approved' and app_user_id is not null and approved_at is not null) or status<>'approved')
);
create index if not exists device_enrollments_user_idx on public.device_enrollments(app_user_id,status);
create index if not exists device_enrollments_status_idx on public.device_enrollments(status,updated_at desc);

create or replace function public.approve_device_enrollment(p_device_id text,p_app_user_id uuid,p_actor text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_user public.app_users%rowtype;
begin
  if p_device_id is null or p_device_id !~ '^dev-[A-Za-z0-9-]{8,150}$' then raise exception 'DEVICE_ID_INVALID'; end if;
  if nullif(trim(p_actor),'') is null then raise exception 'DEVICE_APPROVER_REQUIRED'; end if;
  select * into v_user from public.app_users where id=p_app_user_id and active=true for share;
  if not found then raise exception 'DEVICE_APP_USER_NOT_ACTIVE'; end if;
  insert into public.device_enrollments(device_id,app_user_id,status,approved_by,approved_at,last_seen_at,updated_at)
  values(p_device_id,p_app_user_id,'approved',p_actor,now(),now(),now())
  on conflict(device_id) do update set app_user_id=excluded.app_user_id,status='approved',approved_by=excluded.approved_by,approved_at=excluded.approved_at,revoked_by=null,revoked_at=null,last_seen_at=now(),updated_at=now();
  insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details)
  values('web',p_actor,'device_enrollment_approved','device',p_device_id,jsonb_build_object('app_user_id',p_app_user_id,'role',v_user.role));
  return jsonb_build_object('device_id',p_device_id,'app_user_id',p_app_user_id,'status','approved','role',v_user.role);
end $$;

create or replace function public.revoke_device_enrollment(p_device_id text,p_actor text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_count integer;
begin
  if nullif(trim(p_actor),'') is null then raise exception 'DEVICE_REVOKER_REQUIRED'; end if;
  update public.device_enrollments set status='revoked',revoked_by=p_actor,revoked_at=now(),updated_at=now() where device_id=p_device_id and status<>'revoked';
  get diagnostics v_count=row_count;
  if v_count=0 then raise exception 'DEVICE_ENROLLMENT_NOT_FOUND'; end if;
  insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details) values('web',p_actor,'device_enrollment_revoked','device',p_device_id,'{}'::jsonb);
  return jsonb_build_object('device_id',p_device_id,'status','revoked');
end $$;

-- These records and security-definer functions are server-side only. No browser or Supabase client role may access them directly.
alter table public.user_invitations enable row level security;
alter table public.mix_materials enable row level security;
alter table public.mix_material_prices enable row level security;
alter table public.mix_designs enable row level security;
alter table public.mix_design_items enable row level security;
alter table public.mix_design_overheads enable row level security;
alter table public.mix_cost_calculation_runs enable row level security;
alter table public.device_enrollments enable row level security;

revoke all on table public.user_invitations,public.mix_materials,public.mix_material_prices,public.mix_designs,public.mix_design_items,public.mix_design_overheads,public.mix_cost_calculation_runs,public.device_enrollments from anon,authenticated;
grant all on table public.user_invitations,public.mix_materials,public.mix_material_prices,public.mix_designs,public.mix_design_items,public.mix_design_overheads,public.mix_cost_calculation_runs,public.device_enrollments to service_role;
revoke all on table public.mix_design_latest_cost from anon,authenticated;
grant select on table public.mix_design_latest_cost to service_role;

revoke all on function public.accept_user_invitation(text,text) from public,anon,authenticated;
revoke all on function public.decide_user_invitation(uuid,text,text,text,text) from public,anon,authenticated;
revoke all on function public.clone_mix_design_version(uuid,text) from public,anon,authenticated;
revoke all on function public.approve_mix_cost_run(uuid,text) from public,anon,authenticated;
revoke all on function public.approve_device_enrollment(text,uuid,text) from public,anon,authenticated;
revoke all on function public.revoke_device_enrollment(text,text) from public,anon,authenticated;
grant execute on function public.accept_user_invitation(text,text) to service_role;
grant execute on function public.decide_user_invitation(uuid,text,text,text,text) to service_role;
grant execute on function public.clone_mix_design_version(uuid,text) to service_role;
grant execute on function public.approve_mix_cost_run(uuid,text) to service_role;
grant execute on function public.approve_device_enrollment(text,uuid,text) to service_role;
grant execute on function public.revoke_device_enrollment(text,text) to service_role;

insert into public.migration_history(version,migration_name)
values(21,'021_reversal_ledger_balance_fix')
on conflict(version) do update set migration_name=excluded.migration_name;
