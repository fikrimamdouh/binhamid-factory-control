-- Bin Hamid Factory Control — notification delivery resilience
-- Run after 007_procurement_projection_and_permissions.sql.
-- Idempotent.

alter table public.notification_outbox add column if not exists attempts integer not null default 0;
alter table public.notification_outbox add column if not exists last_attempt_at timestamptz;
alter table public.notification_outbox add column if not exists dead_letter_at timestamptz;

alter table public.notification_outbox drop constraint if exists notification_outbox_status_check;
alter table public.notification_outbox add constraint notification_outbox_status_check
  check (status in ('pending','processing','sent','failed','cancelled','dead_letter'));

create index if not exists notification_outbox_delivery_idx
  on public.notification_outbox(status,scheduled_at,attempts);

-- Convert previously looping failures to dead-letter only after five recorded attempts.
update public.notification_outbox
set status='dead_letter',dead_letter_at=coalesce(dead_letter_at,now())
where status='failed' and attempts>=5;
