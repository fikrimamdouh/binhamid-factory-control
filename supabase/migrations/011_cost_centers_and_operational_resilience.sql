-- Bin Hamid Factory Control — cost centers, allocation engine and operational resilience
-- Run after 010_daily_report_factory_os_foundation.sql.
-- Idempotent and non-destructive. Existing production rows are never deleted.

create extension if not exists pgcrypto;

create table if not exists public.cost_centers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_ar text not null,
  center_type text not null default 'operational' check (center_type in ('production','support','fleet','administration')),
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.cost_centers(code,name_ar,center_type) values
  ('block','البلوك','production'),
  ('concrete','الخرسانة','production'),
  ('fleet','الأسطول','fleet'),
  ('general','الإدارة العامة','administration'),
  ('shared','تكاليف مشتركة','support')
on conflict(code) do update set name_ar=excluded.name_ar,center_type=excluded.center_type;

alter table public.cost_ledger add column if not exists cost_center_id uuid;
alter table public.cost_ledger add column if not exists period_start date;
alter table public.cost_ledger add column if not exists calculation_run_id uuid;
alter table public.cost_ledger add column if not exists allocation_rule_id uuid;
alter table public.cost_ledger add column if not exists source_hash text;
alter table public.cost_ledger add column if not exists reversed_entry_id uuid;
alter table public.cost_ledger add column if not exists posted_status text not null default 'posted';

create table if not exists public.cost_periods (
  id uuid primary key default gen_random_uuid(),
  period_start date not null unique,
  status text not null default 'open' check (status in ('open','calculated','approved','reopened')),
  completeness_percent numeric(7,2) not null default 0,
  approved_run_id uuid,
  approved_by text,
  approved_at timestamptz,
  reopened_by text,
  reopened_at timestamptz,
  reopen_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_start=date_trunc('month',period_start)::date)
);

create table if not exists public.cost_calculation_runs (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.cost_periods(id) on delete restrict,
  run_no integer not null,
  status text not null default 'running' check (status in ('running','completed','approved','superseded','failed')),
  dry_run boolean not null default false,
  assumptions jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error_text text,
  created_by text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  approved_at timestamptz,
  unique(period_id,run_no)
);

create table if not exists public.cost_allocation_rules (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_ar text not null,
  source_center_id uuid not null references public.cost_centers(id) on delete restrict,
  target_center_id uuid not null references public.cost_centers(id) on delete restrict,
  basis text not null check (basis in ('fixed_percentage','sales_value','production_quantity','employee_count')),
  allocation_percent numeric(7,4) check (allocation_percent is null or allocation_percent between 0 and 100),
  settings jsonb not null default '{}'::jsonb,
  effective_from date not null default current_date,
  effective_to date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_center_id<>target_center_id),
  check (effective_to is null or effective_to>=effective_from)
);

create table if not exists public.asset_cost_center_assignments (
  id uuid primary key default gen_random_uuid(),
  asset_external_id text not null,
  asset_type text not null default 'vehicle' check (asset_type in ('vehicle','equipment','fixed_asset')),
  cost_center_id uuid not null references public.cost_centers(id) on delete restrict,
  effective_from date not null default current_date,
  effective_to date,
  active boolean not null default true,
  operational_exception boolean not null default false,
  exception_reason text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to>=effective_from)
);

create unique index if not exists asset_cost_assignment_period_uidx
  on public.asset_cost_center_assignments(asset_external_id,effective_from,cost_center_id);
create index if not exists asset_cost_assignment_lookup_idx
  on public.asset_cost_center_assignments(asset_external_id,active,effective_from,effective_to);

create table if not exists public.employee_cost_assignments (
  id uuid primary key default gen_random_uuid(),
  employee_external_id text not null,
  cost_center_id uuid not null references public.cost_centers(id) on delete restrict,
  allocation_percent numeric(7,4) not null check (allocation_percent>0 and allocation_percent<=100),
  effective_from date not null,
  effective_to date,
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to>=effective_from)
);

