-- Bin Hamid Factory Control — chronological FIFO rebuild and auditable maintenance reversals
-- Run after 012_daily_report_idempotency_and_validation.sql.
-- Idempotent and non-destructive: allocations are superseded, never deleted.

create extension if not exists pgcrypto;

create table if not exists public.fifo_rebuild_runs (
  id uuid primary key default gen_random_uuid(),
  customer_external_id text not null,
  reason text not null,
  status text not null default 'running' check (status in ('running','completed','failed')),
  previous_allocated_amount numeric(18,2) not null default 0,
  rebuilt_allocated_amount numeric(18,2) not null default 0,
  unallocated_amount numeric(18,2) not null default 0,
  order_count integer not null default 0,
  collection_count integer not null default 0,
  actor text,
  details jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error_text text
);

alter table public.sales_payment_allocations add column if not exists active boolean not null default true;
alter table public.sales_payment_allocations add column if not exists allocation_order integer;
alter table public.sales_payment_allocations add column if not exists rebuild_run_id uuid;
alter table public.sales_payment_allocations add column if not exists superseded_at timestamptz;
alter table public.sales_payment_allocations add column if not exists updated_at timestamptz not null default now();

alter table public.cost_ledger drop constraint if exists cost_ledger_posted_status_check;
alter table public.cost_ledger add constraint cost_ledger_posted_status_check
  check (posted_status in ('posted','superseded','reversed')) not valid;

-- Add circular foreign keys only after all referenced tables exist.
do $$ begin
  if not exists(select 1 from pg_constraint where conname='cost_periods_approved_run_fk') then
    alter table public.cost_periods add constraint cost_periods_approved_run_fk
      foreign key(approved_run_id) references public.cost_calculation_runs(id) on delete restrict;
  end if;
  if not exists(select 1 from pg_constraint where conname='sales_payment_allocations_rebuild_run_fk') then
    alter table public.sales_payment_allocations add constraint sales_payment_allocations_rebuild_run_fk
      foreign key(rebuild_run_id) references public.fifo_rebuild_runs(id) on delete set null;
  end if;
end $$;

create index if not exists sales_payment_allocations_active_idx
  on public.sales_payment_allocations(sales_order_id,active,created_at);
create index if not exists fifo_rebuild_customer_idx
  on public.fifo_rebuild_runs(customer_external_id,started_at desc);

