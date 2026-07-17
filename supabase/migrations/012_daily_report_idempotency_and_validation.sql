-- Bin Hamid Factory Control — database-level daily report validation and idempotency
-- Run after 011_cost_centers_and_operational_resilience.sql.
-- Idempotent and non-destructive. Historical duplicate rows remain traceable.

create extension if not exists pgcrypto;

alter table public.daily_report_batches add column if not exists file_storage_path text;
alter table public.daily_report_batches add column if not exists uploaded_by text;
alter table public.daily_report_batches add column if not exists approved_by text;
alter table public.daily_report_batches add column if not exists approved_at timestamptz;
alter table public.daily_report_batches add column if not exists rejection_reason text;
alter table public.daily_report_batches add column if not exists validation_errors jsonb not null default '[]'::jsonb;
alter table public.daily_report_batches add column if not exists validation_warnings jsonb not null default '[]'::jsonb;
alter table public.daily_report_batches add column if not exists preview_summary jsonb not null default '{}'::jsonb;

alter table public.daily_report_sales_lines add column if not exists line_identity text;
alter table public.daily_report_cash_movements add column if not exists line_identity text;

create table if not exists public.daily_report_import_attempts (
  id uuid primary key default gen_random_uuid(),
  report_date date,
  original_name text,
  file_hash text,
  content_hash text,
  idempotency_key text,
  status text not null check (status in ('previewed','approved','duplicate','rejected','failed')),
  existing_batch_id uuid references public.daily_report_batches(id) on delete set null,
  summary jsonb not null default '{}'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  actor text,
  created_at timestamptz not null default now()
);

create unique index if not exists daily_report_attempt_idempotency_uidx
  on public.daily_report_import_attempts(idempotency_key)
  where idempotency_key is not null and status in ('approved','duplicate');
create index if not exists daily_report_attempt_date_idx
  on public.daily_report_import_attempts(report_date,created_at desc,status);

create or replace function public.daily_sale_identity(
  p_invoice_no text,p_customer_code text,p_sales_type text,p_quantity numeric,p_amount numeric
) returns text language sql immutable as $$
  select encode(digest(concat_ws('|',trim(coalesce(p_invoice_no,'')),trim(coalesce(p_customer_code,'')),trim(coalesce(p_sales_type,'')),round(coalesce(p_quantity,0),3)::text,round(coalesce(p_amount,0),2)::text),'sha256'),'hex');
$$;

create or replace function public.daily_cash_identity(
  p_treasury_code text,p_account_code text,p_voucher_no text,p_movement_type text,p_debit numeric,p_credit numeric,p_movement_date_text text
) returns text language sql immutable as $$
  select encode(digest(concat_ws('|',trim(coalesce(p_treasury_code,'')),trim(coalesce(p_account_code,'')),trim(coalesce(p_voucher_no,'')),trim(coalesce(p_movement_type,'')),round(coalesce(p_debit,0),2)::text,round(coalesce(p_credit,0),2)::text,trim(coalesce(p_movement_date_text,''))),'sha256'),'hex');
$$;

create or replace function public.validate_daily_report_sale_line()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if nullif(trim(new.customer_code),'') is null then raise exception 'DAILY_REPORT_CUSTOMER_CODE_REQUIRED'; end if;
  if not exists(select 1 from public.customers c where c.active=true and (c.external_id=new.customer_code or c.customer_code=new.customer_code)) then
    raise exception 'DAILY_REPORT_UNKNOWN_CUSTOMER_CODE:%',new.customer_code;
  end if;
  if new.sales_type not in ('block','concrete') then raise exception 'DAILY_REPORT_UNSUPPORTED_SALES_TYPE:%',new.sales_type; end if;
  if coalesce(new.quantity,0)<=0 then raise exception 'DAILY_REPORT_INVALID_QUANTITY'; end if;
  if coalesce(new.amount,0)<=0 then raise exception 'DAILY_REPORT_INVALID_AMOUNT'; end if;
  new.line_identity:=public.daily_sale_identity(new.invoice_no,new.customer_code,new.sales_type,new.quantity,new.amount);
  return new;
end $$;

drop trigger if exists daily_report_sale_validation_trigger on public.daily_report_sales_lines;
create trigger daily_report_sale_validation_trigger
before insert or update of invoice_no,customer_code,sales_type,quantity,amount on public.daily_report_sales_lines
for each row execute function public.validate_daily_report_sale_line();

