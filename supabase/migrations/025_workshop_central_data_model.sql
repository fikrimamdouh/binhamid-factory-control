-- Bin Hamid Factory Control — workshop central data model
-- Run after 024_employee_nickname_and_financial_command_center.sql.
-- Idempotent and non-destructive. Existing maintenance and operational rows are preserved.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Extend the existing maintenance order without removing legacy columns.
-- ---------------------------------------------------------------------------

alter table public.maintenance_orders add column if not exists asset_external_id text;
alter table public.maintenance_orders add column if not exists fault_category text;
alter table public.maintenance_orders add column if not exists assigned_supervisor_id text;
alter table public.maintenance_orders add column if not exists started_at timestamptz;
alter table public.maintenance_orders add column if not exists target_completion_at timestamptz;
alter table public.maintenance_orders add column if not exists completed_at timestamptz;
alter table public.maintenance_orders add column if not exists downtime_started_at timestamptz;
alter table public.maintenance_orders add column if not exists downtime_ended_at timestamptz;
alter table public.maintenance_orders add column if not exists approved_cost numeric(18,2);
alter table public.maintenance_orders add column if not exists root_cause text;
alter table public.maintenance_orders add column if not exists resolution_summary text;
alter table public.maintenance_orders add column if not exists test_result text;
alter table public.maintenance_orders add column if not exists handover_status text not null default 'pending';
alter table public.maintenance_orders add column if not exists version integer not null default 1;

-- Preserve the legacy vehicle link during transition and populate the unified link only
-- when the referenced unified asset already exists.
update public.maintenance_orders mo
set asset_external_id=mo.vehicle_external_id,
    updated_at=now()
where nullif(trim(coalesce(mo.asset_external_id,'')),'') is null
  and nullif(trim(coalesce(mo.vehicle_external_id,'')),'') is not null
  and exists(select 1 from public.unified_assets ua where ua.external_id=mo.vehicle_external_id);

create index if not exists maintenance_orders_asset_status_idx
  on public.maintenance_orders(asset_external_id,status,updated_at desc);
create index if not exists maintenance_orders_priority_status_idx
  on public.maintenance_orders(priority,status,reported_at desc);
create unique index if not exists maintenance_orders_telegram_source_uidx
  on public.maintenance_orders(source_chat_id,source_message_id)
  where source_channel='telegram' and source_chat_id is not null and source_message_id is not null;

-- Widen the old status constraint without deleting rows or changing current statuses.
do $$
declare item record;
begin
  for item in
    select conname
    from pg_constraint
    where conrelid='public.maintenance_orders'::regclass
      and contype='c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.maintenance_orders drop constraint if exists %I',item.conname);
  end loop;
end $$;

alter table public.maintenance_orders
  add constraint maintenance_orders_status_check
  check(status in (
    'draft','reported','triage','inspection','diagnosed','quotation_required',
    'parts_waiting','approval_pending','approved','in_repair','testing',
    'ready_for_handover','completed','closed','on_hold','cancelled','external_repair'
  )) not valid;
alter table public.maintenance_orders validate constraint maintenance_orders_status_check;

alter table public.maintenance_orders
  drop constraint if exists maintenance_orders_handover_status_check;
alter table public.maintenance_orders
  add constraint maintenance_orders_handover_status_check
  check(handover_status in ('pending','ready','accepted','rejected','not_required')) not valid;
alter table public.maintenance_orders validate constraint maintenance_orders_handover_status_check;

-- ---------------------------------------------------------------------------
-- Reconciliation queue: every pre-existing mismatch is preserved and classified.
-- ---------------------------------------------------------------------------

