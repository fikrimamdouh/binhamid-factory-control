begin;

-- Employee preferred names used by invitations and conversational Telegram UX.
alter table public.app_users add column if not exists nickname text;
alter table public.employees add column if not exists nickname text;
alter table public.user_invitations add column if not exists nickname text;

do $$
begin
  if not exists(select 1 from pg_constraint where conname='app_users_nickname_length_chk') then
    alter table public.app_users add constraint app_users_nickname_length_chk check (nickname is null or char_length(trim(nickname)) between 2 and 80);
  end if;
  if not exists(select 1 from pg_constraint where conname='employees_nickname_length_chk') then
    alter table public.employees add constraint employees_nickname_length_chk check (nickname is null or char_length(trim(nickname)) between 2 and 80);
  end if;
  if not exists(select 1 from pg_constraint where conname='user_invitations_nickname_length_chk') then
    alter table public.user_invitations add constraint user_invitations_nickname_length_chk check (nickname is null or char_length(trim(nickname)) between 2 and 80);
  end if;
end $$;

create index if not exists app_users_nickname_idx on public.app_users(lower(nickname)) where nickname is not null;
create index if not exists employees_nickname_idx on public.employees(lower(nickname)) where nickname is not null;

create or replace function public.sync_app_user_nickname_to_employee()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.employee_external_id is not null and new.nickname is distinct from old.nickname then
    update public.employees set nickname=new.nickname where external_id=new.employee_external_id;
  end if;
  return new;
end $$;

drop trigger if exists app_user_nickname_employee_sync on public.app_users;
create trigger app_user_nickname_employee_sync
after update of nickname on public.app_users
for each row execute function public.sync_app_user_nickname_to_employee();

update public.employees e
set nickname=u.nickname
from public.app_users u
where u.employee_external_id=e.external_id
  and u.nickname is not null
  and e.nickname is distinct from u.nickname;

insert into public.migration_history(version,migration_name)
values(24,'024_employee_nickname_and_financial_command_center')
on conflict(version) do update set migration_name=excluded.migration_name;

commit;
