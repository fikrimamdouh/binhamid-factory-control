-- Bin Hamid Factory Control — workshop service commands and atomic transitions
-- Run after 025_workshop_central_data_model.sql.
-- Idempotent and non-destructive.

create extension if not exists pgcrypto;

alter table public.maintenance_orders add column if not exists assigned_technician_id text;
alter table public.maintenance_orders add column if not exists approval_required boolean not null default false;
alter table public.maintenance_orders add column if not exists test_passed boolean;
alter table public.maintenance_orders add column if not exists cost_approved_by text;
alter table public.maintenance_orders add column if not exists cost_approved_at timestamptz;

alter table public.maintenance_diagnostics add column if not exists request_id text;
alter table public.maintenance_labor_entries add column if not exists request_id text;
alter table public.maintenance_parts add column if not exists request_id text;
create unique index if not exists maintenance_diagnostics_request_uidx on public.maintenance_diagnostics(request_id) where request_id is not null;
create unique index if not exists maintenance_labor_request_uidx on public.maintenance_labor_entries(request_id) where request_id is not null;
create unique index if not exists maintenance_parts_request_uidx on public.maintenance_parts(request_id) where request_id is not null;

create table if not exists public.workshop_command_receipts (
  id uuid primary key default gen_random_uuid(),
  command_key text not null unique,
  action text not null,
  maintenance_id uuid references public.maintenance_orders(id) on delete restrict,
  actor_id text,
  actor_role text,
  source_channel text not null default 'system',
  source_reference text,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists workshop_command_receipts_order_idx on public.workshop_command_receipts(maintenance_id,created_at desc);

create or replace function public.workshop_actor_uuid(p_actor text)
returns uuid language plpgsql immutable as $$
begin
  if nullif(trim(coalesce(p_actor,'')),'') is null then return null; end if;
  if p_actor ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then return p_actor::uuid; end if;
  return null;
end $$;

create or replace function public.workshop_create_order(
  p_reference_no text,
  p_asset_external_id text,
  p_problem text,
  p_priority text default 'normal',
  p_vehicle_stopped boolean default false,
  p_fault_category text default null,
  p_actor text default null,
  p_actor_role text default null,
  p_source_channel text default 'web',
  p_source_chat_id text default null,
  p_source_message_id text default null,
  p_request_id text default null,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_existing jsonb;
  v_order public.maintenance_orders%rowtype;
  v_asset public.unified_assets%rowtype;
  v_result jsonb;
begin
  if nullif(trim(coalesce(p_request_id,'')),'') is null then raise exception 'WORKSHOP_REQUEST_ID_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id,0));
  select result into v_existing from public.workshop_command_receipts where command_key=p_request_id;
  if found then return v_existing||jsonb_build_object('duplicate',true); end if;
  if nullif(trim(coalesce(p_reference_no,'')),'') is null then raise exception 'WORKSHOP_REFERENCE_REQUIRED'; end if;
  if nullif(trim(coalesce(p_problem,'')),'') is null then raise exception 'WORKSHOP_PROBLEM_REQUIRED'; end if;
  if coalesce(p_priority,'normal') not in ('normal','urgent','critical') then raise exception 'WORKSHOP_PRIORITY_INVALID'; end if;
  if nullif(trim(coalesce(p_asset_external_id,'')),'') is null then raise exception 'WORKSHOP_ASSET_REQUIRED'; end if;
  select * into v_asset from public.unified_assets where external_id=p_asset_external_id and active=true for share;
  if not found then raise exception 'WORKSHOP_ASSET_NOT_FOUND:%',p_asset_external_id; end if;

  insert into public.maintenance_orders(
    reference_no,asset_external_id,vehicle_external_id,plate_snapshot,problem,fault_category,priority,
    vehicle_stopped,status,reported_by,source_channel,source_chat_id,source_message_id,reported_at,metadata
  ) values(
    p_reference_no,p_asset_external_id,
    case when v_asset.asset_type='vehicle' then p_asset_external_id else null end,
    coalesce(nullif(v_asset.plate_no,''),nullif(v_asset.asset_no,''),nullif(v_asset.asset_name,''),p_asset_external_id),
    trim(p_problem),nullif(trim(coalesce(p_fault_category,'')),''),coalesce(p_priority,'normal'),
    coalesce(p_vehicle_stopped,false),'draft',public.workshop_actor_uuid(p_actor),coalesce(nullif(p_source_channel,''),'web'),
    nullif(p_source_chat_id,''),nullif(p_source_message_id,''),now(),coalesce(p_metadata,'{}'::jsonb)
  ) returning * into v_order;

  insert into public.maintenance_status_history(
    maintenance_id,previous_status,new_status,actor_id,actor_role,source_channel,note,reason,request_id,metadata
  ) values(
    v_order.id,null,'draft',p_actor,p_actor_role,coalesce(nullif(p_source_channel,''),'web'),
    'تم إنشاء مسودة أمر الصيانة','create',p_request_id,jsonb_build_object('created_by','workshop_create_order')
  );

  insert into public.operational_records(
    reference_no,entity_type,entity_id,maintenance_order_id,department,status,title,summary,amount,payload,
    created_by,source_channel,source_chat_id,source_message_id,created_at,updated_at
  ) values(
    v_order.reference_no,'maintenance_order',v_order.id::text,v_order.id,'workshop',v_order.status,
    concat('أمر صيانة ',v_order.reference_no),v_order.problem,0,
    jsonb_build_object('maintenance_order_id',v_order.id,'asset_external_id',v_order.asset_external_id,'priority',v_order.priority,'projection',true),
    coalesce(nullif(p_actor,''),'workshop-service'),coalesce(nullif(p_source_channel,''),'web'),
    nullif(p_source_chat_id,''),nullif(p_source_message_id,''),v_order.created_at,v_order.updated_at
  );

  v_result=to_jsonb(v_order)||jsonb_build_object('duplicate',false);
  insert into public.workshop_command_receipts(command_key,action,maintenance_id,actor_id,actor_role,source_channel,source_reference,result)
  values(p_request_id,'create_order',v_order.id,p_actor,p_actor_role,coalesce(nullif(p_source_channel,''),'web'),p_source_message_id,v_result);
  return v_result;
end $$;

create or replace function public.workshop_transition_order(
  p_maintenance_id uuid,
  p_target_status text,
  p_actor text,
  p_actor_role text,
  p_source_channel text default 'web',
  p_note text default null,
  p_reason text default null,
  p_request_id text default null,
  p_expected_version integer default null,
  p_patch jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_existing jsonb;
  v_order public.maintenance_orders%rowtype;
  v_updated public.maintenance_orders%rowtype;
  v_has_diagnosis boolean;
  v_has_work boolean;
  v_test_passed boolean;
  v_handover text;
  v_result jsonb;
  v_now timestamptz:=now();
begin
  if p_maintenance_id is null then raise exception 'WORKSHOP_ORDER_ID_REQUIRED'; end if;
  if nullif(trim(coalesce(p_request_id,'')),'') is null then raise exception 'WORKSHOP_REQUEST_ID_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id,0));
  select result into v_existing from public.workshop_command_receipts where command_key=p_request_id;
  if found then return v_existing||jsonb_build_object('duplicate',true); end if;

  select * into v_order from public.maintenance_orders where id=p_maintenance_id for update;
  if not found then raise exception 'WORKSHOP_ORDER_NOT_FOUND:%',p_maintenance_id; end if;
  if p_expected_version is not null and v_order.version<>p_expected_version then
    raise exception 'WORKSHOP_VERSION_CONFLICT:%:%',v_order.version,p_expected_version;
  end if;
  if not public.workshop_status_transition_allowed(v_order.status,p_target_status) then
    raise exception 'WORKSHOP_TRANSITION_NOT_ALLOWED:%:%',v_order.status,p_target_status;
  end if;
  if p_target_status='approved' and coalesce(p_actor_role,'') not in ('admin','manager') then raise exception 'WORKSHOP_APPROVAL_REQUIRED'; end if;
  if p_target_status='closed' and coalesce(p_actor_role,'') not in ('admin','manager') then raise exception 'WORKSHOP_CLOSE_REQUIRED'; end if;
  if v_order.status='closed' and p_target_status='in_repair' and coalesce(p_actor_role,'') not in ('admin','manager') then raise exception 'WORKSHOP_REOPEN_REQUIRED'; end if;

  select exists(select 1 from public.maintenance_diagnostics d where d.maintenance_id=v_order.id) into v_has_diagnosis;
  select exists(select 1 from public.maintenance_labor_entries l where l.maintenance_id=v_order.id and (l.hours>0 or l.ended_at is not null))
      or nullif(trim(coalesce(v_order.resolution_summary,'')),'') is not null into v_has_work;
  v_test_passed=coalesce((p_patch->>'testPassed')::boolean,v_order.test_passed,false);
  v_handover=coalesce(nullif(p_patch->>'handoverStatus',''),v_order.handover_status,'pending');

  if p_target_status in ('diagnosed','quotation_required','approval_pending','approved','in_repair','external_repair') and not v_has_diagnosis then
    raise exception 'WORKSHOP_DIAGNOSIS_REQUIRED';
  end if;
  if p_target_status='in_repair' and coalesce(v_order.approval_required,false) and v_order.cost_approved_at is null then
    raise exception 'WORKSHOP_COST_APPROVAL_REQUIRED';
  end if;
  if p_target_status='testing' and not v_has_work then raise exception 'WORKSHOP_WORK_EVIDENCE_REQUIRED'; end if;
  if p_target_status in ('ready_for_handover','completed','closed') and not v_test_passed then raise exception 'WORKSHOP_SUCCESSFUL_TEST_REQUIRED'; end if;
  if p_target_status='closed' and v_handover<>'accepted' then raise exception 'WORKSHOP_HANDOVER_REQUIRED'; end if;

  perform set_config('app.actor_id',coalesce(p_actor,''),true);
  perform set_config('app.actor_role',coalesce(p_actor_role,''),true);
  perform set_config('app.source_channel',coalesce(nullif(p_source_channel,''),'web'),true);
  perform set_config('app.request_id',p_request_id,true);
  perform set_config('app.status_note',coalesce(p_note,''),true);
  perform set_config('app.status_reason',coalesce(p_reason,''),true);

  update public.maintenance_orders
  set status=p_target_status,
      resolution_summary=coalesce(nullif(p_patch->>'resolutionSummary',''),resolution_summary),
      root_cause=coalesce(nullif(p_patch->>'rootCause',''),root_cause),
      test_result=coalesce(nullif(p_patch->>'testResult',''),test_result),
      test_passed=case when p_patch ? 'testPassed' then (p_patch->>'testPassed')::boolean else test_passed end,
      handover_status=coalesce(nullif(p_patch->>'handoverStatus',''),handover_status),
      approved_cost=case when p_patch ? 'approvedCost' then (p_patch->>'approvedCost')::numeric else approved_cost end,
      approval_required=case when p_patch ? 'approvalRequired' then (p_patch->>'approvalRequired')::boolean else approval_required end,
      cost_approved_by=case when p_target_status='approved' then p_actor else cost_approved_by end,
      cost_approved_at=case when p_target_status='approved' then v_now else cost_approved_at end,
      started_at=case when p_target_status='in_repair' then coalesce(started_at,v_now) else started_at end,
      downtime_started_at=case when p_target_status='in_repair' then coalesce(downtime_started_at,v_now) else downtime_started_at end,
      completed_at=case when p_target_status='completed' then coalesce(completed_at,v_now) else completed_at end,
      closed_at=case when p_target_status='closed' then v_now else closed_at end,
      downtime_ended_at=case when p_target_status='closed' then v_now else downtime_ended_at end,
      cancelled_at=case when p_target_status='cancelled' then v_now else cancelled_at end,
      updated_at=v_now
  where id=v_order.id
  returning * into v_updated;

  update public.operational_records
  set status=v_updated.status,
      amount=coalesce(v_updated.actual_cost,v_updated.approved_cost,v_updated.estimated_cost,0),
      summary=coalesce(nullif(v_updated.resolution_summary,''),v_updated.problem),
      payload=coalesce(payload,'{}'::jsonb)||jsonb_build_object(
        'maintenance_order_id',v_updated.id,'asset_external_id',v_updated.asset_external_id,
        'priority',v_updated.priority,'version',v_updated.version,'handover_status',v_updated.handover_status,
        'test_passed',v_updated.test_passed,'projection',true
      ),
      version=version+1,
      updated_at=v_now,
      closed_at=case when v_updated.status in ('closed','cancelled') then v_now else null end
  where maintenance_order_id=v_updated.id;

  v_result=to_jsonb(v_updated)||jsonb_build_object('duplicate',false);
  insert into public.workshop_command_receipts(command_key,action,maintenance_id,actor_id,actor_role,source_channel,result)
  values(p_request_id,concat('transition:',p_target_status),v_updated.id,p_actor,p_actor_role,coalesce(nullif(p_source_channel,''),'web'),v_result);
  return v_result;
end $$;

create or replace function public.workshop_assign_technician(
  p_maintenance_id uuid,
  p_technician_external_id text,
  p_actor text,
  p_actor_role text,
  p_request_id text,
  p_expected_version integer default null
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_existing jsonb;
  v_order public.maintenance_orders%rowtype;
  v_result jsonb;
begin
  if nullif(trim(coalesce(p_request_id,'')),'') is null then raise exception 'WORKSHOP_REQUEST_ID_REQUIRED'; end if;
  if nullif(trim(coalesce(p_technician_external_id,'')),'') is null then raise exception 'WORKSHOP_TECHNICIAN_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id,0));
  select result into v_existing from public.workshop_command_receipts where command_key=p_request_id;
  if found then return v_existing||jsonb_build_object('duplicate',true); end if;
  select * into v_order from public.maintenance_orders where id=p_maintenance_id for update;
  if not found then raise exception 'WORKSHOP_ORDER_NOT_FOUND'; end if;
  if p_expected_version is not null and v_order.version<>p_expected_version then raise exception 'WORKSHOP_VERSION_CONFLICT'; end if;
  if coalesce(p_actor_role,'') not in ('admin','manager','mechanic') then raise exception 'WORKSHOP_ASSIGN_PERMISSION_REQUIRED'; end if;
  update public.maintenance_orders
  set assigned_technician_id=trim(p_technician_external_id),version=version+1,updated_at=now()
  where id=p_maintenance_id returning * into v_order;
  update public.operational_records
  set assigned_to=trim(p_technician_external_id),payload=coalesce(payload,'{}'::jsonb)||jsonb_build_object('assigned_technician_id',trim(p_technician_external_id),'version',v_order.version),version=version+1,updated_at=now()
  where maintenance_order_id=p_maintenance_id;
  insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details)
  values('workshop-service',coalesce(p_actor,'system'),'maintenance_technician_assigned','maintenance_order',p_maintenance_id::text,jsonb_build_object('technician_external_id',trim(p_technician_external_id),'actor_role',p_actor_role));
  v_result=to_jsonb(v_order)||jsonb_build_object('duplicate',false);
  insert into public.workshop_command_receipts(command_key,action,maintenance_id,actor_id,actor_role,source_channel,result)
  values(p_request_id,'assign_technician',p_maintenance_id,p_actor,p_actor_role,'web',v_result);
  return v_result;
end $$;

revoke all on function public.workshop_actor_uuid(text) from public,anon,authenticated;
revoke all on function public.workshop_create_order(text,text,text,text,boolean,text,text,text,text,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.workshop_transition_order(uuid,text,text,text,text,text,text,text,integer,jsonb) from public,anon,authenticated;
revoke all on function public.workshop_assign_technician(uuid,text,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.workshop_actor_uuid(text) to service_role;
grant execute on function public.workshop_create_order(text,text,text,text,boolean,text,text,text,text,text,text,text,jsonb) to service_role;
grant execute on function public.workshop_transition_order(uuid,text,text,text,text,text,text,text,integer,jsonb) to service_role;
grant execute on function public.workshop_assign_technician(uuid,text,text,text,text,integer) to service_role;

insert into public.role_capabilities(role,capability) values
  ('manager','workshop.view'),('manager','workshop.manage'),('manager','workshop.approve'),('manager','workshop.close'),('manager','workshop.cost.view'),
  ('mechanic','workshop.view'),('mechanic','workshop.create'),('mechanic','workshop.update'),('mechanic','workshop.diagnose'),('mechanic','workshop.labor'),('mechanic','workshop.test'),
  ('accountant','workshop.view'),('accountant','workshop.cost.view'),('accountant','workshop.cost.manage'),
  ('procurement','workshop.view'),('procurement','workshop.parts.manage'),
  ('warehouse','workshop.view'),('warehouse','workshop.parts.issue')
on conflict(role,capability) do update set allowed=true;

insert into public.migration_history(version,migration_name)
values(26,'026_workshop_service_rpcs')
on conflict(version) do update set migration_name=excluded.migration_name;
