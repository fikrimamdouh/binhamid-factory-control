-- Bin Hamid Factory Control — bind physical device sessions to approved application users
-- Run after 020_atomic_mix_invitation_and_sales_basis.sql.
-- Idempotent and non-destructive.

create table if not exists public.device_enrollments (
  device_id text primary key check (device_id ~ '^dev-[A-Za-z0-9-]{8,150}$'),
  app_user_id uuid references public.app_users(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','approved','revoked')),
  requested_at timestamptz not null default now(),
  requested_from jsonb not null default '{}'::jsonb,
  approved_by text,
  approved_at timestamptz,
  revoked_by text,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  check ((status='approved' and app_user_id is not null and approved_at is not null) or status<>'approved')
);
create index if not exists device_enrollments_user_idx on public.device_enrollments(app_user_id,status);
create index if not exists device_enrollments_status_idx on public.device_enrollments(status,updated_at desc);

create or replace function public.approve_device_enrollment(p_device_id text,p_app_user_id uuid,p_actor text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_user public.app_users%rowtype;
begin
  if p_device_id is null or p_device_id !~ '^dev-[A-Za-z0-9-]{8,150}$' then raise exception 'DEVICE_ID_INVALID'; end if;
  if nullif(trim(p_actor),'') is null then raise exception 'DEVICE_APPROVER_REQUIRED'; end if;
  select * into v_user from public.app_users where id=p_app_user_id and active=true for share;
  if not found then raise exception 'DEVICE_APP_USER_NOT_ACTIVE'; end if;
  insert into public.device_enrollments(device_id,app_user_id,status,approved_by,approved_at,last_seen_at,updated_at)
  values(p_device_id,p_app_user_id,'approved',p_actor,now(),now(),now())
  on conflict(device_id) do update set app_user_id=excluded.app_user_id,status='approved',approved_by=excluded.approved_by,approved_at=excluded.approved_at,revoked_by=null,revoked_at=null,last_seen_at=now(),updated_at=now();
  insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details)
  values('web',p_actor,'device_enrollment_approved','device',p_device_id,jsonb_build_object('app_user_id',p_app_user_id,'role',v_user.role));
  return jsonb_build_object('device_id',p_device_id,'app_user_id',p_app_user_id,'status','approved','role',v_user.role);
end $$;

create or replace function public.revoke_device_enrollment(p_device_id text,p_actor text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_count integer;
begin
  if nullif(trim(p_actor),'') is null then raise exception 'DEVICE_REVOKER_REQUIRED'; end if;
  update public.device_enrollments set status='revoked',revoked_by=p_actor,revoked_at=now(),updated_at=now() where device_id=p_device_id and status<>'revoked';
  get diagnostics v_count=row_count;
  if v_count=0 then raise exception 'DEVICE_ENROLLMENT_NOT_FOUND'; end if;
  insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details) values('web',p_actor,'device_enrollment_revoked','device',p_device_id,'{}'::jsonb);
  return jsonb_build_object('device_id',p_device_id,'status','revoked');
end $$;

-- These records and security-definer functions are server-side only. No browser or Supabase client role may access them directly.
alter table public.user_invitations enable row level security;
alter table public.mix_materials enable row level security;
alter table public.mix_material_prices enable row level security;
alter table public.mix_designs enable row level security;
alter table public.mix_design_items enable row level security;
alter table public.mix_design_overheads enable row level security;
alter table public.mix_cost_calculation_runs enable row level security;
alter table public.device_enrollments enable row level security;

revoke all on table public.user_invitations,public.mix_materials,public.mix_material_prices,public.mix_designs,public.mix_design_items,public.mix_design_overheads,public.mix_cost_calculation_runs,public.device_enrollments from anon,authenticated;
grant all on table public.user_invitations,public.mix_materials,public.mix_material_prices,public.mix_designs,public.mix_design_items,public.mix_design_overheads,public.mix_cost_calculation_runs,public.device_enrollments to service_role;
revoke all on table public.mix_design_latest_cost from anon,authenticated;
grant select on table public.mix_design_latest_cost to service_role;

revoke all on function public.accept_user_invitation(text,text) from public,anon,authenticated;
revoke all on function public.decide_user_invitation(uuid,text,text,text,text) from public,anon,authenticated;
revoke all on function public.clone_mix_design_version(uuid,text) from public,anon,authenticated;
revoke all on function public.approve_mix_cost_run(uuid,text) from public,anon,authenticated;
revoke all on function public.approve_device_enrollment(text,uuid,text) from public,anon,authenticated;
revoke all on function public.revoke_device_enrollment(text,text) from public,anon,authenticated;
grant execute on function public.accept_user_invitation(text,text) to service_role;
grant execute on function public.decide_user_invitation(uuid,text,text,text,text) to service_role;
grant execute on function public.clone_mix_design_version(uuid,text) to service_role;
grant execute on function public.approve_mix_cost_run(uuid,text) to service_role;
grant execute on function public.approve_device_enrollment(text,uuid,text) to service_role;
grant execute on function public.revoke_device_enrollment(text,text) to service_role;

insert into public.migration_history(version,migration_name)
values(21,'021_device_identity_binding')
on conflict(version) do update set migration_name=excluded.migration_name;
