-- Bin Hamid Factory Control — accounting ledger, import lifecycle and Telegram update integrity
-- Run after 018_governance_safety_refinements.sql.
-- Idempotent and non-destructive. Existing business rows are not deleted or rewritten.

create extension if not exists pgcrypto;

do $$
begin
  if not exists(select 1 from public.migration_history where version=18) then
    raise exception 'MIGRATION_018_REQUIRED';
  end if;
end $$;

create table if not exists public.chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  account_code text not null unique,
  account_name_ar text not null,
  account_type text not null check(account_type in ('asset','liability','equity','revenue','expense')),
  normal_side text not null check(normal_side in ('debit','credit')),
  parent_code text,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.chart_of_accounts(account_code,account_name_ar,account_type,normal_side,parent_code) values
  ('110100','ذمم العملاء','asset','debit','110000'),
  ('110201','الخزينة النقدية 101','asset','debit','110200'),
  ('110204','نقاط البيع 104','asset','debit','110200'),
  ('410100','مبيعات البلوك','revenue','credit','410000'),
  ('410200','مبيعات الخرسانة','revenue','credit','410000')
on conflict(account_code) do update set
  account_name_ar=excluded.account_name_ar,
  account_type=excluded.account_type,
  normal_side=excluded.normal_side,
  parent_code=excluded.parent_code,
  updated_at=now();

create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  reference_no text not null unique,
  entry_date date not null,
  description text not null,
  source_type text not null,
  source_id text not null,
  source_batch_id uuid references public.daily_report_batches(id) on delete restrict,
  currency text not null default 'SAR' check(currency='SAR'),
  status text not null default 'draft' check(status in ('draft','posted','reversed')),
  posted_by text,
  posted_at timestamptz,
  reversal_of uuid references public.journal_entries(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_type,source_id)
);

create table if not exists public.journal_entry_lines (
  id bigserial primary key,
  journal_entry_id uuid not null references public.journal_entries(id) on delete restrict,
  line_no integer not null,
  account_id uuid not null references public.chart_of_accounts(id) on delete restrict,
  debit numeric(18,2) not null default 0,
  credit numeric(18,2) not null default 0,
  customer_external_id text,
  cost_center_code text,
  memo text,
  source_line_id text,
  created_at timestamptz not null default now(),
  unique(journal_entry_id,line_no),
  check(debit>=0 and credit>=0),
  check((debit>0 and credit=0) or (credit>0 and debit=0))
);

create index if not exists journal_entries_date_status_idx on public.journal_entries(entry_date,status,created_at desc);
create index if not exists journal_entries_source_batch_idx on public.journal_entries(source_batch_id,source_type);
create index if not exists journal_lines_account_idx on public.journal_entry_lines(account_id,journal_entry_id);
create index if not exists journal_lines_customer_idx on public.journal_entry_lines(customer_external_id,journal_entry_id) where customer_external_id is not null;

