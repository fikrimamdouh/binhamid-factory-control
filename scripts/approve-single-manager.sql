\set ON_ERROR_STOP on

select column_name,data_type,udt_name,is_nullable
from information_schema.columns
where table_schema='public'
  and table_name in ('user_invitations','app_users')
  and column_name in ('id','external_id','role','active','status','requested_role','accepted_by_telegram_id','approved_by','approved_at')
order by table_name,column_name;

select requested_role,status,count(*) as records,count(distinct accepted_by_telegram_id) as linked_accounts
from public.user_invitations
where accepted_by_telegram_id is not null
group by requested_role,status
order by requested_role,status;

begin;
do $approval$
declare
  v_pending integer;
  v_active integer;
  v_telegram public.user_invitations.accepted_by_telegram_id%type;
  v_invitation_id public.user_invitations.id%type;
  v_updated integer;
begin
  select count(distinct accepted_by_telegram_id) into v_pending
  from public.user_invitations
  where requested_role='manager'
    and accepted_by_telegram_id is not null
    and status not in ('rejected','revoked')
    and created_at >= now()-interval '30 days';

  if v_pending = 0 then
    select count(*) into v_active
    from public.user_invitations i
    join public.app_users u on u.external_id=i.accepted_by_telegram_id
    where i.requested_role='manager'
      and u.role='manager'
      and u.active=true;
    if v_active < 1 then raise exception 'NO_RECENT_ACCEPTED_MANAGER_INVITATION'; end if;
    return;
  end if;

  if v_pending <> 1 then raise exception 'EXPECTED_ONE_RECENT_MANAGER_ACCOUNT_FOUND_%',v_pending; end if;

  select accepted_by_telegram_id,id into v_telegram,v_invitation_id
  from public.user_invitations
  where requested_role='manager'
    and accepted_by_telegram_id is not null
    and status not in ('rejected','revoked')
    and created_at >= now()-interval '30 days'
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
