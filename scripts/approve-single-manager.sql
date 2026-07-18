\set ON_ERROR_STOP on

begin;
do $approval$
declare
  v_pending_users integer;
  v_pending_invites integer;
  v_channels integer;
  v_user_id public.app_users.id%type;
  v_admin_id public.app_users.id%type;
  v_external_id public.user_channels.external_id%type;
  v_invitation_id public.user_invitations.id%type;
begin
  select count(*) into v_pending_users
  from public.app_users
  where role='pending' and active=false;
  if v_pending_users <> 1 then raise exception 'EXPECTED_ONE_PENDING_APP_USER_FOUND_%',v_pending_users; end if;

  select id into v_user_id
  from public.app_users
  where role='pending' and active=false
  for update;

  select count(*) into v_channels
  from public.user_channels
  where user_id=v_user_id and channel='telegram' and active=true;
  if v_channels <> 1 then raise exception 'EXPECTED_ONE_TELEGRAM_CHANNEL_FOUND_%',v_channels; end if;

  select external_id into v_external_id
  from public.user_channels
  where user_id=v_user_id and channel='telegram' and active=true
  for update;

  select count(*) into v_pending_invites
  from public.user_invitations
  where status='pending'
    and requested_role='manager'
    and accepted_by_telegram_id is null;
  if v_pending_invites <> 1 then raise exception 'EXPECTED_ONE_PENDING_MANAGER_INVITATION_FOUND_%',v_pending_invites; end if;

  select id into v_invitation_id
  from public.user_invitations
  where status='pending'
    and requested_role='manager'
    and accepted_by_telegram_id is null
  for update;

  select id into v_admin_id
  from public.app_users
  where role='admin' and active=true
  order by created_at
  limit 1;
  if v_admin_id is null then raise exception 'ACTIVE_ADMIN_NOT_FOUND'; end if;

  update public.app_users
  set role='manager',active=true,updated_at=now()
  where id=v_user_id;

  update public.user_invitations
  set accepted_by_telegram_id=v_external_id,
      accepted_at=coalesce(accepted_at,now()),
      status='approved',
      approved_by=v_admin_id,
      approved_at=now()
  where id=v_invitation_id;

  delete from public.bot_sessions
  where channel='telegram' and external_user_id=v_external_id;
end
$approval$;
commit;

select role,active,count(*) as users
from public.app_users
group by role,active
order by role,active;

select status,requested_role,count(*) as invitations,count(accepted_by_telegram_id) as linked
from public.user_invitations
group by status,requested_role
order by status,requested_role;
