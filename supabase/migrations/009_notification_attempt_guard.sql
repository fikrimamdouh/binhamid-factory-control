-- Bin Hamid Factory Control — database-level notification retry guard
-- Run after 008_notification_delivery_resilience.sql.
-- Idempotent.

create or replace function public.guard_notification_attempts()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='failed' and old.status is distinct from 'failed' then
    new.attempts:=coalesce(old.attempts,0)+1;
    new.last_attempt_at:=now();
    if new.attempts>=5 then
      new.status:='dead_letter';
      new.dead_letter_at:=now();
    end if;
  elsif new.status='sent' and old.status is distinct from 'sent' then
    new.attempts:=coalesce(old.attempts,0)+1;
    new.last_attempt_at:=now();
  elsif new.status='pending' and old.status='dead_letter' then
    -- A dead-letter notification may only be requeued deliberately by an administrator.
    new.dead_letter_at:=null;
    new.attempts:=0;
  end if;
  return new;
end $$;

drop trigger if exists notification_attempt_guard_trigger on public.notification_outbox;
create trigger notification_attempt_guard_trigger
before update of status on public.notification_outbox
for each row execute function public.guard_notification_attempts();

revoke all on function public.guard_notification_attempts() from anon, authenticated;
