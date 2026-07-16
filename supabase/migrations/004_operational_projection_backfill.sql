-- Bin Hamid Factory Control — harden and backfill audit projections
-- Run after 003_enterprise_operations_and_conversations.sql.
-- Idempotent.

alter table public.sales_order_updates add column if not exists source_audit_id bigint;
create unique index if not exists sales_order_updates_audit_uidx
  on public.sales_order_updates(source_audit_id)
  where source_audit_id is not null;

create or replace function public.safe_numeric(p_value text, p_default numeric default 0)
returns numeric language plpgsql immutable as $$
begin
  if p_value is null or btrim(p_value)='' then return p_default; end if;
  return replace(replace(btrim(p_value),',',''),'٬','')::numeric;
exception when others then return p_default;
end $$;

create or replace function public.safe_uuid(p_value text)
returns uuid language plpgsql immutable as $$
begin
  if p_value is null or btrim(p_value)='' then return null; end if;
  return btrim(p_value)::uuid;
exception when others then return null;
end $$;

create or replace function public.safe_date(p_value text)
returns date language plpgsql immutable as $$
begin
  if p_value is null or btrim(p_value)='' then return null; end if;
  return btrim(p_value)::date;
exception when others then return null;
end $$;

create or replace function public.safe_timestamptz(p_value text, p_default timestamptz default null)
returns timestamptz language plpgsql immutable as $$
begin
  if p_value is null or btrim(p_value)='' then return p_default; end if;
  return btrim(p_value)::timestamptz;
exception when others then return p_default;
end $$;

create or replace function public.project_audit_row(
  p_id bigint,
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_details jsonb,
  p_created_at timestamptz
) returns void language plpgsql security definer set search_path=public as $$
declare
  d jsonb := coalesce(p_details,'{}'::jsonb);
  ref text := coalesce(nullif(p_entity_id,''),nullif(d->>'reference_no',''),concat('AUD-',p_id));
  dept text;
  v_type text;
  v_order_id uuid;
  v_status text := coalesce(nullif(d->>'status',''),'registered');
  v_amount numeric := coalesce(public.safe_numeric(d->>'amount',null),public.safe_numeric(d->>'total_amount',0),0);
