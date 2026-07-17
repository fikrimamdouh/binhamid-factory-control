-- Bin Hamid Factory Control — governance safety refinements
-- Run after 017_governance_control_rpcs.sql.
-- Prevents false blocking, invalid custody settlement and unsupported handover signoff.

-- Legacy source files may contain repeated or reformatted plate numbers. Keep the
-- plate lookup indexed, but use asset_source_links and external_id as the stable identity.
drop index if exists public.unified_assets_plate_uidx;
create index if not exists unified_assets_plate_idx on public.unified_assets(lower(plate_no)) where nullif(trim(plate_no),'') is not null and active;

create or replace function public.guard_sales_order_credit()
returns trigger language plpgsql set search_path=public as $$
declare
  v_customer record;
  v_outstanding numeric:=0;
  v_exposure numeric:=0;
  v_new_open numeric:=greatest(0,coalesce(new.total_amount,0)-coalesce(new.paid_amount,0));
  v_old_open numeric:=case when tg_op='UPDATE' then greatest(0,coalesce(old.total_amount,0)-coalesce(old.paid_amount,0)) else 0 end;
  v_override record;
begin
  if nullif(trim(new.customer_external_id),'') is null or coalesce(new.status,'') in ('cancelled','rejected','collected') then return new; end if;

  -- Approved daily reports are the accounting source of truth. They must be imported
  -- atomically even when they reveal an existing credit breach. An AFTER trigger below
  -- records the breach as a critical discrepancy for management instead of losing the day.
  if coalesce(new.reference_no,'') like 'DR-%' then return new; end if;

  -- Collections, returns and status changes that do not increase exposure must never
  -- be blocked by credit control, even when the customer was already above the limit.
  if tg_op='UPDATE' and new.customer_external_id=old.customer_external_id and v_new_open<=v_old_open then return new; end if;

  select external_id,credit_limit into v_customer from public.customers where external_id=new.customer_external_id and active=true;
  if not found or coalesce(v_customer.credit_limit,0)<=0 then return new; end if;

  select coalesce(sum(greatest(0,total_amount-coalesce(paid_amount,0))),0) into v_outstanding
  from public.sales_orders
  where customer_external_id=new.customer_external_id
    and coalesce(status,'') not in ('cancelled','rejected','collected')
    and (tg_op='INSERT' or id<>new.id);

  v_exposure:=v_outstanding+v_new_open;
  if v_exposure<=v_customer.credit_limit then return new; end if;
  if new.credit_override_id is null then raise exception 'CREDIT_LIMIT_EXCEEDED:%:%',v_exposure,v_customer.credit_limit; end if;

  select * into v_override from public.credit_override_requests
  where id=new.credit_override_id
    and customer_external_id=new.customer_external_id
    and status='approved'
    and coalesce(expires_at,now()+interval '1 minute')>now()
  for update;
  if not found then raise exception 'CREDIT_OVERRIDE_INVALID'; end if;
  if v_override.requested_amount<(v_exposure-v_customer.credit_limit) then raise exception 'CREDIT_OVERRIDE_AMOUNT_INSUFFICIENT'; end if;
  return new;
end $$;

create or replace function public.flag_daily_report_credit_breach()
returns trigger language plpgsql set search_path=public as $$
declare
  v_customer record;
  v_exposure numeric:=0;
  v_reference text;
