-- Bin Hamid Factory Control — secure Telegram invitations and mix design costing
-- Run after 018_governance_safety_refinements.sql.
-- Idempotent and non-destructive. Existing production rows are never deleted.

create extension if not exists pgcrypto;

create table if not exists public.user_invitations (
  id uuid primary key default gen_random_uuid(),
  phone_normalized text not null check (phone_normalized ~ '^\+[1-9][0-9]{7,14}$'),
  full_name text not null check (char_length(trim(full_name)) between 3 and 160),
  employee_external_id text,
  requested_role text not null check (requested_role in ('admin','manager','accountant','block_sales','concrete_sales','mechanic','fuel_operator','hr','procurement','driver','employee','collector','warehouse','quality')),
  requested_capabilities jsonb not null default '[]'::jsonb check (jsonb_typeof(requested_capabilities)='array'),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  token_prefix text not null check (char_length(token_prefix) between 6 and 16),
  expires_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','opened','accepted_pending_approval','approved','expired','revoked','rejected')),
  created_by text not null,
  created_at timestamptz not null default now(),
  accepted_by_telegram_id text,
  accepted_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  revoked_by text,
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  check (expires_at>created_at),
  check (not (requested_capabilities ? '*'))
);
create unique index if not exists user_invitations_open_phone_uidx
  on public.user_invitations(phone_normalized)
  where status in ('pending','opened','accepted_pending_approval');
create index if not exists user_invitations_status_idx on public.user_invitations(status,expires_at,created_at desc);
create index if not exists user_invitations_telegram_idx on public.user_invitations(accepted_by_telegram_id,status);