create or replace function public.validate_daily_report_cash_line()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.treasury_code not in ('101','104') and coalesce(new.is_customer_collection,false) then raise exception 'DAILY_REPORT_UNSUPPORTED_COLLECTION_TREASURY:%',new.treasury_code; end if;
  if coalesce(new.is_customer_collection,false) and nullif(trim(new.account_code),'') is null then raise exception 'DAILY_REPORT_COLLECTION_CUSTOMER_CODE_REQUIRED'; end if;
  if coalesce(new.is_customer_collection,false) and not exists(select 1 from public.customers c where c.active=true and (c.external_id=new.account_code or c.customer_code=new.account_code)) then raise exception 'DAILY_REPORT_UNKNOWN_COLLECTION_CUSTOMER:%',new.account_code; end if;
  if coalesce(new.debit,0)<0 or coalesce(new.credit,0)<0 then raise exception 'DAILY_REPORT_NEGATIVE_CASH_VALUE'; end if;
  new.line_identity:=public.daily_cash_identity(new.treasury_code,new.account_code,new.voucher_no,new.movement_type,new.debit,new.credit,new.movement_date_text);
  return new;
end $$;

drop trigger if exists daily_report_cash_validation_trigger on public.daily_report_cash_movements;
create trigger daily_report_cash_validation_trigger
before insert or update of treasury_code,account_code,voucher_no,movement_type,debit,credit,movement_date_text,is_customer_collection on public.daily_report_cash_movements
for each row execute function public.validate_daily_report_cash_line();

-- Backfill only the first occurrence of each historical identity. Additional historical
-- duplicates remain NULL and visible for audit instead of making the migration fail.
with ranked as (
  select id,public.daily_sale_identity(invoice_no,customer_code,sales_type,quantity,amount) identity,
    row_number() over(partition by public.daily_sale_identity(invoice_no,customer_code,sales_type,quantity,amount) order by id) rn
  from public.daily_report_sales_lines where line_identity is null and customer_code is not null
) update public.daily_report_sales_lines s set line_identity=r.identity from ranked r where s.id=r.id and r.rn=1;

with ranked as (
  select id,public.daily_cash_identity(treasury_code,account_code,voucher_no,movement_type,debit,credit,movement_date_text) identity,
    row_number() over(partition by public.daily_cash_identity(treasury_code,account_code,voucher_no,movement_type,debit,credit,movement_date_text) order by id) rn
  from public.daily_report_cash_movements where line_identity is null
) update public.daily_report_cash_movements c set line_identity=r.identity from ranked r where c.id=r.id and r.rn=1;

create unique index if not exists daily_report_sales_identity_uidx
  on public.daily_report_sales_lines(line_identity) where line_identity is not null;
create unique index if not exists daily_report_cash_identity_uidx
  on public.daily_report_cash_movements(line_identity) where line_identity is not null;

alter table public.daily_report_sales_lines drop constraint if exists daily_report_sales_positive_quantity;
alter table public.daily_report_sales_lines add constraint daily_report_sales_positive_quantity check (quantity>0) not valid;
alter table public.daily_report_sales_lines drop constraint if exists daily_report_sales_positive_amount;
alter table public.daily_report_sales_lines add constraint daily_report_sales_positive_amount check (amount>0) not valid;
alter table public.daily_report_cash_movements drop constraint if exists daily_report_cash_nonnegative;
alter table public.daily_report_cash_movements add constraint daily_report_cash_nonnegative check (debit>=0 and credit>=0) not valid;

create or replace function public.register_daily_report_attempt(
  p_report_date date,p_original_name text,p_file_hash text,p_content_hash text,p_idempotency_key text,
  p_status text,p_existing_batch_id uuid,p_summary jsonb,p_errors jsonb,p_warnings jsonb,p_actor text
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  insert into public.daily_report_import_attempts(report_date,original_name,file_hash,content_hash,idempotency_key,status,existing_batch_id,summary,errors,warnings,actor)
  values(p_report_date,p_original_name,p_file_hash,p_content_hash,p_idempotency_key,p_status,p_existing_batch_id,coalesce(p_summary,'{}'::jsonb),coalesce(p_errors,'[]'::jsonb),coalesce(p_warnings,'[]'::jsonb),p_actor)
  on conflict(idempotency_key) where idempotency_key is not null and status in ('approved','duplicate')
  do update set existing_batch_id=coalesce(excluded.existing_batch_id,daily_report_import_attempts.existing_batch_id),summary=excluded.summary,warnings=excluded.warnings
  returning id into v_id;
  return v_id;
end $$;

insert into public.migration_history(version,migration_name) values(12,'012_daily_report_idempotency_and_validation')
on conflict(version) do update set migration_name=excluded.migration_name;

alter table public.daily_report_import_attempts enable row level security;
revoke all on public.daily_report_import_attempts from anon,authenticated;
revoke all on function public.daily_sale_identity(text,text,text,numeric,numeric) from anon,authenticated;
revoke all on function public.daily_cash_identity(text,text,text,text,numeric,numeric,text) from anon,authenticated;
revoke all on function public.validate_daily_report_sale_line() from anon,authenticated;
revoke all on function public.validate_daily_report_cash_line() from anon,authenticated;
revoke all on function public.register_daily_report_attempt(date,text,text,text,text,text,uuid,jsonb,jsonb,jsonb,text) from anon,authenticated;
