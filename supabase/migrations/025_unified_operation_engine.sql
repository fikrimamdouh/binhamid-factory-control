begin;

-- Unified operation envelope for web and Telegram adapters.
-- Non-destructive: existing operational records remain valid and are backfilled.

create extension if not exists pgcrypto;

alter table public.operational_records add column if not exists operation_type text;
alter table public.operational_records add column if not exists lifecycle_status text not null default 'pending_review';
alter table public.operational_records add column if not exists idempotency_key text;
alter table public.operational_records add column if not exists source_reference text;
alter table public.operational_records add column if not exists actor_id text;
alter table public.operational_records add column if not exists actor_role text;
alter table public.operational_records add column if not exists approved_by text;
alter table public.operational_records add column if not exists approved_at timestamptz;
alter table public.operational_records add column if not exists posted_reference text;
alter table public.operational_records add column if not exists before_data jsonb not null default '{}'::jsonb;
alter table public.operational_records add column if not exists after_data jsonb not null default '{}'::jsonb;
alter table public.operational_records add column if not exists error_log jsonb not null default '[]'::jsonb;
alter table public.operational_records add column if not exists attempt_count integer not null default 1;
alter table public.operational_records add column if not exists last_error text;

update public.operational_records
set operation_type=coalesce(nullif(operation_type,''),entity_type),
    lifecycle_status=case
      when status in ('draft') then 'draft'
      when status in ('approved','confirmed','scheduled','in_production','ready','dispatched','delivered') then 'approved'
      when status in ('posted','invoiced') then 'posted'
      when status in ('completed','closed','collected') then 'completed'
      when status='rejected' then 'rejected'
      when status='cancelled' then 'cancelled'
      when status='reversed' then 'reversed'
      when status='failed' then 'failed'
      when status='retry_pending' then 'retry_pending'
      else 'pending_review'
    end
where operation_type is null or operation_type='' or lifecycle_status is null;

create unique index if not exists operational_records_idempotency_uidx
  on public.operational_records(idempotency_key)
  where idempotency_key is not null and idempotency_key<>'';
create index if not exists operational_records_lifecycle_idx
  on public.operational_records(lifecycle_status,updated_at desc);
create index if not exists operational_records_source_reference_idx
  on public.operational_records(source_channel,source_reference)
  where source_reference is not null;