create unique index if not exists employee_cost_assignment_uidx
  on public.employee_cost_assignments(employee_external_id,cost_center_id,effective_from);
create index if not exists employee_cost_assignment_period_idx
  on public.employee_cost_assignments(employee_external_id,active,effective_from,effective_to);

create table if not exists public.indirect_cost_allocations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.cost_calculation_runs(id) on delete restrict,
  rule_id uuid not null references public.cost_allocation_rules(id) on delete restrict,
  source_center_id uuid not null references public.cost_centers(id) on delete restrict,
  target_center_id uuid not null references public.cost_centers(id) on delete restrict,
  source_amount numeric(18,2) not null default 0,
  allocation_ratio numeric(18,8) not null default 0,
  allocated_amount numeric(18,2) not null default 0,
  basis_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(run_id,rule_id,target_center_id)
);

create table if not exists public.operational_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_key text not null unique,
  alert_type text not null,
  severity text not null default 'warning' check (severity in ('info','warning','critical')),
  status text not null default 'pending' check (status in ('pending','sent','failed','acknowledged','resolved')),
  entity_type text,
  entity_id text,
  title text not null,
  message text not null,
  payload jsonb not null default '{}'::jsonb,
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  sent_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by text,
  resolved_at timestamptz,
  resolved_by text,
  attempts integer not null default 0,
  last_error text,
  next_attempt_at timestamptz
);

create index if not exists operational_alerts_queue_idx
  on public.operational_alerts(status,severity,next_attempt_at,last_detected_at desc);

create table if not exists public.role_capabilities (
  role text not null,
  capability text not null,
  allowed boolean not null default true,
  created_at timestamptz not null default now(),
  primary key(role,capability)
);

create table if not exists public.user_capabilities (
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  capability text not null,
  allowed boolean not null,
  granted_by text,
  created_at timestamptz not null default now(),
  primary key(app_user_id,capability)
);

insert into public.role_capabilities(role,capability) values
  ('admin','*'),
  ('manager','dashboard.manager'),('manager','daily_report.view'),('manager','costs.view'),('manager','audit.view'),
  ('accountant','daily_report.view'),('accountant','daily_report.import'),('accountant','daily_report.approve'),('accountant','costs.view'),('accountant','costs.calculate'),
  ('block_sales','daily_report.view'),('concrete_sales','daily_report.view'),
  ('mechanic','maintenance.manage'),('fuel_operator','fuel.import'),
  ('hr','costs.view'),('procurement','maintenance.manage')
on conflict(role,capability) do update set allowed=true;

create table if not exists public.backup_runs (
  id uuid primary key default gen_random_uuid(),
  environment text not null,
  backup_name text not null unique,
  schema_version integer not null default 0,
  status text not null default 'running' check (status in ('running','completed','failed','verified','expired')),
  storage_path text,
  manifest jsonb not null default '{}'::jsonb,
  checksum_sha256 text,
  encrypted boolean not null default false,
  size_bytes bigint,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  verified_at timestamptz,
  error_text text
);

create index if not exists backup_runs_status_idx on public.backup_runs(environment,status,started_at desc);

create table if not exists public.token_rotation_registry (
  secret_name text primary key,
  last_rotated_at timestamptz,
  next_due_at timestamptz,
  owner_role text,
  rotation_notes text,
  updated_at timestamptz not null default now(),
  check (secret_name not like '%=%')
);

insert into public.token_rotation_registry(secret_name,next_due_at,owner_role,rotation_notes) values
  ('SUPABASE_SERVICE_ROLE_KEY',now()+interval '3 months','admin','لا تُخزّن قيمة المفتاح في قاعدة البيانات'),
  ('BINHAMID_ADMIN_TOKEN',now()+interval '3 months','admin','دعم انتقال قصير عبر متغير ثانوي عند التدوير'),
  ('TELEGRAM_BOT_TOKEN',now()+interval '3 months','admin','إعادة تسجيل Webhook بعد التدوير'),
  ('TELEGRAM_WEBHOOK_SECRET',now()+interval '3 months','admin','تحديث Vercel ثم تسجيل Webhook'),
  ('OPENAI_API_KEY',now()+interval '3 months','admin','اختياري')
