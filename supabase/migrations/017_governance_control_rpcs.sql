-- Bin Hamid Factory Control — governance RPCs and enforcement guards
-- Run after 016_enterprise_governance_and_handover.sql.
-- Idempotent and non-destructive.

alter table public.sales_orders add column if not exists credit_override_id uuid;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='sales_orders_credit_override_fk') then
    alter table public.sales_orders add constraint sales_orders_credit_override_fk foreign key(credit_override_id) references public.credit_override_requests(id) on delete restrict;
  end if;
end $$;

create or replace function public.close_financial_period(p_period_start date,p_period_end date,p_actor text,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_row record;
begin
  if p_period_start is null or p_period_end is null or p_period_end<p_period_start then raise exception 'FINANCIAL_PERIOD_INVALID'; end if;
  if nullif(trim(p_actor),'') is null or nullif(trim(p_reason),'') is null then raise exception 'FINANCIAL_PERIOD_ACTOR_REASON_REQUIRED'; end if;
  if exists(select 1 from public.financial_periods where status='closed' and daterange(period_start,period_end,'[]') && daterange(p_period_start,p_period_end,'[]') and not(period_start=p_period_start and period_end=p_period_end)) then raise exception 'FINANCIAL_PERIOD_OVERLAP'; end if;
  insert into public.financial_periods(period_start,period_end,status,closed_by,closed_at,close_reason,updated_at)
  values(p_period_start,p_period_end,'closed',p_actor,now(),p_reason,now())
  on conflict(period_start,period_end) do update set status='closed',closed_by=excluded.closed_by,closed_at=excluded.closed_at,close_reason=excluded.close_reason,reopened_by=null,reopened_at=null,reopen_reason=null,updated_at=now()
  returning id into v_id;
  insert into public.financial_period_events(financial_period_id,action,actor,reason) values(v_id,'closed',p_actor,p_reason);
  insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details) values('web',p_actor,'financial_period_closed','financial_period',v_id::text,jsonb_build_object('period_start',p_period_start,'period_end',p_period_end,'reason',p_reason));
  select * into v_row from public.financial_periods where id=v_id;
  return to_jsonb(v_row);
end $$;

create or replace function public.reopen_financial_period(p_period_id uuid,p_actor text,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row record;
begin
  if p_period_id is null or nullif(trim(p_actor),'') is null or nullif(trim(p_reason),'') is null then raise exception 'FINANCIAL_PERIOD_REOPEN_INPUT_REQUIRED'; end if;
  update public.financial_periods set status='reopened',reopened_by=p_actor,reopened_at=now(),reopen_reason=p_reason,updated_at=now() where id=p_period_id and status='closed' returning * into v_row;
  if not found then raise exception 'FINANCIAL_PERIOD_NOT_CLOSED'; end if;
  insert into public.financial_period_events(financial_period_id,action,actor,reason) values(p_period_id,'reopened',p_actor,p_reason);
  insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details) values('web',p_actor,'financial_period_reopened','financial_period',p_period_id::text,jsonb_build_object('reason',p_reason));
  return to_jsonb(v_row);
end $$;

create or replace function public.request_credit_override(p_customer_external_id text,p_requested_amount numeric,p_reason text,p_actor text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_customer record; v_balance numeric:=0; v_row record; v_ref text;
begin
  if nullif(trim(p_customer_external_id),'') is null or coalesce(p_requested_amount,0)<=0 or nullif(trim(p_reason),'') is null or nullif(trim(p_actor),'') is null then raise exception 'CREDIT_OVERRIDE_INPUT_REQUIRED'; end if;
  select external_id,credit_limit into v_customer from public.customers where external_id=p_customer_external_id and active=true for share;
  if not found then raise exception 'CREDIT_OVERRIDE_CUSTOMER_NOT_FOUND'; end if;
  select coalesce(sum(greatest(0,total_amount-coalesce(paid_amount,0))),0) into v_balance from public.sales_orders where customer_external_id=p_customer_external_id and coalesce(status,'') not in ('cancelled','rejected','collected');
  v_ref:=concat('CRO-',to_char(current_date,'YYYYMMDD'),'-',upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)));
  insert into public.credit_override_requests(reference_no,customer_external_id,requested_amount,current_balance,credit_limit,reason,requested_by)
  values(v_ref,p_customer_external_id,p_requested_amount,v_balance,coalesce(v_customer.credit_limit,0),p_reason,p_actor) returning * into v_row;
  insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details) values('web',p_actor,'credit_override_requested','credit_override',v_row.id::text,jsonb_build_object('reference_no',v_ref,'customer_external_id',p_customer_external_id,'requested_amount',p_requested_amount,'current_balance',v_balance,'credit_limit',v_customer.credit_limit));
  return to_jsonb(v_row);
end $$;

