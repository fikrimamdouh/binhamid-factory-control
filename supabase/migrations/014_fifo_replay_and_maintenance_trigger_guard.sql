-- Bin Hamid Factory Control — safe FIFO replay and maintenance trigger INSERT guard
-- Run after 013_fifo_rebuild_and_cost_reversals.sql.
-- Idempotent and non-destructive.

create or replace function public.allocate_collection_fifo_core(p_collection_id uuid,p_rebuild_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_collection record;
  v_existing record;
  v_order record;
  v_remaining numeric;
  v_allocate numeric;
  v_allocated numeric:=0;
  v_order_no integer:=0;
begin
  select id,customer_external_id,amount into v_collection
  from public.collection_events where id=p_collection_id for update;
  if not found then raise exception 'collection not found'; end if;

  -- A direct replay of one collection must unwind its active allocations first.
  -- Full rebuilds already mark all allocations inactive before calling this helper.
  for v_existing in
    select a.sales_order_id,a.amount from public.sales_payment_allocations a
    where a.collection_id=p_collection_id and a.active=true
    order by a.allocation_order nulls last,a.created_at,a.id
    for update
  loop
    update public.sales_orders set
      paid_amount=greatest(0,coalesce(paid_amount,0)-v_existing.amount),
      status=case
        when greatest(0,coalesce(paid_amount,0)-v_existing.amount)<=0 and status in ('collected','partially_collected') then 'registered'
        when greatest(0,coalesce(paid_amount,0)-v_existing.amount)<total_amount then 'partially_collected'
        else status end,
      collected_at=case when greatest(0,coalesce(paid_amount,0)-v_existing.amount)<total_amount then null else collected_at end,
      updated_at=now()
    where id=v_existing.sales_order_id;
  end loop;

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
    if tg_op='UPDATE' and v_active.id is not null and old.status in ('completed','closed') then
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

insert into public.migration_history(version,migration_name) values(14,'014_fifo_replay_and_maintenance_trigger_guard')
on conflict(version) do update set migration_name=excluded.migration_name;

revoke all on function public.allocate_collection_fifo_core(uuid,uuid) from anon,authenticated;
revoke all on function public.project_maintenance_cost_v2() from anon,authenticated;
