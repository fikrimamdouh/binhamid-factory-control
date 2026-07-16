-- Bin Hamid Factory Control — daily report ingestion and Factory OS ledger foundation
-- Run after 009_notification_attempt_guard.sql.
-- Idempotent. No existing operational data is deleted.

create extension if not exists pgcrypto;

create table if not exists public.migration_history (
  version integer primary key,
  migration_name text not null,
  applied_at timestamptz not null default now()
);

create table if not exists public.daily_report_batches (
  id uuid primary key default gen_random_uuid(),
  report_date date not null unique,
  original_name text not null,
  file_hash text not null,
  content_hash text not null,
  status text not null default 'processing' check (status in ('processing','approved','failed','rejected')),
  summary jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  committed_at timestamptz
);
create unique index if not exists daily_report_batches_content_uidx on public.daily_report_batches(report_date,content_hash);

create table if not exists public.daily_report_sales_lines (
  id bigserial primary key,
  batch_id uuid not null references public.daily_report_batches(id) on delete restrict,
  source_row_no integer not null,
  invoice_no text not null,
  sales_type text not null check (sales_type in ('block','concrete','other')),
  customer_code text,
  customer_name text not null,
  item_name text not null,
  quantity numeric(18,3) not null default 0,
  unit text,
  amount numeric(18,2) not null default 0,
  payment_terms text,
  issues jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique(batch_id,source_row_no)
);

create table if not exists public.daily_report_cash_movements (
  id bigserial primary key,
  batch_id uuid not null references public.daily_report_batches(id) on delete restrict,
  source_row_no integer not null,
  treasury_code text not null,
  treasury_name text,
  debit numeric(18,2) not null default 0,
  credit numeric(18,2) not null default 0,
  account_name text not null,
  account_type text,
  account_code text,
  description text,
  movement_type text,
  voucher_no text,
  movement_date_text text,
  payment_method text,
  is_customer_collection boolean not null default false,
  created_at timestamptz not null default now(),
  unique(batch_id,source_row_no)
);

create table if not exists public.daily_report_treasury_balances (
  id bigserial primary key,
  batch_id uuid not null references public.daily_report_batches(id) on delete restrict,
  treasury_code text not null,
  treasury_name text,
  opening_balance numeric(18,2) not null default 0,
  closing_balance numeric(18,2) not null default 0,
  created_at timestamptz not null default now(),
  unique(batch_id,treasury_code)
);

create table if not exists public.daily_report_inventory_snapshots (
  id bigserial primary key,
  batch_id uuid not null references public.daily_report_batches(id) on delete restrict,
  source_row_no integer not null,
  inventory_type text not null check (inventory_type in ('finished_goods','raw_material')),
  item_code text not null,
  item_name text not null,
  unit text,
  opening_quantity numeric(18,5) not null default 0,
  received_quantity numeric(18,5) not null default 0,
  issued_quantity numeric(18,5) not null default 0,
  closing_quantity numeric(18,5) not null default 0,
  created_at timestamptz not null default now(),
  unique(batch_id,inventory_type,item_code,source_row_no)
);

create table if not exists public.cost_ledger (
  id uuid primary key default gen_random_uuid(),
  entry_type text not null check (entry_type in ('revenue','direct_cost','shared_cost','allocation','adjustment')),
  cost_center text not null check (cost_center in ('block','concrete','shared','fleet','general')),
  source_type text not null,
  source_reference text not null,
  amount numeric(18,2) not null default 0,
  quantity numeric(18,3) not null default 0,
  unit text,
  allocation_basis text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(source_type,source_reference,entry_type)
);

alter table public.sales_orders add column if not exists paid_amount numeric(18,2) not null default 0;
alter table public.collection_events add column if not exists allocated_amount numeric(18,2) not null default 0;
alter table public.collection_events add column if not exists unallocated_amount numeric(18,2) not null default 0;

create table if not exists public.sales_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collection_events(id) on delete restrict,
  sales_order_id uuid not null references public.sales_orders(id) on delete restrict,
  amount numeric(18,2) not null check (amount>0),
  created_at timestamptz not null default now(),
  unique(collection_id,sales_order_id)
);