on conflict(secret_name) do nothing;

create table if not exists public.gps_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  vehicle_external_id text not null,
  occurred_at timestamptz not null,
  latitude numeric(10,7),
  longitude numeric(10,7),
  distance_km numeric(18,3),
  engine_on boolean,
  fuel_level numeric(18,3),
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(provider,provider_event_id)
);

create index if not exists gps_provider_vehicle_time_idx
  on public.gps_provider_events(vehicle_external_id,occurred_at desc);

alter table public.driver_events add column if not exists client_event_id text;
create unique index if not exists driver_events_client_event_uidx
  on public.driver_events(app_user_id,client_event_id) where client_event_id is not null;

-- Add foreign keys after the referenced tables exist, without failing on reruns.
do $$ begin
  if not exists(select 1 from pg_constraint where conname='cost_ledger_center_fk') then
    alter table public.cost_ledger add constraint cost_ledger_center_fk foreign key(cost_center_id) references public.cost_centers(id) on delete restrict;
  end if;
  if not exists(select 1 from pg_constraint where conname='cost_ledger_run_fk') then
    alter table public.cost_ledger add constraint cost_ledger_run_fk foreign key(calculation_run_id) references public.cost_calculation_runs(id) on delete set null;
  end if;
  if not exists(select 1 from pg_constraint where conname='cost_ledger_rule_fk') then
    alter table public.cost_ledger add constraint cost_ledger_rule_fk foreign key(allocation_rule_id) references public.cost_allocation_rules(id) on delete set null;
  end if;
  if not exists(select 1 from pg_constraint where conname='cost_ledger_reversal_fk') then
    alter table public.cost_ledger add constraint cost_ledger_reversal_fk foreign key(reversed_entry_id) references public.cost_ledger(id) on delete restrict;
  end if;
end $$;

update public.cost_ledger l
set cost_center_id=c.id,
    period_start=date_trunc('month',l.occurred_at)::date
from public.cost_centers c
where c.code=l.cost_center and (l.cost_center_id is null or l.period_start is null);

create index if not exists cost_ledger_period_center_idx
  on public.cost_ledger(period_start,cost_center_id,entry_type);
create unique index if not exists cost_ledger_source_hash_uidx
  on public.cost_ledger(source_hash) where source_hash is not null;

create or replace function public.sync_cost_ledger_center()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.cost_center_id is null then
    select id into new.cost_center_id from public.cost_centers where code=new.cost_center;
  end if;
  if new.period_start is null then new.period_start:=date_trunc('month',new.occurred_at)::date; end if;
  return new;
end $$;

drop trigger if exists cost_ledger_center_sync_trigger on public.cost_ledger;
create trigger cost_ledger_center_sync_trigger
before insert or update of cost_center,cost_center_id,occurred_at on public.cost_ledger
for each row execute function public.sync_cost_ledger_center();

create or replace function public.project_driver_fuel_cost()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_center record; v_unclassified boolean:=false;
begin
  if new.event_type<>'fuel_complete' or coalesce(new.fuel_amount,0)<=0 then return new; end if;
  select c.id,c.code into v_center
  from public.asset_cost_center_assignments a join public.cost_centers c on c.id=a.cost_center_id
  where a.asset_external_id=new.vehicle_external_id and a.active=true
    and a.effective_from<=new.occurred_at::date and (a.effective_to is null or a.effective_to>=new.occurred_at::date)
  order by a.effective_from desc limit 1;
  if v_center.id is null then
    select id,code into v_center from public.cost_centers where code='fleet';
    v_unclassified:=true;
  end if;
  insert into public.cost_ledger(entry_type,cost_center,cost_center_id,source_type,source_reference,source_hash,amount,quantity,unit,allocation_basis,metadata,occurred_at,period_start)
  values('direct_cost',v_center.code,v_center.id,'driver_fuel_event',new.reference_no,
    encode(digest(concat_ws('|','fuel',new.reference_no,new.vehicle_external_id,new.fuel_amount,new.fuel_liters),'sha256'),'hex'),
    new.fuel_amount,coalesce(new.fuel_liters,0),'liter','direct',
    jsonb_build_object('vehicle_external_id',new.vehicle_external_id,'plate_or_asset',new.vehicle_external_id,'unclassified',v_unclassified,'source_event_id',new.id),
    new.occurred_at,date_trunc('month',new.occurred_at)::date)
  on conflict(source_type,source_reference,entry_type) do update set amount=excluded.amount,quantity=excluded.quantity,cost_center=excluded.cost_center,cost_center_id=excluded.cost_center_id,metadata=excluded.metadata,occurred_at=excluded.occurred_at,period_start=excluded.period_start;
  return new;
