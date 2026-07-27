-- Bin Hamid Factory Control — keep customer payment allocations consistent
-- when an approved ERP report is upgraded from a revised workbook.
-- Run after 029_daily_report_v2_upgrade.sql.

do $$
begin
  if not exists(select 1 from public.migration_history where version=29) then
    raise exception 'MIGRATION_029_REQUIRED';
  end if;
end $$;

create or replace function public.replay_daily_report_collection_fifo_after_update()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  -- Migration 029 upserts collection rows by their stable DR reference. When a
  -- revised workbook changes the customer, amount, or effective date, replay
  -- the allocation after the row is updated so paid and unallocated balances
  -- cannot retain values from the previous workbook.
  if new.reference_no like 'DR-%' then
    perform public.allocate_collection_fifo(new.id);
  end if;
  return new;
end $$;

drop trigger if exists daily_report_collection_fifo_update_trigger on public.collection_events;
create trigger daily_report_collection_fifo_update_trigger
after update of customer_external_id,amount,occurred_at on public.collection_events
for each row
when (
  old.customer_external_id is distinct from new.customer_external_id
  or old.amount is distinct from new.amount
  or old.occurred_at is distinct from new.occurred_at
)
execute function public.replay_daily_report_collection_fifo_after_update();

-- Repair only customers whose current paid/allocated values are already
-- inconsistent. The rebuild is auditable and supersedes old allocations
-- instead of deleting financial history.
do $$
declare
  v_customer text;
  v_invalid_sales_before integer;
  v_invalid_collections_before integer;
  v_invalid_sales_after integer;
  v_invalid_collections_after integer;
  v_rebuilt_customers integer:=0;
begin
  select count(*) into v_invalid_sales_before
  from public.sales_orders
  where coalesce(paid_amount,0)<0
     or coalesce(paid_amount,0)>coalesce(total_amount,0)+0.01;

  select count(*) into v_invalid_collections_before
  from public.collection_events
  where abs(
    coalesce(amount,0)
    -coalesce(allocated_amount,0)
    -coalesce(unallocated_amount,0)
  )>0.01;

  update public.collection_events
  set allocated_amount=0,
      unallocated_amount=greatest(coalesce(amount,0),0)
  where nullif(trim(coalesce(customer_external_id,'')),'') is null
    and abs(
      coalesce(amount,0)
      -coalesce(allocated_amount,0)
      -coalesce(unallocated_amount,0)
    )>0.01;

  for v_customer in
    select customer_external_id
    from (
      select nullif(trim(customer_external_id),'') as customer_external_id
      from public.sales_orders
      where coalesce(paid_amount,0)<0
         or coalesce(paid_amount,0)>coalesce(total_amount,0)+0.01
      union
      select nullif(trim(customer_external_id),'') as customer_external_id
      from public.collection_events
      where abs(
        coalesce(amount,0)
        -coalesce(allocated_amount,0)
        -coalesce(unallocated_amount,0)
      )>0.01
    ) affected
    where customer_external_id is not null
    order by customer_external_id
  loop
    perform public.rebuild_customer_fifo(
      v_customer,
      'migration-030',
      'daily_report_v2_allocation_repair'
    );
    v_rebuilt_customers:=v_rebuilt_customers+1;
  end loop;

  select count(*) into v_invalid_sales_after
  from public.sales_orders
  where coalesce(paid_amount,0)<0
     or coalesce(paid_amount,0)>coalesce(total_amount,0)+0.01;

  select count(*) into v_invalid_collections_after
  from public.collection_events
  where abs(
    coalesce(amount,0)
    -coalesce(allocated_amount,0)
    -coalesce(unallocated_amount,0)
  )>0.01;

  if v_invalid_sales_after<>0 or v_invalid_collections_after<>0 then
    raise exception
      'DAILY_REPORT_FIFO_REPAIR_FAILED:sales=%,collections=%',
      v_invalid_sales_after,
      v_invalid_collections_after;
  end if;

  insert into public.audit_log(
    actor_type,actor_id,action,entity_type,entity_id,details
  ) values(
    'system',
    'migration-030',
    'daily_report_fifo_integrity_repaired',
    'daily_report',
    'all',
    jsonb_build_object(
      'invalidSalesBefore',v_invalid_sales_before,
      'invalidCollectionsBefore',v_invalid_collections_before,
      'rebuiltCustomers',v_rebuilt_customers,
      'invalidSalesAfter',v_invalid_sales_after,
      'invalidCollectionsAfter',v_invalid_collections_after
    )
  );
end $$;

insert into public.migration_history(version,migration_name)
values(30,'030_daily_report_fifo_integrity')
on conflict(version) do update set migration_name=excluded.migration_name;

revoke all on function public.replay_daily_report_collection_fifo_after_update()
from public,anon,authenticated;
grant execute on function public.replay_daily_report_collection_fifo_after_update()
to service_role;