create or replace function public.assert_journal_entry_balanced(p_entry_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_debit numeric(18,2);v_credit numeric(18,2);v_lines integer;
begin
  select coalesce(sum(debit),0),coalesce(sum(credit),0),count(*) into v_debit,v_credit,v_lines
  from public.journal_entry_lines where journal_entry_id=p_entry_id;
  if v_lines<2 then raise exception 'JOURNAL_LINES_REQUIRED:%',p_entry_id; end if;
  if round(v_debit,2)<>round(v_credit,2) then raise exception 'JOURNAL_NOT_BALANCED:%:%:%',p_entry_id,v_debit,v_credit; end if;
  return jsonb_build_object('entryId',p_entry_id,'debit',v_debit,'credit',v_credit,'balanced',true,'lineCount',v_lines);
end $$;

create or replace function public.post_daily_report_accounting(p_batch_id uuid,p_actor text default 'system')
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_batch public.daily_report_batches%rowtype;
  v_sale record;v_cash record;v_entry uuid;v_account_debit uuid;v_account_credit uuid;
  v_sales integer:=0;v_collections integer:=0;v_total_debit numeric(18,2):=0;v_total_credit numeric(18,2):=0;
  v_ref text;v_source text;v_amount numeric(18,2);
begin
  select * into v_batch from public.daily_report_batches where id=p_batch_id for update;
  if not found then raise exception 'DAILY_REPORT_BATCH_NOT_FOUND:%',p_batch_id; end if;
  if v_batch.status<>'approved' then raise exception 'DAILY_REPORT_NOT_APPROVED:%',p_batch_id; end if;
  select id into v_account_debit from public.chart_of_accounts where account_code='110100' and active=true;
  if v_account_debit is null then raise exception 'ACCOUNT_RECEIVABLE_MISSING'; end if;

  for v_sale in select * from public.daily_report_sales_lines where batch_id=p_batch_id order by id loop
    v_amount:=round(coalesce(v_sale.amount,0),2);
    if v_amount<=0 then raise exception 'SALE_AMOUNT_INVALID:%',v_sale.id; end if;
    select id into v_account_credit from public.chart_of_accounts where account_code=case when v_sale.sales_type='block' then '410100' else '410200' end and active=true;
    if v_account_credit is null then raise exception 'SALES_ACCOUNT_MISSING:%',v_sale.sales_type; end if;
    v_source:=concat(p_batch_id,':sale:',v_sale.id);
    v_ref:=concat('JE-',to_char(v_batch.report_date,'YYYYMMDD'),'-S-',lpad(v_sale.id::text,8,'0'));
    insert into public.journal_entries(reference_no,entry_date,description,source_type,source_id,source_batch_id,status,posted_by,metadata)
    values(v_ref,v_batch.report_date,concat('فاتورة ',v_sale.invoice_no,' — ',v_sale.customer_name),'daily_report_sale',v_source,p_batch_id,'draft',p_actor,jsonb_build_object('invoiceNo',v_sale.invoice_no,'salesType',v_sale.sales_type,'sourceRowNo',v_sale.source_row_no))
    on conflict(source_type,source_id) do update set updated_at=now()
    returning id into v_entry;
    if not exists(select 1 from public.journal_entry_lines where journal_entry_id=v_entry) then
      insert into public.journal_entry_lines(journal_entry_id,line_no,account_id,debit,credit,customer_external_id,cost_center_code,memo,source_line_id) values
        (v_entry,1,v_account_debit,v_amount,0,v_sale.customer_code,v_sale.sales_type,concat('مديونية فاتورة ',v_sale.invoice_no),v_sale.id::text),
        (v_entry,2,v_account_credit,0,v_amount,v_sale.customer_code,v_sale.sales_type,concat('إيراد ',v_sale.item_name),v_sale.id::text);
    end if;
    perform public.assert_journal_entry_balanced(v_entry);
    update public.journal_entries set status='posted',posted_by=p_actor,posted_at=coalesce(posted_at,now()),updated_at=now() where id=v_entry and status='draft';
    v_sales:=v_sales+1;v_total_debit:=v_total_debit+v_amount;v_total_credit:=v_total_credit+v_amount;
  end loop;

  for v_cash in select * from public.daily_report_cash_movements where batch_id=p_batch_id and is_customer_collection=true order by id loop
    v_amount:=round(greatest(coalesce(v_cash.debit,0),coalesce(v_cash.credit,0)),2);
    if v_amount<=0 then raise exception 'COLLECTION_AMOUNT_INVALID:%',v_cash.id; end if;
    select id into v_account_debit from public.chart_of_accounts where account_code=case when v_cash.treasury_code='104' then '110204' else '110201' end and active=true;
    select id into v_account_credit from public.chart_of_accounts where account_code='110100' and active=true;
    if v_account_debit is null or v_account_credit is null then raise exception 'COLLECTION_ACCOUNT_MISSING:%',v_cash.treasury_code; end if;
    v_source:=concat(p_batch_id,':collection:',v_cash.id);
    v_ref:=concat('JE-',to_char(v_batch.report_date,'YYYYMMDD'),'-C-',lpad(v_cash.id::text,8,'0'));
    insert into public.journal_entries(reference_no,entry_date,description,source_type,source_id,source_batch_id,status,posted_by,metadata)
    values(v_ref,v_batch.report_date,concat('تحصيل ',v_cash.account_name,' — خزينة ',v_cash.treasury_code),'daily_report_collection',v_source,p_batch_id,'draft',p_actor,jsonb_build_object('treasuryCode',v_cash.treasury_code,'voucherNo',v_cash.voucher_no,'sourceRowNo',v_cash.source_row_no))
    on conflict(source_type,source_id) do update set updated_at=now()
    returning id into v_entry;
    if not exists(select 1 from public.journal_entry_lines where journal_entry_id=v_entry) then
      insert into public.journal_entry_lines(journal_entry_id,line_no,account_id,debit,credit,customer_external_id,cost_center_code,memo,source_line_id) values
        (v_entry,1,v_account_debit,v_amount,0,v_cash.account_code,'finance',concat('تحصيل خزينة ',v_cash.treasury_code),v_cash.id::text),
        (v_entry,2,v_account_credit,0,v_amount,v_cash.account_code,'finance',concat('تسوية ذمة ',v_cash.account_name),v_cash.id::text);
    end if;
    perform public.assert_journal_entry_balanced(v_entry);
    update public.journal_entries set status='posted',posted_by=p_actor,posted_at=coalesce(posted_at,now()),updated_at=now() where id=v_entry and status='draft';
    v_collections:=v_collections+1;v_total_debit:=v_total_debit+v_amount;v_total_credit:=v_total_credit+v_amount;
  end loop;

  insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details)
  values('system',coalesce(nullif(p_actor,''),'system'),'daily_report_accounting_posted','daily_report_batch',p_batch_id::text,jsonb_build_object('salesEntries',v_sales,'collectionEntries',v_collections,'totalDebit',v_total_debit,'totalCredit',v_total_credit))
  on conflict do nothing;
  return jsonb_build_object('batchId',p_batch_id,'salesEntries',v_sales,'collectionEntries',v_collections,'entryCount',v_sales+v_collections,'totalDebit',v_total_debit,'totalCredit',v_total_credit,'balanced',round(v_total_debit,2)=round(v_total_credit,2));
