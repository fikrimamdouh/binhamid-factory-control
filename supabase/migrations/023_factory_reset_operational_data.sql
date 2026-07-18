-- Controlled factory reset for the pre-go-live test environment.
-- It intentionally preserves: migration history, encrypted backup evidence,
-- owner/device identities, Telegram connection settings and role policies.
-- It removes operational records, imported files and Telegram history only
-- after the protected web endpoint has received its explicit confirmation.

do $$ begin
  if not exists(select 1 from public.migration_history where version=22) then
    raise exception 'MIGRATION_022_REQUIRED';
  end if;
end $$;

create or replace function public.reset_factory_operational_data(
  p_actor text,
  p_reason text,
  p_confirmation text,
  p_storage_bucket text default 'factory-documents'
)
returns jsonb
language plpgsql
security definer
set search_path=public,storage,pg_temp
as $$
declare
  v_table text;
  v_counts jsonb;
  v_files integer:=0;
begin
  if coalesce(trim(p_confirmation),'')<>'RESET_FACTORY_OPERATIONAL_DATA' then
    raise exception 'FACTORY_RESET_CONFIRMATION_REQUIRED';
  end if;

  select jsonb_build_object(
    'appState',(select count(*) from public.app_state),
    'telegramMessages',(select count(*) from public.telegram_messages),
    'imports',(select count(*) from public.imports),
    'dailyBatches',(select count(*) from public.daily_report_batches),
    'alerts',(select count(*) from public.operational_alerts),
    'salesOrders',(select count(*) from public.sales_orders),
    'employees',(select count(*) from public.employees),
    'vehicles',(select count(*) from public.vehicles),
    'customers',(select count(*) from public.customers)
  ) into v_counts;

  -- Keep backups and credentials. Each target is operational/test data and is
  -- deleted in the same transaction. We intentionally avoid DDL-style bulk
  -- clearing so the migration remains within the production safety policy.
  foreach v_table in array array[
    'app_state','telegram_messages','telegram_update_receipts','bot_sessions','user_invitations',
    'import_rows','imports','daily_report_import_attempts','daily_report_sales_lines',
    'daily_report_cash_movements','daily_report_treasury_balances','daily_report_inventory_snapshots',
    'daily_report_batches','sales_payment_allocations','fifo_rebuild_runs','journal_entry_lines',
    'journal_entries','collection_events','sales_order_updates','sales_orders','invoices',
    'inventory_movements','inventory_items','supplier_quotes','purchase_requests','quality_cases',
    'maintenance_updates','maintenance_orders','discrepancies','approvals','operational_tasks',
    'operational_records','operation_status_history','finance_events','hr_requests','employee_daily_reports',
    'attendance_events','driver_events','gps_provider_events','employee_assignments','work_sites',
    'asset_cost_center_assignments','employee_cost_assignments','indirect_cost_allocations',
    'cost_ledger','cost_calculation_runs','cost_allocation_rules','cost_periods',
    'credit_override_requests','financial_period_events','financial_periods','custody_transactions',
    'custody_accounts','handover_signoffs','handover_acceptance_runs','restore_test_runs',
    'document_registry','compliance_documents','asset_source_links','unified_assets','operational_alerts',
    'notification_outbox','mix_cost_calculation_runs','mix_design_items','mix_design_overheads',
    'mix_designs','mix_material_prices','mix_materials','employees','vehicles','customers','doc_sequences',
    'audit_log'
  ] loop
    execute format('delete from public.%I',v_table);
  end loop;

  -- Uploaded operational documents are removed, while encrypted backups stay.
  delete from storage.objects
   where bucket_id=coalesce(nullif(trim(p_storage_bucket),''),'factory-documents')
     and name not like 'backups/%';
  get diagnostics v_files=row_count;

  insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details)
  values(
    'web',coalesce(nullif(trim(p_actor),''),'system'),'factory_operational_reset','factory','pre_go_live',
    jsonb_build_object('reason',coalesce(nullif(trim(p_reason),''),'تهيئة بداية تشغيل جديدة'),'cleared',v_counts,'storageObjectsRemoved',v_files,'backupsPreserved',true,'identitiesPreserved',true)
  );

  return jsonb_build_object('ok',true,'counts',v_counts,'storageObjectsRemoved',v_files,'backupsPreserved',true,'identitiesPreserved',true);
end $$;

revoke all on function public.reset_factory_operational_data(text,text,text,text) from public,anon,authenticated;
grant execute on function public.reset_factory_operational_data(text,text,text,text) to service_role;

insert into public.migration_history(version,migration_name)
values(23,'023_factory_reset_operational_data')
on conflict(version) do nothing;