begin
  if coalesce(new.reference_no,'') not like 'DR-%' or nullif(trim(new.customer_external_id),'') is null then return new; end if;
  select external_id,customer_name,credit_limit into v_customer from public.customers where external_id=new.customer_external_id and active=true;
  if not found or coalesce(v_customer.credit_limit,0)<=0 then return new; end if;

  select coalesce(sum(greatest(0,total_amount-coalesce(paid_amount,0))),0) into v_exposure
  from public.sales_orders
  where customer_external_id=new.customer_external_id and coalesce(status,'') not in ('cancelled','rejected','collected');

  v_reference:=concat('CR-',new.reference_no);
  if v_exposure>v_customer.credit_limit then
    insert into public.discrepancies(reference_no,source_type,source_id,discrepancy_type,severity,title,expected_value,actual_value,difference_amount,status,reason)
    values(v_reference,'sales_order',new.id,'credit_limit_breach','critical',concat('تجاوز حد ائتماني — ',coalesce(v_customer.customer_name,new.customer_external_id)),jsonb_build_object('credit_limit',v_customer.credit_limit),jsonb_build_object('exposure',v_exposure,'sales_order_reference',new.reference_no),v_exposure-v_customer.credit_limit,'open','تم تسجيل البيع من تقرير يومي معتمد ويحتاج اعتمادًا إداريًا لاحقًا')
    on conflict(reference_no) do update set actual_value=excluded.actual_value,difference_amount=excluded.difference_amount,status='open',severity='critical',title=excluded.title,reason=excluded.reason,resolved_by=null,resolved_at=null;
  else
    update public.discrepancies set status='resolved',resolution='انخفض التعرض إلى داخل الحد الائتماني',resolved_at=now()
    where reference_no=v_reference and status in ('open','under_review');
  end if;
  return new;
end $$;

drop trigger if exists daily_report_credit_breach_flag on public.sales_orders;
create trigger daily_report_credit_breach_flag after insert or update of total_amount,paid_amount,status,customer_external_id on public.sales_orders for each row execute function public.flag_daily_report_credit_breach();

create or replace function public.approve_custody_transaction(p_transaction_id uuid,p_actor text,p_approve boolean,p_note text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_tx record; v_account record; v_row record; v_issue_delta numeric:=0; v_settle_delta numeric:=0;
begin
  select * into v_tx from public.custody_transactions where id=p_transaction_id and status='pending' for update;
  if not found then raise exception 'CUSTODY_TRANSACTION_NOT_PENDING'; end if;
  select * into v_account from public.custody_accounts where id=v_tx.custody_account_id for update;
  if not found or v_account.status<>'open' then raise exception 'CUSTODY_ACCOUNT_NOT_OPEN'; end if;

  if not p_approve then
    update public.custody_transactions set status='rejected',approved_by=p_actor,approved_at=now(),metadata=metadata||jsonb_build_object('decision_note',p_note) where id=p_transaction_id returning * into v_row;
  else
    if v_tx.transaction_type='issue' then v_issue_delta:=v_tx.amount;
    elsif v_tx.transaction_type in ('expense','return') then v_settle_delta:=v_tx.amount;
    elsif v_tx.transaction_type='adjustment' then v_issue_delta:=v_tx.amount; end if;
    if v_settle_delta>0 and v_account.outstanding_amount<v_settle_delta then raise exception 'CUSTODY_SETTLEMENT_EXCEEDS_OUTSTANDING:%:%',v_settle_delta,v_account.outstanding_amount; end if;
    update public.custody_accounts set issued_amount=issued_amount+v_issue_delta,settled_amount=settled_amount+v_settle_delta,updated_at=now() where id=v_tx.custody_account_id;
    update public.custody_transactions set status='posted',approved_by=p_actor,approved_at=now(),metadata=metadata||jsonb_build_object('decision_note',p_note) where id=p_transaction_id returning * into v_row;
  end if;
  insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details) values('web',p_actor,case when p_approve then 'custody_transaction_approved' else 'custody_transaction_rejected' end,'custody_transaction',p_transaction_id::text,jsonb_build_object('note',p_note));
  return to_jsonb(v_row);
end $$;

create or replace view public.control_asset_duplicates as
select lower(trim(plate_no)) as normalized_plate,count(*) as asset_count,array_agg(external_id order by external_id) as asset_external_ids
from public.unified_assets
where active=true and nullif(trim(plate_no),'') is not null
group by lower(trim(plate_no))
having count(*)>1;