create or replace function public.decide_credit_override(p_request_id uuid,p_decision text,p_actor text,p_note text,p_expires_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row record; v_status text;
begin
  if p_decision not in ('approved','rejected') or nullif(trim(p_actor),'') is null then raise exception 'CREDIT_OVERRIDE_DECISION_INVALID'; end if;
  v_status:=p_decision;
  update public.credit_override_requests set status=v_status,reviewed_by=p_actor,reviewed_at=now(),decision_note=nullif(trim(p_note),''),expires_at=case when v_status='approved' then coalesce(p_expires_at,now()+interval '24 hours') else null end
  where id=p_request_id and status='pending' returning * into v_row;
  if not found then raise exception 'CREDIT_OVERRIDE_NOT_PENDING'; end if;
  insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details) values('web',p_actor,case when v_status='approved' then 'credit_override_approved' else 'credit_override_rejected' end,'credit_override',p_request_id::text,jsonb_build_object('decision_note',p_note,'expires_at',v_row.expires_at));
  return to_jsonb(v_row);
end $$;

create or replace function public.guard_sales_order_credit()
returns trigger language plpgsql set search_path=public as $$
declare v_customer record; v_outstanding numeric:=0; v_exposure numeric:=0; v_override record;
begin
  if nullif(trim(new.customer_external_id),'') is null or coalesce(new.status,'') in ('cancelled','rejected') then return new; end if;
  select external_id,credit_limit into v_customer from public.customers where external_id=new.customer_external_id and active=true;
  if not found or coalesce(v_customer.credit_limit,0)<=0 then return new; end if;
  select coalesce(sum(greatest(0,total_amount-coalesce(paid_amount,0))),0) into v_outstanding
  from public.sales_orders where customer_external_id=new.customer_external_id and coalesce(status,'') not in ('cancelled','rejected','collected') and (tg_op='INSERT' or id<>new.id);
  v_exposure:=v_outstanding+greatest(0,coalesce(new.total_amount,0)-coalesce(new.paid_amount,0));
  if v_exposure<=v_customer.credit_limit then return new; end if;
  if new.credit_override_id is null then raise exception 'CREDIT_LIMIT_EXCEEDED:%:%',v_exposure,v_customer.credit_limit; end if;
  select * into v_override from public.credit_override_requests where id=new.credit_override_id and customer_external_id=new.customer_external_id and status='approved' and coalesce(expires_at,now()+interval '1 minute')>now() for update;
  if not found then raise exception 'CREDIT_OVERRIDE_INVALID'; end if;
  if v_override.requested_amount<(v_exposure-v_customer.credit_limit) then raise exception 'CREDIT_OVERRIDE_AMOUNT_INSUFFICIENT'; end if;
  return new;
end $$;

drop trigger if exists sales_orders_credit_limit_guard on public.sales_orders;
create trigger sales_orders_credit_limit_guard before insert or update of customer_external_id,total_amount,paid_amount,status,credit_override_id on public.sales_orders for each row execute function public.guard_sales_order_credit();

create or replace function public.mark_credit_override_used()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.credit_override_id is not null then
    update public.credit_override_requests set status='used',used_at=now(),used_by=coalesce(new.sales_person_name,'system'),sales_order_id=new.id where id=new.credit_override_id and status='approved';
  end if;
  return new;
end $$;
drop trigger if exists sales_orders_credit_override_used on public.sales_orders;
create trigger sales_orders_credit_override_used after insert or update of credit_override_id on public.sales_orders for each row execute function public.mark_credit_override_used();

create or replace function public.request_custody_transaction(p_employee_external_id text,p_transaction_type text,p_amount numeric,p_description text,p_actor text,p_attachment_path text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_account uuid; v_row record; v_ref text;
begin
  if p_transaction_type not in ('issue','expense','return','adjustment') or coalesce(p_amount,0)<=0 or nullif(trim(p_employee_external_id),'') is null or nullif(trim(p_actor),'') is null then raise exception 'CUSTODY_INPUT_INVALID'; end if;
  if not exists(select 1 from public.employees where external_id=p_employee_external_id and active=true) then raise exception 'CUSTODY_EMPLOYEE_NOT_FOUND'; end if;
  insert into public.custody_accounts(employee_external_id,opened_by) values(p_employee_external_id,p_actor)
  on conflict(employee_external_id) do update set updated_at=now() returning id into v_account;
  v_ref:=concat('CUS-',to_char(current_date,'YYYYMMDD'),'-',upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)));
  insert into public.custody_transactions(custody_account_id,reference_no,transaction_type,amount,description,attachment_path,status,created_by)
  values(v_account,v_ref,p_transaction_type,p_amount,p_description,p_attachment_path,'pending',p_actor) returning * into v_row;
  insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details) values('web',p_actor,'custody_transaction_requested','custody_transaction',v_row.id::text,jsonb_build_object('reference_no',v_ref,'employee_external_id',p_employee_external_id,'transaction_type',p_transaction_type,'amount',p_amount));
  return to_jsonb(v_row);
end $$;

