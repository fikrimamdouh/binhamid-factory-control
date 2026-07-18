\set ON_ERROR_STOP on

select column_name,data_type,udt_name,is_nullable
from information_schema.columns
where table_schema='public' and table_name='app_users'
order by ordinal_position;

select role,active,count(*) as users
from public.app_users
group by role,active
order by role,active;

select status,requested_role,
       count(*) as invitations,
       count(accepted_by_telegram_id) as linked
from public.user_invitations
group by status,requested_role
order by status,requested_role;
