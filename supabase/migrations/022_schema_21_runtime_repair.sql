-- Bin Hamid Factory Control — repair incomplete Schema 21 runtime contracts.
-- This migration is idempotent and preserves all existing operational rows.
-- It repairs function signatures and Telegram receipt storage that were absent
-- in production despite migration_history reporting Schema 21.

do $$ begin
  if not exists(select 1 from public.migration_history where version=21) then
    raise exception 'MIGRATION_021_REQUIRED';
  end if;
end $$;

-- Public-schema backups intentionally exclude database-level extensions.
-- Recreate the trusted extension before any restored report identity function runs.
create extension if not exists pgcrypto;

-- Recreate the complete accounting contract when the historical migration
-- record exists but its objects are absent (the condition found in production).
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

-- Keep the ledger view and reversal behaviour aligned with the final Schema 21 contract.
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

create or replace view public.accounting_integrity_report as
select
  (select count(*) from public.journal_entries where status='draft') draft_entries,
  (select count(*) from public.journal_entries where status='posted') posted_entries,
  (select count(*) from public.journal_entries e where e.status in ('posted','reversed') and not exists(select 1 from public.journal_entry_lines l where l.journal_entry_id=e.id)) entries_without_lines,
  (select count(*) from (select l.journal_entry_id from public.journal_entry_lines l join public.journal_entries e on e.id=l.journal_entry_id where e.status in ('posted','reversed') group by l.journal_entry_id having round(sum(l.debit),2)<>round(sum(l.credit),2)) x) unbalanced_entries,
  (select coalesce(sum(total_debit),0) from public.trial_balance) total_debit,
  (select coalesce(sum(total_credit),0) from public.trial_balance) total_credit,
  (select count(*) from public.journal_entries where status='reversed') reversed_entries;

create or replace function public.reverse_journal_entry(p_entry_id uuid,p_actor text,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_original public.journal_entries%rowtype;v_reversal uuid;v_reference text;v_line record;
begin
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'REVERSAL_REASON_REQUIRED'; end if;
  select * into v_original from public.journal_entries where id=p_entry_id for update;
  if not found then raise exception 'JOURNAL_ENTRY_NOT_FOUND:%',p_entry_id; end if;
  if v_original.status='reversed' then
    select id,reference_no into v_reversal,v_reference from public.journal_entries where reversal_of=p_entry_id order by created_at desc limit 1;
    return jsonb_build_object('ok',true,'duplicate',true,'originalEntryId',p_entry_id,'reversalEntryId',v_reversal,'referenceNo',v_reference);
  end if;
  if v_original.status<>'posted' then raise exception 'ONLY_POSTED_JOURNAL_CAN_BE_REVERSED:%',p_entry_id; end if;
  v_reference:=concat('RV-',v_original.reference_no);
  insert into public.journal_entries(reference_no,entry_date,description,source_type,source_id,source_batch_id,currency,status,posted_by,reversal_of,metadata)
  values(v_reference,current_date,concat('عكس: ',v_original.description),'journal_reversal',p_entry_id::text,v_original.source_batch_id,v_original.currency,'draft',p_actor,p_entry_id,jsonb_build_object('reason',left(p_reason,1000),'originalReference',v_original.reference_no))
  on conflict(source_type,source_id) do update set updated_at=now()
  returning id into v_reversal;
  if not exists(select 1 from public.journal_entry_lines where journal_entry_id=v_reversal) then
    for v_line in select * from public.journal_entry_lines where journal_entry_id=p_entry_id order by line_no loop
      insert into public.journal_entry_lines(journal_entry_id,line_no,account_id,debit,credit,customer_external_id,cost_center_code,memo,source_line_id)
      values(v_reversal,v_line.line_no,v_line.account_id,v_line.credit,v_line.debit,v_line.customer_external_id,v_line.cost_center_code,concat('عكس — ',coalesce(v_line.memo,'')),v_line.source_line_id);
    end loop;
  end if;
  perform public.assert_journal_entry_balanced(v_reversal);
  update public.journal_entries set status='posted',posted_by=p_actor,posted_at=coalesce(posted_at,now()),updated_at=now() where id=v_reversal;
  update public.journal_entries set status='reversed',updated_at=now() where id=p_entry_id;
  insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details)
  values('web',coalesce(nullif(p_actor,''),'system'),'journal_entry_reversed','journal_entry',p_entry_id::text,jsonb_build_object('reversalEntryId',v_reversal,'referenceNo',v_reference,'reason',left(p_reason,1000)));
  return jsonb_build_object('ok',true,'duplicate',false,'originalEntryId',p_entry_id,'reversalEntryId',v_reversal,'referenceNo',v_reference);
end $$;

revoke all on function public.commit_daily_report(date,text,text,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.register_daily_report_attempt(date,text,text,text,text,text,uuid,jsonb,jsonb,jsonb,text) from public,anon,authenticated;
revoke all on function public.commit_daily_report_acceptance(date,text,text,text,jsonb,text,text,jsonb,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.commit_daily_report(date,text,text,text,jsonb,text),public.register_daily_report_attempt(date,text,text,text,text,text,uuid,jsonb,jsonb,jsonb,text),public.commit_daily_report_acceptance(date,text,text,text,jsonb,text,text,jsonb,jsonb,text,uuid) to service_role;
revoke all on function public.reverse_journal_entry(uuid,text,text) from public,anon,authenticated;
grant execute on function public.reverse_journal_entry(uuid,text,text) to service_role;

alter table public.telegram_update_receipts enable row level security;
revoke all on public.telegram_update_receipts from public,anon,authenticated;
revoke all on function public.transition_import_status(uuid,text,text,text,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.claim_telegram_update(text,text) from public,anon,authenticated;
revoke all on function public.complete_telegram_update(text) from public,anon,authenticated;
revoke all on function public.fail_telegram_update(text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.transition_import_status(uuid,text,text,text,uuid,jsonb),public.claim_telegram_update(text,text),public.complete_telegram_update(text),public.fail_telegram_update(text,text,text,boolean) to service_role;

insert into public.migration_history(version,migration_name)
values(22,'022_schema_21_runtime_repair')
on conflict(version) do update set migration_name=excluded.migration_name;
