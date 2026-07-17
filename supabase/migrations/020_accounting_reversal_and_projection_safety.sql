-- Bin Hamid Factory Control — accounting reversal, posted-only balances and fail-closed projections
-- Run after 019_accounting_import_and_telegram_integrity.sql.
-- Idempotent and non-destructive.

do $$ begin
  if not exists(select 1 from public.migration_history where version=19) then raise exception 'MIGRATION_019_REQUIRED'; end if;
end $$;

create or replace view public.trial_balance as
with posted_lines as (
  select l.account_id,l.debit,l.credit
  from public.journal_entry_lines l
  join public.journal_entries e on e.id=l.journal_entry_id
  where e.status='posted'
)
select coa.account_code,coa.account_name_ar,coa.account_type,coa.normal_side,
  coalesce(sum(pl.debit),0)::numeric(18,2) total_debit,
  coalesce(sum(pl.credit),0)::numeric(18,2) total_credit,
  case when coa.normal_side='debit' then coalesce(sum(pl.debit-pl.credit),0) else coalesce(sum(pl.credit-pl.debit),0) end::numeric(18,2) balance
from public.chart_of_accounts coa
left join posted_lines pl on pl.account_id=coa.id
where coa.active=true
group by coa.account_code,coa.account_name_ar,coa.account_type,coa.normal_side;

create or replace view public.accounting_integrity_report as
select
  (select count(*) from public.journal_entries where status='draft') draft_entries,
  (select count(*) from public.journal_entries where status='posted') posted_entries,
  (select count(*) from public.journal_entries where status='reversed') reversed_entries,
  (select count(*) from public.journal_entries je where je.status='posted' and not exists(select 1 from public.journal_entry_lines l where l.journal_entry_id=je.id)) entries_without_lines,
  (select count(*) from (select l.journal_entry_id from public.journal_entry_lines l join public.journal_entries e on e.id=l.journal_entry_id where e.status='posted' group by l.journal_entry_id having round(sum(l.debit),2)<>round(sum(l.credit),2)) x) unbalanced_entries,
  (select coalesce(sum(total_debit),0) from public.trial_balance) total_debit,
  (select coalesce(sum(total_credit),0) from public.trial_balance) total_credit;

create or replace function public.reverse_journal_entry(p_entry_id uuid,p_actor text,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_original public.journal_entries%rowtype;v_reversal uuid;v_reference text;v_line record;
begin
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'REVERSAL_REASON_REQUIRED'; end if;
  select * into v_original from public.journal_entries where id=p_entry_id for update;
  if not found then raise exception 'JOURNAL_ENTRY_NOT_FOUND:%',p_entry_id; end if;
  if v_original.status='reversed' then
    select id,reference_no into v_reversal,v_reference from public.journal_entries where reversal_of=p_entry_id order by created_at desc limit 1;
    return jsonb_build_object('ok',true,'duplicate',true,'originalEntryId',p_entry_id,'reversalEntryId',v_reversal,'referenceNo',v_reference);
  end if;
  if v_original.status<>'posted' then raise exception 'ONLY_POSTED_JOURNAL_CAN_BE_REVERSED:%',p_entry_id; end if;
  v_reference:=concat('RV-',v_original.reference_no);
  insert into public.journal_entries(reference_no,entry_date,description,source_type,source_id,source_batch_id,currency,status,posted_by,reversal_of,metadata)
  values(v_reference,current_date,concat('عكس: ',v_original.description),'journal_reversal',p_entry_id::text,v_original.source_batch_id,v_original.currency,'draft',p_actor,p_entry_id,jsonb_build_object('reason',left(p_reason,1000),'originalReference',v_original.reference_no))
  on conflict(source_type,source_id) do update set updated_at=now()
  returning id into v_reversal;
  if not exists(select 1 from public.journal_entry_lines where journal_entry_id=v_reversal) then
    for v_line in select * from public.journal_entry_lines where journal_entry_id=p_entry_id order by line_no loop
      insert into public.journal_entry_lines(journal_entry_id,line_no,account_id,debit,credit,customer_external_id,cost_center_code,memo,source_line_id)
      values(v_reversal,v_line.line_no,v_line.account_id,v_line.credit,v_line.debit,v_line.customer_external_id,v_line.cost_center_code,concat('عكس — ',coalesce(v_line.memo,'')),v_line.source_line_id);
    end loop;
  end if;
  perform public.assert_journal_entry_balanced(v_reversal);
  update public.journal_entries set status='posted',posted_by=p_actor,posted_at=coalesce(posted_at,now()),updated_at=now() where id=v_reversal;
  update public.journal_entries set status='reversed',updated_at=now() where id=p_entry_id;
  insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details)
  values('web',coalesce(nullif(p_actor,''),'system'),'journal_entry_reversed','journal_entry',p_entry_id::text,jsonb_build_object('reversalEntryId',v_reversal,'referenceNo',v_reference,'reason',left(p_reason,1000)));
  return jsonb_build_object('ok',true,'duplicate',false,'originalEntryId',p_entry_id,'reversalEntryId',v_reversal,'referenceNo',v_reference);
end $$;