create or replace function public.accept_user_invitation(p_token_hash text,p_telegram_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row public.user_invitations%rowtype;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or nullif(trim(p_telegram_id),'') is null then raise exception 'INVITATION_INPUT_INVALID'; end if;
  select * into v_row from public.user_invitations where token_hash=p_token_hash for update;
  if not found then raise exception 'INVITATION_NOT_FOUND'; end if;
  if v_row.status in ('approved','revoked','rejected','expired') then raise exception 'INVITATION_NOT_USABLE:%',v_row.status; end if;
  if v_row.expires_at<=now() then raise exception 'INVITATION_EXPIRED'; end if;
  if v_row.accepted_by_telegram_id is not null and v_row.accepted_by_telegram_id<>p_telegram_id then raise exception 'INVITATION_ALREADY_ACCEPTED'; end if;
  update public.user_invitations
  set status='accepted_pending_approval',accepted_by_telegram_id=p_telegram_id,accepted_at=coalesce(accepted_at,now()),metadata=metadata||jsonb_build_object('last_opened_at',now())
  where id=v_row.id returning * into v_row;
  return to_jsonb(v_row)-'token_hash';
end $$;

create table if not exists public.mix_materials (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_ar text not null,
  name_en text,
  category text not null check (category in ('cement','sand','aggregate','water','admixture','fly_ash','silica','ice','other')),
  base_unit text not null check (base_unit in ('kg','ton','liter','m3','bag')),
  density numeric(18,6) check (density is null or density>0),
  bag_weight_kg numeric(18,6) check (bag_weight_kg is null or bag_weight_kg>0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mix_material_prices (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.mix_materials(id) on delete restrict,
  supplier_id text,
  price numeric(18,6) not null check (price>=0),
  price_unit text not null check (price_unit in ('kg','ton','liter','m3','bag')),
  effective_from date not null,
  effective_to date,
  transport_cost numeric(18,6) not null default 0 check (transport_cost>=0),
  handling_cost numeric(18,6) not null default 0 check (handling_cost>=0),
  wastage_percent numeric(9,4) not null default 0 check (wastage_percent between 0 and 100),
  vat_included boolean not null default false,
  vat_rate numeric(9,4) not null default 15 check (vat_rate between 0 and 100),
  currency text not null default 'SAR',
  source_reference text,
  approved boolean not null default false,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to>=effective_from)
);
create unique index if not exists mix_material_prices_identity_uidx on public.mix_material_prices(material_id,effective_from,price_unit,coalesce(supplier_id,''));
create index if not exists mix_material_prices_lookup_idx on public.mix_material_prices(material_id,approved,effective_from desc,effective_to);

create or replace function public.guard_mix_material_price_overlap()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.approved and exists(
    select 1 from public.mix_material_prices p
    where p.material_id=new.material_id and p.approved and p.id<>new.id
      and daterange(p.effective_from,coalesce(p.effective_to,'infinity'::date),'[]') && daterange(new.effective_from,coalesce(new.effective_to,'infinity'::date),'[]')
  ) then raise exception 'MIX_MATERIAL_PRICE_PERIOD_OVERLAP'; end if;
  return new;
end $$;
drop trigger if exists mix_material_price_overlap_guard on public.mix_material_prices;
create trigger mix_material_price_overlap_guard before insert or update of material_id,effective_from,effective_to,approved on public.mix_material_prices for each row execute function public.guard_mix_material_price_overlap();

create table if not exists public.mix_designs (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  product_type text not null default 'concrete' check (product_type in ('concrete','block','other')),
  strength_class text,
  unit text not null default 'm3' check (unit in ('m3','unit','batch')),
  yield_m3 numeric(18,6) not null default 1 check (yield_m3>0),
  version_no integer not null default 1 check (version_no>0),
  status text not null default 'draft' check (status in ('draft','pending_approval','approved','archived')),
  effective_from date,
  effective_to date,
  notes text,
  created_by text not null,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(code,version_no),
  check (effective_to is null or effective_from is null or effective_to>=effective_from)
);
create index if not exists mix_designs_status_idx on public.mix_designs(status,code,version_no desc);

create or replace function public.guard_approved_mix_design_update()
returns trigger language plpgsql set search_path=public as $$
begin
  if old.status='approved' and not (
    new.status='archived' and new.code=old.code and new.name=old.name and new.product_type=old.product_type and
    new.strength_class is not distinct from old.strength_class and new.unit=old.unit and new.yield_m3=old.yield_m3 and
    new.version_no=old.version_no and new.effective_from is not distinct from old.effective_from and
    new.effective_to is not distinct from old.effective_to and new.notes is not distinct from old.notes and
    new.created_by=old.created_by and new.approved_by is not distinct from old.approved_by and new.approved_at is not distinct from old.approved_at
  ) then raise exception 'APPROVED_MIX_DESIGN_IMMUTABLE'; end if;
  return new;
end $$;
drop trigger if exists approved_mix_design_update_guard on public.mix_designs;
create trigger approved_mix_design_update_guard before update on public.mix_designs for each row execute function public.guard_approved_mix_design_update();

create table if not exists public.mix_design_items (
  id uuid primary key default gen_random_uuid(),
  mix_design_id uuid not null references public.mix_designs(id) on delete cascade,
  material_id uuid not null references public.mix_materials(id) on delete restrict,
  quantity numeric(18,6) not null check (quantity>0),
  unit text not null check (unit in ('kg','ton','liter','m3','bag')),
  wastage_percent_override numeric(9,4) check (wastage_percent_override is null or wastage_percent_override between 0 and 100),
  sequence_no integer not null default 1,
  notes text,
  created_at timestamptz not null default now(),
  unique(mix_design_id,material_id,sequence_no)
);
create index if not exists mix_design_items_design_idx on public.mix_design_items(mix_design_id,sequence_no);

create table if not exists public.mix_design_overheads (
  id uuid primary key default gen_random_uuid(),
  mix_design_id uuid not null references public.mix_designs(id) on delete cascade,
  cost_type text not null check (cost_type in ('production_labor','batching_energy','loader','pump','quality_testing','depreciation','maintenance','delivery','other')),
  amount numeric(18,6) not null check (amount>=0),
  allocation_basis text not null check (allocation_basis in ('per_m3','per_batch','percentage_material_cost','fixed')),
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists mix_design_overheads_design_idx on public.mix_design_overheads(mix_design_id,cost_type);

create table if not exists public.mix_cost_calculation_runs (
  id uuid primary key default gen_random_uuid(),
  mix_design_id uuid not null references public.mix_designs(id) on delete restrict,
  calculated_at timestamptz not null default now(),
  price_date date not null,
  material_cost numeric(18,6) not null default 0,
  wastage_cost numeric(18,6) not null default 0,
  overhead_cost numeric(18,6) not null default 0,
  delivery_cost numeric(18,6) not null default 0,
  total_cost_per_m3 numeric(18,6) not null default 0,
  recommended_price numeric(18,6),
  target_margin_percent numeric(9,4) check (target_margin_percent is null or target_margin_percent>=0 and target_margin_percent<100),
  markup_percent numeric(9,4),
  snapshot jsonb not null,
  actor text not null,
  status text not null default 'calculated' check (status in ('calculated','approved','superseded','failed'))
);
create index if not exists mix_cost_runs_design_idx on public.mix_cost_calculation_runs(mix_design_id,calculated_at desc);

create or replace view public.mix_design_latest_cost as
select distinct on (r.mix_design_id)
  r.mix_design_id,d.code,d.name,d.version_no,d.status as design_status,r.price_date,r.material_cost,r.wastage_cost,r.overhead_cost,r.delivery_cost,r.total_cost_per_m3,r.recommended_price,r.target_margin_percent,r.markup_percent,r.calculated_at,r.status as calculation_status
from public.mix_cost_calculation_runs r
join public.mix_designs d on d.id=r.mix_design_id
where r.status in ('calculated','approved')
order by r.mix_design_id,r.calculated_at desc;

insert into public.role_capabilities(role,capability) values
  ('manager','costs.customer_profitability.view'),
  ('accountant','costs.customer_profitability.view'),
  ('manager','mix_design.view'),('manager','mix_design.calculate'),('manager','mix_design.approve'),
  ('accountant','mix_design.view'),('accountant','mix_design.calculate'),('accountant','mix_material_prices.manage'),
  ('quality','mix_design.view'),('quality','mix_design.manage'),
  ('concrete_sales','mix_design.price.view'),
  ('manager','users.invite.create'),('manager','users.invite.view')
on conflict(role,capability) do update set allowed=true;

insert into public.migration_history(version,migration_name)
values(19,'019_mix_design_and_user_invitations')
on conflict(version) do update set migration_name=excluded.migration_name;