create or replace function public.allocate_collection_fifo_core(p_collection_id uuid,p_rebuild_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_collection record;
  v_order record;
  v_remaining numeric;
  v_allocate numeric;
  v_allocated numeric:=0;
  v_order_no integer:=0;
begin
  select id,customer_external_id,amount into v_collection
  from public.collection_events where id=p_collection_id for update;
  if not found then raise exception 'collection not found'; end if;

  update public.sales_payment_allocations
  set active=false,superseded_at=now(),rebuild_run_id=coalesce(p_rebuild_run_id,rebuild_run_id),updated_at=now()
  where collection_id=p_collection_id and active=true;

  v_remaining:=greatest(coalesce(v_collection.amount,0),0);
  if nullif(v_collection.customer_external_id,'') is null then
    update public.collection_events set allocated_amount=0,unallocated_amount=v_remaining where id=p_collection_id;
    return jsonb_build_object('allocated',0,'unallocated',v_remaining,'allocation_count',0);
  end if;

  for v_order in
    select id,total_amount,paid_amount from public.sales_orders
    where customer_external_id=v_collection.customer_external_id
      and coalesce(status,'') not in ('cancelled','rejected')
      and total_amount>coalesce(paid_amount,0)
    order by created_at,id
    for update
  loop
    exit when v_remaining<=0;
    v_allocate:=least(v_remaining,v_order.total_amount-coalesce(v_order.paid_amount,0));
    if v_allocate<=0 then continue; end if;
    v_order_no:=v_order_no+1;
    insert into public.sales_payment_allocations(collection_id,sales_order_id,amount,active,allocation_order,rebuild_run_id,superseded_at,updated_at)
    values(p_collection_id,v_order.id,v_allocate,true,v_order_no,p_rebuild_run_id,null,now())
    on conflict(collection_id,sales_order_id) do update set
      amount=excluded.amount,active=true,allocation_order=excluded.allocation_order,
      rebuild_run_id=excluded.rebuild_run_id,superseded_at=null,updated_at=now();
    update public.sales_orders set
      paid_amount=coalesce(paid_amount,0)+v_allocate,
      status=case when coalesce(paid_amount,0)+v_allocate>=total_amount then 'collected' else 'partially_collected' end,
      collected_at=case when coalesce(paid_amount,0)+v_allocate>=total_amount then coalesce(collected_at,now()) else null end,
      updated_at=now()
    where id=v_order.id;
    v_remaining:=v_remaining-v_allocate;
    v_allocated:=v_allocated+v_allocate;
  end loop;
  update public.collection_events set allocated_amount=v_allocated,unallocated_amount=v_remaining where id=p_collection_id;
  return jsonb_build_object('allocated',v_allocated,'unallocated',v_remaining,'allocation_count',v_order_no);
end $$;

create or replace function public.preview_customer_fifo_rebuild(p_customer_external_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_orders integer;
  v_collections integer;
  v_open numeric;
  v_receipts numeric;
  v_allocated numeric;
  v_unallocated numeric;
begin
  if nullif(trim(p_customer_external_id),'') is null then raise exception 'CUSTOMER_REQUIRED'; end if;
  select count(*),coalesce(sum(greatest(total_amount-coalesce(paid_amount,0),0)),0)
    into v_orders,v_open from public.sales_orders
    where customer_external_id=p_customer_external_id and coalesce(status,'') not in ('cancelled','rejected');
  select count(*),coalesce(sum(amount),0),coalesce(sum(allocated_amount),0),coalesce(sum(unallocated_amount),0)
    into v_collections,v_receipts,v_allocated,v_unallocated from public.collection_events
    where customer_external_id=p_customer_external_id;
  return jsonb_build_object(
    'customerExternalId',p_customer_external_id,'orderCount',v_orders,'collectionCount',v_collections,
    'currentOpenAmount',v_open,'receiptAmount',v_receipts,'currentAllocatedAmount',v_allocated,
    'currentUnallocatedAmount',v_unallocated,'willRebuildChronologically',true
  );
end $$;

create or replace function public.rebuild_customer_fifo(
  p_customer_external_id text,p_actor text default 'system',p_reason text default 'chronology_changed'
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_run_id uuid;
  v_collection record;
  v_result jsonb;
  v_before numeric:=0;
  v_after numeric:=0;
  v_unallocated numeric:=0;
  v_orders integer:=0;
  v_collections integer:=0;
begin
  if nullif(trim(p_customer_external_id),'') is null then raise exception 'CUSTOMER_REQUIRED'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'REBUILD_REASON_REQUIRED'; end if;

  perform id from public.sales_orders
    where customer_external_id=p_customer_external_id and coalesce(status,'') not in ('cancelled','rejected')
    order by created_at,id for update;
  perform id from public.collection_events
    where customer_external_id=p_customer_external_id order by occurred_at,created_at,id for update;

  select coalesce(sum(allocated_amount),0),count(*) into v_before,v_collections
    from public.collection_events where customer_external_id=p_customer_external_id;
  select count(*) into v_orders from public.sales_orders
    where customer_external_id=p_customer_external_id and coalesce(status,'') not in ('cancelled','rejected');

  insert into public.fifo_rebuild_runs(customer_external_id,reason,previous_allocated_amount,order_count,collection_count,actor)
  values(p_customer_external_id,p_reason,v_before,v_orders,v_collections,p_actor) returning id into v_run_id;

  update public.sales_payment_allocations a set
    active=false,superseded_at=now(),rebuild_run_id=v_run_id,updated_at=now()
  where a.collection_id in (select id from public.collection_events where customer_external_id=p_customer_external_id)
    and a.active=true;

  update public.sales_orders set
    paid_amount=0,
    status=case when status in ('collected','partially_collected') then 'registered' else status end,
    collected_at=case when status in ('collected','partially_collected') then null else collected_at end,
    updated_at=now()
  where customer_external_id=p_customer_external_id and coalesce(status,'') not in ('cancelled','rejected');

  update public.collection_events set allocated_amount=0,unallocated_amount=amount
  where customer_external_id=p_customer_external_id;

  for v_collection in
    select id from public.collection_events
    where customer_external_id=p_customer_external_id
    order by occurred_at,created_at,id
  loop
    v_result:=public.allocate_collection_fifo_core(v_collection.id,v_run_id);
    v_after:=v_after+coalesce((v_result->>'allocated')::numeric,0);
    v_unallocated:=v_unallocated+coalesce((v_result->>'unallocated')::numeric,0);
  end loop;

  update public.fifo_rebuild_runs set
    status='completed',rebuilt_allocated_amount=v_after,unallocated_amount=v_unallocated,
    completed_at=now(),details=jsonb_build_object('delta',v_after-v_before)
  where id=v_run_id;
  insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details)
  values('system',p_actor,'customer_fifo_rebuilt','customer',p_customer_external_id,
    jsonb_build_object('run_id',v_run_id,'reason',p_reason,'previous_allocated',v_before,'rebuilt_allocated',v_after,'unallocated',v_unallocated,'order_count',v_orders,'collection_count',v_collections));
  return jsonb_build_object('runId',v_run_id,'customerExternalId',p_customer_external_id,'previousAllocated',v_before,'rebuiltAllocated',v_after,'unallocated',v_unallocated,'orderCount',v_orders,'collectionCount',v_collections);
exception when others then
  if v_run_id is not null then
    update public.fifo_rebuild_runs set status='failed',error_text=sqlerrm,completed_at=now() where id=v_run_id;
  end if;
  raise;
end $$;

create or replace function public.allocate_collection_fifo(p_collection_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_collection record;
  v_later_exists boolean:=false;
begin
  select id,customer_external_id,occurred_at,created_at into v_collection
  from public.collection_events where id=p_collection_id for update;
  if not found then raise exception 'collection not found'; end if;
  if nullif(v_collection.customer_external_id,'') is not null then
    select exists(
      select 1 from public.collection_events c
      where c.customer_external_id=v_collection.customer_external_id and c.id<>v_collection.id
        and (c.occurred_at,c.created_at,c.id)>(v_collection.occurred_at,v_collection.created_at,v_collection.id)
        and coalesce(c.allocated_amount,0)>0
    ) into v_later_exists;
  end if;
  if v_later_exists then
    return public.rebuild_customer_fifo(v_collection.customer_external_id,'system','backdated_collection');
  end if;
  return public.allocate_collection_fifo_core(p_collection_id,null);
end $$;

create or replace function public.rebuild_fifo_after_backdated_sale()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if nullif(new.customer_external_id,'') is null or new.reference_no not like 'DR-%' then return new; end if;
  if exists(
    select 1 from public.collection_events c
    where c.customer_external_id=new.customer_external_id and c.occurred_at>new.created_at
      and coalesce(c.allocated_amount,0)>0
  ) then
    perform public.rebuild_customer_fifo(new.customer_external_id,'system','backdated_daily_report_sale');
  end if;
  return new;
end $$;

drop trigger if exists sales_order_backdated_fifo_trigger on public.sales_orders;
create trigger sales_order_backdated_fifo_trigger
after insert or update of customer_external_id,total_amount,created_at on public.sales_orders
for each row execute function public.rebuild_fifo_after_backdated_sale();

-- Maintenance postings are versioned. Reopening or changing a closed order creates
-- a negative adjustment linked to the prior posting, then a later close posts a new version.
create or replace function public.project_maintenance_cost_v2()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_center record;
  v_active public.cost_ledger%rowtype;
  v_time timestamptz:=coalesce(new.closed_at,new.updated_at,new.created_at,now());
  v_unclassified boolean:=false;
  v_transition text;
  v_version_ref text;
begin
  select l.* into v_active from public.cost_ledger l
  where l.metadata->>'maintenance_id'=new.id::text
    and l.entry_type='direct_cost' and l.posted_status='posted'
    and not exists(select 1 from public.cost_ledger r where r.reversed_entry_id=l.id and r.posted_status='posted')
  order by l.occurred_at desc,l.created_at desc limit 1 for update;

  if new.status not in ('completed','closed') then
    if v_active.id is not null and old.status in ('completed','closed') then
      v_transition:=concat('reopen:',to_char(coalesce(new.updated_at,now()),'YYYYMMDDHH24MISSUS'));
      insert into public.cost_ledger(entry_type,cost_center,cost_center_id,source_type,source_reference,source_hash,amount,quantity,unit,allocation_basis,metadata,occurred_at,period_start,reversed_entry_id,posted_status)
      values('adjustment',v_active.cost_center,v_active.cost_center_id,'maintenance_order_reversal',concat(new.reference_no,':',v_transition),
        encode(digest(concat_ws('|','maintenance-reversal',new.id::text,v_transition,v_active.id::text),'sha256'),'hex'),
        -v_active.amount,0,null,'reversal',jsonb_build_object('maintenance_id',new.id,'vehicle_external_id',new.vehicle_external_id,'reason','reopened','reversed_entry_id',v_active.id,'status',new.status),
        coalesce(new.updated_at,now()),date_trunc('month',coalesce(new.updated_at,now()))::date,v_active.id,'posted')
      on conflict(source_type,source_reference,entry_type) do nothing;
      insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details)
      values('system','maintenance-cost-trigger','maintenance_cost_reversed','maintenance_order',new.id::text,
        jsonb_build_object('reference_no',new.reference_no,'reversed_entry_id',v_active.id,'amount',v_active.amount,'new_status',new.status));
    end if;
    return new;
  end if;

  select c.id,c.code into v_center
  from public.asset_cost_center_assignments a join public.cost_centers c on c.id=a.cost_center_id
  where a.asset_external_id=new.vehicle_external_id and a.active=true
    and a.effective_from<=v_time::date and (a.effective_to is null or a.effective_to>=v_time::date)
  order by a.effective_from desc limit 1;
  if v_center.id is null then select id,code into v_center from public.cost_centers where code='fleet';v_unclassified:=true; end if;

  if v_active.id is not null and (v_active.amount<>coalesce(new.actual_cost,0) or v_active.cost_center_id is distinct from v_center.id) then
    v_transition:=concat('change:',to_char(coalesce(new.updated_at,now()),'YYYYMMDDHH24MISSUS'));
    insert into public.cost_ledger(entry_type,cost_center,cost_center_id,source_type,source_reference,source_hash,amount,allocation_basis,metadata,occurred_at,period_start,reversed_entry_id,posted_status)
    values('adjustment',v_active.cost_center,v_active.cost_center_id,'maintenance_order_reversal',concat(new.reference_no,':',v_transition),
      encode(digest(concat_ws('|','maintenance-change-reversal',new.id::text,v_transition,v_active.id::text),'sha256'),'hex'),
      -v_active.amount,'reversal',jsonb_build_object('maintenance_id',new.id,'reason','closed_cost_changed','reversed_entry_id',v_active.id),
      v_time,date_trunc('month',v_time)::date,v_active.id,'posted')
    on conflict(source_type,source_reference,entry_type) do nothing;
    v_active.id:=null;
  end if;

  if v_active.id is null and coalesce(new.actual_cost,0)>0 then
    v_version_ref:=concat(new.reference_no,':post:',to_char(coalesce(new.updated_at,new.closed_at,now()),'YYYYMMDDHH24MISSUS'));
    insert into public.cost_ledger(entry_type,cost_center,cost_center_id,source_type,source_reference,source_hash,amount,quantity,unit,allocation_basis,metadata,occurred_at,period_start,posted_status)
    values('direct_cost',v_center.code,v_center.id,'maintenance_order_version',v_version_ref,
      encode(digest(concat_ws('|','maintenance-post',new.id::text,v_version_ref,new.actual_cost::text),'sha256'),'hex'),
      new.actual_cost,0,null,'direct',jsonb_build_object('maintenance_id',new.id,'vehicle_external_id',new.vehicle_external_id,'unclassified',v_unclassified,'status',new.status,'versioned',true),
      v_time,date_trunc('month',v_time)::date,'posted')
    on conflict(source_type,source_reference,entry_type) do update set
      amount=excluded.amount,cost_center=excluded.cost_center,cost_center_id=excluded.cost_center_id,
      metadata=excluded.metadata,occurred_at=excluded.occurred_at,period_start=excluded.period_start,posted_status='posted';
  end if;
  return new;
end $$;

drop trigger if exists maintenance_cost_projection_trigger on public.maintenance_orders;
drop trigger if exists maintenance_cost_projection_v2_trigger on public.maintenance_orders;
create trigger maintenance_cost_projection_v2_trigger
after insert or update of status,actual_cost,vehicle_external_id,closed_at,updated_at on public.maintenance_orders
for each row execute function public.project_maintenance_cost_v2();

insert into public.migration_history(version,migration_name) values(13,'013_fifo_rebuild_and_cost_reversals')
on conflict(version) do update set migration_name=excluded.migration_name;

alter table public.fifo_rebuild_runs enable row level security;
revoke all on public.fifo_rebuild_runs from anon,authenticated;
revoke all on function public.allocate_collection_fifo_core(uuid,uuid) from anon,authenticated;
revoke all on function public.preview_customer_fifo_rebuild(text) from anon,authenticated;
revoke all on function public.rebuild_customer_fifo(text,text,text) from anon,authenticated;
revoke all on function public.allocate_collection_fifo(uuid) from anon,authenticated;
revoke all on function public.rebuild_fifo_after_backdated_sale() from anon,authenticated;
revoke all on function public.project_maintenance_cost_v2() from anon,authenticated;
