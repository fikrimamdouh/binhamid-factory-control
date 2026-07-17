-- Bin Hamid Factory Control — governance safety refinements
-- Run after 017_governance_control_rpcs.sql.
-- Prevents false blocking of debt-reducing updates and tolerates legacy duplicate plates.

-- Legacy source files may contain repeated or reformatted plate numbers. Keep the
-- plate lookup indexed, but use asset_source_links and external_id as the stable identity.
drop index if exists public.unified_assets_plate_uidx;
create index if not exists unified_assets_plate_idx on public.unified_assets(lower(plate_no)) where nullif(trim(plate_no),'') is not null and active;

create or replace function public.guard_sales_order_credit()
returns trigger language plpgsql set search_path=public as $$
declare
  v_customer record;
  v_outstanding numeric:=0;
  v_exposure numeric:=0;
  v_new_open numeric:=greatest(0,coalesce(new.total_amount,0)-coalesce(new.paid_amount,0));
  v_old_open numeric:=case when tg_op='UPDATE' then greatest(0,coalesce(old.total_amount,0)-coalesce(old.paid_amount,0)) else 0 end;
  v_override record;
begin
  if nullif(trim(new.customer_external_id),'') is null or coalesce(new.status,'') in ('cancelled','rejected','collected') then return new; end if;

  -- Collections, returns and status changes that do not increase exposure must never
  -- be blocked by credit control, even when the customer was already above the limit.
  if tg_op='UPDATE' and new.customer_external_id=old.customer_external_id and v_new_open<=v_old_open then return new; end if;

  select external_id,credit_limit into v_customer from public.customers where external_id=new.customer_external_id and active=true;
  if not found or coalesce(v_customer.credit_limit,0)<=0 then return new; end if;

  select coalesce(sum(greatest(0,total_amount-coalesce(paid_amount,0))),0) into v_outstanding
  from public.sales_orders
  where customer_external_id=new.customer_external_id
    and coalesce(status,'') not in ('cancelled','rejected','collected')
    and (tg_op='INSERT' or id<>new.id);

  v_exposure:=v_outstanding+v_new_open;
  if v_exposure<=v_customer.credit_limit then return new; end if;
  if new.credit_override_id is null then raise exception 'CREDIT_LIMIT_EXCEEDED:%:%',v_exposure,v_customer.credit_limit; end if;

  select * into v_override from public.credit_override_requests
  where id=new.credit_override_id
    and customer_external_id=new.customer_external_id
    and status='approved'
    and coalesce(expires_at,now()+interval '1 minute')>now()
  for update;
  if not found then raise exception 'CREDIT_OVERRIDE_INVALID'; end if;
  if v_override.requested_amount<(v_exposure-v_customer.credit_limit) then raise exception 'CREDIT_OVERRIDE_AMOUNT_INSUFFICIENT'; end if;
  return new;
end $$;

create or replace view public.control_asset_duplicates as
select lower(trim(plate_no)) as normalized_plate,count(*) as asset_count,array_agg(external_id order by external_id) as asset_external_ids
from public.unified_assets
where active=true and nullif(trim(plate_no),'') is not null
group by lower(trim(plate_no))
having count(*)>1;

insert into public.migration_history(version,migration_name)
values(18,'018_governance_safety_refinements')
on conflict(version) do update set migration_name=excluded.migration_name;
