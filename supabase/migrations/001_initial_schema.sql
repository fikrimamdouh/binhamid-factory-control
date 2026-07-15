-- Bin Hamid Factory Control — central database foundation
-- Run once in Supabase SQL Editor. All application access is server-side through Vercel.

create extension if not exists pgcrypto;

create table if not exists public.app_state (
  key text primary key,
  revision bigint not null default 0,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text,
  device_id text
);

create table if not exists public.doc_sequences (
  prefix text primary key,
  value bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  employee_external_id text,
  full_name text not null,
  role text not null default 'pending' check (role in ('pending','admin','manager','accountant','mechanic','block_sales','concrete_sales','collector')),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_channels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  channel text not null,
  external_id text not null,
  external_username text,
  active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(channel, external_id)
);

create table if not exists public.telegram_groups (
  id uuid primary key default gen_random_uuid(),
  chat_id text not null unique,
  title text,
  department text not null default 'unassigned' check (department in ('unassigned','workshop','finance','block','concrete')),
  active boolean not null default false,
  status text not null default 'pending' check (status in ('pending','approved','disabled','private')),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.telegram_messages (
  id uuid primary key default gen_random_uuid(),
  update_id text not null unique,
  chat_id text not null,
  message_id text not null,
  group_id uuid references public.telegram_groups(id) on delete set null,
  sender_user_id uuid references public.app_users(id) on delete set null,
  sender_external_id text,
  message_type text not null,
  text text,
  transcription text,
  file_id text,
  file_name text,
  mime_type text,
  file_path text,
  related_entity_type text,
  related_entity_id uuid,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(chat_id, message_id)
);

create table if not exists public.imports (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'web',
  department text not null default 'unassigned',
  report_type text,
  status text not null default 'received' check (status in ('received','processing','ready','failed','opened_in_program','approved','rejected')),
  original_name text,
  mime_type text,
  file_path text not null,
  file_hash text not null unique,
  report_date date,
  row_count integer not null default 0,
  valid_count integer not null default 0,
  warning_count integer not null default 0,
  error_count integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  submitted_by uuid references public.app_users(id) on delete set null,
  source_chat_id text,
  source_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.import_rows (
  id bigserial primary key,
  import_id uuid not null references public.imports(id) on delete cascade,
  sheet_name text,
  row_no integer,
  status text not null default 'pending',
  raw_data jsonb not null default '{}'::jsonb,
  normalized_data jsonb not null default '{}'::jsonb,
  issues jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  external_id text not null unique,
  employee_no text,
  national_id text,
  full_name text not null,
  phone text,
  role text,
  salary numeric(18,2) not null default 0,
  active boolean not null default true,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  external_id text not null unique,
  plate_no text,
  asset_no text,
  vehicle_type text,
  make text,
  model text,
  driver_external_id text,
  status text default 'active',
  active boolean not null default true,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  external_id text not null unique,
  customer_code text,
  customer_name text not null,
  phone text,
  segment text,
  credit_limit numeric(18,2) not null default 0,
  payment_days integer not null default 0,
  active boolean not null default true,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bot_sessions (
  id uuid primary key default gen_random_uuid(),
  channel text not null,
  chat_id text not null,
  external_user_id text not null,
  state text not null default 'idle',
  context jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique(channel, chat_id, external_user_id)
);

create table if not exists public.maintenance_orders (
  id uuid primary key default gen_random_uuid(),
  reference_no text not null unique,
  vehicle_external_id text,
  plate_snapshot text,
  problem text not null,
  diagnosis text,
  priority text not null default 'normal',
  vehicle_stopped boolean not null default false,
  status text not null default 'draft' check (status in ('draft','reported','inspection','quotation_required','approval_pending','approved','in_repair','testing','completed','closed','cancelled')),
  reported_by uuid references public.app_users(id) on delete set null,
  confirmed_by uuid references public.app_users(id) on delete set null,
  approved_by uuid references public.app_users(id) on delete set null,
  source_channel text,
  source_chat_id text,
  source_message_id text,
  voice_path text,
  estimated_cost numeric(18,2) not null default 0,
  actual_cost numeric(18,2) not null default 0,
  reported_at timestamptz not null default now(),
  confirmed_at timestamptz,
  approved_at timestamptz,
  closed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.maintenance_updates (
  id uuid primary key default gen_random_uuid(),
  maintenance_id uuid not null references public.maintenance_orders(id) on delete cascade,
  status text,
  note text,
  attachment_path text,
  created_by uuid references public.app_users(id) on delete set null,
  source_channel text,
  source_chat_id text,
  source_message_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.quotations (
  id uuid primary key default gen_random_uuid(),
  reference_no text not null unique,
  maintenance_id uuid references public.maintenance_orders(id) on delete set null,
  supplier_name text,
  quotation_no text,
  quotation_date date,
  subtotal numeric(18,2) not null default 0,
  vat numeric(18,2) not null default 0,
  total numeric(18,2) not null default 0,
  file_path text,
  status text not null default 'draft' check (status in ('draft','pending_approval','approved','rejected','superseded')),
  extracted_data jsonb not null default '{}'::jsonb,
  entered_manually boolean not null default false,
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  reference_no text not null unique,
  entity_type text not null,
  entity_id uuid not null,
  summary text,
  amount numeric(18,2) not null default 0,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  requested_by uuid references public.app_users(id) on delete set null,
  decided_by uuid references public.app_users(id) on delete set null,
  decision_note text,
  source_chat_id text,
  source_message_id text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  reference_no text not null unique,
  maintenance_id uuid references public.maintenance_orders(id) on delete set null,
  quotation_id uuid references public.quotations(id) on delete set null,
  supplier_name text,
  invoice_no text,
  invoice_date date,
  subtotal numeric(18,2) not null default 0,
  vat numeric(18,2) not null default 0,
  total numeric(18,2) not null default 0,
  approved_difference numeric(18,2) not null default 0,
  file_path text,
  status text not null default 'draft' check (status in ('draft','needs_data','difference_pending','approved','posted','rejected')),
  extracted_data jsonb not null default '{}'::jsonb,
  entered_manually boolean not null default false,
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.discrepancies (
  id uuid primary key default gen_random_uuid(),
  reference_no text unique,
  source_type text,
  source_id uuid,
  discrepancy_type text not null,
  severity text not null default 'review' check (severity in ('notice','review','critical')),
  title text not null,
  expected_value jsonb,
  actual_value jsonb,
  difference_amount numeric(18,2) not null default 0,
  status text not null default 'open' check (status in ('open','under_review','resolved','accepted_with_reason','cancelled')),
  reason text,
  resolution text,
  assigned_to uuid references public.app_users(id) on delete set null,
  resolved_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.audit_log (
  id bigserial primary key,
  actor_type text,
  actor_id text,
  action text not null,
  entity_type text,
  entity_id text,
  old_value jsonb,
  new_value jsonb,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists telegram_messages_chat_created_idx on public.telegram_messages(chat_id, created_at desc);
create index if not exists imports_status_created_idx on public.imports(status, created_at desc);
create index if not exists maintenance_status_created_idx on public.maintenance_orders(status, created_at desc);
create index if not exists approvals_status_created_idx on public.approvals(status, created_at desc);
create index if not exists discrepancies_status_severity_idx on public.discrepancies(status, severity);
create index if not exists vehicles_plate_idx on public.vehicles(plate_no);
create index if not exists customers_code_idx on public.customers(customer_code);

create or replace function public.save_app_state(
  p_payload jsonb,
  p_base_revision bigint default null,
  p_updated_by text default null,
  p_device_id text default null,
  p_reason text default null
) returns table(revision bigint, updated_at timestamptz)
language plpgsql security definer set search_path=public as $$
declare v_revision bigint;
begin
  perform pg_advisory_xact_lock(hashtext('binhamid-app-state-primary'));
  select s.revision into v_revision from public.app_state s where s.key='primary' for update;
  if not found then
    if p_base_revision is not null and p_base_revision <> 0 then
      raise exception 'revision conflict: remote=0 local=%', p_base_revision using errcode='40001';
    end if;
    insert into public.app_state(key,revision,payload,updated_at,updated_by,device_id)
    values('primary',1,p_payload,now(),p_updated_by,p_device_id);
  else
    if p_base_revision is not null and p_base_revision <> v_revision then
      raise exception 'revision conflict: remote=% local=%', v_revision, p_base_revision using errcode='40001';
    end if;
    update public.app_state set revision=v_revision+1,payload=p_payload,updated_at=now(),updated_by=p_updated_by,device_id=p_device_id where key='primary';
  end if;
  insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details)
  values('system',coalesce(p_updated_by,'unknown'),'save_app_state','app_state','primary',jsonb_build_object('device_id',p_device_id,'reason',p_reason));
  return query select s.revision,s.updated_at from public.app_state s where s.key='primary';
end $$;

create or replace function public.next_document_no(p_prefix text)
returns text language plpgsql security definer set search_path=public as $$
declare v_value bigint;
begin
  insert into public.doc_sequences(prefix,value,updated_at) values(upper(p_prefix),1,now())
  on conflict(prefix) do update set value=public.doc_sequences.value+1,updated_at=now()
  returning value into v_value;
  return format('BH-%s-%s-%s',upper(p_prefix),extract(year from current_date)::int,lpad(v_value::text,5,'0'));
end $$;

create or replace function public.register_telegram_identity(
  p_external_id text,
  p_username text,
  p_full_name text,
  p_make_owner boolean default false
) returns table(user_id uuid, role text, active boolean, external_id text)
language plpgsql security definer set search_path=public as $$
declare v_user uuid;
begin
  select uc.user_id into v_user from public.user_channels uc where uc.channel='telegram' and uc.external_id=p_external_id;
  if v_user is null then
    insert into public.app_users(full_name,role,active)
    values(coalesce(nullif(p_full_name,''),p_external_id),case when p_make_owner then 'admin' else 'pending' end,p_make_owner)
    returning id into v_user;
    insert into public.user_channels(user_id,channel,external_id,external_username,active,last_seen_at)
    values(v_user,'telegram',p_external_id,nullif(p_username,''),true,now());
  else
    update public.user_channels set external_username=nullif(p_username,''),last_seen_at=now(),active=true where channel='telegram' and external_id=p_external_id;
    update public.app_users set full_name=coalesce(nullif(p_full_name,''),full_name),role=case when p_make_owner then 'admin' else role end,active=case when p_make_owner then true else active end,updated_at=now() where id=v_user;
  end if;
  return query select au.id,au.role,au.active,p_external_id from public.app_users au where au.id=v_user;
end $$;

create or replace function public.approve_telegram_user(
  p_external_id text,
  p_full_name text,
  p_role text,
  p_active boolean default true
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_user uuid;
begin
  if p_role not in ('admin','manager','accountant','mechanic','block_sales','concrete_sales','collector') then raise exception 'invalid role'; end if;
  select user_id into v_user from public.user_channels where channel='telegram' and external_id=p_external_id;
  if v_user is null then
    insert into public.app_users(full_name,role,active) values(coalesce(nullif(p_full_name,''),p_external_id),p_role,p_active) returning id into v_user;
    insert into public.user_channels(user_id,channel,external_id,active,last_seen_at) values(v_user,'telegram',p_external_id,true,now());
  else
    update public.app_users set full_name=coalesce(nullif(p_full_name,''),full_name),role=p_role,active=p_active,updated_at=now() where id=v_user;
    update public.user_channels set active=true,last_seen_at=now() where channel='telegram' and external_id=p_external_id;
  end if;
  insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details) values('web','web-admin','approve_telegram_user','app_user',v_user::text,jsonb_build_object('role',p_role,'external_id',p_external_id));
  return v_user;
end $$;

create or replace function public.decide_approval(
  p_approval_id uuid,
  p_decision text,
  p_decided_by uuid,
  p_note text default null
) returns table(reference_no text,status text)
language plpgsql security definer set search_path=public as $$
begin
  if p_decision not in ('approved','rejected') then raise exception 'invalid decision'; end if;
  update public.approvals set status=p_decision,decided_by=p_decided_by,decision_note=p_note,decided_at=now()
  where id=p_approval_id and status='pending';
  if not found then raise exception 'approval unavailable'; end if;
  return query select a.reference_no,a.status from public.approvals a where a.id=p_approval_id;
end $$;

-- Keep all tables private. Vercel uses the service-role key and bypasses RLS.
do $$ declare t text; begin
  foreach t in array array['app_state','doc_sequences','app_users','user_channels','telegram_groups','telegram_messages','imports','import_rows','employees','vehicles','customers','bot_sessions','maintenance_orders','maintenance_updates','quotations','approvals','invoices','discrepancies','audit_log'] loop
    execute format('alter table public.%I enable row level security',t);
  end loop;
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('factory-documents','factory-documents',false,26214400,array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel','application/pdf','image/jpeg','image/png','audio/ogg','audio/mpeg','audio/mp4','application/octet-stream'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