create index if not exists daily_report_sales_batch_idx on public.daily_report_sales_lines(batch_id,sales_type);
create index if not exists daily_report_cash_batch_idx on public.daily_report_cash_movements(batch_id,treasury_code);
create index if not exists daily_report_inventory_batch_idx on public.daily_report_inventory_snapshots(batch_id,inventory_type,item_code);
create index if not exists cost_ledger_center_time_idx on public.cost_ledger(cost_center,occurred_at desc,entry_type);

create or replace view public.factory_daily_margin as
select
  occurred_at::date as work_date,
  cost_center,
  sum(amount) filter(where entry_type='revenue') as revenue,
  sum(amount) filter(where entry_type in ('direct_cost','shared_cost','allocation')) as actual_cost,
  sum(quantity) filter(where entry_type='revenue') as sold_quantity,
  max(unit) filter(where entry_type='revenue') as quantity_unit,
  coalesce(sum(amount) filter(where entry_type='revenue'),0)-coalesce(sum(amount) filter(where entry_type in ('direct_cost','shared_cost','allocation')),0) as gross_margin,
  case when coalesce(sum(quantity) filter(where entry_type='revenue'),0)>0
    then coalesce(sum(amount) filter(where entry_type in ('direct_cost','shared_cost','allocation')),0)/sum(quantity) filter(where entry_type='revenue')
    else null end as actual_cost_per_unit
from public.cost_ledger
group by occurred_at::date,cost_center;