end $$;

drop trigger if exists driver_fuel_cost_projection_trigger on public.driver_events;
create trigger driver_fuel_cost_projection_trigger
after insert or update of event_type,fuel_amount,fuel_liters,vehicle_external_id on public.driver_events
for each row execute function public.project_driver_fuel_cost();

create or replace function public.project_maintenance_cost()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_center record; v_unclassified boolean:=false; v_time timestamptz;
begin
  if new.status not in ('completed','closed') or coalesce(new.actual_cost,0)<=0 then return new; end if;
  v_time:=coalesce(new.closed_at,new.updated_at,new.created_at,now());
  select c.id,c.code into v_center
  from public.asset_cost_center_assignments a join public.cost_centers c on c.id=a.cost_center_id
  where a.asset_external_id=new.vehicle_external_id and a.active=true
    and a.effective_from<=v_time::date and (a.effective_to is null or a.effective_to>=v_time::date)
  order by a.effective_from desc limit 1;
  if v_center.id is null then select id,code into v_center from public.cost_centers where code='fleet';v_unclassified:=true; end if;
  insert into public.cost_ledger(entry_type,cost_center,cost_center_id,source_type,source_reference,source_hash,amount,quantity,unit,allocation_basis,metadata,occurred_at,period_start)
  values('direct_cost',v_center.code,v_center.id,'maintenance_order',new.reference_no,
    encode(digest(concat_ws('|','maintenance',new.reference_no,new.actual_cost,new.status),'sha256'),'hex'),
    new.actual_cost,0,null,'direct',jsonb_build_object('maintenance_id',new.id,'vehicle_external_id',new.vehicle_external_id,'unclassified',v_unclassified,'status',new.status),v_time,date_trunc('month',v_time)::date)
  on conflict(source_type,source_reference,entry_type) do update set amount=excluded.amount,cost_center=excluded.cost_center,cost_center_id=excluded.cost_center_id,metadata=excluded.metadata,occurred_at=excluded.occurred_at,period_start=excluded.period_start;
  return new;
end $$;

drop trigger if exists maintenance_cost_projection_trigger on public.maintenance_orders;
create trigger maintenance_cost_projection_trigger
after insert or update of status,actual_cost,vehicle_external_id,closed_at on public.maintenance_orders
for each row execute function public.project_maintenance_cost();