end $$;

create or replace function public.daily_report_accounting_trigger()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='approved' and old.status is distinct from new.status then
    perform public.post_daily_report_accounting(new.id,coalesce(new.approved_by,new.created_by,'system'));
  end if;
  return new;
end $$;

drop trigger if exists daily_report_accounting_post_trigger on public.daily_report_batches;
create trigger daily_report_accounting_post_trigger
after update of status on public.daily_report_batches
for each row execute function public.daily_report_accounting_trigger();

create or replace view public.general_ledger as
select je.id journal_entry_id,je.reference_no,je.entry_date,je.description,je.source_type,je.source_id,je.source_batch_id,je.status,je.currency,
  jel.line_no,coa.account_code,coa.account_name_ar,coa.account_type,jel.debit,jel.credit,jel.customer_external_id,jel.cost_center_code,jel.memo,
  sum(case when coa.normal_side='debit' then jel.debit-jel.credit else jel.credit-jel.debit end)
    over(partition by coa.account_code order by je.entry_date,je.created_at,je.id,jel.line_no rows unbounded preceding) running_balance
from public.journal_entries je
join public.journal_entry_lines jel on jel.journal_entry_id=je.id
join public.chart_of_accounts coa on coa.id=jel.account_id
where je.status='posted';

create or replace view public.trial_balance as
select coa.account_code,coa.account_name_ar,coa.account_type,coa.normal_side,
  coalesce(sum(jel.debit),0)::numeric(18,2) total_debit,
  coalesce(sum(jel.credit),0)::numeric(18,2) total_credit,
  case when coa.normal_side='debit' then coalesce(sum(jel.debit-jel.credit),0) else coalesce(sum(jel.credit-jel.debit),0) end::numeric(18,2) balance
