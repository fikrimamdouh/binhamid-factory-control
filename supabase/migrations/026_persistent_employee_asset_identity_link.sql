begin;

-- Persistent employee master data used by Telegram identity linking and cost allocation.
alter table public.employees add column if not exists site text;
alter table public.employees add column if not exists basic_salary numeric(18,2) not null default 0;
alter table public.employees add column if not exists housing_allowance numeric(18,2) not null default 0;
alter table public.employees add column if not exists transport_allowance numeric(18,2) not null default 0;
alter table public.employees add column if not exists total_package numeric(18,2) not null default 0;
alter table public.employees add column if not exists factory_status text;
alter table public.employees add column if not exists metadata jsonb not null default '{}'::jsonb;

update public.employees
set national_id=nullif(regexp_replace(coalesce(national_id,''),'[^0-9]','','g'),'')
where national_id is distinct from nullif(regexp_replace(coalesce(national_id,''),'[^0-9]','','g'),'');

create index if not exists employees_national_id_active_idx
on public.employees(national_id) where active and national_id is not null;
create index if not exists employees_role_active_idx
on public.employees(role,active);
create index if not exists unified_assets_employee_active_idx
on public.unified_assets(assigned_employee_external_id,active)
where assigned_employee_external_id is not null;

create or replace function public.guard_employee_national_id()
returns trigger language plpgsql set search_path=public as $$
declare v_id text;
begin
  v_id:=nullif(regexp_replace(coalesce(new.national_id,''),'[^0-9]','','g'),'');
  new.national_id:=v_id;
  if new.active and v_id is not null and exists(
    select 1 from public.employees e
    where e.active and e.national_id=v_id and e.id<>new.id
  ) then
    raise exception 'EMPLOYEE_NATIONAL_ID_DUPLICATE:%',v_id;
  end if;
  return new;
end $$;

drop trigger if exists employees_national_id_guard on public.employees;
create trigger employees_national_id_guard
before insert or update of national_id,active on public.employees
for each row execute function public.guard_employee_national_id();

create table if not exists public.master_data_import_runs (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  actor text not null,
  employee_count integer not null default 0,
  asset_count integer not null default 0,
  vehicle_count integer not null default 0,
  linked_asset_count integer not null default 0,
  warning_count integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists master_data_import_runs_created_idx on public.master_data_import_runs(created_at desc);

create or replace view public.employee_asset_directory as
select
  e.external_id as employee_external_id,
  e.national_id,
  e.employee_no,
  e.full_name,
  e.nickname,
  e.role,
  e.site,
  e.salary,
  e.active as employee_active,
  a.external_id as asset_external_id,
  a.asset_type,
  a.asset_name,
  a.plate_no,
  a.asset_no,
  a.operational_status,
  a.diesel_expected,
  a.cost_center_code,
  a.active as asset_active
from public.employees e
left join public.unified_assets a
  on a.assigned_employee_external_id=e.external_id and a.active=true;

create or replace view public.control_employee_identity_duplicates as
select national_id,count(*) as employee_count,array_agg(external_id order by external_id) as employee_external_ids
from public.employees
where active and national_id is not null
group by national_id having count(*)>1;

-- Keep the legacy vehicles directory synchronized when a unified asset is edited.
create or replace function public.sync_unified_asset_to_vehicle()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.asset_type in ('vehicle','equipment') and (new.plate_no is not null or new.asset_no is not null) then
    insert into public.vehicles(external_id,plate_no,asset_no,vehicle_type,make,model,driver_external_id,status,active,source_updated_at,updated_at)
    values(new.external_id,new.plate_no,new.asset_no,coalesce(new.asset_name,new.asset_type),new.make,new.model,new.assigned_employee_external_id,new.operational_status,new.active,new.source_updated_at,now())
    on conflict(external_id) do update set
      plate_no=excluded.plate_no,asset_no=excluded.asset_no,vehicle_type=excluded.vehicle_type,make=excluded.make,model=excluded.model,
      driver_external_id=excluded.driver_external_id,status=excluded.status,active=excluded.active,source_updated_at=excluded.source_updated_at,updated_at=now();
  end if;
  return new;
end $$;

drop trigger if exists unified_assets_vehicle_sync on public.unified_assets;
create trigger unified_assets_vehicle_sync
after insert or update of plate_no,asset_no,asset_name,asset_type,make,model,assigned_employee_external_id,operational_status,active
on public.unified_assets for each row execute function public.sync_unified_asset_to_vehicle();

insert into public.migration_history(version,migration_name)
values(26,'026_persistent_employee_asset_identity_link')
on conflict(version) do update set migration_name=excluded.migration_name;

commit;
