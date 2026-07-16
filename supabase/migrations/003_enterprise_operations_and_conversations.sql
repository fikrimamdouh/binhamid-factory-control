-- Bin Hamid Factory Control — enterprise operations and complete Telegram conversations
-- Run after 001_initial_schema.sql and 002_driver_attendance_and_roles.sql.
-- Idempotent: safe to run again.

create extension if not exists pgcrypto;

-- Complete message history: inbound + outbound bot messages.
alter table public.telegram_messages add column if not exists direction text not null default 'incoming';
alter table public.telegram_messages add column if not exists delivery_status text not null default 'received';
alter table public.telegram_messages add column if not exists sender_name text;
alter table public.telegram_messages add column if not exists chat_type text;
alter table public.telegram_messages add column if not exists reply_to_message_id text;
alter table public.telegram_messages add column if not exists bot_method text;
alter table public.telegram_messages add column if not exists action_name text;
alter table public.telegram_messages add column if not exists action_payload jsonb not null default '{}'::jsonb;

alter table public.telegram_messages drop constraint if exists telegram_messages_direction_check;
alter table public.telegram_messages add constraint telegram_messages_direction_check
  check (direction in ('incoming','outgoing','system'));

alter table public.telegram_messages drop constraint if exists telegram_messages_delivery_status_check;
alter table public.telegram_messages add constraint telegram_messages_delivery_status_check
  check (delivery_status in ('received','processing','sent','delivered','failed'));

update public.telegram_messages
set direction=coalesce(nullif(direction,''),'incoming'),
    delivery_status=coalesce(nullif(delivery_status,''),'received')
where direction is null or direction='' or delivery_status is null or delivery_status='';

create index if not exists telegram_messages_thread_idx
  on public.telegram_messages(chat_id, created_at desc, direction);
create index if not exists telegram_messages_sender_idx
  on public.telegram_messages(sender_external_id, created_at desc);
create index if not exists telegram_messages_search_idx
  on public.telegram_messages using gin (to_tsvector('simple', coalesce(text,'') || ' ' || coalesce(transcription,'')));

-- Direct operational read model. This removes dependence on app_state for new bot transactions.
create table if not exists public.operational_records (
  id uuid primary key default gen_random_uuid(),
  reference_no text not null,
  entity_type text not null,
  department text not null default 'general',
  status text not null default 'registered',
  title text,
  summary text,
  amount numeric(18,2) not null default 0,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references public.app_users(id) on delete set null,
  assigned_to uuid references public.app_users(id) on delete set null,
  source_channel text,
  source_chat_id text,
  source_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  unique(entity_type, reference_no)
);

create index if not exists operational_records_status_idx
  on public.operational_records(department, status, updated_at desc);
create index if not exists operational_records_creator_idx
  on public.operational_records(created_by, updated_at desc);

-- Structured sales orders mirrored from existing Telegram sales events.
create table if not exists public.sales_orders (
  id uuid primary key default gen_random_uuid(),
  reference_no text not null unique,
  sales_type text not null check (sales_type in ('block','concrete')),
  customer_external_id text,
  customer_name text not null,
  customer_phone text,
  item text not null,
  quantity numeric(18,3) not null default 0,
  quantity_text text,
  unit text,
  unit_price numeric(18,2) not null default 0,
  total_amount numeric(18,2) not null default 0,
  delivery_date date,
  delivery_text text,
  location text,
  payment_method text,
  notes text,
  status text not null default 'registered',
  sales_person_user_id uuid references public.app_users(id) on delete set null,
  sales_person_name text,
  source_chat_id text,
  source_message_id text,
  raw_order_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  delivered_at timestamptz,
  collected_at timestamptz,
  cancelled_at timestamptz
);

create index if not exists sales_orders_status_delivery_idx
  on public.sales_orders(status, delivery_date, updated_at desc);
create index if not exists sales_orders_person_idx
  on public.sales_orders(sales_person_user_id, updated_at desc);