create or replace view public.cost_unit_monthly_report as
with ledger as (
  select coalesce(period_start,date_trunc('month',occurred_at)::date) period_start,cost_center,entry_type,amount,quantity,metadata
  from public.cost_ledger where posted_status='posted'
), product as (
  select period_start,cost_center,
    coalesce(sum(amount) filter(where entry_type='revenue'),0)::numeric(18,2) revenue,
    coalesce(sum(amount) filter(where entry_type in ('direct_cost','shared_cost','allocation','adjustment')),0)::numeric(18,2) actual_cost,
    coalesce(sum(quantity) filter(where entry_type='revenue'),0)::numeric(18,3) sold_quantity,
    coalesce(sum(amount) filter(where entry_type='direct_cost'),0)::numeric(18,2) direct_cost,
    coalesce(sum(amount) filter(where entry_type in ('shared_cost','allocation')),0)::numeric(18,2) indirect_cost
  from ledger where cost_center in ('block','concrete') group by period_start,cost_center
), gaps as (
  select period_start,
    coalesce(sum(abs(amount)) filter(where coalesce((metadata->>'unclassified')::boolean,false)),0) unclassified_cost,
    coalesce(sum(abs(amount)) filter(where entry_type in ('direct_cost','shared_cost','allocation','adjustment')),0) total_cost
  from ledger group by period_start
)
select p.period_start,p.cost_center,p.revenue,p.actual_cost,p.sold_quantity,p.direct_cost,p.indirect_cost,
  case when p.sold_quantity>0 then round(p.actual_cost/p.sold_quantity,4) end unit_cost,
  case when p.sold_quantity>0 then round(p.revenue/p.sold_quantity,4) end average_sale_price,
  (p.revenue-p.actual_cost)::numeric(18,2) gross_margin,
  case when p.sold_quantity>0 then round((p.revenue-p.actual_cost)/p.sold_quantity,4) end margin_per_unit,
  coalesce(g.unclassified_cost,0)::numeric(18,2) unclassified_cost,
  case when coalesce(g.total_cost,0)>0 then greatest(0,round((1-(g.unclassified_cost/g.total_cost))*100,2)) else 0 end completeness_percent
from product p left join gaps g on g.period_start=p.period_start;

