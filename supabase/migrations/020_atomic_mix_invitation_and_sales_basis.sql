-- Bin Hamid Factory Control — atomic workflow controls and explicit sales tax basis
-- Run after 019_mix_design_and_user_invitations.sql.
-- Idempotent and non-destructive.

alter table public.sales_orders add column if not exists subtotal_before_vat numeric(18,2) check (subtotal_before_vat is null or subtotal_before_vat>=0);
alter table public.sales_orders add column if not exists discount_amount numeric(18,2) not null default 0 check (discount_amount>=0);
alter table public.sales_orders add column if not exists return_amount numeric(18,2) not null default 0 check (return_amount>=0);
alter table public.sales_orders add column if not exists vat_amount numeric(18,2) check (vat_amount is null or vat_amount>=0);
alter table public.sales_orders add column if not exists vat_rate numeric(9,4) check (vat_rate is null or vat_rate between 0 and 100);
alter table public.sales_orders add column if not exists amount_includes_vat boolean;
alter table public.sales_orders add column if not exists net_amount_before_vat numeric(18,2) check (net_amount_before_vat is null or net_amount_before_vat>=0);

create or replace function public.accept_user_invitation(p_token_hash text,p_telegram_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_row public.user_invitations%rowtype;
  v_user_id uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or nullif(trim(p_telegram_id),'') is null then raise exception 'INVITATION_INPUT_INVALID'; end if;
  select * into v_row from public.user_invitations where token_hash=p_token_hash for update;
  if not found then raise exception 'INVITATION_NOT_FOUND'; end if;
  if v_row.status in ('approved','revoked','rejected','expired') then raise exception 'INVITATION_NOT_USABLE:%',v_row.status; end if;
  if v_row.expires_at<=now() then
    update public.user_invitations set status='expired' where id=v_row.id;
    raise exception 'INVITATION_EXPIRED';
  end if;
  if v_row.accepted_by_telegram_id is not null and v_row.accepted_by_telegram_id<>p_telegram_id then raise exception 'INVITATION_ALREADY_ACCEPTED'; end if;
  update public.app_users
  set full_name=v_row.full_name,employee_external_id=v_row.employee_external_id,role='pending',active=false,updated_at=now()
  where external_id=p_telegram_id returning id into v_user_id;
  if v_user_id is null then raise exception 'INVITATION_USER_NOT_FOUND'; end if;
  update public.user_invitations
  set status='accepted_pending_approval',accepted_by_telegram_id=p_telegram_id,accepted_at=coalesce(accepted_at,now()),metadata=metadata||jsonb_build_object('last_opened_at',now())
  where id=v_row.id returning * into v_row;
  insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details)
  values('telegram',p_telegram_id,'user_invitation_accepted','user_invitation',v_row.id::text,jsonb_build_object('app_user_id',v_user_id,'requested_role',v_row.requested_role));
  return to_jsonb(v_row)-'token_hash';
end $$;

create or replace function public.clone_mix_design_version(p_design_id uuid,p_actor text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_source public.mix_designs%rowtype;
  v_new_id uuid;
  v_version integer;
begin
  if nullif(trim(p_actor),'') is null then raise exception 'MIX_ACTOR_REQUIRED'; end if;
  select * into v_source from public.mix_designs where id=p_design_id for update;
  if not found then raise exception 'MIX_DESIGN_NOT_FOUND'; end if;
  select coalesce(max(version_no),0)+1 into v_version from public.mix_designs where code=v_source.code;
  insert into public.mix_designs(code,name,product_type,strength_class,unit,yield_m3,version_no,status,effective_from,effective_to,notes,created_by)
  values(v_source.code,v_source.name,v_source.product_type,v_source.strength_class,v_source.unit,v_source.yield_m3,v_version,'draft',null,null,v_source.notes,p_actor)
  returning id into v_new_id;
  insert into public.mix_design_items(mix_design_id,material_id,quantity,unit,wastage_percent_override,sequence_no,notes)
  select v_new_id,material_id,quantity,unit,wastage_percent_override,sequence_no,notes from public.mix_design_items where mix_design_id=p_design_id;
  insert into public.mix_design_overheads(mix_design_id,cost_type,amount,allocation_basis,notes)
  select v_new_id,cost_type,amount,allocation_basis,notes from public.mix_design_overheads where mix_design_id=p_design_id;
  insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details)
  values('web',p_actor,'mix_design_version_cloned','mix_design',v_new_id::text,jsonb_build_object('source_design_id',p_design_id,'version_no',v_version));
  return jsonb_build_object('id',v_new_id,'code',v_source.code,'version_no',v_version,'status','draft');
end $$;