from public.chart_of_accounts coa
left join public.journal_entry_lines jel on jel.account_id=coa.id
left join public.journal_entries je on je.id=jel.journal_entry_id and je.status='posted'
where coa.active=true
group by coa.account_code,coa.account_name_ar,coa.account_type,coa.normal_side;

create or replace view public.accounting_integrity_report as
select
  (select count(*) from public.journal_entries where status='draft') draft_entries,
  (select count(*) from public.journal_entries where status='posted') posted_entries,
  (select count(*) from public.journal_entries je where je.status='posted' and not exists(select 1 from public.journal_entry_lines l where l.journal_entry_id=je.id)) entries_without_lines,
  (select count(*) from (select journal_entry_id from public.journal_entry_lines group by journal_entry_id having round(sum(debit),2)<>round(sum(credit),2)) x) unbalanced_entries,
  (select coalesce(sum(total_debit),0) from public.trial_balance) total_debit,
  (select coalesce(sum(total_credit),0) from public.trial_balance) total_credit;

alter table public.imports add column if not exists processing_started_at timestamptz;
alter table public.imports add column if not exists completed_at timestamptz;
alter table public.imports add column if not exists approved_by text;
alter table public.imports add column if not exists approved_at timestamptz;
alter table public.imports add column if not exists posted_batch_id uuid references public.daily_report_batches(id) on delete set null;
alter table public.imports add column if not exists result_summary jsonb not null default '{}'::jsonb;
alter table public.imports add column if not exists last_error_code text;
alter table public.imports add column if not exists last_error_message text;
alter table public.imports drop constraint if exists imports_status_check;
alter table public.imports add constraint imports_status_check check(status in ('received','validating','validation_failed','ready_for_review','approved','processing','posted','partially_failed','rejected','failed','reversed','ready','opened_in_program')) not valid;
create index if not exists imports_posted_batch_idx on public.imports(posted_batch_id) where posted_batch_id is not null;
create index if not exists imports_processing_idx on public.imports(status,processing_started_at,updated_at);

create or replace function public.transition_import_status(p_import_id uuid,p_next_status text,p_actor text,p_note text default null,p_posted_batch_id uuid default null,p_result jsonb default '{}'::jsonb)
returns public.imports language plpgsql security definer set search_path=public as $$
declare v_row public.imports%rowtype;v_allowed boolean:=false;
begin
  perform pg_advisory_xact_lock(hashtext('import:'||p_import_id::text));
  select * into v_row from public.imports where id=p_import_id for update;
  if not found then raise exception 'IMPORT_NOT_FOUND:%',p_import_id; end if;
  if v_row.status=p_next_status then return v_row; end if;
  v_allowed:=case v_row.status
    when 'received' then p_next_status in ('validating','failed','rejected')
    when 'validating' then p_next_status in ('validation_failed','ready_for_review','failed')
    when 'validation_failed' then p_next_status in ('validating','rejected','failed')
    when 'ready' then p_next_status in ('ready_for_review','processing','rejected','failed','opened_in_program')
    when 'ready_for_review' then p_next_status in ('approved','processing','rejected','failed','opened_in_program')
    when 'opened_in_program' then p_next_status in ('approved','processing','rejected','failed')
    when 'approved' then p_next_status in ('processing','posted','failed')
    when 'processing' then p_next_status in ('posted','partially_failed','failed')
    when 'partially_failed' then p_next_status in ('processing','reversed','failed')
    when 'failed' then p_next_status in ('validating','processing','rejected')
    when 'posted' then p_next_status='reversed'
    else false end;
  if not v_allowed then raise exception 'IMPORT_STATUS_TRANSITION_INVALID:%:%',v_row.status,p_next_status; end if;
  update public.imports set status=p_next_status,updated_at=now(),
    processing_started_at=case when p_next_status='processing' then now() else processing_started_at end,
    completed_at=case when p_next_status in ('posted','rejected','failed','reversed') then now() else completed_at end,
    approved_by=case when p_next_status in ('approved','processing','posted') then coalesce(approved_by,p_actor) else approved_by end,
    approved_at=case when p_next_status in ('approved','processing','posted') then coalesce(approved_at,now()) else approved_at end,
    posted_batch_id=coalesce(p_posted_batch_id,posted_batch_id),
    result_summary=coalesce(result_summary,'{}'::jsonb)||coalesce(p_result,'{}'::jsonb)||case when p_note is null then '{}'::jsonb else jsonb_build_object('lastStatusNote',left(p_note,500),'lastStatusActor',p_actor,'lastStatusAt',now()) end,
    last_error_code=case when p_next_status in ('failed','partially_failed','validation_failed') then coalesce(p_result->>'errorCode',last_error_code) else null end,
    last_error_message=case when p_next_status in ('failed','partially_failed','validation_failed') then left(coalesce(p_result->>'errorMessage',p_note,last_error_message),1000) else null end
  where id=p_import_id returning * into v_row;
  insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details)
  values('system',coalesce(nullif(p_actor,''),'system'),'import_status_transition','import',p_import_id::text,jsonb_build_object('status',p_next_status,'postedBatchId',p_posted_batch_id,'note',left(coalesce(p_note,''),500)));
  return v_row;
