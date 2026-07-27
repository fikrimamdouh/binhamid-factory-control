begin;

-- 028_fuel_transactions_history
--
-- تقرير الديزل كان يُقرأ ويُعرض ثم يضيع: لا جدول يحفظ حركات التعبئة إطلاقًا.
-- فلا مقارنة بفترة سابقة، ولا استهلاك تراكمي لكل مركبة، ولا كشف لتعبئة مشبوهة،
-- ولا ربط بالتكلفة. هذا الجدول هو الذاكرة الدائمة لحركة الوقود.

create table if not exists public.fuel_transactions(
  id uuid primary key default gen_random_uuid(),
  transaction_date date not null,
  plate_key text not null,
  vehicle_name text,
  vehicle_external_id text,
  driver_name text,
  station text,
  fuel_type text,
  receipt_no text,
  liters numeric(14,3) not null default 0,
  unit_price numeric(14,4) not null default 0,
  amount numeric(16,2) not null default 0,
  tax_amount numeric(16,2) not null default 0,
  net_amount numeric(16,2) not null default 0,
  prev_odometer numeric(14,1),
  curr_odometer numeric(14,1),
  service_km numeric(14,1),
  source text not null default 'station_report',
  source_file text,
  -- بصمة السطر تمنع تكرار الحركة عند إعادة رفع التقرير نفسه أو تداخل الفترات.
  line_identity text not null,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists fuel_transactions_identity_uidx on public.fuel_transactions(line_identity);
create index if not exists fuel_transactions_date_idx on public.fuel_transactions(transaction_date desc);
create index if not exists fuel_transactions_plate_idx on public.fuel_transactions(plate_key,transaction_date desc);
create index if not exists fuel_transactions_vehicle_idx on public.fuel_transactions(vehicle_external_id,transaction_date desc);

-- هوية السطر من الحقول التي لا تتكرر معًا لنفس التعبئة. تُستخدم extensions.digest
-- صراحةً كما في 027، لأن pgcrypto خارج مخطط public على Supabase.
create or replace function public.fuel_transaction_identity(
  p_date date,
  p_plate text,
  p_receipt text,
  p_liters numeric,
  p_amount numeric
)
returns text
language sql
immutable
set search_path=pg_catalog,public,extensions
as $$
  select encode(
    extensions.digest(
      concat_ws('|',
        coalesce(p_date::text,''),
        trim(coalesce(p_plate,'')),
        trim(coalesce(p_receipt,'')),
        round(coalesce(p_liters,0),3)::text,
        round(coalesce(p_amount,0),2)::text
      ),
      'sha256'::text
    ),
    'hex'
  );
$$;

create or replace function public.set_fuel_transaction_identity()
returns trigger language plpgsql set search_path=pg_catalog,public,extensions as $$
begin
  if nullif(trim(new.plate_key),'') is null then raise exception 'FUEL_PLATE_REQUIRED'; end if;
  if coalesce(new.liters,0) < 0 then raise exception 'FUEL_LITERS_NEGATIVE'; end if;
  new.line_identity := public.fuel_transaction_identity(new.transaction_date,new.plate_key,new.receipt_no,new.liters,new.amount);
  return new;
end;
$$;

drop trigger if exists fuel_transactions_identity on public.fuel_transactions;
create trigger fuel_transactions_identity
before insert or update of transaction_date,plate_key,receipt_no,liters,amount
on public.fuel_transactions for each row execute function public.set_fuel_transaction_identity();

alter table public.fuel_transactions enable row level security;
revoke all on function public.fuel_transaction_identity(date,text,text,numeric,numeric) from anon,authenticated;

insert into public.migration_history(version,migration_name)
values(28,'028_fuel_transactions_history')
on conflict(version) do update set migration_name=excluded.migration_name;

commit;