create table if not exists public.maintenance_reconciliation_queue (
  id uuid primary key default gen_random_uuid(),
  source_table text not null check(source_table in ('maintenance_orders','operational_records','unified_assets')),
  source_id text not null,
  reference_no text,
  issue_type text not null check(issue_type in ('missing_asset_link','missing_operational_link','orphan_operational_record','ambiguous_reference','manual_review')),
  status text not null default 'pending' check(status in ('pending','auto_resolved','resolved','ignored')),
  source_snapshot jsonb not null default '{}'::jsonb,
  resolution jsonb not null default '{}'::jsonb,
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_table,source_id,issue_type)
);
create index if not exists maintenance_reconciliation_status_idx
  on public.maintenance_reconciliation_queue(status,issue_type,created_at);

insert into public.maintenance_reconciliation_queue(source_table,source_id,reference_no,issue_type,source_snapshot)
select 'maintenance_orders',mo.id::text,mo.reference_no,'missing_asset_link',
       jsonb_build_object('reference_no',mo.reference_no,'vehicle_external_id',mo.vehicle_external_id,'plate_snapshot',mo.plate_snapshot,'status',mo.status)
from public.maintenance_orders mo
left join public.unified_assets ua on ua.external_id=coalesce(nullif(mo.asset_external_id,''),nullif(mo.vehicle_external_id,''))
where ua.id is null
on conflict(source_table,source_id,issue_type) do update
set source_snapshot=excluded.source_snapshot,updated_at=now();

insert into public.maintenance_reconciliation_queue(source_table,source_id,reference_no,issue_type,source_snapshot)
select 'maintenance_orders',mo.id::text,mo.reference_no,'missing_operational_link',
       jsonb_build_object('reference_no',mo.reference_no,'status',mo.status,'problem',mo.problem)
from public.maintenance_orders mo
where not exists(select 1 from public.operational_records o where o.reference_no=mo.reference_no)
on conflict(source_table,source_id,issue_type) do update
set source_snapshot=excluded.source_snapshot,updated_at=now();

insert into public.maintenance_reconciliation_queue(source_table,source_id,reference_no,issue_type,source_snapshot)
select 'operational_records',o.id::text,o.reference_no,'orphan_operational_record',
       jsonb_build_object('reference_no',o.reference_no,'entity_type',o.entity_type,'department',o.department,'status',o.status,'title',o.title)
from public.operational_records o
where (o.department='workshop' or o.entity_type in ('maintenance','maintenance_order','workshop','spare_parts_request'))
  and not exists(select 1 from public.maintenance_orders mo where mo.reference_no=o.reference_no)
on conflict(source_table,source_id,issue_type) do update
set source_snapshot=excluded.source_snapshot,updated_at=now();

-- ---------------------------------------------------------------------------
-- Single linkage from the operations center to the maintenance source record.
-- ---------------------------------------------------------------------------

alter table public.operational_records add column if not exists entity_id text;
alter table public.operational_records add column if not exists maintenance_order_id uuid;
alter table public.operational_records add column if not exists version integer not null default 1;

do $$ begin
  if not exists(select 1 from pg_constraint where conname='operational_records_maintenance_order_fk') then
    alter table public.operational_records
      add constraint operational_records_maintenance_order_fk
      foreign key(maintenance_order_id) references public.maintenance_orders(id) on delete restrict;
  end if;
end $$;

create unique index if not exists operational_records_maintenance_order_uidx
  on public.operational_records(maintenance_order_id)
  where maintenance_order_id is not null;
create index if not exists operational_records_entity_lookup_idx
  on public.operational_records(entity_type,entity_id,department,status);

-- Link only deterministic one-to-one reference matches.
with deterministic as (
  select mo.id maintenance_id,mo.reference_no,min(o.id::text)::uuid operational_id
  from public.maintenance_orders mo
  join public.operational_records o on o.reference_no=mo.reference_no
  group by mo.id,mo.reference_no
  having count(o.id)=1
)
update public.operational_records o
set entity_type='maintenance_order',
    entity_id=d.maintenance_id::text,
    maintenance_order_id=d.maintenance_id,
    department='workshop',
    version=o.version+1,
    updated_at=now()
