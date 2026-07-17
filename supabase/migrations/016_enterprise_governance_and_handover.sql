-- Bin Hamid Factory Control — enterprise governance, financial close and handover controls
-- Run after 015_daily_report_customer_master.sql.
-- Idempotent and non-destructive. Existing operational rows are never deleted.

create extension if not exists pgcrypto;

create table if not exists public.financial_periods (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  status text not null default 'open' check (status in ('open','closed','reopened')),
  closed_by text,
  closed_at timestamptz,
  close_reason text,
  reopened_by text,
  reopened_at timestamptz,
  reopen_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(period_start,period_end),
  check (period_end>=period_start)
);
create index if not exists financial_periods_status_idx on public.financial_periods(status,period_start desc);

create table if not exists public.financial_period_events (
  id uuid primary key default gen_random_uuid(),
  financial_period_id uuid not null references public.financial_periods(id) on delete restrict,
  action text not null check (action in ('created','closed','reopened')),
  actor text not null,
  reason text,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists financial_period_events_period_idx on public.financial_period_events(financial_period_id,created_at desc);

create table if not exists public.credit_override_requests (
  id uuid primary key default gen_random_uuid(),
  reference_no text not null unique,
  customer_external_id text not null,
  requested_amount numeric(18,2) not null check (requested_amount>0),
  current_balance numeric(18,2) not null default 0,
  credit_limit numeric(18,2) not null default 0,
  exposure_after numeric(18,2) generated always as (current_balance+requested_amount) stored,
  reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','expired','used','cancelled')),
  requested_by text not null,
  requested_at timestamptz not null default now(),
  reviewed_by text,
  reviewed_at timestamptz,
  decision_note text,
  expires_at timestamptz,
  used_at timestamptz,
  used_by text,
  sales_order_id uuid references public.sales_orders(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists credit_override_customer_status_idx on public.credit_override_requests(customer_external_id,status,requested_at desc);

create table if not exists public.unified_assets (
  id uuid primary key default gen_random_uuid(),
  external_id text not null unique,
  asset_type text not null default 'vehicle' check (asset_type in ('vehicle','equipment','fixed_asset')),
  asset_name text,
  plate_no text,
  asset_no text,
  serial_no text,
  make text,
  model text,
  operational_status text not null default 'in_service' check (operational_status in ('in_service','parked','stopped','maintenance','out_of_service','sold')),
  diesel_expected boolean,
  assigned_employee_external_id text,
  cost_center_code text,
  active boolean not null default true,
  source_updated_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists unified_assets_plate_idx on public.unified_assets(lower(plate_no)) where nullif(trim(plate_no),'') is not null and active;
create index if not exists unified_assets_status_idx on public.unified_assets(active,operational_status,asset_type);

create table if not exists public.asset_source_links (
  id uuid primary key default gen_random_uuid(),
  asset_external_id text not null references public.unified_assets(external_id) on delete cascade,
  source_system text not null,
  source_key text not null,
  source_payload jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(source_system,source_key)
);
create index if not exists asset_source_links_asset_idx on public.asset_source_links(asset_external_id,source_system);

insert into public.unified_assets(external_id,asset_type,asset_name,plate_no,asset_no,make,model,operational_status,diesel_expected,assigned_employee_external_id,active,source_updated_at,metadata)
select v.external_id,'vehicle',coalesce(nullif(v.vehicle_type,''),nullif(v.make,''),v.external_id),v.plate_no,v.asset_no,v.make,v.model,
  case when coalesce(v.active,true)=false then 'out_of_service' when lower(coalesce(v.status,'')) in ('maintenance','stopped','parked','sold','out_of_service') then lower(v.status) else 'in_service' end,
  case when coalesce(v.active,true)=false then false else true end,v.driver_external_id,coalesce(v.active,true),v.source_updated_at,
  jsonb_build_object('legacy_vehicle_id',v.id,'legacy_status',v.status)
from public.vehicles v
on conflict(external_id) do update set
  asset_name=excluded.asset_name,plate_no=excluded.plate_no,asset_no=excluded.asset_no,make=excluded.make,model=excluded.model,
  assigned_employee_external_id=excluded.assigned_employee_external_id,active=excluded.active,source_updated_at=excluded.source_updated_at,
  metadata=public.unified_assets.metadata||excluded.metadata,updated_at=now();

insert into public.asset_source_links(asset_external_id,source_system,source_key,source_payload,last_seen_at)
select v.external_id,'vehicles',v.external_id,jsonb_build_object('plate_no',v.plate_no,'asset_no',v.asset_no),now() from public.vehicles v
on conflict(source_system,source_key) do update set asset_external_id=excluded.asset_external_id,source_payload=excluded.source_payload,last_seen_at=now();

create table if not exists public.compliance_documents (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('employee','asset','company')),
  subject_external_id text not null,
  document_type text not null,
  document_no text,
  issue_date date,
  expiry_date date,
  storage_path text,
  status text not null default 'valid' check (status in ('valid','expiring','expired','missing','cancelled')),
  verified_by text,
  verified_at timestamptz,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expiry_date is null or issue_date is null or expiry_date>=issue_date)
);
create unique index if not exists compliance_documents_identity_uidx on public.compliance_documents(subject_type,subject_external_id,document_type,coalesce(document_no,'')) where active;
create index if not exists compliance_documents_expiry_idx on public.compliance_documents(active,expiry_date,subject_type);

create table if not exists public.custody_accounts (
  id uuid primary key default gen_random_uuid(),
  employee_external_id text not null,
  status text not null default 'open' check (status in ('open','suspended','closed')),
  issued_amount numeric(18,2) not null default 0,
  settled_amount numeric(18,2) not null default 0,
  outstanding_amount numeric(18,2) generated always as (issued_amount-settled_amount) stored,
  opened_by text,
  closed_by text,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_external_id)
);

create table if not exists public.custody_transactions (
  id uuid primary key default gen_random_uuid(),
  custody_account_id uuid not null references public.custody_accounts(id) on delete restrict,
  reference_no text not null unique,
  transaction_type text not null check (transaction_type in ('issue','expense','return','adjustment','reversal')),
  amount numeric(18,2) not null check (amount>0),
  occurred_at timestamptz not null default now(),
  description text,
  attachment_path text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','posted','reversed')),
  created_by text not null,
  approved_by text,
  approved_at timestamptz,
  reversed_transaction_id uuid references public.custody_transactions(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists custody_transactions_account_idx on public.custody_transactions(custody_account_id,status,occurred_at desc);

create table if not exists public.restore_test_runs (
  id uuid primary key default gen_random_uuid(),
  backup_run_id uuid references public.backup_runs(id) on delete set null,
  environment text not null check (environment<>'production'),
  status text not null default 'planned' check (status in ('planned','running','passed','failed','cancelled')),
  checksum_verified boolean not null default false,
  schema_version integer,
  row_counts jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  started_by text,
  started_at timestamptz,
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists restore_test_runs_status_idx on public.restore_test_runs(status,created_at desc);

create table if not exists public.handover_acceptance_runs (
  id uuid primary key default gen_random_uuid(),
  reference_no text not null unique,
  version_label text not null,
  status text not null default 'draft' check (status in ('draft','in_progress','passed','failed','signed','cancelled')),
  scope jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  blockers jsonb not null default '[]'::jsonb,
  started_by text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.handover_signoffs (
  id uuid primary key default gen_random_uuid(),
  handover_run_id uuid not null references public.handover_acceptance_runs(id) on delete restrict,
  signoff_role text not null check (signoff_role in ('management','finance','operations','system_admin')),
  signer_name text not null,
  decision text not null check (decision in ('approved','rejected','conditional')),
  note text,
  signed_at timestamptz not null default now(),
  unique(handover_run_id,signoff_role)
);

create or replace function public.assert_financial_period_open(p_date date)
returns void language plpgsql security definer set search_path=public as $$
declare v_period record;
begin
  if p_date is null then return; end if;
  select id,period_start,period_end,status into v_period
  from public.financial_periods
  where p_date between period_start and period_end and status='closed'
  order by period_start desc limit 1;
  if found then raise exception 'FINANCIAL_PERIOD_CLOSED:%:%',v_period.period_start,v_period.period_end; end if;
end $$;

create or replace function public.guard_sales_order_period()
returns trigger language plpgsql set search_path=public as $$
begin perform public.assert_financial_period_open(coalesce(new.delivery_date,new.created_at::date)); return new; end $$;
create or replace function public.guard_collection_period()
returns trigger language plpgsql set search_path=public as $$
begin perform public.assert_financial_period_open(new.occurred_at::date); return new; end $$;
create or replace function public.guard_daily_report_period()
returns trigger language plpgsql set search_path=public as $$
begin perform public.assert_financial_period_open(new.report_date); return new; end $$;
create or replace function public.guard_cost_ledger_period()
returns trigger language plpgsql set search_path=public as $$
begin perform public.assert_financial_period_open(new.occurred_at::date); return new; end $$;

drop trigger if exists sales_orders_financial_period_guard on public.sales_orders;
create trigger sales_orders_financial_period_guard before insert or update on public.sales_orders for each row execute function public.guard_sales_order_period();
drop trigger if exists collection_events_financial_period_guard on public.collection_events;
create trigger collection_events_financial_period_guard before insert or update on public.collection_events for each row execute function public.guard_collection_period();
drop trigger if exists daily_report_batches_financial_period_guard on public.daily_report_batches;
create trigger daily_report_batches_financial_period_guard before insert or update on public.daily_report_batches for each row execute function public.guard_daily_report_period();
drop trigger if exists cost_ledger_financial_period_guard on public.cost_ledger;
create trigger cost_ledger_financial_period_guard before insert or update on public.cost_ledger for each row execute function public.guard_cost_ledger_period();

create or replace view public.control_credit_exposure as
select c.external_id as customer_external_id,c.customer_code,c.customer_name,c.credit_limit,c.payment_days,
  coalesce(sum(greatest(0,so.total_amount-coalesce(so.paid_amount,0))) filter(where coalesce(so.status,'') not in ('cancelled','rejected','collected')),0)::numeric(18,2) as outstanding_balance,
  greatest(0,coalesce(sum(greatest(0,so.total_amount-coalesce(so.paid_amount,0))) filter(where coalesce(so.status,'') not in ('cancelled','rejected','collected')),0)-c.credit_limit)::numeric(18,2) as over_limit_amount,
  count(so.id) filter(where coalesce(so.status,'') not in ('cancelled','rejected','collected') and so.total_amount>coalesce(so.paid_amount,0)) as open_orders
from public.customers c left join public.sales_orders so on so.customer_external_id=c.external_id
where c.active=true group by c.external_id,c.customer_code,c.customer_name,c.credit_limit,c.payment_days;

create or replace view public.control_expiring_documents as
select id,subject_type,subject_external_id,document_type,document_no,issue_date,expiry_date,storage_path,status,
  case when expiry_date is null then null else expiry_date-current_date end as days_to_expiry,
  case when expiry_date is null then 'missing_expiry' when expiry_date<current_date then 'expired' when expiry_date<=current_date+30 then 'critical' when expiry_date<=current_date+60 then 'warning' else 'valid' end as control_status
from public.compliance_documents where active=true;

create or replace view public.control_open_custodies as
select ca.id,ca.employee_external_id,ca.status,ca.issued_amount,ca.settled_amount,ca.outstanding_amount,
  count(ct.id) filter(where ct.status='pending') as pending_transactions,
  max(ct.occurred_at) as last_transaction_at
from public.custody_accounts ca left join public.custody_transactions ct on ct.custody_account_id=ca.id
where ca.status<>'closed' group by ca.id,ca.employee_external_id,ca.status,ca.issued_amount,ca.settled_amount,ca.outstanding_amount;

insert into public.role_capabilities(role,capability) values
  ('admin','financial_period.manage'),('admin','credit_override.approve'),('admin','assets.manage'),('admin','compliance.manage'),('admin','custody.approve'),('admin','handover.manage'),('admin','restore_test.manage'),
  ('manager','credit_override.approve'),('manager','assets.view'),('manager','compliance.view'),('manager','handover.view'),
  ('accountant','financial_period.manage'),('accountant','credit_override.request'),('accountant','custody.manage'),('accountant','custody.approve'),
  ('hr','compliance.manage'),('hr','assets.view'),('fuel_operator','assets.view'),('mechanic','assets.view'),('procurement','assets.view')
on conflict(role,capability) do update set allowed=true;

insert into public.migration_history(version,migration_name)
values(16,'016_enterprise_governance_and_handover')
on conflict(version) do update set migration_name=excluded.migration_name;