create or replace function public.allocate_collection_fifo(p_collection_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_collection record;
  v_order record;
  v_remaining numeric;
  v_allocate numeric;
  v_allocated numeric:=0;
begin
  select id,customer_external_id,amount into v_collection from public.collection_events where id=p_collection_id for update;
  if not found then raise exception 'collection not found'; end if;
  v_remaining:=coalesce(v_collection.amount,0);
  if nullif(v_collection.customer_external_id,'') is null then
    update public.collection_events set allocated_amount=0,unallocated_amount=v_remaining where id=p_collection_id;
    return jsonb_build_object('allocated',0,'unallocated',v_remaining);
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
    insert into public.sales_payment_allocations(collection_id,sales_order_id,amount)
    values(p_collection_id,v_order.id,v_allocate)
    on conflict(collection_id,sales_order_id) do nothing;
    if found then
      update public.sales_orders set paid_amount=coalesce(paid_amount,0)+v_allocate,
        status=case when coalesce(paid_amount,0)+v_allocate>=total_amount then 'collected' else 'partially_collected' end,
        collected_at=case when coalesce(paid_amount,0)+v_allocate>=total_amount then coalesce(collected_at,now()) else collected_at end,
        updated_at=now()
      where id=v_order.id;
      v_remaining:=v_remaining-v_allocate;
      v_allocated:=v_allocated+v_allocate;
    end if;
  end loop;
  update public.collection_events set allocated_amount=v_allocated,unallocated_amount=v_remaining where id=p_collection_id;
  return jsonb_build_object('allocated',v_allocated,'unallocated',v_remaining);
end $$;

create or replace function public.commit_daily_report(
  p_report_date date,
  p_original_name text,
  p_file_hash text,
  p_content_hash text,
  p_payload jsonb,
  p_actor text default 'web-admin'
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_batch uuid;
  v_existing record;
  v_row jsonb;
  v_ref text;
  v_collection_ref text;
  v_amount numeric;
  v_created_at timestamptz:=((p_report_date::text||' 12:00:00+03')::timestamptz);
  v_sales_count integer:=0;
  v_cash_count integer:=0;
  v_collection_count integer:=0;
  v_inventory_count integer:=0;
  v_sales_id uuid;
  v_collection_id uuid;
begin
  if p_report_date is null then raise exception 'report date is required'; end if;
  select id,content_hash,status,summary,committed_at into v_existing from public.daily_report_batches where report_date=p_report_date for update;
  if found then
    if v_existing.content_hash=p_content_hash then return jsonb_build_object('id',v_existing.id,'duplicate',true,'status',v_existing.status,'summary',v_existing.summary,'committed_at',v_existing.committed_at); end if;
    raise exception 'DAILY_REPORT_DATE_ALREADY_COMMITTED';
  end if;
  insert into public.daily_report_batches(report_date,original_name,file_hash,content_hash,status,summary,created_by)
  values(p_report_date,coalesce(nullif(p_original_name,''),'daily-report.xlsx'),p_file_hash,p_content_hash,'processing',coalesce(p_payload->'summary','{}'::jsonb),p_actor) returning id into v_batch;

  for v_row in select value from jsonb_array_elements(coalesce(p_payload->'sales','[]'::jsonb)) loop
    insert into public.daily_report_sales_lines(batch_id,source_row_no,invoice_no,sales_type,customer_code,customer_name,item_name,quantity,unit,amount,payment_terms,issues)
    values(v_batch,(v_row->>'sourceRowNo')::integer,v_row->>'invoiceNo',v_row->>'salesType',nullif(v_row->>'customerCode',''),v_row->>'customerName',v_row->>'item',public.safe_numeric(v_row->>'quantity',0),v_row->>'unit',public.safe_numeric(v_row->>'amount',0),v_row->>'paymentTerms',coalesce(v_row->'issues','[]'::jsonb));
    v_ref:=concat('DR-',to_char(p_report_date,'YYYYMMDD'),'-S-',lpad(v_row->>'sourceRowNo',4,'0'));
    insert into public.sales_orders(reference_no,sales_type,customer_external_id,customer_name,item,quantity,quantity_text,unit,unit_price,total_amount,delivery_date,delivery_text,payment_method,notes,status,sales_person_name,raw_order_text,created_at,updated_at)
    values(v_ref,v_row->>'salesType',nullif(v_row->>'customerCode',''),v_row->>'customerName',v_row->>'item',public.safe_numeric(v_row->>'quantity',0),v_row->>'quantity',v_row->>'unit',case when public.safe_numeric(v_row->>'quantity',0)>0 then public.safe_numeric(v_row->>'amount',0)/public.safe_numeric(v_row->>'quantity',1) else 0 end,public.safe_numeric(v_row->>'amount',0),p_report_date,'التقرير اليومي','credit',concat('فاتورة المصدر ',v_row->>'invoiceNo',' — سطر ',v_row->>'sourceRowNo'),'registered','استيراد التقرير اليومي',v_row::text,v_created_at,now())
    on conflict(reference_no) do update set customer_external_id=excluded.customer_external_id,customer_name=excluded.customer_name,item=excluded.item,quantity=excluded.quantity,unit=excluded.unit,unit_price=excluded.unit_price,total_amount=excluded.total_amount,delivery_date=excluded.delivery_date,notes=excluded.notes,updated_at=now() returning id into v_sales_id;
    insert into public.sales_order_updates(sales_order_id,status,note,created_at) values(v_sales_id,'registered',concat('استيراد التقرير اليومي — فاتورة ',v_row->>'invoiceNo'),v_created_at);
    insert into public.cost_ledger(entry_type,cost_center,source_type,source_reference,amount,quantity,unit,allocation_basis,metadata,occurred_at)
    values('revenue',v_row->>'salesType','daily_report_sale',v_ref,public.safe_numeric(v_row->>'amount',0),public.safe_numeric(v_row->>'quantity',0),v_row->>'unit','direct',jsonb_build_object('batch_id',v_batch,'invoice_no',v_row->>'invoiceNo','customer_code',v_row->>'customerCode','item',v_row->>'item'),v_created_at)
    on conflict(source_type,source_reference,entry_type) do update set amount=excluded.amount,quantity=excluded.quantity,unit=excluded.unit,metadata=excluded.metadata,occurred_at=excluded.occurred_at;
    insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details,created_at)
    values('web',p_actor,'daily_report_sales_imported',case when v_row->>'salesType'='block' then 'block_sales_order' else 'concrete_sales_order' end,v_ref,jsonb_build_object('reference_no',v_ref,'department',v_row->>'salesType','status','registered','title',concat('فاتورة ',v_row->>'invoiceNo'),'summary',concat(v_row->>'customerName',' — ',v_row->>'item'),'amount',v_row->>'amount','total_amount',v_row->>'amount','quantity',v_row->>'quantity','customer_name',v_row->>'customerName','customer_code',v_row->>'customerCode','item',v_row->>'item','source_batch_id',v_batch,'source_row_no',v_row->>'sourceRowNo','created_at',v_created_at),v_created_at);
    v_sales_count:=v_sales_count+1;
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(p_payload->'cashMovements','[]'::jsonb)) loop
    insert into public.daily_report_cash_movements(batch_id,source_row_no,treasury_code,treasury_name,debit,credit,account_name,account_type,account_code,description,movement_type,voucher_no,movement_date_text,payment_method,is_customer_collection)
    values(v_batch,(v_row->>'sourceRowNo')::integer,v_row->>'treasuryCode',v_row->>'treasuryName',public.safe_numeric(v_row->>'debit',0),public.safe_numeric(v_row->>'credit',0),v_row->>'accountName',v_row->>'accountType',nullif(v_row->>'accountCode',''),v_row->>'description',v_row->>'movementType',v_row->>'voucherNo',v_row->>'movementDate',v_row->>'paymentMethod',coalesce((v_row->>'isCustomerCollection')::boolean,false));
    v_ref:=concat('DR-',to_char(p_report_date,'YYYYMMDD'),'-F-',lpad(v_row->>'sourceRowNo',4,'0'));
    v_amount:=case when public.safe_numeric(v_row->>'debit',0)>0 then public.safe_numeric(v_row->>'debit',0) else public.safe_numeric(v_row->>'credit',0) end;
    insert into public.finance_events(reference_no,event_type,party_name,amount,payment_method,note,status,source_audit_id,occurred_at,created_at,updated_at)
    values(v_ref,case when public.safe_numeric(v_row->>'credit',0)>0 then 'cash_payment' when coalesce((v_row->>'isCustomerCollection')::boolean,false) then 'customer_receipt' else 'cash_receipt' end,v_row->>'accountName',v_amount,v_row->>'paymentMethod',concat(coalesce(v_row->>'movementType',''),' — إذن ',coalesce(v_row->>'voucherNo',''),' — خزينة ',v_row->>'treasuryCode'),'recorded',null,v_created_at,v_created_at,now())
    on conflict(reference_no) do update set party_name=excluded.party_name,amount=excluded.amount,payment_method=excluded.payment_method,note=excluded.note,occurred_at=excluded.occurred_at,updated_at=now();
    insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details,created_at)
    values('web',p_actor,'daily_report_finance_imported','finance_event',v_ref,jsonb_build_object('reference_no',v_ref,'department','finance','status','recorded','title',v_row->>'movementType','summary',v_row->>'accountName','amount',v_amount,'party',v_row->>'accountName','method',v_row->>'paymentMethod','treasury_code',v_row->>'treasuryCode','voucher_no',v_row->>'voucherNo','source_batch_id',v_batch,'source_row_no',v_row->>'sourceRowNo','created_at',v_created_at),v_created_at);
    if coalesce((v_row->>'isCustomerCollection')::boolean,false) then
      v_collection_ref:=concat('DR-',to_char(p_report_date,'YYYYMMDD'),'-C-',lpad(v_row->>'sourceRowNo',4,'0'));
      insert into public.collection_events(reference_no,customer_external_id,customer_name,amount,payment_method,status,note,occurred_at,created_at)
      values(v_collection_ref,nullif(v_row->>'accountCode',''),v_row->>'accountName',public.safe_numeric(v_row->>'debit',0),v_row->>'paymentMethod','recorded',concat('إذن ',coalesce(v_row->>'voucherNo',''),' — خزينة ',v_row->>'treasuryCode'),v_created_at,v_created_at)
      on conflict(reference_no) do update set customer_external_id=excluded.customer_external_id,customer_name=excluded.customer_name,amount=excluded.amount,payment_method=excluded.payment_method,note=excluded.note,occurred_at=excluded.occurred_at returning id into v_collection_id;
      perform public.allocate_collection_fifo(v_collection_id);
      insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details,created_at)
      values('web',p_actor,'daily_report_collection_imported','collection_event',v_collection_ref,jsonb_build_object('reference_no',v_collection_ref,'department','finance','status','recorded','title','تحصيل عميل','summary',v_row->>'accountName','amount',v_row->>'debit','party',v_row->>'accountName','customer_code',v_row->>'accountCode','method',v_row->>'paymentMethod','source_batch_id',v_batch,'source_row_no',v_row->>'sourceRowNo','created_at',v_created_at),v_created_at);
      v_collection_count:=v_collection_count+1;
    end if;
    v_cash_count:=v_cash_count+1;
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(p_payload->'treasuries','[]'::jsonb)) loop
    insert into public.daily_report_treasury_balances(batch_id,treasury_code,treasury_name,opening_balance,closing_balance)
    values(v_batch,v_row->>'treasuryCode',v_row->>'treasuryName',public.safe_numeric(v_row->>'opening',0),public.safe_numeric(v_row->>'closing',0));
  end loop;
  for v_row in select value from jsonb_array_elements(coalesce(p_payload->'inventory','[]'::jsonb)) loop
    insert into public.daily_report_inventory_snapshots(batch_id,source_row_no,inventory_type,item_code,item_name,unit,opening_quantity,received_quantity,issued_quantity,closing_quantity)
    values(v_batch,(v_row->>'sourceRowNo')::integer,v_row->>'inventoryType',v_row->>'itemCode',v_row->>'itemName',v_row->>'unit',public.safe_numeric(v_row->>'opening',0),public.safe_numeric(v_row->>'received',0),public.safe_numeric(v_row->>'issued',0),public.safe_numeric(v_row->>'closing',0));
    v_inventory_count:=v_inventory_count+1;
  end loop;
  update public.daily_report_batches set status='approved',committed_at=now(),summary=coalesce(p_payload->'summary','{}'::jsonb) where id=v_batch;
  return jsonb_build_object('id',v_batch,'duplicate',false,'status','approved','sales_count',v_sales_count,'cash_count',v_cash_count,'collection_count',v_collection_count,'inventory_count',v_inventory_count,'summary',p_payload->'summary','committed_at',now());
