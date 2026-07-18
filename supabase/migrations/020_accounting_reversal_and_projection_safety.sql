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

-- Preserve the six columns introduced by migration 019 in their original order.
-- PostgreSQL allows CREATE OR REPLACE VIEW to append a column, but not to insert
-- one in the middle because that is interpreted as renaming existing columns.
create or replace view public.accounting_integrity_report as
select
  (select count(*) from public.journal_entries where status='draft') draft_entries,
  (select count(*) from public.journal_entries where status='posted') posted_entries,
  (select count(*) from public.journal_entries je where je.status='posted' and not exists(select 1 from public.journal_entry_lines l where l.journal_entry_id=je.id)) entries_without_lines,
  (select count(*) from (select l.journal_entry_id from public.journal_entry_lines l join public.journal_entries e on e.id=l.journal_entry_id where e.status='posted' group by l.journal_entry_id having round(sum(l.debit),2)<>round(sum(l.credit),2)) x) unbalanced_entries,
  (select coalesce(sum(total_debit),0) from public.trial_balance) total_debit,
  (select coalesce(sum(total_credit),0) from public.trial_balance) total_credit,
  (select count(*) from public.journal_entries where status='reversed') reversed_entries;

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

revoke all on function public.reverse_journal_entry(uuid,text,text) from public,anon,authenticated;
revoke all on function public.project_sales_audit_event() from public,anon,authenticated;
revoke all on function public.project_operational_audit_event() from public,anon,authenticated;
grant execute on function public.reverse_journal_entry(uuid,text,text) to service_role;

-- Additional Schema 20 features merged from the same release.
-- Bin Hamid Factory Control — atomic workflow controls and explicit sales tax basis
-- Additional features for Schema 20, applied after Schema 19.
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
values(20,'020_accounting_reversal_and_projection_safety')
on conflict(version) do update set migration_name=excluded.migration_name;
