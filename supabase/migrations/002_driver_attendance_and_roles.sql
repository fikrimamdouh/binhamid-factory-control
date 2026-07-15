-- Bin Hamid Factory Control — drivers, employees, attendance, locations and movement
-- Run once in Supabase SQL Editor after 001_initial_schema.sql.

alter table public.app_users drop constraint if exists app_users_role_check;
alter table public.app_users add constraint app_users_role_check check (
  role in (
    'pending','admin','manager','accountant','mechanic','block_sales','concrete_sales','collector',
    'driver','employee','warehouse','fuel_operator','hr','procurement','quality'
  )
);

create table if not exists public.work_sites (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  address text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  radius_m integer not null default 250 check (radius_m between 25 and 10000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_assignments (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null unique references public.app_users(id) on delete cascade,
  employee_external_id text,
  site_id uuid references public.work_sites(id) on delete set null,
  vehicle_external_id text,
  job_title text,
  shift_name text,
  active boolean not null default true,
  assigned_by uuid references public.app_users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.attendance_events (
  id uuid primary key default gen_random_uuid(),
  reference_no text not null unique,
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  employee_external_id text,
  site_id uuid references public.work_sites(id) on delete set null,
  event_type text not null check (event_type in ('check_in','check_out','break_start','break_end','field_arrival','field_departure')),
  latitude numeric(10,7),
  longitude numeric(10,7),
  horizontal_accuracy_m numeric(12,2),
  distance_from_site_m numeric(12,2),
  within_geofence boolean,
  note text,
  source_chat_id text,
  source_message_id text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.driver_events (
  id uuid primary key default gen_random_uuid(),
  reference_no text not null unique,
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  employee_external_id text,
  vehicle_external_id text,
  event_type text not null check (event_type in (
    'shift_start','shift_end','trip_start','trip_end','location_update','arrived','loaded','delivered','delay','fault',
    'fuel_start','fuel_complete','odometer_reading'
  )),
  latitude numeric(10,7),
  longitude numeric(10,7),
  horizontal_accuracy_m numeric(12,2),
  odometer numeric(18,2),
  fuel_liters numeric(18,3),
  fuel_amount numeric(18,2),
  station_name text,
  destination text,
  odometer_photo_path text,
  receipt_photo_path text,
  note text,
  source_chat_id text,
  source_message_id text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists attendance_user_time_idx on public.attendance_events(app_user_id, occurred_at desc);
create index if not exists attendance_site_time_idx on public.attendance_events(site_id, occurred_at desc);
create index if not exists driver_events_user_time_idx on public.driver_events(app_user_id, occurred_at desc);
create index if not exists driver_events_vehicle_time_idx on public.driver_events(vehicle_external_id, occurred_at desc);
create index if not exists assignments_site_idx on public.employee_assignments(site_id, active);

drop function if exists public.approve_telegram_user(text,text,text,boolean);
drop function if exists public.approve_telegram_user(text,text,text,boolean,text);
create function public.approve_telegram_user(
  p_external_id text,
  p_full_name text,
  p_role text,
  p_active boolean default true,
  p_employee_external_id text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_user uuid;
begin
  if p_role not in (
    'admin','manager','accountant','mechanic','block_sales','concrete_sales','collector',
    'driver','employee','warehouse','fuel_operator','hr','procurement','quality'
  ) then raise exception 'invalid role'; end if;
  select user_id into v_user from public.user_channels where channel='telegram' and external_id=p_external_id;
  if v_user is null then
    insert into public.app_users(full_name,role,active,employee_external_id)
    values(coalesce(nullif(p_full_name,''),p_external_id),p_role,p_active,nullif(p_employee_external_id,'')) returning id into v_user;
    insert into public.user_channels(user_id,channel,external_id,active,last_seen_at)
    values(v_user,'telegram',p_external_id,true,now());
  else
    update public.app_users set
      full_name=coalesce(nullif(p_full_name,''),full_name),
      role=p_role,
      active=p_active,
      employee_external_id=coalesce(nullif(p_employee_external_id,''),employee_external_id),
      updated_at=now()
    where id=v_user;
    update public.user_channels set active=true,last_seen_at=now() where channel='telegram' and external_id=p_external_id;
  end if;
  insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details)
  values('web','web-admin','approve_telegram_user','app_user',v_user::text,jsonb_build_object('role',p_role,'external_id',p_external_id,'employee_external_id',p_employee_external_id));
  return v_user;
end $$;

alter table public.work_sites enable row level security;
alter table public.employee_assignments enable row level security;
alter table public.attendance_events enable row level security;
alter table public.driver_events enable row level security;

revoke all on public.work_sites, public.employee_assignments, public.attendance_events, public.driver_events from anon, authenticated;
revoke all on function public.approve_telegram_user(text,text,text,boolean,text) from anon, authenticated;