from deterministic d
where o.id=d.operational_id
  and o.maintenance_order_id is null;

-- Create the missing operations-center projection. The maintenance order remains
-- authoritative; this row is a linked projection, not an independent source.
insert into public.operational_records(
  reference_no,entity_type,entity_id,maintenance_order_id,department,status,title,summary,
  amount,payload,created_by,source_channel,source_chat_id,source_message_id,created_at,updated_at,closed_at
)
select mo.reference_no,'maintenance_order',mo.id::text,mo.id,'workshop',mo.status,
       concat('أمر صيانة ',mo.reference_no),coalesce(nullif(mo.problem,''),'أمر صيانة'),
       coalesce(mo.actual_cost,mo.approved_cost,mo.estimated_cost,0),
       jsonb_build_object('maintenance_order_id',mo.id,'asset_external_id',mo.asset_external_id,'vehicle_external_id',mo.vehicle_external_id,'priority',mo.priority,'projection',true),
       coalesce(mo.reported_by::text,'migration-025'),mo.source_channel,mo.source_chat_id,mo.source_message_id,
       coalesce(mo.reported_at,mo.created_at,now()),coalesce(mo.updated_at,now()),
       case when mo.status in ('closed','cancelled') then mo.closed_at else null end
from public.maintenance_orders mo
where not exists(select 1 from public.operational_records o where o.maintenance_order_id=mo.id)
  and not exists(select 1 from public.operational_records o where o.reference_no=mo.reference_no);

update public.maintenance_reconciliation_queue q
set status='auto_resolved',
    resolution=jsonb_build_object('strategy','created_linked_operational_projection','maintenance_order_id',q.source_id),
    resolved_by='migration-025',resolved_at=now(),updated_at=now()
where q.issue_type='missing_operational_link'
  and q.status='pending'
  and exists(
    select 1 from public.operational_records o
    where o.maintenance_order_id::text=q.source_id
  );

-- ---------------------------------------------------------------------------
-- Status history and state-machine metadata.
-- ---------------------------------------------------------------------------

