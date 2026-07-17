-- Bin Hamid Factory Control — create customer master records atomically from approved daily reports
-- Run after 014_fifo_replay_and_maintenance_trigger_guard.sql.
-- Idempotent and non-destructive. Existing customer names, limits and payment terms are never overwritten.

do $$
begin
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='daily_report_sales_lines' and column_name='customer_name') then
    raise exception 'DAILY_REPORT_SALES_CUSTOMER_NAME_COLUMN_MISSING';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='daily_report_cash_movements' and column_name='account_name') then
    raise exception 'DAILY_REPORT_CASH_ACCOUNT_NAME_COLUMN_MISSING';
  end if;
end $$;

create or replace function public.ensure_daily_report_customer(p_code text,p_name text)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_code text:=nullif(trim(coalesce(p_code,'')),'');
  v_name text:=nullif(regexp_replace(trim(coalesce(p_name,'')),'\s+',' ','g'),'');
  v_customer public.customers%rowtype;
begin
  if v_code is null then return; end if;

  select * into v_customer
  from public.customers
  where external_id=v_code or customer_code=v_code
  order by case when external_id=v_code then 0 else 1 end,id
  limit 1
  for update;

  if found then
    if not coalesce(v_customer.active,false) then
      raise exception 'DAILY_REPORT_CUSTOMER_INACTIVE:%',v_code;
    end if;
    if v_customer.customer_code is null then
      update public.customers
      set customer_code=v_code,source_updated_at=now(),updated_at=now()
      where id=v_customer.id;
    end if;
    return;
  end if;

  if v_name is null then
    raise exception 'DAILY_REPORT_CUSTOMER_NAME_REQUIRED:%',v_code;
  end if;

  insert into public.customers(external_id,customer_code,customer_name,segment,credit_limit,payment_days,active,source_updated_at)
  values(v_code,v_code,v_name,'daily_report',0,0,true,now())
  on conflict(external_id) do update
  set customer_code=coalesce(customers.customer_code,excluded.customer_code),
      source_updated_at=now(),
      updated_at=now();

  if exists(select 1 from public.customers where external_id=v_code and active=false) then
    raise exception 'DAILY_REPORT_CUSTOMER_INACTIVE:%',v_code;
  end if;
end $$;

create or replace function public.validate_daily_report_sale_line()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if nullif(trim(new.customer_code),'') is null then raise exception 'DAILY_REPORT_CUSTOMER_CODE_REQUIRED'; end if;
  perform public.ensure_daily_report_customer(new.customer_code,new.customer_name);
  if not exists(select 1 from public.customers c where c.active=true and (c.external_id=new.customer_code or c.customer_code=new.customer_code)) then
    raise exception 'DAILY_REPORT_UNKNOWN_CUSTOMER_CODE:%',new.customer_code;
  end if;
  if new.sales_type not in ('block','concrete') then raise exception 'DAILY_REPORT_UNSUPPORTED_SALES_TYPE:%',new.sales_type; end if;
  if coalesce(new.quantity,0)<=0 then raise exception 'DAILY_REPORT_INVALID_QUANTITY'; end if;
  if coalesce(new.amount,0)<=0 then raise exception 'DAILY_REPORT_INVALID_AMOUNT'; end if;
  new.line_identity:=public.daily_sale_identity(new.invoice_no,new.customer_code,new.sales_type,new.quantity,new.amount);
  return new;
end $$;

create or replace function public.validate_daily_report_cash_line()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.treasury_code not in ('101','104') and coalesce(new.is_customer_collection,false) then raise exception 'DAILY_REPORT_UNSUPPORTED_COLLECTION_TREASURY:%',new.treasury_code; end if;
  if coalesce(new.is_customer_collection,false) and nullif(trim(new.account_code),'') is null then raise exception 'DAILY_REPORT_COLLECTION_CUSTOMER_CODE_REQUIRED'; end if;
  if coalesce(new.is_customer_collection,false) then
    perform public.ensure_daily_report_customer(new.account_code,new.account_name);
  end if;
  if coalesce(new.is_customer_collection,false) and not exists(select 1 from public.customers c where c.active=true and (c.external_id=new.account_code or c.customer_code=new.account_code)) then
    raise exception 'DAILY_REPORT_UNKNOWN_COLLECTION_CUSTOMER:%',new.account_code;
  end if;
  if coalesce(new.debit,0)<0 or coalesce(new.credit,0)<0 then raise exception 'DAILY_REPORT_NEGATIVE_CASH_VALUE'; end if;
  new.line_identity:=public.daily_cash_identity(new.treasury_code,new.account_code,new.voucher_no,new.movement_type,new.debit,new.credit,new.movement_date_text);
  return new;
end $$;

insert into public.migration_history(version,migration_name)
values(15,'015_daily_report_customer_master')
on conflict(version) do update set migration_name=excluded.migration_name;

revoke all on function public.ensure_daily_report_customer(text,text) from anon,authenticated;
revoke all on function public.validate_daily_report_sale_line() from anon,authenticated;
revoke all on function public.validate_daily_report_cash_line() from anon,authenticated;