begin
  dept := coalesce(nullif(d->>'department',''),
    case
      when coalesce(p_entity_type,'') ilike '%sales%' then case when coalesce(p_entity_type,'') ilike '%block%' then 'block' else 'concrete' end
      when coalesce(p_entity_type,'') ilike '%maintenance%' or coalesce(p_entity_type,'') ilike '%workshop%' then 'workshop'
      when coalesce(p_entity_type,'') ilike '%purchase%' or coalesce(p_entity_type,'') ilike '%quotation%' or coalesce(p_entity_type,'') ilike '%supplier%' then 'procurement'
      when coalesce(p_entity_type,'') ilike '%collection%' or coalesce(p_entity_type,'') ilike '%finance%' or coalesce(p_entity_type,'') ilike '%invoice%' then 'finance'
      when coalesce(p_entity_type,'') ilike '%quality%' then 'quality'
      when coalesce(p_entity_type,'') ilike '%attendance%' then 'hr'
      when coalesce(p_entity_type,'') ilike '%driver%' or coalesce(p_entity_type,'') ilike '%trip%' or coalesce(p_entity_type,'') ilike '%fuel%' then 'fleet'
      else 'general'
    end);

  insert into public.operational_records(
    reference_no,entity_type,department,status,title,summary,amount,payload,created_by,assigned_to,
    source_channel,source_chat_id,source_message_id,created_at,updated_at,closed_at
  ) values (
    ref,coalesce(nullif(p_entity_type,''),'operation'),dept,v_status,d->>'title',
    coalesce(d->>'summary',d->>'note',d->>'problem',d->>'description'),v_amount,d,
    coalesce(public.safe_uuid(d->>'created_by_user_id'),public.safe_uuid(d->>'updated_by_user_id'),public.safe_uuid(d->>'user_id')),
    public.safe_uuid(d->>'assigned_to'),'telegram',coalesce(d->>'chat_id',d->>'source_chat_id'),d->>'source_message_id',
    coalesce(public.safe_timestamptz(d->>'created_at',p_created_at),p_created_at),p_created_at,
    case when v_status in ('closed','completed','cancelled','collected','rejected') then p_created_at end
  ) on conflict(entity_type,reference_no) do update set
    department=excluded.department,
    status=excluded.status,
    title=coalesce(excluded.title,public.operational_records.title),
    summary=coalesce(excluded.summary,public.operational_records.summary),
    amount=case when excluded.amount<>0 then excluded.amount else public.operational_records.amount end,
    payload=public.operational_records.payload || excluded.payload,
    assigned_to=coalesce(excluded.assigned_to,public.operational_records.assigned_to),
    updated_at=greatest(public.operational_records.updated_at,excluded.updated_at),
    closed_at=coalesce(excluded.closed_at,public.operational_records.closed_at);

  if p_action in ('sales_order_created','sales_order_updated','sales_order_cancelled')
     and p_entity_type in ('block_sales_order','concrete_sales_order') then
    v_type := case when p_entity_type='block_sales_order' then 'block' else 'concrete' end;
    insert into public.sales_orders(
      reference_no,sales_type,customer_name,customer_phone,item,quantity,quantity_text,unit,unit_price,total_amount,
      delivery_date,delivery_text,location,payment_method,notes,status,sales_person_user_id,sales_person_name,
      source_chat_id,source_message_id,raw_order_text,created_at,updated_at,delivered_at,collected_at,cancelled_at
    ) values (
      ref,v_type,coalesce(nullif(d->>'customer_name',''),'غير محدد'),d->>'customer_phone',coalesce(nullif(d->>'item',''),'غير محدد'),
      public.safe_numeric(d->>'quantity',0),d->>'quantity_text',d->>'unit',public.safe_numeric(d->>'unit_price',0),public.safe_numeric(d->>'total_amount',0),
      public.safe_date(d->>'delivery_date'),d->>'delivery_text',d->>'location',d->>'payment_method',d->>'notes',v_status,
      coalesce(public.safe_uuid(d->>'created_by_user_id'),public.safe_uuid(d->>'updated_by_user_id')),d->>'sales_person_name',
      coalesce(d->>'chat_id',d->>'source_chat_id'),d->>'source_message_id',d->>'raw_order_text',
      coalesce(public.safe_timestamptz(d->>'created_at',p_created_at),p_created_at),p_created_at,
      case when v_status='delivered' then p_created_at end,
      case when v_status='collected' then p_created_at end,
      case when v_status='cancelled' then p_created_at end
    ) on conflict(reference_no) do update set
      customer_name=excluded.customer_name,
      customer_phone=coalesce(excluded.customer_phone,public.sales_orders.customer_phone),
      item=excluded.item,
      quantity=excluded.quantity,
      quantity_text=coalesce(excluded.quantity_text,public.sales_orders.quantity_text),
      unit=coalesce(excluded.unit,public.sales_orders.unit),
      unit_price=case when excluded.unit_price<>0 then excluded.unit_price else public.sales_orders.unit_price end,
      total_amount=case when excluded.total_amount<>0 then excluded.total_amount else public.sales_orders.total_amount end,
      delivery_date=coalesce(excluded.delivery_date,public.sales_orders.delivery_date),
      delivery_text=coalesce(excluded.delivery_text,public.sales_orders.delivery_text),
      location=coalesce(excluded.location,public.sales_orders.location),
      payment_method=coalesce(excluded.payment_method,public.sales_orders.payment_method),
      notes=coalesce(excluded.notes,public.sales_orders.notes),
      status=excluded.status,
      sales_person_name=coalesce(excluded.sales_person_name,public.sales_orders.sales_person_name),
      updated_at=greatest(public.sales_orders.updated_at,excluded.updated_at),
      delivered_at=coalesce(public.sales_orders.delivered_at,excluded.delivered_at),
      collected_at=coalesce(public.sales_orders.collected_at,excluded.collected_at),
      cancelled_at=coalesce(public.sales_orders.cancelled_at,excluded.cancelled_at)
    returning id into v_order_id;

    insert into public.sales_order_updates(
      sales_order_id,status,note,created_by,source_chat_id,source_message_id,created_at,source_audit_id
    ) values (
      v_order_id,v_status,coalesce(d->>'last_update_note',p_action),
      coalesce(public.safe_uuid(d->>'updated_by_user_id'),public.safe_uuid(d->>'created_by_user_id')),
      coalesce(d->>'chat_id',d->>'source_chat_id'),d->>'source_message_id',p_created_at,p_id
    ) on conflict(source_audit_id) where source_audit_id is not null do nothing;
  end if;
end $$;

create or replace function public.project_sales_audit_event()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform public.project_audit_row(new.id,new.action,new.entity_type,new.entity_id,new.details,new.created_at);
  return new;
exception when others then
  return new;
end $$;

create or replace function public.project_operational_audit_event()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform public.project_audit_row(new.id,new.action,new.entity_type,new.entity_id,new.details,new.created_at);
  return new;
exception when others then
  return new;
end $$;

-- One trigger is sufficient because project_audit_row handles all operations including sales.
drop trigger if exists audit_sales_projection_trigger on public.audit_log;
drop trigger if exists audit_operational_projection_trigger on public.audit_log;
create trigger audit_operational_projection_trigger
after insert on public.audit_log
for each row execute function public.project_operational_audit_event();

-- Backfill every existing Telegram/audit operation.
do $$ declare r record; begin
  for r in select id,action,entity_type,entity_id,details,created_at from public.audit_log order by id loop
    begin
      perform public.project_audit_row(r.id,r.action,r.entity_type,r.entity_id,r.details,r.created_at);
    exception when others then
      raise notice 'Skipped audit row %: %',r.id,sqlerrm;
    end;
  end loop;
end $$;

revoke all on function public.safe_numeric(text,numeric) from anon, authenticated;
revoke all on function public.safe_uuid(text) from anon, authenticated;
revoke all on function public.safe_date(text) from anon, authenticated;
revoke all on function public.safe_timestamptz(text,timestamptz) from anon, authenticated;
revoke all on function public.project_audit_row(bigint,text,text,text,jsonb,timestamptz) from anon, authenticated;
revoke all on function public.project_sales_audit_event() from anon, authenticated;
revoke all on function public.project_operational_audit_event() from anon, authenticated;