create or replace function public.approve_custody_transaction(p_transaction_id uuid,p_actor text,p_approve boolean,p_note text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_tx record; v_row record; v_issue_delta numeric:=0; v_settle_delta numeric:=0;
begin
  select * into v_tx from public.custody_transactions where id=p_transaction_id and status='pending' for update;
  if not found then raise exception 'CUSTODY_TRANSACTION_NOT_PENDING'; end if;
  if not p_approve then
    update public.custody_transactions set status='rejected',approved_by=p_actor,approved_at=now(),metadata=metadata||jsonb_build_object('decision_note',p_note) where id=p_transaction_id returning * into v_row;
  else
    if v_tx.transaction_type='issue' then v_issue_delta:=v_tx.amount;
    elsif v_tx.transaction_type in ('expense','return') then v_settle_delta:=v_tx.amount;
    elsif v_tx.transaction_type='adjustment' then v_issue_delta:=v_tx.amount; end if;
    update public.custody_accounts set issued_amount=issued_amount+v_issue_delta,settled_amount=settled_amount+v_settle_delta,updated_at=now() where id=v_tx.custody_account_id;
    update public.custody_transactions set status='posted',approved_by=p_actor,approved_at=now(),metadata=metadata||jsonb_build_object('decision_note',p_note) where id=p_transaction_id returning * into v_row;
  end if;
  insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details) values('web',p_actor,case when p_approve then 'custody_transaction_approved' else 'custody_transaction_rejected' end,'custody_transaction',p_transaction_id::text,jsonb_build_object('note',p_note));
  return to_jsonb(v_row);
end $$;

create or replace function public.guard_maintenance_closure()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.status in ('completed','closed') and nullif(trim(coalesce(new.diagnosis,'')),'') is null then raise exception 'MAINTENANCE_DIAGNOSIS_REQUIRED'; end if;
  if new.status='closed' and old.status not in ('completed','closed') then raise exception 'MAINTENANCE_COMPLETE_BEFORE_CLOSE'; end if;
  if new.status in ('completed','closed') and coalesce(new.actual_cost,0)>100 and not exists(select 1 from public.maintenance_updates where maintenance_id=new.id and nullif(trim(coalesce(attachment_path,'')),'') is not null) then raise exception 'MAINTENANCE_ATTACHMENT_REQUIRED'; end if;
  return new;
end $$;
drop trigger if exists maintenance_closure_control_trigger on public.maintenance_orders;
create trigger maintenance_closure_control_trigger before update of status,diagnosis,actual_cost on public.maintenance_orders for each row execute function public.guard_maintenance_closure();

create or replace function public.start_handover_acceptance(p_version_label text,p_actor text,p_scope jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row record; v_ref text;
begin
  if nullif(trim(p_version_label),'') is null or nullif(trim(p_actor),'') is null then raise exception 'HANDOVER_INPUT_REQUIRED'; end if;
  v_ref:=concat('HO-',to_char(current_date,'YYYYMMDD'),'-',upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)));
  insert into public.handover_acceptance_runs(reference_no,version_label,status,scope,started_by) values(v_ref,p_version_label,'in_progress',coalesce(p_scope,'{}'::jsonb),p_actor) returning * into v_row;
  insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details) values('web',p_actor,'handover_acceptance_started','handover_acceptance',v_row.id::text,jsonb_build_object('reference_no',v_ref,'version_label',p_version_label));
  return to_jsonb(v_row);
end $$;

create or replace function public.sign_handover_acceptance(p_run_id uuid,p_signoff_role text,p_signer_name text,p_decision text,p_note text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row record; v_required integer; v_approved integer; v_rejected integer;
begin
  if p_signoff_role not in ('management','finance','operations','system_admin') or p_decision not in ('approved','rejected','conditional') or nullif(trim(p_signer_name),'') is null then raise exception 'HANDOVER_SIGNOFF_INVALID'; end if;
  insert into public.handover_signoffs(handover_run_id,signoff_role,signer_name,decision,note) values(p_run_id,p_signoff_role,p_signer_name,p_decision,p_note)
  on conflict(handover_run_id,signoff_role) do update set signer_name=excluded.signer_name,decision=excluded.decision,note=excluded.note,signed_at=now() returning * into v_row;
  select count(*),count(*) filter(where decision='approved'),count(*) filter(where decision='rejected') into v_required,v_approved,v_rejected from public.handover_signoffs where handover_run_id=p_run_id;
  update public.handover_acceptance_runs set status=case when v_rejected>0 then 'failed' when v_required=4 and v_approved=4 then 'signed' else 'in_progress' end,completed_at=case when v_rejected>0 or (v_required=4 and v_approved=4) then now() else null end,updated_at=now() where id=p_run_id;
  insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details) values('web',p_signer_name,'handover_signoff_recorded','handover_acceptance',p_run_id::text,jsonb_build_object('signoff_role',p_signoff_role,'decision',p_decision,'note',p_note));
  return to_jsonb(v_row);
end $$;

insert into public.migration_history(version,migration_name)
values(17,'017_governance_control_rpcs')
on conflict(version) do update set migration_name=excluded.migration_name;