create or replace function public.run_cost_period(p_period_start date,p_actor text default 'web-admin',p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_start date:=date_trunc('month',p_period_start)::date;
  v_end date:=(date_trunc('month',p_period_start)+interval '1 month')::date;
  v_period public.cost_periods%rowtype;
  v_run_id uuid;
  v_run_no integer;
  v_assignment record;
  v_rule record;
  v_days integer;
  v_month_days integer:=(v_end-v_start);
  v_amount numeric:=0;
  v_salary_total numeric:=0;
  v_alloc_total numeric:=0;
  v_source_amount numeric:=0;
  v_target_metric numeric:=0;
  v_total_metric numeric:=0;
  v_ratio numeric:=0;
  v_unclassified numeric:=0;
  v_total_cost numeric:=0;
  v_completeness numeric:=0;
begin
  if p_period_start is null then raise exception 'period is required'; end if;
  insert into public.cost_periods(period_start) values(v_start) on conflict(period_start) do nothing;
  select * into v_period from public.cost_periods where period_start=v_start for update;
  if v_period.status='approved' then raise exception 'COST_PERIOD_APPROVED'; end if;

  if not p_dry_run then
    select coalesce(max(run_no),0)+1 into v_run_no from public.cost_calculation_runs where period_id=v_period.id;
    insert into public.cost_calculation_runs(period_id,run_no,status,dry_run,created_by,assumptions)
    values(v_period.id,v_run_no,'running',false,p_actor,jsonb_build_object('period_start',v_start,'engine_version','011')) returning id into v_run_id;

    update public.cost_calculation_runs set status='superseded'
    where period_id=v_period.id and id<>v_run_id and status='completed';

    delete from public.cost_ledger
    where period_start=v_start and source_type in ('salary_allocation','cost_rule_allocation')
      and calculation_run_id in (select id from public.cost_calculation_runs where period_id=v_period.id and status<>'approved');
    delete from public.indirect_cost_allocations
    where run_id in (select id from public.cost_calculation_runs where period_id=v_period.id and id<>v_run_id and status<>'approved');
  end if;

  for v_assignment in
    select a.*,e.salary,c.code center_code
    from public.employee_cost_assignments a
    join public.employees e on e.external_id=a.employee_external_id and e.active=true
    join public.cost_centers c on c.id=a.cost_center_id
    where a.active=true and a.effective_from<v_end and coalesce(a.effective_to,v_end-1)>=v_start
  loop
    v_days:=greatest(0,(least(coalesce(v_assignment.effective_to,v_end-1),v_end-1)-greatest(v_assignment.effective_from,v_start)+1));
    v_amount:=round((coalesce(v_assignment.salary,0)/v_month_days)*v_days*(v_assignment.allocation_percent/100),2);
    v_salary_total:=v_salary_total+v_amount;
    if not p_dry_run and v_amount<>0 then
      insert into public.cost_ledger(entry_type,cost_center,cost_center_id,source_type,source_reference,amount,quantity,unit,allocation_basis,metadata,occurred_at,period_start,calculation_run_id)
      values('direct_cost',v_assignment.center_code,v_assignment.cost_center_id,'salary_allocation',concat(to_char(v_start,'YYYY-MM'),':',v_assignment.employee_external_id,':',v_assignment.center_code),v_amount,0,null,'employee_assignment',
        jsonb_build_object('employee_external_id',v_assignment.employee_external_id,'allocation_percent',v_assignment.allocation_percent,'covered_days',v_days,'month_days',v_month_days,'run_generated',true),
        v_start+interval '15 days',v_start,v_run_id)
      on conflict(source_type,source_reference,entry_type) do update set amount=excluded.amount,cost_center=excluded.cost_center,cost_center_id=excluded.cost_center_id,metadata=excluded.metadata,occurred_at=excluded.occurred_at,period_start=excluded.period_start,calculation_run_id=excluded.calculation_run_id;
    end if;
  end loop;

  for v_rule in
    select r.*,s.code source_code,t.code target_code
    from public.cost_allocation_rules r
    join public.cost_centers s on s.id=r.source_center_id
    join public.cost_centers t on t.id=r.target_center_id
    where r.active=true and r.effective_from<v_end and coalesce(r.effective_to,v_end-1)>=v_start
  loop
    select coalesce(sum(amount),0) into v_source_amount from public.cost_ledger
    where period_start=v_start and cost_center_id=v_rule.source_center_id and entry_type in ('direct_cost','shared_cost','adjustment') and source_type<>'cost_rule_allocation';
    v_ratio:=0;
    if v_rule.basis='fixed_percentage' then v_ratio:=coalesce(v_rule.allocation_percent,0)/100;
    elsif v_rule.basis='sales_value' then
      select coalesce(sum(amount) filter(where cost_center_id=v_rule.target_center_id),0),coalesce(sum(amount),0)
      into v_target_metric,v_total_metric from public.cost_ledger where period_start=v_start and entry_type='revenue' and cost_center in ('block','concrete');
      if v_total_metric<>0 then v_ratio:=v_target_metric/v_total_metric; end if;
    elsif v_rule.basis='production_quantity' then
      select coalesce(sum(quantity) filter(where cost_center_id=v_rule.target_center_id),0),coalesce(sum(quantity),0)
      into v_target_metric,v_total_metric from public.cost_ledger where period_start=v_start and entry_type='revenue' and cost_center in ('block','concrete');
      if v_total_metric<>0 then v_ratio:=v_target_metric/v_total_metric; end if;
    elsif v_rule.basis='employee_count' then
      select count(*) filter(where cost_center_id=v_rule.target_center_id),count(*) into v_target_metric,v_total_metric
      from public.employee_cost_assignments where active=true and effective_from<v_end and coalesce(effective_to,v_end-1)>=v_start;
      if v_total_metric<>0 then v_ratio:=v_target_metric/v_total_metric; end if;
    end if;
    v_amount:=round(v_source_amount*v_ratio,2);
    v_alloc_total:=v_alloc_total+abs(v_amount);
    if not p_dry_run and v_amount<>0 then
      insert into public.indirect_cost_allocations(run_id,rule_id,source_center_id,target_center_id,source_amount,allocation_ratio,allocated_amount,basis_snapshot)
      values(v_run_id,v_rule.id,v_rule.source_center_id,v_rule.target_center_id,v_source_amount,v_ratio,v_amount,jsonb_build_object('basis',v_rule.basis,'source_amount',v_source_amount,'ratio',v_ratio));
      insert into public.cost_ledger(entry_type,cost_center,cost_center_id,source_type,source_reference,amount,allocation_basis,metadata,occurred_at,period_start,calculation_run_id,allocation_rule_id)
      values('allocation',v_rule.target_code,v_rule.target_center_id,'cost_rule_allocation',concat(to_char(v_start,'YYYY-MM'),':',v_rule.code,':target'),v_amount,v_rule.basis,jsonb_build_object('run_generated',true,'direction','target','source_center',v_rule.source_code),v_start+interval '20 days',v_start,v_run_id,v_rule.id)
      on conflict(source_type,source_reference,entry_type) do update set amount=excluded.amount,cost_center=excluded.cost_center,cost_center_id=excluded.cost_center_id,metadata=excluded.metadata,calculation_run_id=excluded.calculation_run_id,allocation_rule_id=excluded.allocation_rule_id;
      insert into public.cost_ledger(entry_type,cost_center,cost_center_id,source_type,source_reference,amount,allocation_basis,metadata,occurred_at,period_start,calculation_run_id,allocation_rule_id)
      values('allocation',v_rule.source_code,v_rule.source_center_id,'cost_rule_allocation',concat(to_char(v_start,'YYYY-MM'),':',v_rule.code,':source'),-v_amount,v_rule.basis,jsonb_build_object('run_generated',true,'direction','source','target_center',v_rule.target_code),v_start+interval '20 days',v_start,v_run_id,v_rule.id)
      on conflict(source_type,source_reference,entry_type) do update set amount=excluded.amount,cost_center=excluded.cost_center,cost_center_id=excluded.cost_center_id,metadata=excluded.metadata,calculation_run_id=excluded.calculation_run_id,allocation_rule_id=excluded.allocation_rule_id;
    end if;
  end loop;

  select coalesce(sum(abs(amount)) filter(where coalesce((metadata->>'unclassified')::boolean,false)),0),coalesce(sum(abs(amount)) filter(where entry_type in ('direct_cost','shared_cost','allocation','adjustment')),0)
  into v_unclassified,v_total_cost from public.cost_ledger where period_start=v_start;
  v_completeness:=case when v_total_cost>0 then greatest(0,round((1-(v_unclassified/v_total_cost))*100,2)) else 0 end;

  if p_dry_run then
    return jsonb_build_object('dryRun',true,'periodStart',v_start,'salaryEstimate',v_salary_total,'allocationEstimate',v_alloc_total,'unclassifiedCost',v_unclassified,'completenessPercent',v_completeness);
  end if;

  update public.cost_calculation_runs set status='completed',completed_at=now(),result=jsonb_build_object('salaryTotal',v_salary_total,'allocationTotal',v_alloc_total,'unclassifiedCost',v_unclassified,'completenessPercent',v_completeness) where id=v_run_id;
  update public.cost_periods set status='calculated',completeness_percent=v_completeness,updated_at=now() where id=v_period.id;
  insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details)
  values('web',p_actor,'cost_period_calculated','cost_period',v_period.id::text,jsonb_build_object('period_start',v_start,'run_id',v_run_id,'salary_total',v_salary_total,'allocation_total',v_alloc_total,'completeness_percent',v_completeness));
  return jsonb_build_object('dryRun',false,'periodStart',v_start,'runId',v_run_id,'salaryTotal',v_salary_total,'allocationTotal',v_alloc_total,'unclassifiedCost',v_unclassified,'completenessPercent',v_completeness);