create table if not exists public.maintenance_status_history (
  id uuid primary key default gen_random_uuid(),
  maintenance_id uuid not null references public.maintenance_orders(id) on delete restrict,
  previous_status text,
  new_status text not null,
  actor_id text,
  actor_role text,
  source_channel text not null default 'system',
  note text,
  reason text,
  request_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists maintenance_status_history_order_idx
  on public.maintenance_status_history(maintenance_id,created_at desc);
create unique index if not exists maintenance_status_history_request_uidx
  on public.maintenance_status_history(maintenance_id,request_id)
  where request_id is not null;

insert into public.maintenance_status_history(maintenance_id,previous_status,new_status,actor_id,source_channel,note,metadata,created_at)
select u.maintenance_id,null,u.status,u.created_by::text,coalesce(u.source_channel,'legacy'),u.note,
       jsonb_build_object('legacy_update_id',u.id),coalesce(u.created_at,now())
from public.maintenance_updates u
where not exists(
  select 1 from public.maintenance_status_history h
  where h.metadata->>'legacy_update_id'=u.id::text
);

create or replace function public.workshop_status_transition_allowed(p_from text,p_to text)
returns boolean language sql immutable as $$
  select case
    when p_from=p_to then true
    when p_from='draft' and p_to in ('reported','cancelled') then true
    when p_from='reported' and p_to in ('triage','inspection','on_hold','cancelled') then true
    when p_from='triage' and p_to in ('inspection','on_hold','cancelled') then true
    when p_from='inspection' and p_to in ('diagnosed','quotation_required','on_hold','cancelled') then true
    when p_from='diagnosed' and p_to in ('quotation_required','approval_pending','approved','in_repair','external_repair','on_hold','cancelled') then true
    when p_from='quotation_required' and p_to in ('parts_waiting','approval_pending','approved','on_hold','cancelled') then true
    when p_from='parts_waiting' and p_to in ('approval_pending','approved','in_repair','on_hold','cancelled') then true
    when p_from='approval_pending' and p_to in ('approved','on_hold','cancelled') then true
    when p_from='approved' and p_to in ('in_repair','external_repair','on_hold','cancelled') then true
    when p_from='external_repair' and p_to in ('testing','parts_waiting','on_hold','cancelled') then true
    when p_from='in_repair' and p_to in ('testing','parts_waiting','on_hold','cancelled') then true
    when p_from='testing' and p_to in ('ready_for_handover','in_repair','on_hold') then true
    when p_from='ready_for_handover' and p_to in ('completed','in_repair','on_hold') then true
    when p_from='completed' and p_to in ('closed','in_repair') then true
    when p_from='on_hold' and p_to in ('triage','inspection','diagnosed','quotation_required','parts_waiting','approval_pending','approved','in_repair','external_repair','cancelled') then true
    when p_from='closed' and p_to='in_repair' then true
    else false end;
$$;

create or replace function public.capture_maintenance_status_history()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_actor text:=nullif(current_setting('app.actor_id',true),'');
  v_role text:=nullif(current_setting('app.actor_role',true),'');
  v_channel text:=coalesce(nullif(current_setting('app.source_channel',true),''),'database');
  v_request text:=nullif(current_setting('app.request_id',true),'');
begin
  if old.status is distinct from new.status then
    insert into public.maintenance_status_history(
      maintenance_id,previous_status,new_status,actor_id,actor_role,source_channel,note,reason,request_id,metadata
    ) values(
      new.id,old.status,new.status,coalesce(v_actor,new.reported_by::text,'database'),v_role,v_channel,
      nullif(current_setting('app.status_note',true),''),nullif(current_setting('app.status_reason',true),''),v_request,
      jsonb_build_object('captured_by','maintenance_orders_status_history_trigger')
    ) on conflict(maintenance_id,request_id) where request_id is not null do nothing;
    new.version=coalesce(old.version,1)+1;
  end if;
  return new;
end $$;

drop trigger if exists maintenance_orders_status_history_trigger on public.maintenance_orders;
create trigger maintenance_orders_status_history_trigger
before update of status on public.maintenance_orders
for each row execute function public.capture_maintenance_status_history();

-- ---------------------------------------------------------------------------
-- Labor, diagnostics, parts, attachments and checklists.
-- ---------------------------------------------------------------------------

create table if not exists public.maintenance_labor_entries (
  id uuid primary key default gen_random_uuid(),
  maintenance_id uuid not null references public.maintenance_orders(id) on delete restrict,
  technician_external_id text not null,
  work_type text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  hours numeric(10,2) not null default 0 check(hours>=0),
  cost_per_hour numeric(18,2) not null default 0 check(cost_per_hour>=0),
  total_labor_cost numeric(18,2) generated always as (round(hours*cost_per_hour,2)) stored,
  notes text,
  source_channel text not null default 'web',
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(ended_at is null or ended_at>=started_at)
);
create index if not exists maintenance_labor_order_idx on public.maintenance_labor_entries(maintenance_id,started_at desc);
create index if not exists maintenance_labor_technician_idx on public.maintenance_labor_entries(technician_external_id,started_at desc);

create table if not exists public.maintenance_diagnostics (
  id uuid primary key default gen_random_uuid(),
  maintenance_id uuid not null references public.maintenance_orders(id) on delete restrict,
  technician_external_id text,
  diagnosis text not null,
  probable_cause text,
  root_cause text,
  proposed_action text,
  needs_parts boolean not null default false,
  needs_external_repair boolean not null default false,
  risk_level text not null default 'normal' check(risk_level in ('low','normal','high','critical')),
  approved_by text,
  approved_at timestamptz,
  source_channel text not null default 'web',
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists maintenance_diagnostics_order_idx on public.maintenance_diagnostics(maintenance_id,created_at desc);

create table if not exists public.maintenance_parts (
  id uuid primary key default gen_random_uuid(),
  maintenance_id uuid not null references public.maintenance_orders(id) on delete restrict,
  item_external_id text,
  item_code text,
  item_name text not null,
  unit text,
  quantity_requested numeric(18,4) not null default 0 check(quantity_requested>=0),
  quantity_reserved numeric(18,4) not null default 0 check(quantity_reserved>=0),
  quantity_issued numeric(18,4) not null default 0 check(quantity_issued>=0),
  quantity_used numeric(18,4) not null default 0 check(quantity_used>=0),
  quantity_returned numeric(18,4) not null default 0 check(quantity_returned>=0),
  unit_cost numeric(18,4) not null default 0 check(unit_cost>=0),
  total_cost numeric(18,2) generated always as (round(quantity_used*unit_cost,2)) stored,
  supplier_external_id text,
  purchase_order_reference text,
  expected_at timestamptz,
  received_at timestamptz,
  urgency text not null default 'normal' check(urgency in ('normal','urgent','critical')),
  status text not null default 'requested' check(status in ('requested','reserved','not_available','quotation','purchasing','received','issued','used','returned','cancelled')),
  source_channel text not null default 'web',
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(quantity_reserved<=quantity_requested),
  check(quantity_issued<=quantity_requested),
  check(quantity_used<=quantity_issued),
  check(quantity_returned<=quantity_issued)
);
create index if not exists maintenance_parts_order_idx on public.maintenance_parts(maintenance_id,status,created_at desc);
create index if not exists maintenance_parts_item_idx on public.maintenance_parts(item_code,status,created_at desc);

create table if not exists public.maintenance_attachments (
  id uuid primary key default gen_random_uuid(),
  maintenance_id uuid not null references public.maintenance_orders(id) on delete restrict,
  attachment_type text not null check(attachment_type in ('image','video','audio','document','signature')),
  stage text not null check(stage in ('report','before_repair','diagnosis','during_repair','after_repair','testing','handover','external_repair')),
  storage_path text not null,
  original_name text,
  mime_type text,
  size_bytes bigint,
  source_channel text not null default 'web',
  source_chat_id text,
  source_message_id text,
  uploaded_by text,
  created_at timestamptz not null default now()
);
create index if not exists maintenance_attachments_order_idx on public.maintenance_attachments(maintenance_id,stage,created_at desc);
create unique index if not exists maintenance_attachments_telegram_uidx
  on public.maintenance_attachments(source_chat_id,source_message_id,storage_path)
  where source_channel='telegram' and source_chat_id is not null and source_message_id is not null;

create table if not exists public.maintenance_checklist_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_ar text not null,
  asset_type text not null,
  version integer not null default 1,
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.maintenance_checklist_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.maintenance_checklist_templates(id) on delete restrict,
  item_order integer not null,
  item_code text not null,
  label_ar text not null,
  response_type text not null default 'pass_fail' check(response_type in ('pass_fail','yes_no','number','text','choice')),
  required boolean not null default true,
  failure_opens_order boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  unique(template_id,item_code),
  unique(template_id,item_order)
);

create table if not exists public.maintenance_checklist_results (
  id uuid primary key default gen_random_uuid(),
  maintenance_id uuid references public.maintenance_orders(id) on delete restrict,
  template_id uuid not null references public.maintenance_checklist_templates(id) on delete restrict,
  item_id uuid not null references public.maintenance_checklist_items(id) on delete restrict,
  asset_external_id text not null,
  response_value text,
  passed boolean,
  note text,
  attachment_id uuid references public.maintenance_attachments(id) on delete set null,
  inspected_by text,
  inspected_at timestamptz not null default now(),
  source_channel text not null default 'web'
);
create index if not exists maintenance_checklist_results_asset_idx on public.maintenance_checklist_results(asset_external_id,inspected_at desc);
create index if not exists maintenance_checklist_results_order_idx on public.maintenance_checklist_results(maintenance_id,inspected_at desc);

-- ---------------------------------------------------------------------------
-- Preventive maintenance and meter readings.
-- ---------------------------------------------------------------------------

create table if not exists public.preventive_maintenance_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_ar text not null,
  asset_type text not null,
  checklist_template_id uuid references public.maintenance_checklist_templates(id) on delete set null,
  interval_days integer check(interval_days is null or interval_days>0),
  interval_meter numeric(18,3) check(interval_meter is null or interval_meter>0),
  meter_type text check(meter_type is null or meter_type in ('kilometer','hour','cycle')),
  lead_days integer not null default 7 check(lead_days>=0),
  active boolean not null default true,
  instructions text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(interval_days is not null or interval_meter is not null)
);

