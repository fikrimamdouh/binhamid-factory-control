-- Bin Hamid Factory Control — repair incomplete Schema 21 runtime contracts.
-- This migration is idempotent and preserves all existing operational rows.
-- It repairs function signatures and Telegram receipt storage that were absent
-- in production despite migration_history reporting Schema 21.

do $$ begin
  if not exists(select 1 from public.migration_history where version=21) then
    raise exception 'MIGRATION_021_REQUIRED';
  end if;
end $$;

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

revoke all on function public.commit_daily_report(date,text,text,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.register_daily_report_attempt(date,text,text,text,text,text,uuid,jsonb,jsonb,jsonb,text) from public,anon,authenticated;
revoke all on function public.commit_daily_report_acceptance(date,text,text,text,jsonb,text,text,jsonb,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.commit_daily_report(date,text,text,text,jsonb,text),public.register_daily_report_attempt(date,text,text,text,text,text,uuid,jsonb,jsonb,jsonb,text),public.commit_daily_report_acceptance(date,text,text,text,jsonb,text,text,jsonb,jsonb,text,uuid) to service_role;

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
