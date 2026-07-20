-- Bin Hamid Factory Control — workshop service compatibility refinements
-- Run after 026_workshop_service_rpcs.sql.
-- Idempotent and non-destructive.

alter table public.maintenance_orders add column if not exists metadata jsonb not null default '{}'::jsonb;

-- Nullable unique indexes permit multiple legacy NULL values and allow the API
-- to use request_id as a deterministic conflict target.
create unique index if not exists maintenance_diagnostics_request_full_uidx on public.maintenance_diagnostics(request_id);
create unique index if not exists maintenance_labor_request_full_uidx on public.maintenance_labor_entries(request_id);
create unique index if not exists maintenance_parts_request_full_uidx on public.maintenance_parts(request_id);

insert into public.migration_history(version,migration_name)
values(27,'027_workshop_service_compatibility')
on conflict(version) do update set migration_name=excluded.migration_name;
