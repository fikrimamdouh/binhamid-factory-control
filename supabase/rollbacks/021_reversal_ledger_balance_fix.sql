-- Non-destructive rollback for migration 021.
-- Preserve journals, source imports and every audit row. Disable new reversals and
-- atomic acceptance while a forward correction is prepared.
begin;
revoke all on function public.reverse_journal_entry(uuid,text,text) from public,anon,authenticated;
revoke all on function public.commit_daily_report_acceptance(date,text,text,text,jsonb,text,uuid,text,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.prepare_daily_report_source_import() from public,anon,authenticated;
revoke all on function public.finalize_daily_report_source_import() from public,anon,authenticated;
insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details)
values('system','rollback-021','schema_021_sensitive_actions_disabled','migration','021',jsonb_build_object('nonDestructive',true,'journalDataPreserved',true,'importEvidencePreserved',true,'executedAt',now()));
commit;