create or replace function public.approve_mix_cost_run(p_run_id uuid,p_actor text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_run public.mix_cost_calculation_runs%rowtype;
  v_design public.mix_designs%rowtype;
begin
  if nullif(trim(p_actor),'') is null then raise exception 'MIX_ACTOR_REQUIRED'; end if;
  select * into v_run from public.mix_cost_calculation_runs where id=p_run_id for update;
  if not found or v_run.status<>'calculated' then raise exception 'MIX_RUN_NOT_APPROVABLE'; end if;
  select * into v_design from public.mix_designs where id=v_run.mix_design_id for update;
  if not found then raise exception 'MIX_DESIGN_NOT_FOUND'; end if;
  if v_design.status not in ('draft','pending_approval','approved') then raise exception 'MIX_DESIGN_NOT_APPROVABLE:%',v_design.status; end if;
  update public.mix_cost_calculation_runs set status='superseded'
  where mix_design_id=v_run.mix_design_id and status='approved' and id<>p_run_id;
  update public.mix_cost_calculation_runs set status='approved' where id=p_run_id;
  if v_design.status<>'approved' then
    update public.mix_designs set status='approved',approved_by=p_actor,approved_at=now(),updated_at=now() where id=v_run.mix_design_id;
  end if;
  insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details)
  values('web',p_actor,'mix_cost_run_approved','mix_cost_run',p_run_id::text,jsonb_build_object('mix_design_id',v_run.mix_design_id,'total_cost_per_m3',v_run.total_cost_per_m3,'recommended_price',v_run.recommended_price));
  return jsonb_build_object('id',p_run_id,'mix_design_id',v_run.mix_design_id,'status','approved','total_cost_per_m3',v_run.total_cost_per_m3,'recommended_price',v_run.recommended_price);
end $$;

create or replace function public.decide_user_invitation(
  p_invitation_id uuid,
  p_actor text,
  p_approver_telegram_id text,
  p_decision text,
  p_role text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_inv public.user_invitations%rowtype;
  v_role text;
  v_user_id uuid;
begin
  if p_decision not in ('approve','reject','revoke') then raise exception 'INVITATION_DECISION_INVALID'; end if;
  if nullif(trim(p_actor),'') is null or nullif(trim(p_approver_telegram_id),'') is null then raise exception 'INVITATION_ACTOR_REQUIRED'; end if;
  select * into v_inv from public.user_invitations where id=p_invitation_id for update;
  if not found then raise exception 'INVITATION_NOT_FOUND'; end if;
  if p_decision='revoke' then
    if v_inv.status not in ('pending','opened','accepted_pending_approval') then raise exception 'INVITATION_NOT_REVOCABLE'; end if;
    update public.user_invitations set status='revoked',revoked_by=p_actor,revoked_at=now() where id=p_invitation_id;
    insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details)
    values('telegram',p_actor,'user_invitation_revoked','user_invitation',p_invitation_id::text,jsonb_build_object('phone',regexp_replace(v_inv.phone_normalized,'(.{4}).*(.{3})','\1****\2')));
    return jsonb_build_object('id',p_invitation_id,'status','revoked');
  end if;
  if v_inv.status<>'accepted_pending_approval' then raise exception 'INVITATION_NOT_AWAITING_APPROVAL'; end if;
  if v_inv.accepted_by_telegram_id=p_approver_telegram_id then raise exception 'INVITATION_SELF_APPROVAL_FORBIDDEN'; end if;
  if p_decision='reject' then
    update public.user_invitations set status='rejected',revoked_by=p_actor,revoked_at=now() where id=p_invitation_id;
    insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details)
    values('telegram',p_actor,'user_invitation_rejected','user_invitation',p_invitation_id::text,jsonb_build_object('target_telegram_id',v_inv.accepted_by_telegram_id));
    return jsonb_build_object('id',p_invitation_id,'status','rejected','target_telegram_id',v_inv.accepted_by_telegram_id);
  end if;
  v_role:=coalesce(nullif(trim(p_role),''),v_inv.requested_role);
  if v_role not in ('admin','manager','accountant','block_sales','concrete_sales','mechanic','fuel_operator','hr','procurement','driver','employee','collector','warehouse','quality') then raise exception 'INVITATION_ROLE_INVALID'; end if;
  update public.app_users set full_name=v_inv.full_name,employee_external_id=v_inv.employee_external_id,role=v_role,active=true,updated_at=now()
  where external_id=v_inv.accepted_by_telegram_id returning id into v_user_id;
  if v_user_id is null then raise exception 'INVITATION_USER_NOT_FOUND'; end if;
  update public.user_invitations set requested_role=v_role,status='approved',approved_by=p_actor,approved_at=now() where id=p_invitation_id;
  insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details)
  values('telegram',p_actor,'user_invitation_approved','app_user',v_user_id::text,jsonb_build_object('invitation_id',p_invitation_id,'new_role',v_role,'target_telegram_id',v_inv.accepted_by_telegram_id));
  return jsonb_build_object('id',p_invitation_id,'status','approved','user_id',v_user_id,'role',v_role,'target_telegram_id',v_inv.accepted_by_telegram_id);
end $$;

insert into public.migration_history(version,migration_name)
values(20,'020_atomic_mix_invitation_and_sales_basis')
on conflict(version) do update set migration_name=excluded.migration_name;