-- Sales projections now fail with the originating transaction instead of silently
-- accepting an audit event while losing its structured sales order.
create or replace function public.project_sales_audit_event()
returns trigger language plpgsql security definer set search_path=public as $$
declare d jsonb:=coalesce(new.details,'{}'::jsonb);v_type text;v_order_id uuid;
begin
  if new.action not in ('sales_order_created','sales_order_updated','sales_order_cancelled') then return new; end if;
  if new.entity_type not in ('block_sales_order','concrete_sales_order') then return new; end if;
  v_type:=case when new.entity_type='block_sales_order' then 'block' else 'concrete' end;
  insert into public.sales_orders(reference_no,sales_type,customer_external_id,customer_name,customer_phone,item,quantity,quantity_text,unit,unit_price,total_amount,delivery_date,delivery_text,location,payment_method,notes,status,sales_person_user_id,sales_person_name,source_chat_id,source_message_id,raw_order_text,created_at,updated_at,delivered_at,collected_at,cancelled_at)
  values(new.entity_id,v_type,nullif(d->>'customer_code',''),coalesce(nullif(d->>'customer_name',''),'غير محدد'),d->>'customer_phone',coalesce(nullif(d->>'item',''),'غير محدد'),public.safe_numeric(d->>'quantity',0),d->>'quantity_text',d->>'unit',public.safe_numeric(d->>'unit_price',0),public.safe_numeric(d->>'total_amount',0),nullif(d->>'delivery_date','')::date,d->>'delivery_text',d->>'location',d->>'payment_method',d->>'notes',coalesce(nullif(d->>'status',''),'registered'),nullif(d->>'created_by_user_id','')::uuid,d->>'sales_person_name',d->>'chat_id',d->>'source_message_id',d->>'raw_order_text',coalesce(nullif(d->>'created_at','')::timestamptz,new.created_at),new.created_at,case when d->>'status'='delivered' then new.created_at end,case when d->>'status'='collected' then new.created_at end,case when d->>'status'='cancelled' then new.created_at end)
  on conflict(reference_no) do update set customer_external_id=excluded.customer_external_id,customer_name=excluded.customer_name,customer_phone=excluded.customer_phone,item=excluded.item,quantity=excluded.quantity,quantity_text=excluded.quantity_text,unit=excluded.unit,unit_price=excluded.unit_price,total_amount=excluded.total_amount,delivery_date=excluded.delivery_date,delivery_text=excluded.delivery_text,location=excluded.location,payment_method=excluded.payment_method,notes=excluded.notes,status=excluded.status,sales_person_name=excluded.sales_person_name,updated_at=new.created_at,delivered_at=coalesce(public.sales_orders.delivered_at,excluded.delivered_at),collected_at=coalesce(public.sales_orders.collected_at,excluded.collected_at),cancelled_at=coalesce(public.sales_orders.cancelled_at,excluded.cancelled_at)
  returning id into v_order_id;
  insert into public.sales_order_updates(sales_order_id,status,note,created_by,source_chat_id,source_message_id,created_at)
  values(v_order_id,d->>'status',coalesce(d->>'last_update_note',new.action),nullif(coalesce(d->>'updated_by_user_id',d->>'created_by_user_id'),'')::uuid,d->>'chat_id',d->>'source_message_id',new.created_at);
  return new;
end $$;

create or replace function public.project_operational_audit_event()
returns trigger language plpgsql security definer set search_path=public as $$
declare d jsonb:=coalesce(new.details,'{}'::jsonb);ref text:=coalesce(nullif(new.entity_id,''),nullif(d->>'reference_no',''),concat('AUD-',new.id));dept text;
begin
  dept:=coalesce(nullif(d->>'department',''),case when new.entity_type ilike '%sales%' then case when new.entity_type ilike '%block%' then 'block' else 'concrete' end when new.entity_type ilike '%maintenance%' or new.entity_type ilike '%workshop%' then 'workshop' when new.entity_type ilike '%purchase%' or new.entity_type ilike '%quotation%' then 'procurement' when new.entity_type ilike '%collection%' or new.entity_type ilike '%finance%' then 'finance' when new.entity_type ilike '%quality%' then 'quality' else 'general' end);
  insert into public.operational_records(reference_no,entity_type,department,status,title,summary,amount,payload,source_channel,source_chat_id,source_message_id,created_at,updated_at)
  values(ref,coalesce(new.entity_type,'operation'),dept,coalesce(nullif(d->>'status',''),'registered'),d->>'title',coalesce(d->>'summary',d->>'note',d->>'problem'),coalesce(public.safe_numeric(d->>'amount',null),public.safe_numeric(d->>'total_amount',0)),d,coalesce(nullif(d->>'source_channel',''),'telegram'),d->>'chat_id',d->>'source_message_id',new.created_at,new.created_at)
  on conflict(entity_type,reference_no) do update set department=excluded.department,status=excluded.status,title=coalesce(excluded.title,public.operational_records.title),summary=coalesce(excluded.summary,public.operational_records.summary),amount=case when excluded.amount<>0 then excluded.amount else public.operational_records.amount end,payload=public.operational_records.payload||excluded.payload,updated_at=excluded.updated_at;
  return new;
end $$;

revoke all on function public.reverse_journal_entry(uuid,text,text) from anon,authenticated;
revoke all on function public.project_sales_audit_event() from anon,authenticated;
revoke all on function public.project_operational_audit_event() from anon,authenticated;

insert into public.migration_history(version,migration_name)
values(20,'020_accounting_reversal_and_projection_safety')
on conflict(version) do update set migration_name=excluded.migration_name;
