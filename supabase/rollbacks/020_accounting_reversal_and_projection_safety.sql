-- Non-destructive rollback for migration 020.
-- Preserve every journal and reversal row; disable new reversals while a forward fix is prepared.
begin;
revoke all on function public.reverse_journal_entry(uuid,text,text) from public,anon,authenticated;
insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details)
values('system','rollback-020','journal_reversal_disabled','migration','020',jsonb_build_object('nonDestructive',true,'journalDataPreserved',true,'executedAt',now()));
commit;
