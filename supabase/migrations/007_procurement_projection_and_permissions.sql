-- Bin Hamid Factory Control — direct RFQ projection
-- Run after 006_runtime_replay_and_integrity.sql.
-- Idempotent.

alter table public.purchase_requests add column if not exists source_event_type text;
alter table public.purchase_requests add column if not exists source_event_id text;
create unique index if not exists purchase_requests_source_event_uidx
  on public.purchase_requests(source_event_type,source_event_id)
  where source_event_type is not null and source_event_id is not null;

create or replace function public.project_supplier_quote_request()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  d jsonb:=coalesce(new.details,'{}'::jsonb);
  ref text:=coalesce(nullif(new.entity_id,''),nullif(d->>'reference_no',''),concat('RFQ-AUD-',new.id));
  v_user uuid:=public.safe_uuid(d->>'requested_by_user_id');
begin
  if new.action<>'supplier_quote_request' then return new; end if;
  insert into public.purchase_requests(
    reference_no,request_type,item_description,quantity,unit,urgency,
    related_entity_type,related_entity_id,status,requested_by,
    source_chat_id,source_message_id,requested_at,created_at,updated_at,
    source_audit_id,source_event_type,source_event_id
  ) values(
    ref,'rfq',coalesce(nullif(d->>'item',''),'قطعة غير مسماة'),
    public.safe_numeric(d->>'quantity',1),d->>'unit',coalesce(nullif(d->>'urgency',''),'normal'),
    'request_for_quotation',ref,'requested',v_user,
    d->>'chat_id',d->>'source_message_id',coalesce(public.safe_timestamptz(d->>'created_at',null),new.created_at),new.created_at,new.created_at,
    new.id,'audit_log',new.id::text
  )
  on conflict(reference_no) do update set
    item_description=excluded.item_description,
    quantity=excluded.quantity,
    unit=excluded.unit,
    urgency=excluded.urgency,
    requested_by=coalesce(excluded.requested_by,purchase_requests.requested_by),
    source_chat_id=excluded.source_chat_id,
    source_message_id=excluded.source_message_id,
    updated_at=excluded.updated_at,
    source_audit_id=coalesce(purchase_requests.source_audit_id,excluded.source_audit_id),
    source_event_type=coalesce(purchase_requests.source_event_type,excluded.source_event_type),
    source_event_id=coalesce(purchase_requests.source_event_id,excluded.source_event_id);
  return new;
exception when others then
  raise notice 'RFQ projection skipped audit %: %',new.id,sqlerrm;
  return new;
end $$;

drop trigger if exists supplier_quote_request_projection_trigger on public.audit_log;
create trigger supplier_quote_request_projection_trigger
after insert on public.audit_log
for each row execute function public.project_supplier_quote_request();

-- Replay historical RFQ records once through an update trigger.
drop trigger if exists supplier_quote_request_replay_trigger on public.audit_log;
create trigger supplier_quote_request_replay_trigger
after update of details on public.audit_log
for each row execute function public.project_supplier_quote_request();

update public.audit_log set details=details where action='supplier_quote_request';

drop trigger if exists supplier_quote_request_replay_trigger on public.audit_log;

revoke all on function public.project_supplier_quote_request() from anon, authenticated;
