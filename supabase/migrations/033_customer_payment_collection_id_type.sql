-- Bin Hamid Factory Control — fix the reviewed-payment reconciliation
-- function to use the actual primary-key types of cash and collection events.

do $$
declare
  v_function oid;
  v_definition text;
begin
  if not exists(select 1 from public.migration_history where version=32) then
    raise exception 'MIGRATION_032_REQUIRED';
  end if;

  v_function:=to_regprocedure('public.append_daily_report_customer_payments(date,text,jsonb,text,text)');
  if v_function is null then
    raise exception 'ERP_PAYMENT_RECONCILIATION_FUNCTION_MISSING';
  end if;

  v_definition:=pg_get_functiondef(v_function);

  if position('v_cash_id uuid;' in v_definition)>0 then
    v_definition:=replace(
      v_definition,
      'v_cash_id uuid;',
      'v_cash_id public.daily_report_cash_movements.id%type;'
    );
  elsif position('v_cash_id public.daily_report_cash_movements.id%type;' in v_definition)=0 then
    raise exception 'ERP_PAYMENT_CASH_ID_DECLARATION_NOT_FOUND';
  end if;

  if position('v_collection_id uuid;' in v_definition)>0 then
    v_definition:=replace(
      v_definition,
      'v_collection_id uuid;',
      'v_collection_id public.collection_events.id%type;'
    );
  elsif position('v_collection_id public.collection_events.id%type;' in v_definition)=0 then
    raise exception 'ERP_PAYMENT_COLLECTION_ID_DECLARATION_NOT_FOUND';
  end if;

  execute v_definition;
end $$;

insert into public.migration_history(version,migration_name)
values(33,'033_customer_payment_event_id_types')
on conflict(version) do update set migration_name=excluded.migration_name;