create table if not exists public.preventive_maintenance_schedules (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.preventive_maintenance_plans(id) on delete restrict,
  asset_external_id text not null,
  last_execution_at timestamptz,
  last_meter_value numeric(18,3),
  next_due_at timestamptz,
  next_due_meter numeric(18,3),
  status text not null default 'scheduled' check(status in ('scheduled','due','overdue','generated','paused','cancelled')),
  generated_maintenance_id uuid references public.maintenance_orders(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(plan_id,asset_external_id)
);
create index if not exists preventive_schedules_due_idx on public.preventive_maintenance_schedules(active,status,next_due_at);

create table if not exists public.preventive_maintenance_executions (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.preventive_maintenance_schedules(id) on delete restrict,
  maintenance_id uuid references public.maintenance_orders(id) on delete restrict,
  asset_external_id text not null,
  executed_at timestamptz not null default now(),
  meter_value numeric(18,3),
  result text not null default 'completed' check(result in ('completed','failed','partial','cancelled')),
  notes text,
  executed_by text,
  created_at timestamptz not null default now()
);
create index if not exists preventive_executions_asset_idx on public.preventive_maintenance_executions(asset_external_id,executed_at desc);

create table if not exists public.asset_meter_readings (
  id uuid primary key default gen_random_uuid(),
  asset_external_id text not null,
  meter_type text not null check(meter_type in ('kilometer','hour','cycle')),
  meter_value numeric(18,3) not null check(meter_value>=0),
  read_at timestamptz not null default now(),
  source_channel text not null default 'web',
  source_reference text,
  attachment_path text,
  recorded_by text,
  created_at timestamptz not null default now()
);
create index if not exists asset_meter_readings_lookup_idx on public.asset_meter_readings(asset_external_id,meter_type,read_at desc);
create unique index if not exists asset_meter_readings_source_uidx
  on public.asset_meter_readings(source_channel,source_reference)
  where source_reference is not null;

-- ---------------------------------------------------------------------------
-- Structured daily workshop reports.
-- ---------------------------------------------------------------------------

create table if not exists public.workshop_daily_reports (
  id uuid primary key default gen_random_uuid(),
  reference_no text not null unique,
  report_date date not null,
  mechanic_external_id text not null,
  assets_worked jsonb not null default '[]'::jsonb,
  work_completed jsonb not null default '[]'::jsonb,
  labor_entries jsonb not null default '[]'::jsonb,
  completed_orders jsonb not null default '[]'::jsonb,
  open_orders jsonb not null default '[]'::jsonb,
  parts_required jsonb not null default '[]'::jsonb,
  preventive_work jsonb not null default '[]'::jsonb,
  safety_risks jsonb not null default '[]'::jsonb,
  next_day_plan jsonb not null default '[]'::jsonb,
  attachment_ids jsonb not null default '[]'::jsonb,
  total_hours numeric(10,2) not null default 0 check(total_hours>=0),
  status text not null default 'submitted' check(status in ('draft','submitted','reviewed','approved','rejected')),
  source_channel text not null default 'telegram',
  source_chat_id text,
  source_message_id text,
  submitted_by text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(report_date,mechanic_external_id)
);
create index if not exists workshop_daily_reports_date_idx on public.workshop_daily_reports(report_date desc,status);
create unique index if not exists workshop_daily_reports_telegram_uidx
  on public.workshop_daily_reports(source_chat_id,source_message_id)
  where source_channel='telegram' and source_chat_id is not null and source_message_id is not null;

-- Preserve legacy text reports as immutable structured imports. The complete old
-- audit row remains untouched; the new report records the legacy reference.
insert into public.workshop_daily_reports(
  reference_no,report_date,mechanic_external_id,work_completed,status,source_channel,
  source_chat_id,source_message_id,submitted_by,created_at,updated_at
)
select coalesce(nullif(a.entity_id,''),concat('LEGACY-WDR-',a.id::text)),
       coalesce((a.details->>'report_date')::date,a.created_at::date),
       coalesce(nullif(a.details->>'telegram_user_id',''),nullif(a.actor_id,''),'legacy'),
       jsonb_build_array(jsonb_build_object('legacy_text',coalesce(a.details->>'report_text',''),'audit_log_id',a.id)),
       'submitted','legacy',a.details->>'chat_id',a.details->>'source_message_id',a.actor_id,a.created_at,a.created_at
from public.audit_log a
where a.action='mechanic_daily_report'
  and not exists(
    select 1 from public.workshop_daily_reports r
    where r.reference_no=coalesce(nullif(a.entity_id,''),concat('LEGACY-WDR-',a.id::text))
  )
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Cost and management views.
-- ---------------------------------------------------------------------------

create or replace view public.workshop_order_cost_summary as
with labor as (
  select maintenance_id,sum(total_labor_cost)::numeric(18,2) labor_cost
  from public.maintenance_labor_entries
  group by maintenance_id
), parts as (
  select maintenance_id,sum(total_cost)::numeric(18,2) parts_cost
  from public.maintenance_parts
  group by maintenance_id
)
select mo.id maintenance_id,mo.reference_no,mo.asset_external_id,mo.vehicle_external_id,mo.status,mo.priority,
       coalesce(l.labor_cost,0)::numeric(18,2) labor_cost,
       coalesce(p.parts_cost,0)::numeric(18,2) parts_cost,
       coalesce(mo.actual_cost,0)::numeric(18,2) recorded_actual_cost,
       (coalesce(l.labor_cost,0)+coalesce(p.parts_cost,0)+coalesce(mo.actual_cost,0))::numeric(18,2) total_cost
from public.maintenance_orders mo
left join labor l on l.maintenance_id=mo.id
left join parts p on p.maintenance_id=mo.id;

create or replace view public.workshop_order_aging as
select mo.id,mo.reference_no,mo.asset_external_id,mo.plate_snapshot,mo.status,mo.priority,mo.vehicle_stopped,
       coalesce(mo.downtime_started_at,mo.reported_at,mo.created_at) opened_at,
       extract(epoch from (coalesce(mo.closed_at,now())-coalesce(mo.downtime_started_at,mo.reported_at,mo.created_at)))/3600.0 age_hours,
       case
         when now()-coalesce(mo.reported_at,mo.created_at)<interval '1 day' then 'lt_1_day'
         when now()-coalesce(mo.reported_at,mo.created_at)<interval '4 days' then '1_3_days'
         when now()-coalesce(mo.reported_at,mo.created_at)<interval '8 days' then '4_7_days'
         when now()-coalesce(mo.reported_at,mo.created_at)<interval '16 days' then '8_15_days'
         else 'gt_15_days' end aging_bucket
from public.maintenance_orders mo;

insert into public.migration_history(version,migration_name)
values(25,'025_workshop_central_data_model')
on conflict(version) do update set migration_name=excluded.migration_name;
