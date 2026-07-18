-- Non-destructive rollback for migration 019.
-- This rollback disables new posting and processing functions but intentionally preserves
-- journal, import evidence and Telegram receipt data for audit and recovery.

begin;

drop trigger if exists daily_report_accounting_post_trigger on public.daily_report_batches;
drop function if exists public.daily_report_accounting_trigger();

-- Preserve post_daily_report_accounting and journal tables so already-posted evidence is not lost.
-- Revoke execution to stop new automatic posting until the forward migration is repaired.
revoke all on function public.post_daily_report_accounting(uuid,text) from public,anon,authenticated;
revoke all on function public.transition_import_status(uuid,text,text,text,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.claim_telegram_update(text,text) from public,anon,authenticated;
revoke all on function public.complete_telegram_update(text) from public,anon,authenticated;
revoke all on function public.fail_telegram_update(text,text,text,boolean) from public,anon,authenticated;

insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details)
values('system','rollback-019','migration_control_disabled','migration','019',jsonb_build_object('nonDestructive',true,'journalDataPreserved',true,'telegramReceiptsPreserved',true,'executedAt',now()));

commit;