exception when others then
  if v_run_id is not null then update public.cost_calculation_runs set status='failed',error_text=sqlerrm,completed_at=now() where id=v_run_id; end if;
  raise;
end $$;

create or replace function public.approve_cost_run(p_run_id uuid,p_actor text default 'web-admin')
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_run public.cost_calculation_runs%rowtype; v_period public.cost_periods%rowtype;
begin
  select * into v_run from public.cost_calculation_runs where id=p_run_id for update;
  if not found or v_run.status<>'completed' then raise exception 'COST_RUN_NOT_READY'; end if;
  select * into v_period from public.cost_periods where id=v_run.period_id for update;
  update public.cost_calculation_runs set status='approved',approved_at=now() where id=p_run_id;
  update public.cost_periods set status='approved',approved_run_id=p_run_id,approved_by=p_actor,approved_at=now(),updated_at=now() where id=v_run.period_id;
  insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details)
  values('web',p_actor,'cost_period_approved','cost_period',v_run.period_id::text,jsonb_build_object('run_id',p_run_id,'period_start',v_period.period_start));
  return jsonb_build_object('approved',true,'runId',p_run_id,'periodStart',v_period.period_start);
end $$;

create or replace function public.reopen_cost_period(p_period_start date,p_actor text,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_period public.cost_periods%rowtype;
begin
  if nullif(trim(p_reason),'') is null then raise exception 'REOPEN_REASON_REQUIRED'; end if;
  select * into v_period from public.cost_periods where period_start=date_trunc('month',p_period_start)::date for update;
  if not found then raise exception 'COST_PERIOD_NOT_FOUND'; end if;
  update public.cost_periods set status='reopened',approved_run_id=null,approved_by=null,approved_at=null,reopened_by=p_actor,reopened_at=now(),reopen_reason=p_reason,updated_at=now() where id=v_period.id;
  if v_period.approved_run_id is not null then update public.cost_calculation_runs set status='superseded' where id=v_period.approved_run_id; end if;
  insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details)
  values('web',p_actor,'cost_period_reopened','cost_period',v_period.id::text,jsonb_build_object('period_start',v_period.period_start,'reason',p_reason,'old_run_id',v_period.approved_run_id));
  return jsonb_build_object('reopened',true,'periodStart',v_period.period_start);