create table if not exists public.sales_order_updates (
  id bigserial primary key,
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  status text,
  note text,
  created_by uuid references public.app_users(id) on delete set null,
  source_chat_id text,
  source_message_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,
  sku text unique,
  item_name text not null,
  category text,
  unit text,
  quantity_on_hand numeric(18,3) not null default 0,
  minimum_quantity numeric(18,3) not null default 0,
  average_cost numeric(18,4) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  reference_no text not null unique,
  item_id uuid references public.inventory_items(id) on delete set null,
  movement_type text not null check (movement_type in ('receipt','issue','transfer_in','transfer_out','adjustment','count')),
  quantity numeric(18,3) not null,
  unit_cost numeric(18,4) not null default 0,
  related_entity_type text,
  related_entity_id text,
  note text,
  created_by uuid references public.app_users(id) on delete set null,
  source_chat_id text,
  source_message_id text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.purchase_requests (
  id uuid primary key default gen_random_uuid(),
  reference_no text not null unique,
  request_type text not null default 'general',
  item_description text not null,
  quantity numeric(18,3) not null default 0,
  unit text,
  urgency text not null default 'normal',
  related_entity_type text,
  related_entity_id text,
  status text not null default 'requested',
  requested_by uuid references public.app_users(id) on delete set null,
  approved_by uuid references public.app_users(id) on delete set null,
  source_chat_id text,
  source_message_id text,
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.supplier_quotes (
  id uuid primary key default gen_random_uuid(),
  reference_no text not null unique,
  purchase_request_id uuid references public.purchase_requests(id) on delete cascade,
  supplier_name text not null,
  supplier_phone text,
  supplier_address text,
  subtotal numeric(18,2) not null default 0,
  vat numeric(18,2) not null default 0,
  total numeric(18,2) not null default 0,
  delivery_days integer,
  warranty_text text,
  file_path text,
  status text not null default 'received',
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.collection_events (
  id uuid primary key default gen_random_uuid(),
  reference_no text not null unique,
  customer_external_id text,
  customer_name text,
  amount numeric(18,2) not null default 0,
  payment_method text,
  promise_date date,
  status text not null default 'recorded',
  note text,
  collected_by uuid references public.app_users(id) on delete set null,
  source_chat_id text,
  source_message_id text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.quality_cases (
  id uuid primary key default gen_random_uuid(),
  reference_no text not null unique,
  case_type text not null default 'inspection',
  related_entity_type text,
  related_entity_id text,
  product_name text,
  result text,
  severity text not null default 'review',
  status text not null default 'open',
  description text not null,
  corrective_action text,
  created_by uuid references public.app_users(id) on delete set null,
  assigned_to uuid references public.app_users(id) on delete set null,
  source_chat_id text,
  source_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists public.operational_tasks (
  id uuid primary key default gen_random_uuid(),
  reference_no text not null unique,
  title text not null,
  description text,
  department text not null default 'general',
  priority text not null default 'normal',
  status text not null default 'open',
  due_at timestamptz,
  created_by uuid references public.app_users(id) on delete set null,
  assigned_to uuid references public.app_users(id) on delete set null,
  related_entity_type text,
  related_entity_id text,
  source_chat_id text,
  source_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  notification_type text not null,
  recipient_user_id uuid references public.app_users(id) on delete cascade,
  recipient_chat_id text,
  title text,
  message text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  scheduled_at timestamptz not null default now(),
  sent_at timestamptz,
  error_text text,
  created_at timestamptz not null default now()
);

create index if not exists operational_tasks_open_idx on public.operational_tasks(status, due_at, priority);
create index if not exists purchase_requests_status_idx on public.purchase_requests(status, urgency, updated_at desc);
create index if not exists collection_events_customer_idx on public.collection_events(customer_external_id, occurred_at desc);
create index if not exists quality_cases_status_idx on public.quality_cases(status, severity, updated_at desc);
create index if not exists notification_outbox_pending_idx on public.notification_outbox(status, scheduled_at);

-- Project the existing event-sourced sales flow into direct tables automatically.
create or replace function public.project_sales_audit_event()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  d jsonb := coalesce(new.details,'{}'::jsonb);
  v_type text;
  v_order_id uuid;
begin
  if new.action not in ('sales_order_created','sales_order_updated','sales_order_cancelled') then return new; end if;
  if new.entity_type not in ('block_sales_order','concrete_sales_order') then return new; end if;
  v_type := case when new.entity_type='block_sales_order' then 'block' else 'concrete' end;

  insert into public.sales_orders(
    reference_no,sales_type,customer_name,customer_phone,item,quantity,quantity_text,unit,unit_price,total_amount,
    delivery_date,delivery_text,location,payment_method,notes,status,sales_person_user_id,sales_person_name,
    source_chat_id,source_message_id,raw_order_text,created_at,updated_at,delivered_at,collected_at,cancelled_at
  ) values (
    new.entity_id,v_type,coalesce(nullif(d->>'customer_name',''),'غير محدد'),d->>'customer_phone',coalesce(nullif(d->>'item',''),'غير محدد'),
    coalesce((d->>'quantity')::numeric,0),d->>'quantity_text',d->>'unit',coalesce((d->>'unit_price')::numeric,0),coalesce((d->>'total_amount')::numeric,0),
    nullif(d->>'delivery_date','')::date,d->>'delivery_text',d->>'location',d->>'payment_method',d->>'notes',coalesce(nullif(d->>'status',''),'registered'),
    nullif(d->>'created_by_user_id','')::uuid,d->>'sales_person_name',d->>'chat_id',d->>'source_message_id',d->>'raw_order_text',
    coalesce(nullif(d->>'created_at','')::timestamptz,new.created_at),new.created_at,
    case when d->>'status'='delivered' then new.created_at end,
    case when d->>'status'='collected' then new.created_at end,
    case when d->>'status'='cancelled' then new.created_at end
  ) on conflict(reference_no) do update set
    customer_name=excluded.customer_name,customer_phone=excluded.customer_phone,item=excluded.item,quantity=excluded.quantity,
    quantity_text=excluded.quantity_text,unit=excluded.unit,unit_price=excluded.unit_price,total_amount=excluded.total_amount,
    delivery_date=excluded.delivery_date,delivery_text=excluded.delivery_text,location=excluded.location,payment_method=excluded.payment_method,
    notes=excluded.notes,status=excluded.status,sales_person_name=excluded.sales_person_name,updated_at=new.created_at,
    delivered_at=coalesce(public.sales_orders.delivered_at,excluded.delivered_at),
    collected_at=coalesce(public.sales_orders.collected_at,excluded.collected_at),
    cancelled_at=coalesce(public.sales_orders.cancelled_at,excluded.cancelled_at)
  returning id into v_order_id;

  insert into public.sales_order_updates(sales_order_id,status,note,created_by,source_chat_id,source_message_id,created_at)
  values(v_order_id,d->>'status',coalesce(d->>'last_update_note',new.action),nullif(coalesce(d->>'updated_by_user_id',d->>'created_by_user_id'),'')::uuid,d->>'chat_id',d->>'source_message_id',new.created_at);
  return new;
exception when others then
  -- Never block the original business event if projection data is incomplete.
  return new;
end $$;

drop trigger if exists audit_sales_projection_trigger on public.audit_log;
create trigger audit_sales_projection_trigger
after insert on public.audit_log
for each row execute function public.project_sales_audit_event();

-- Generic projection for every bot operation currently recorded in audit_log.
create or replace function public.project_operational_audit_event()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  d jsonb := coalesce(new.details,'{}'::jsonb);
  ref text := coalesce(nullif(new.entity_id,''),nullif(d->>'reference_no',''),concat('AUD-',new.id));
  dept text := coalesce(nullif(d->>'department',''),
    case
      when new.entity_type ilike '%sales%' then case when new.entity_type ilike '%block%' then 'block' else 'concrete' end
      when new.entity_type ilike '%maintenance%' or new.entity_type ilike '%workshop%' then 'workshop'
      when new.entity_type ilike '%purchase%' or new.entity_type ilike '%quotation%' then 'procurement'
      when new.entity_type ilike '%collection%' or new.entity_type ilike '%finance%' then 'finance'
      when new.entity_type ilike '%quality%' then 'quality'
      else 'general'
    end);
begin
  insert into public.operational_records(reference_no,entity_type,department,status,title,summary,amount,payload,source_channel,source_chat_id,source_message_id,created_at,updated_at)
  values(ref,coalesce(new.entity_type,'operation'),dept,coalesce(nullif(d->>'status',''),'registered'),d->>'title',coalesce(d->>'summary',d->>'note',d->>'problem'),coalesce((d->>'amount')::numeric,(d->>'total_amount')::numeric,0),d,'telegram',d->>'chat_id',d->>'source_message_id',new.created_at,new.created_at)
  on conflict(entity_type,reference_no) do update set
    department=excluded.department,status=excluded.status,title=coalesce(excluded.title,public.operational_records.title),
    summary=coalesce(excluded.summary,public.operational_records.summary),amount=case when excluded.amount<>0 then excluded.amount else public.operational_records.amount end,
    payload=public.operational_records.payload || excluded.payload,updated_at=excluded.updated_at;
  return new;
exception when others then return new;
end $$;

drop trigger if exists audit_operational_projection_trigger on public.audit_log;
create trigger audit_operational_projection_trigger
after insert on public.audit_log
for each row execute function public.project_operational_audit_event();

-- Backfill existing sales events and generic records.
do $$ declare r record; begin
  for r in select * from public.audit_log order by id loop
    begin perform public.project_operational_audit_event(); exception when others then null; end;
  end loop;
end $$;

-- Private server-side tables only.
do $$ declare t text; begin
  foreach t in array array[
    'operational_records','sales_orders','sales_order_updates','inventory_items','inventory_movements','purchase_requests',
    'supplier_quotes','collection_events','quality_cases','operational_tasks','notification_outbox'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
  end loop;
end $$;

revoke all on function public.project_sales_audit_event() from anon, authenticated;
revoke all on function public.project_operational_audit_event() from anon, authenticated;
