begin;

create table if not exists public.fuel_entries (
  id text primary key,
  source text not null default 'noor-khoy',
  report_date date not null,
  filled_at timestamptz,
  receipt text,
  driver text,
  station text,
  vehicle_name text,
  plate text,
  plate_key text,
  fuel_type text,
  category text not null default 'diesel',
  liters numeric(18,3) not null default 0,
  amount numeric(18,2) not null default 0,
  price numeric(18,4) not null default 0,
  before_tax numeric(18,2) not null default 0,
  tax numeric(18,2) not null default 0,
  net numeric(18,2) not null default 0,
  prev_odometer numeric(18,3) not null default 0,
  curr_odometer numeric(18,3) not null default 0,
  service_km numeric(18,3) not null default 0,
  source_file text,
  source_hash text,
  source_row integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fuel_entries_report_date_idx on public.fuel_entries(report_date);
create index if not exists fuel_entries_plate_key_idx on public.fuel_entries(plate_key);
create index if not exists fuel_entries_category_idx on public.fuel_entries(category);
create index if not exists fuel_entries_receipt_idx on public.fuel_entries(receipt);

create table if not exists public.fuel_daily_summaries (
  report_date date primary key,
  movement_count integer not null default 0,
  plate_count integer not null default 0,
  liters numeric(18,3) not null default 0,
  amount numeric(18,2) not null default 0,
  diesel jsonb not null default '{}'::jsonb,
  petrol jsonb not null default '{}'::jsonb,
  other jsonb not null default '{}'::jsonb,
  source_file text,
  source_hash text,
  updated_at timestamptz not null default now()
);

create table if not exists public.fuel_balance_snapshots (
  report_date date primary key,
  amount numeric(18,2) not null,
  currency text not null default 'SAR',
  kind text not null default 'closing',
  source text not null default 'noor-khoy',
  captured_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.fuel_entries enable row level security;
alter table public.fuel_daily_summaries enable row level security;
alter table public.fuel_balance_snapshots enable row level security;

grant select, insert, update, delete on public.fuel_entries to service_role;
grant select, insert, update, delete on public.fuel_daily_summaries to service_role;
grant select, insert, update, delete on public.fuel_balance_snapshots to service_role;

grant select on public.fuel_entries to authenticated;
grant select on public.fuel_daily_summaries to authenticated;
grant select on public.fuel_balance_snapshots to authenticated;

notify pgrst, 'reload schema';
commit;