create table if not exists public.operation_events (
  id bigserial primary key,
  operation_record_id uuid not null references public.operational_records(id) on delete restrict,
  action text not null,
  from_status text,
  to_status text,
  from_lifecycle_status text,
  to_lifecycle_status text,
  actor_id text,
  actor_role text,
  source_channel text,
  source_reference text,
  note text,
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  error_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists operation_events_operation_idx
  on public.operation_events(operation_record_id,created_at desc);

alter table public.notification_outbox add column if not exists dedupe_key text;
alter table public.notification_outbox add column if not exists attempt_count integer not null default 0;
alter table public.notification_outbox add column if not exists next_attempt_at timestamptz;
alter table public.notification_outbox add column if not exists last_attempt_at timestamptz;
alter table public.notification_outbox add column if not exists dead_letter_at timestamptz;
create unique index if not exists notification_outbox_dedupe_uidx
  on public.notification_outbox(dedupe_key)
  where dedupe_key is not null and dedupe_key<>'';

create or replace function public.map_operation_lifecycle(p_status text)
returns text language sql immutable as $$
  select case lower(coalesce(p_status,''))
    when 'draft' then 'draft'
    when 'approved' then 'approved'
    when 'confirmed' then 'approved'
    when 'scheduled' then 'approved'
    when 'in_production' then 'approved'
    when 'ready' then 'approved'
    when 'dispatched' then 'approved'
    when 'delivered' then 'approved'
    when 'posted' then 'posted'
    when 'invoiced' then 'posted'
    when 'completed' then 'completed'
    when 'closed' then 'completed'
    when 'collected' then 'completed'
    when 'rejected' then 'rejected'
    when 'cancelled' then 'cancelled'
    when 'reversed' then 'reversed'
    when 'failed' then 'failed'
    when 'retry_pending' then 'retry_pending'
    else 'pending_review'
  end
$$;

create or replace function public.operation_transition_allowed(p_from text,p_to text)
returns boolean language sql immutable as $$
  select case
    when p_from=p_to then true
    when p_from='draft' then p_to in ('pending_review','cancelled','failed')
    when p_from='pending_review' then p_to in ('approved','completed','rejected','cancelled','failed')
    when p_from='approved' then p_to in ('posted','completed','cancelled','failed')
    when p_from='posted' then p_to in ('completed','reversed','failed')
    when p_from='failed' then p_to in ('retry_pending','cancelled')
    when p_from='retry_pending' then p_to in ('pending_review','approved','posted','failed','cancelled')
    else false
  end
$$;

create or replace function public.queue_operation_notifications(
  p_operation_id uuid,
  p_idempotency_key text,
  p_notifications jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_notification jsonb;
  v_outbox_id uuid;
  v_ids jsonb := '[]'::jsonb;
  v_position integer := 0;
  v_dedupe text;
begin
  if p_notifications is null or jsonb_typeof(p_notifications)<>'array' then return v_ids; end if;
  for v_notification in select value from jsonb_array_elements(p_notifications) loop
    v_position := v_position+1;
    if nullif(v_notification->>'message','') is null then continue; end if;
    v_dedupe := coalesce(nullif(v_notification->>'dedupeKey',''),concat(p_idempotency_key,':notification:',v_position));
    insert into public.notification_outbox(
      notification_type,recipient_user_id,recipient_chat_id,title,message,payload,status,scheduled_at,dedupe_key
    ) values (
      coalesce(nullif(v_notification->>'type',''),'operation'),
      public.safe_uuid(v_notification->>'userId'),
      nullif(v_notification->>'chatId',''),
      nullif(v_notification->>'title',''),
      v_notification->>'message',
      coalesce(v_notification->'payload','{}'::jsonb)||jsonb_build_object('operation_id',p_operation_id),
      'pending',
      coalesce(public.safe_timestamptz(v_notification->>'scheduledAt',now()),now()),
      v_dedupe
    ) on conflict(dedupe_key) where dedupe_key is not null and dedupe_key<>''
      do update set payload=public.notification_outbox.payload||excluded.payload
    returning id into v_outbox_id;
    v_ids := v_ids||jsonb_build_array(v_outbox_id);
  end loop;
  return v_ids;
end $$;

create or replace function public.execute_unified_operation(
  p_operation jsonb,
  p_notifications jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_key text := nullif(p_operation->>'idempotency_key','');
  v_operation_type text := nullif(p_operation->>'operation_type','');
  v_entity_type text := coalesce(nullif(p_operation->>'entity_type',''),v_operation_type,'operation');
  v_reference text := nullif(p_operation->>'reference_no','');
  v_status text := coalesce(nullif(p_operation->>'status',''),'draft');
  v_lifecycle text := coalesce(nullif(p_operation->>'lifecycle_status',''),public.map_operation_lifecycle(v_status));
  v_id uuid := gen_random_uuid();
  v_existing public.operational_records%rowtype;
  v_payload jsonb := coalesce(p_operation->'payload','{}'::jsonb);
  v_outbox_ids jsonb;
  v_domain jsonb := coalesce(p_operation->'domain_record','{}'::jsonb);
begin
  if v_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if v_operation_type is null then raise exception 'OPERATION_TYPE_REQUIRED'; end if;
  if nullif(p_operation->>'source','') is null then raise exception 'OPERATION_SOURCE_REQUIRED'; end if;
  if v_reference is null then
    v_reference := concat('OP-',upper(substr(encode(digest(v_key,'sha256'),'hex'),1,16)));
  end if;

  select * into v_existing from public.operational_records where idempotency_key=v_key limit 1 for update;
  if found then
    update public.operational_records
    set attempt_count=attempt_count+1,updated_at=now()
    where id=v_existing.id;
    insert into public.operation_events(
      operation_record_id,action,from_status,to_status,from_lifecycle_status,to_lifecycle_status,
      actor_id,actor_role,source_channel,source_reference,note,before_data,after_data
    ) values (
      v_existing.id,'duplicate_attempt',v_existing.status,v_existing.status,v_existing.lifecycle_status,v_existing.lifecycle_status,
      p_operation->>'actor_id',p_operation->>'actor_role',p_operation->>'source',p_operation->>'source_reference',
      'Duplicate request ignored',v_existing.before_data,v_existing.after_data
    );
    return jsonb_build_object('ok',true,'duplicate',true,'operationId',v_existing.id,'referenceNo',v_existing.reference_no,'status',v_existing.status,'lifecycleStatus',v_existing.lifecycle_status,'outboxIds','[]'::jsonb);
  end if;

  v_payload := v_payload||jsonb_build_object(
    'operation_id',v_id,
    'operation_type',v_operation_type,
    'idempotency_key',v_key,
    'source',p_operation->>'source',
    'source_reference',p_operation->>'source_reference'
  );

  insert into public.operational_records(
    id,reference_no,entity_type,operation_type,department,status,lifecycle_status,title,summary,amount,payload,
    created_by,assigned_to,source_channel,source_chat_id,source_message_id,source_reference,actor_id,actor_role,
    idempotency_key,before_data,after_data,error_log,attempt_count,created_at,updated_at
  ) values (
    v_id,v_reference,v_entity_type,v_operation_type,coalesce(nullif(p_operation->>'department',''),'general'),v_status,v_lifecycle,
    nullif(p_operation->>'title',''),nullif(p_operation->>'summary',''),public.safe_numeric(p_operation->>'amount',0),v_payload,
    public.safe_uuid(p_operation->>'created_by_user_id'),public.safe_uuid(p_operation->>'assigned_to_user_id'),
    p_operation->>'source',nullif(p_operation->>'source_chat_id',''),nullif(p_operation->>'source_message_id',''),
    nullif(p_operation->>'source_reference',''),nullif(p_operation->>'actor_id',''),nullif(p_operation->>'actor_role',''),
    v_key,coalesce(p_operation->'before_data','{}'::jsonb),coalesce(p_operation->'after_data',v_payload),'[]'::jsonb,1,now(),now()
  );

  if v_domain->>'kind'='operational_task' then
    insert into public.operational_tasks(
      reference_no,title,description,department,priority,status,due_at,created_by,assigned_to,
      related_entity_type,related_entity_id,source_chat_id,source_message_id,created_at,updated_at
    ) values (
      v_reference,coalesce(nullif(v_domain->>'title',''),coalesce(nullif(p_operation->>'title',''),'مهمة تشغيلية')),
      nullif(v_domain->>'description',''),coalesce(nullif(v_domain->>'department',''),'general'),
      coalesce(nullif(v_domain->>'priority',''),'normal'),v_status,public.safe_timestamptz(v_domain->>'dueAt',null),
      public.safe_uuid(p_operation->>'created_by_user_id'),public.safe_uuid(v_domain->>'assignedToUserId'),
      nullif(v_domain->>'relatedEntityType',''),nullif(v_domain->>'relatedEntityId',''),
      nullif(p_operation->>'source_chat_id',''),nullif(p_operation->>'source_message_id',''),now(),now()
    ) on conflict(reference_no) do update set
      title=excluded.title,description=excluded.description,department=excluded.department,priority=excluded.priority,
      status=excluded.status,due_at=excluded.due_at,assigned_to=coalesce(excluded.assigned_to,public.operational_tasks.assigned_to),updated_at=now();
  end if;

  insert into public.operation_events(
    operation_record_id,action,from_status,to_status,from_lifecycle_status,to_lifecycle_status,
    actor_id,actor_role,source_channel,source_reference,note,before_data,after_data
  ) values (
    v_id,'created',null,v_status,null,v_lifecycle,p_operation->>'actor_id',p_operation->>'actor_role',
    p_operation->>'source',p_operation->>'source_reference',null,
    coalesce(p_operation->'before_data','{}'::jsonb),coalesce(p_operation->'after_data',v_payload)
  );

  insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details,created_at)
  values(
    p_operation->>'source',coalesce(nullif(p_operation->>'actor_id',''),'system'),'unified_operation_created',v_entity_type,v_reference,
    v_payload||jsonb_build_object('status',v_status,'lifecycle_status',v_lifecycle,'actor_role',p_operation->>'actor_role'),now()
  );

  v_outbox_ids := public.queue_operation_notifications(v_id,v_key,p_notifications);
  return jsonb_build_object('ok',true,'duplicate',false,'operationId',v_id,'referenceNo',v_reference,'status',v_status,'lifecycleStatus',v_lifecycle,'outboxIds',v_outbox_ids);
end $$;

create or replace function public.transition_unified_operation(
  p_operation_id uuid default null,
  p_reference_no text default null,
  p_next_status text default null,
  p_next_lifecycle_status text default null,
  p_actor jsonb default '{}'::jsonb,
  p_note text default null,
  p_after_data jsonb default '{}'::jsonb,
  p_notifications jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_record public.operational_records%rowtype;
  v_status text;
  v_lifecycle text;
  v_outbox_ids jsonb;
begin
  if p_operation_id is null and nullif(p_reference_no,'') is null then raise exception 'OPERATION_REFERENCE_REQUIRED'; end if;
  select * into v_record
  from public.operational_records
  where (p_operation_id is not null and id=p_operation_id)
     or (p_operation_id is null and reference_no=p_reference_no)
  order by created_at desc limit 1 for update;
  if not found then raise exception 'OPERATION_NOT_FOUND'; end if;

  v_status := coalesce(nullif(p_next_status,''),v_record.status);
  v_lifecycle := coalesce(nullif(p_next_lifecycle_status,''),public.map_operation_lifecycle(v_status));
  if not public.operation_transition_allowed(v_record.lifecycle_status,v_lifecycle) then
    raise exception 'OPERATION_TRANSITION_INVALID:%:%',v_record.lifecycle_status,v_lifecycle;
  end if;

  update public.operational_records set
    status=v_status,
    lifecycle_status=v_lifecycle,
    after_data=coalesce(after_data,'{}'::jsonb)||coalesce(p_after_data,'{}'::jsonb),
    payload=payload||coalesce(p_after_data,'{}'::jsonb)||jsonb_build_object('status',v_status,'lifecycle_status',v_lifecycle,'status_note',p_note),
    actor_id=coalesce(nullif(p_actor->>'id',''),actor_id),
    actor_role=coalesce(nullif(p_actor->>'role',''),actor_role),
    approved_by=case when v_lifecycle='approved' then coalesce(nullif(p_actor->>'id',''),approved_by) else approved_by end,
    approved_at=case when v_lifecycle='approved' then coalesce(approved_at,now()) else approved_at end,
    closed_at=case when v_lifecycle in ('completed','rejected','cancelled','reversed') then coalesce(closed_at,now()) else closed_at end,
    updated_at=now(),
    last_error=case when v_lifecycle='failed' then p_note else null end,
    error_log=case when v_lifecycle='failed' then error_log||jsonb_build_array(jsonb_build_object('at',now(),'message',p_note,'actor',p_actor)) else error_log end
  where id=v_record.id;

  if v_record.operation_type='management_task' or v_record.payload->>'category'='task' then
    update public.operational_tasks set
      status=v_status,updated_at=now(),completed_at=case when v_lifecycle='completed' then coalesce(completed_at,now()) else completed_at end
    where reference_no=v_record.reference_no;
  end if;

  insert into public.operation_events(
    operation_record_id,action,from_status,to_status,from_lifecycle_status,to_lifecycle_status,
    actor_id,actor_role,source_channel,source_reference,note,before_data,after_data
  ) values (
    v_record.id,'status_changed',v_record.status,v_status,v_record.lifecycle_status,v_lifecycle,
    p_actor->>'id',p_actor->>'role',p_actor->>'source',p_actor->>'source_reference',p_note,
    v_record.after_data,coalesce(v_record.after_data,'{}'::jsonb)||coalesce(p_after_data,'{}'::jsonb)
  );

  insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details,created_at)
  values(
    coalesce(nullif(p_actor->>'source',''),'system'),coalesce(nullif(p_actor->>'id',''),'system'),'unified_operation_status',
    v_record.entity_type,v_record.reference_no,
    jsonb_build_object('operation_id',v_record.id,'status',v_status,'lifecycle_status',v_lifecycle,'note',p_note,'actor_role',p_actor->>'role'),now()
  );

  v_outbox_ids := public.queue_operation_notifications(v_record.id,v_record.idempotency_key||':transition:'||v_status||':'||extract(epoch from now())::bigint,p_notifications);
  return jsonb_build_object('ok',true,'operationId',v_record.id,'referenceNo',v_record.reference_no,'status',v_status,'lifecycleStatus',v_lifecycle,'outboxIds',v_outbox_ids);
end $$;

alter table public.operation_events enable row level security;
revoke all on public.operation_events from anon, authenticated;
revoke all on function public.map_operation_lifecycle(text) from anon, authenticated;
revoke all on function public.operation_transition_allowed(text,text) from anon, authenticated;
revoke all on function public.queue_operation_notifications(uuid,text,jsonb) from anon, authenticated;
revoke all on function public.execute_unified_operation(jsonb,jsonb) from anon, authenticated;
revoke all on function public.transition_unified_operation(uuid,text,text,text,jsonb,text,jsonb,jsonb) from anon, authenticated;

insert into public.migration_history(version,migration_name)
values(25,'025_unified_operation_engine')
on conflict(version) do update set migration_name=excluded.migration_name;

commit;