end $$;

create table if not exists public.telegram_update_receipts (
  update_id text primary key,
  payload_kind text,
  status text not null default 'received' check(status in ('received','processing','completed','failed')),
  attempts integer not null default 0,
  retryable boolean not null default false,
  last_error_code text,
  last_error_message text,
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists telegram_update_receipts_status_idx on public.telegram_update_receipts(status,retryable,updated_at);

create or replace function public.claim_telegram_update(p_update_id text,p_payload_kind text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v public.telegram_update_receipts%rowtype;v_claimed boolean:=false;
begin
  if nullif(trim(p_update_id),'') is null then raise exception 'TELEGRAM_UPDATE_ID_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtext('telegram-update:'||p_update_id));
  select * into v from public.telegram_update_receipts where update_id=p_update_id for update;
  if not found then
    insert into public.telegram_update_receipts(update_id,payload_kind,status,attempts,claimed_at,updated_at)
    values(p_update_id,p_payload_kind,'processing',1,now(),now()) returning * into v;v_claimed:=true;
  elsif v.status='completed' then v_claimed:=false;
  elsif v.status='processing' and v.updated_at>now()-interval '2 minutes' then v_claimed:=false;
  else
    update public.telegram_update_receipts set status='processing',payload_kind=coalesce(p_payload_kind,payload_kind),attempts=attempts+1,retryable=false,last_error_code=null,last_error_message=null,claimed_at=now(),updated_at=now() where update_id=p_update_id returning * into v;v_claimed:=true;
  end if;
  return jsonb_build_object('updateId',v.update_id,'claimed',v_claimed,'duplicate',not v_claimed,'status',v.status,'attempts',v.attempts);
end $$;

create or replace function public.complete_telegram_update(p_update_id text)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.telegram_update_receipts set status='completed',retryable=false,completed_at=now(),updated_at=now(),last_error_code=null,last_error_message=null where update_id=p_update_id;
end $$;

create or replace function public.fail_telegram_update(p_update_id text,p_error_code text,p_error_message text,p_retryable boolean default true)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.telegram_update_receipts set status='failed',retryable=coalesce(p_retryable,true),last_error_code=left(coalesce(p_error_code,'PROCESSING_FAILED'),120),last_error_message=left(coalesce(p_error_message,'Unexpected processing failure'),1000),updated_at=now() where update_id=p_update_id;
end $$;

-- Backfill accounting for previously approved daily reports. Any failure aborts the migration transaction.
do $$ declare r record;begin
  for r in select id,coalesce(approved_by,created_by,'migration-019') actor from public.daily_report_batches where status='approved' order by report_date,id loop
    perform public.post_daily_report_accounting(r.id,r.actor);
  end loop;
end $$;

insert into public.role_capabilities(role,capability) values
  ('manager','accounting.view'),('accountant','accounting.view'),('accountant','accounting.post')
on conflict(role,capability) do update set allowed=true;

alter table public.chart_of_accounts enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_entry_lines enable row level security;
alter table public.telegram_update_receipts enable row level security;
revoke all on public.chart_of_accounts,public.journal_entries,public.journal_entry_lines,public.telegram_update_receipts from anon,authenticated;
revoke all on function public.assert_journal_entry_balanced(uuid) from public,anon,authenticated;
revoke all on function public.post_daily_report_accounting(uuid,text) from public,anon,authenticated;
revoke all on function public.daily_report_accounting_trigger() from public,anon,authenticated;
revoke all on function public.transition_import_status(uuid,text,text,text,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.claim_telegram_update(text,text) from public,anon,authenticated;
revoke all on function public.complete_telegram_update(text) from public,anon,authenticated;
revoke all on function public.fail_telegram_update(text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.assert_journal_entry_balanced(uuid),public.post_daily_report_accounting(uuid,text),public.transition_import_status(uuid,text,text,text,uuid,jsonb),public.claim_telegram_update(text,text),public.complete_telegram_update(text),public.fail_telegram_update(text,text,text,boolean) to service_role;

-- Additional Schema 19 features merged from the same release.
+-- Bin Hamid Factory Control — secure Telegram invitations and mix design costing
-- Run after 018_governance_safety_refinements.sql.
-- Idempotent and non-destructive. Existing production rows are never deleted.

create extension if not exists pgcrypto;

create table if not exists public.user_invitations (
  id uuid primary key default gen_random_uuid(),
  phone_normalized text not null check (phone_normalized ~ '^\+[1-9][0-9]{7,14}$'),
  full_name text not null check (char_length(trim(full_name)) between 3 and 160),
  employee_external_id text,
  requested_role text not null check (requested_role in ('admin','manager','accountant','block_sales','concrete_sales','mechanic','fuel_operator','hr','procurement','driver','employee','collector','warehouse','quality')),
  requested_capabilities jsonb not null default '[]'::jsonb check (jsonb_typeof(requested_capabilities)='array'),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  token_prefix text not null check (char_length(token_prefix) between 6 and 16),
  expires_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','opened','accepted_pending_approval','approved','expired','revoked','rejected')),
  created_by text not null,
  created_at timestamptz not null default now(),
  accepted_by_telegram_id text,
  accepted_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  revoked_by text,
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  check (expires_at>created_at),
  check (not (requested_capabilities ? '*'))
);
create unique index if not exists user_invitations_open_phone_uidx
  on public.user_invitations(phone_normalized)
  where status in ('pending','opened','accepted_pending_approval');
create index if not exists user_invitations_status_idx on public.user_invitations(status,expires_at,created_at desc);
create index if not exists user_invitations_telegram_idx on public.user_invitations(accepted_by_telegram_id,status);

create or replace function public.accept_user_invitation(p_token_hash text,p_telegram_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row public.user_invitations%rowtype;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or nullif(trim(p_telegram_id),'') is null then raise exception 'INVITATION_INPUT_INVALID'; end if;
  select * into v_row from public.user_invitations where token_hash=p_token_hash for update;
  if not found then raise exception 'INVITATION_NOT_FOUND'; end if;
  if v_row.status in ('approved','revoked','rejected','expired') then raise exception 'INVITATION_NOT_USABLE:%',v_row.status; end if;
  if v_row.expires_at<=now() then raise exception 'INVITATION_EXPIRED'; end if;
  if v_row.accepted_by_telegram_id is not null and v_row.accepted_by_telegram_id<>p_telegram_id then raise exception 'INVITATION_ALREADY_ACCEPTED'; end if;
  update public.user_invitations
  set status='accepted_pending_approval',accepted_by_telegram_id=p_telegram_id,accepted_at=coalesce(accepted_at,now()),metadata=metadata||jsonb_build_object('last_opened_at',now())
  where id=v_row.id returning * into v_row;
  return to_jsonb(v_row)-'token_hash';
end $$;

create table if not exists public.mix_materials (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_ar text not null,
  name_en text,
  category text not null check (category in ('cement','sand','aggregate','water','admixture','fly_ash','silica','ice','other')),
  base_unit text not null check (base_unit in ('kg','ton','liter','m3','bag')),
  density numeric(18,6) check (density is null or density>0),
  bag_weight_kg numeric(18,6) check (bag_weight_kg is null or bag_weight_kg>0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mix_material_prices (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.mix_materials(id) on delete restrict,
  supplier_id text,
  price numeric(18,6) not null check (price>=0),
  price_unit text not null check (price_unit in ('kg','ton','liter','m3','bag')),
  effective_from date not null,
  effective_to date,
  transport_cost numeric(18,6) not null default 0 check (transport_cost>=0),
  handling_cost numeric(18,6) not null default 0 check (handling_cost>=0),
  wastage_percent numeric(9,4) not null default 0 check (wastage_percent between 0 and 100),
  vat_included boolean not null default false,
  vat_rate numeric(9,4) not null default 15 check (vat_rate between 0 and 100),
  currency text not null default 'SAR',
  source_reference text,
  approved boolean not null default false,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to>=effective_from)
);
create unique index if not exists mix_material_prices_identity_uidx on public.mix_material_prices(material_id,effective_from,price_unit,coalesce(supplier_id,''));
create index if not exists mix_material_prices_lookup_idx on public.mix_material_prices(material_id,approved,effective_from desc,effective_to);

create or replace function public.guard_mix_material_price_overlap()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.approved and exists(
    select 1 from public.mix_material_prices p
    where p.material_id=new.material_id and p.approved and p.id<>new.id
      and daterange(p.effective_from,coalesce(p.effective_to,'infinity'::date),'[]') && daterange(new.effective_from,coalesce(new.effective_to,'infinity'::date),'[]')
  ) then raise exception 'MIX_MATERIAL_PRICE_PERIOD_OVERLAP'; end if;
  return new;
end $$;
drop trigger if exists mix_material_price_overlap_guard on public.mix_material_prices;
create trigger mix_material_price_overlap_guard before insert or update of material_id,effective_from,effective_to,approved on public.mix_material_prices for each row execute function public.guard_mix_material_price_overlap();

create table if not exists public.mix_designs (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  product_type text not null default 'concrete' check (product_type in ('concrete','block','other')),
  strength_class text,
  unit text not null default 'm3' check (unit in ('m3','unit','batch')),
  yield_m3 numeric(18,6) not null default 1 check (yield_m3>0),
  version_no integer not null default 1 check (version_no>0),
  status text not null default 'draft' check (status in ('draft','pending_approval','approved','archived')),
  effective_from date,
  effective_to date,
  notes text,
  created_by text not null,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(code,version_no),
  check (effective_to is null or effective_from is null or effective_to>=effective_from)
);
create index if not exists mix_designs_status_idx on public.mix_designs(status,code,version_no desc);

create or replace function public.guard_approved_mix_design_update()
returns trigger language plpgsql set search_path=public as $$
begin
  if old.status='approved' and not (
    new.status='archived' and new.code=old.code and new.name=old.name and new.product_type=old.product_type and
    new.strength_class is not distinct from old.strength_class and new.unit=old.unit and new.yield_m3=old.yield_m3 and
    new.version_no=old.version_no and new.effective_from is not distinct from old.effective_from and
    new.effective_to is not distinct from old.effective_to and new.notes is not distinct from old.notes and
    new.created_by=old.created_by and new.approved_by is not distinct from old.approved_by and new.approved_at is not distinct from old.approved_at
  ) then raise exception 'APPROVED_MIX_DESIGN_IMMUTABLE'; end if;
  return new;
end $$;
drop trigger if exists approved_mix_design_update_guard on public.mix_designs;
create trigger approved_mix_design_update_guard before update on public.mix_designs for each row execute function public.guard_approved_mix_design_update();

create table if not exists public.mix_design_items (
  id uuid primary key default gen_random_uuid(),
  mix_design_id uuid not null references public.mix_designs(id) on delete cascade,
  material_id uuid not null references public.mix_materials(id) on delete restrict,
  quantity numeric(18,6) not null check (quantity>0),
  unit text not null check (unit in ('kg','ton','liter','m3','bag')),
  wastage_percent_override numeric(9,4) check (wastage_percent_override is null or wastage_percent_override between 0 and 100),
  sequence_no integer not null default 1,
  notes text,
  created_at timestamptz not null default now(),
  unique(mix_design_id,material_id,sequence_no)
);
create index if not exists mix_design_items_design_idx on public.mix_design_items(mix_design_id,sequence_no);

create table if not exists public.mix_design_overheads (
  id uuid primary key default gen_random_uuid(),
  mix_design_id uuid not null references public.mix_designs(id) on delete cascade,
  cost_type text not null check (cost_type in ('production_labor','batching_energy','loader','pump','quality_testing','depreciation','maintenance','delivery','other')),
  amount numeric(18,6) not null check (amount>=0),
  allocation_basis text not null check (allocation_basis in ('per_m3','per_batch','percentage_material_cost','fixed')),
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists mix_design_overheads_design_idx on public.mix_design_overheads(mix_design_id,cost_type);

create table if not exists public.mix_cost_calculation_runs (
  id uuid primary key default gen_random_uuid(),
  mix_design_id uuid not null references public.mix_designs(id) on delete restrict,
  calculated_at timestamptz not null default now(),
  price_date date not null,
  material_cost numeric(18,6) not null default 0,
  wastage_cost numeric(18,6) not null default 0,
  overhead_cost numeric(18,6) not null default 0,
  delivery_cost numeric(18,6) not null default 0,
  total_cost_per_m3 numeric(18,6) not null default 0,
  recommended_price numeric(18,6),
  target_margin_percent numeric(9,4) check (target_margin_percent is null or target_margin_percent>=0 and target_margin_percent<100),
  markup_percent numeric(9,4),
  snapshot jsonb not null,
  actor text not null,
  status text not null default 'calculated' check (status in ('calculated','approved','superseded','failed'))
);
create index if not exists mix_cost_runs_design_idx on public.mix_cost_calculation_runs(mix_design_id,calculated_at desc);

create or replace view public.mix_design_latest_cost as
select distinct on (r.mix_design_id)
  r.mix_design_id,d.code,d.name,d.version_no,d.status as design_status,r.price_date,r.material_cost,r.wastage_cost,r.overhead_cost,r.delivery_cost,r.total_cost_per_m3,r.recommended_price,r.target_margin_percent,r.markup_percent,r.calculated_at,r.status as calculation_status
from public.mix_cost_calculation_runs r
join public.mix_designs d on d.id=r.mix_design_id
where r.status in ('calculated','approved')
order by r.mix_design_id,r.calculated_at desc;

insert into public.role_capabilities(role,capability) values
  ('manager','costs.customer_profitability.view'),
  ('accountant','costs.customer_profitability.view'),
  ('manager','mix_design.view'),('manager','mix_design.calculate'),('manager','mix_design.approve'),
  ('accountant','mix_design.view'),('accountant','mix_design.calculate'),('accountant','mix_material_prices.manage'),
  ('quality','mix_design.view'),('quality','mix_design.manage'),
  ('concrete_sales','mix_design.price.view'),
  ('manager','users.invite.create'),('manager','users.invite.view')
on conflict(role,capability) do update set allowed=true;

+insert into public.migration_history(version,migration_name)
values(19,'019_accounting_import_and_telegram_integrity')
on conflict(version) do update set migration_name=excluded.migration_name;