end $$;

create or replace function public.upsert_operational_alert(p_alert_key text,p_alert_type text,p_severity text,p_title text,p_message text,p_payload jsonb default '{}'::jsonb,p_entity_type text default null,p_entity_id text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  insert into public.operational_alerts(alert_key,alert_type,severity,title,message,payload,entity_type,entity_id,next_attempt_at)
  values(p_alert_key,p_alert_type,p_severity,p_title,p_message,coalesce(p_payload,'{}'::jsonb),p_entity_type,p_entity_id,now())
  on conflict(alert_key) do update set alert_type=excluded.alert_type,severity=excluded.severity,title=excluded.title,message=excluded.message,payload=excluded.payload,entity_type=excluded.entity_type,entity_id=excluded.entity_id,last_detected_at=now(),status=case when operational_alerts.status='resolved' then 'pending' else operational_alerts.status end,next_attempt_at=case when operational_alerts.status in ('failed','resolved') then now() else operational_alerts.next_attempt_at end
  returning id into v_id;
  return v_id;
end $$;

insert into public.migration_history(version,migration_name) values(11,'011_cost_centers_and_operational_resilience')
on conflict(version) do update set migration_name=excluded.migration_name;

alter table public.cost_centers enable row level security;
alter table public.cost_periods enable row level security;
alter table public.cost_calculation_runs enable row level security;
alter table public.cost_allocation_rules enable row level security;
alter table public.asset_cost_center_assignments enable row level security;
alter table public.employee_cost_assignments enable row level security;
alter table public.indirect_cost_allocations enable row level security;
alter table public.operational_alerts enable row level security;
alter table public.role_capabilities enable row level security;
alter table public.user_capabilities enable row level security;
alter table public.backup_runs enable row level security;
alter table public.token_rotation_registry enable row level security;
alter table public.gps_provider_events enable row level security;

revoke all on public.cost_centers,public.cost_periods,public.cost_calculation_runs,public.cost_allocation_rules,public.asset_cost_center_assignments,public.employee_cost_assignments,public.indirect_cost_allocations,public.operational_alerts,public.role_capabilities,public.user_capabilities,public.backup_runs,public.token_rotation_registry,public.gps_provider_events from anon,authenticated;
revoke all on function public.run_cost_period(date,text,boolean) from anon,authenticated;
revoke all on function public.approve_cost_run(uuid,text) from anon,authenticated;
revoke all on function public.reopen_cost_period(date,text,text) from anon,authenticated;
revoke all on function public.upsert_operational_alert(text,text,text,text,text,jsonb,text,text) from anon,authenticated;
revoke all on function public.project_driver_fuel_cost() from anon,authenticated;
revoke all on function public.project_maintenance_cost() from anon,authenticated;