create or replace function public.start_handover_acceptance(p_version_label text,p_actor text,p_scope jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row record; v_ref text; v_blockers jsonb:='[]'::jsonb; v_count integer; v_last_backup timestamptz;
begin
  if nullif(trim(p_version_label),'') is null or nullif(trim(p_actor),'') is null then raise exception 'HANDOVER_INPUT_REQUIRED'; end if;
  select count(*) into v_count from public.discrepancies where status in ('open','under_review') and severity='critical';
  if v_count>0 then v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','OPEN_CRITICAL_DISCREPANCIES','count',v_count)); end if;
  select count(*) into v_count from public.control_expiring_documents where control_status='expired';
  if v_count>0 then v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','EXPIRED_COMPLIANCE_DOCUMENTS','count',v_count)); end if;
  select count(*) into v_count from public.control_asset_duplicates;
  if v_count>0 then v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','DUPLICATE_ASSET_PLATES','count',v_count)); end if;
  select count(*) into v_count from public.unified_assets a where a.active and not exists(select 1 from public.asset_source_links l where l.asset_external_id=a.external_id);
  if v_count>0 then v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','UNLINKED_ASSETS','count',v_count)); end if;
  select max(coalesce(verified_at,completed_at)) into v_last_backup from public.backup_runs where status in ('verified','completed');
  if v_last_backup is null or v_last_backup<now()-interval '36 hours' then v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','BACKUP_STALE','lastSuccessfulAt',v_last_backup)); end if;
  if not exists(select 1 from public.restore_test_runs where status='passed' and completed_at>=now()-interval '30 days') then v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','RESTORE_DRILL_MISSING')); end if;
  if exists(select 1 from public.collection_events where coalesce(unallocated_amount,0)>0) then v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','UNALLOCATED_COLLECTIONS')); end if;

  v_ref:=concat('HO-',to_char(current_date,'YYYYMMDD'),'-',upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)));
  insert into public.handover_acceptance_runs(reference_no,version_label,status,scope,evidence,blockers,started_by)
  values(v_ref,p_version_label,'in_progress',coalesce(p_scope,'{}'::jsonb),jsonb_build_object('evaluated_at',now(),'schema_version',(select max(version) from public.migration_history)),v_blockers,p_actor) returning * into v_row;
  insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details) values('web',p_actor,'handover_acceptance_started','handover_acceptance',v_row.id::text,jsonb_build_object('reference_no',v_ref,'version_label',p_version_label,'blocker_count',jsonb_array_length(v_blockers)));
  return to_jsonb(v_row);
end $$;

create or replace function public.sign_handover_acceptance(p_run_id uuid,p_signoff_role text,p_signer_name text,p_decision text,p_note text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row record; v_run record; v_required integer; v_approved integer; v_rejected integer;
begin
  if p_signoff_role not in ('management','finance','operations','system_admin') or p_decision not in ('approved','rejected','conditional') or nullif(trim(p_signer_name),'') is null then raise exception 'HANDOVER_SIGNOFF_INVALID'; end if;
  select * into v_run from public.handover_acceptance_runs where id=p_run_id for update;
  if not found or v_run.status not in ('in_progress','passed') then raise exception 'HANDOVER_RUN_NOT_SIGNABLE'; end if;
  if jsonb_array_length(coalesce(v_run.blockers,'[]'::jsonb))>0 and p_decision='approved' then raise exception 'HANDOVER_BLOCKERS_OPEN'; end if;
  insert into public.handover_signoffs(handover_run_id,signoff_role,signer_name,decision,note) values(p_run_id,p_signoff_role,p_signer_name,p_decision,p_note)
  on conflict(handover_run_id,signoff_role) do update set signer_name=excluded.signer_name,decision=excluded.decision,note=excluded.note,signed_at=now() returning * into v_row;
  select count(*),count(*) filter(where decision='approved'),count(*) filter(where decision='rejected') into v_required,v_approved,v_rejected from public.handover_signoffs where handover_run_id=p_run_id;
  update public.handover_acceptance_runs set status=case when v_rejected>0 then 'failed' when v_required=4 and v_approved=4 and jsonb_array_length(coalesce(blockers,'[]'::jsonb))=0 then 'signed' when v_required=4 then 'passed' else 'in_progress' end,completed_at=case when v_rejected>0 or v_required=4 then now() else null end,updated_at=now() where id=p_run_id;
  insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details) values('web',p_signer_name,'handover_signoff_recorded','handover_acceptance',p_run_id::text,jsonb_build_object('signoff_role',p_signoff_role,'decision',p_decision,'note',p_note));
  return to_jsonb(v_row);
end $$;

insert into public.migration_history(version,migration_name)
values(18,'018_governance_safety_refinements')
on conflict(version) do update set migration_name=excluded.migration_name;
