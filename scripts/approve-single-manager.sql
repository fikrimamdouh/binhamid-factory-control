\set ON_ERROR_STOP on

begin;
do $approval$
declare
  v_recent integer;
  v_active integer;
  v_telegram public.user_invitations.accepted_by_telegram_id%type;
  v_invitation_id public.user_invitations.id%type;
  v_updated integer;
begin
  select count(distinct accepted_by_telegram_id) into v_recent
  from public.user_invitations
  where accepted_by_telegram_id is not null
    and status not in ('approved','rejected','revoked','expired')
    and created_at >= now()-interval '12 hours';

  if v_recent = 0 then
    select count(*) into v_active
    from public.app_users
    where role='manager' and active=true;
    if v_active < 1 then raise exception 'NO_RECENT_ACCEPTED_INVITATION_OR_ACTIVE_MANAGER'; end if;
    return;
  end if;

  if v_recent <> 1 then raise exception 'EXPECTED_ONE_RECENT_ACCEPTED_ACCOUNT_FOUND_%',v_recent; end if;

  select accepted_by_telegram_id,id into v_telegram,v_invitation_id
  from public.user_invitations
  where accepted_by_telegram_id is not null
    and status not in ('approved','rejected','revoked','expired')
    and created_at >= now()-interval '12 hours'
  order by created_at desc
  limit 1
  for update;

  update public.app_users
  set role='manager',active=true
  where external_id=v_telegram;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then raise exception 'INVITED_MANAGER_USER_UPDATE_COUNT_%',v_updated; end if;

  begin
    update public.user_invitations
    set status='approved',approved_at=now()
    where id=v_invitation_id;
  exception when others then
    raise notice 'INVITATION_STATUS_UPDATE_SKIPPED:%',sqlstate;
  end;

  begin
    delete from public.bot_sessions
    where channel='telegram' and external_user_id=v_telegram;
  exception when others then
    raise notice 'SESSION_CLEAR_SKIPPED:%',sqlstate;
  end;
end
$approval$;
commit;