end $$;

insert into public.migration_history(version,migration_name) values
(1,'001_initial_schema'),(2,'002_driver_attendance_and_roles'),(3,'003_enterprise_operations_and_conversations'),(4,'004_operational_projection_backfill'),(5,'005_enterprise_runtime_completion'),(6,'006_runtime_replay_and_integrity'),(7,'007_procurement_projection_and_permissions'),(8,'008_notification_delivery_resilience'),(9,'009_notification_attempt_guard'),(10,'010_daily_report_factory_os_foundation')
on conflict(version) do update set migration_name=excluded.migration_name;

alter table public.migration_history enable row level security;
alter table public.daily_report_batches enable row level security;
alter table public.daily_report_sales_lines enable row level security;
alter table public.daily_report_cash_movements enable row level security;
alter table public.daily_report_treasury_balances enable row level security;
alter table public.daily_report_inventory_snapshots enable row level security;
alter table public.cost_ledger enable row level security;
alter table public.sales_payment_allocations enable row level security;
revoke all on public.migration_history,public.daily_report_batches,public.daily_report_sales_lines,public.daily_report_cash_movements,public.daily_report_treasury_balances,public.daily_report_inventory_snapshots,public.cost_ledger,public.sales_payment_allocations from anon,authenticated;
revoke all on function public.allocate_collection_fifo(uuid) from anon,authenticated;
revoke all on function public.commit_daily_report(date,text,text,text,jsonb,text) from anon,authenticated;
