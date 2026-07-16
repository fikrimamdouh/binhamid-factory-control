-- Bin Hamid Factory Control — runtime replay and integrity hardening
-- Run after 005_enterprise_runtime_completion.sql.
-- Idempotent.

-- Nullable columns can use full unique indexes because PostgreSQL permits multiple NULL values.
-- Full indexes let ON CONFLICT(source_audit_id) resolve deterministically.
drop index if exists public.inventory_movements_audit_uidx;
drop index if exists public.purchase_requests_audit_uidx;
drop index if exists public.collection_events_audit_uidx;
drop index if exists public.quality_cases_audit_uidx;
drop index if exists public.operational_tasks_audit_uidx;
drop index if exists public.driver_events_audit_uidx;
drop index if exists public.notification_outbox_dedupe_uidx;

create unique index if not exists inventory_movements_audit_uidx on public.inventory_movements(source_audit_id);
create unique index if not exists purchase_requests_audit_uidx on public.purchase_requests(source_audit_id);
create unique index if not exists collection_events_audit_uidx on public.collection_events(source_audit_id);
create unique index if not exists quality_cases_audit_uidx on public.quality_cases(source_audit_id);
create unique index if not exists operational_tasks_audit_uidx on public.operational_tasks(source_audit_id);
create unique index if not exists driver_events_audit_uidx on public.driver_events(source_audit_id);
create unique index if not exists notification_outbox_dedupe_uidx on public.notification_outbox(dedupe_key);

-- Replay all historical enterprise events through the same trigger implementation.
-- The temporary UPDATE trigger is removed immediately after replay.
drop trigger if exists audit_enterprise_structured_replay_trigger on public.audit_log;
create trigger audit_enterprise_structured_replay_trigger
after update of details on public.audit_log
for each row execute function public.project_enterprise_structured_audit();

update public.audit_log
set details=details
where action in ('enterprise_operation_created','enterprise_operation_status');

drop trigger if exists audit_enterprise_structured_replay_trigger on public.audit_log;

-- Prevent negative stock from becoming silent. The movement remains recorded,
-- while a discrepancy is created for management review.
create or replace function public.flag_negative_inventory()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.quantity_on_hand < 0 then
    insert into public.discrepancies(reference_no,source_type,source_id,discrepancy_type,severity,title,expected_value,actual_value,difference_amount,status,reason,created_at)
    values(
      concat('INV-NEG-',new.id),
      'inventory_item',new.id,'negative_stock','critical',
      concat('رصيد مخزون سالب: ',new.item_name),
      jsonb_build_object('minimum',0),jsonb_build_object('quantity_on_hand',new.quantity_on_hand),
      abs(new.quantity_on_hand),'open','تم إنشاء الفرق تلقائيًا من حركة مخزون معتمدة',now()
    ) on conflict(reference_no) do update set
      actual_value=excluded.actual_value,difference_amount=excluded.difference_amount,status='open',created_at=excluded.created_at;
  end if;
  return new;
end $$;

drop trigger if exists inventory_negative_trigger on public.inventory_items;
create trigger inventory_negative_trigger
after insert or update of quantity_on_hand on public.inventory_items
for each row execute function public.flag_negative_inventory();

-- Queue pending approvals for managers once, without duplicating notifications.
create or replace function public.queue_approval_notification()
returns trigger language plpgsql security definer set search_path=public as $$
declare u record; v_key text;
begin
  if new.status<>'pending' then return new; end if;
  for u in select id from public.app_users where active=true and role in ('admin','manager','accountant') loop
    v_key:=concat('approval:',new.id,':',u.id);
    insert into public.notification_outbox(notification_type,recipient_user_id,title,message,payload,status,scheduled_at,dedupe_key,created_at)
    values(
      'approval_pending',u.id,'اعتماد ينتظر القرار',
      concat(new.reference_no,' — ',coalesce(new.summary,new.entity_type),' — ',new.amount,' ر.س'),
      jsonb_build_object('approval_id',new.id,'reference_no',new.reference_no,'entity_type',new.entity_type,'amount',new.amount),
      'pending',now(),v_key,now()
    ) on conflict(dedupe_key) do nothing;
  end loop;
  return new;
end $$;

drop trigger if exists approval_notification_trigger on public.approvals;
create trigger approval_notification_trigger
after insert on public.approvals
for each row execute function public.queue_approval_notification();

-- Queue reminders for employees who have not submitted a daily report by the time
-- the scheduler runs. Dedupe keys keep one reminder per employee per day.
create or replace function public.queue_missing_daily_reports(p_day date default current_date)
returns integer language plpgsql security definer set search_path=public as $$
declare u record; v_count integer:=0; v_key text;
begin
  for u in
    select au.id,au.full_name
    from public.app_users au
    where au.active=true and au.role not in ('pending','admin')
      and not exists(
        select 1 from public.employee_daily_reports r
        where r.app_user_id=au.id and r.report_date=p_day
      )
  loop
    v_key:=concat('daily-report:',p_day,':',u.id);
    insert into public.notification_outbox(notification_type,recipient_user_id,title,message,payload,status,scheduled_at,dedupe_key,created_at)
    values('daily_report_missing',u.id,'التقرير اليومي لم يُسجل',concat('لم يتم تسجيل تقريرك اليومي ليوم ',p_day,'. افتح لوحة الموظف واختر «تقريري اليومي».'),jsonb_build_object('report_date',p_day),'pending',now(),v_key,now())
    on conflict(dedupe_key) do nothing;
    if found then v_count:=v_count+1; end if;
  end loop;
  return v_count;
end $$;

revoke all on function public.flag_negative_inventory() from anon, authenticated;
revoke all on function public.queue_approval_notification() from anon, authenticated;
revoke all on function public.queue_missing_daily_reports(date) from anon, authenticated;
