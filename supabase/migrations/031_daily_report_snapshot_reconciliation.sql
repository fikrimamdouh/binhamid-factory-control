-- Bin Hamid Factory Control — reconcile revised ERP workbooks as complete
-- snapshots. Migration 029 upserted incoming rows but retained rows that were
-- absent from the revised workbook. This migration preserves an audit trail,
-- reverses their accounting effect, removes only the obsolete snapshot rows,
-- and makes every future historical upgrade perform the same reconciliation.

do $$
begin
  if not exists(select 1 from public.migration_history where version=30) then
    raise exception 'MIGRATION_030_REQUIRED';
  end if;
end $$;

do $$
begin
  if to_regprocedure('public.upgrade_daily_report_details_v2_legacy(date,text,jsonb,text)') is null then
    if to_regprocedure('public.upgrade_daily_report_details(date,text,jsonb,text)') is null then
      raise exception 'DAILY_REPORT_UPGRADE_FUNCTION_REQUIRED';
    end if;
    alter function public.upgrade_daily_report_details(date,text,jsonb,text)
      rename to upgrade_daily_report_details_v2_legacy;
  end if;
end $$;

create or replace function public.reconcile_daily_report_upgrade_snapshot(
  p_batch_id uuid,
  p_report_date date,
  p_payload jsonb,
  p_actor text default 'erp-folder-sync-v3'
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_cash record;
  v_inventory record;
  v_collection record;
  v_entry record;
  v_customer text;
  v_customers text[]:='{}'::text[];
  v_finance_ref text;
  v_collection_ref text;
  v_cash_count integer:=0;
  v_inventory_count integer:=0;
  v_cash_amount numeric:=0;
begin
  if p_batch_id is null or p_report_date is null then
    raise exception 'DAILY_REPORT_RECONCILIATION_TARGET_REQUIRED';
  end if;
  if jsonb_typeof(p_payload->'cashMovements') is distinct from 'array'
     or jsonb_typeof(p_payload->'inventory') is distinct from 'array' then
    raise exception 'DAILY_REPORT_RECONCILIATION_ARRAYS_REQUIRED';
  end if;
  if nullif(trim(coalesce(p_actor,'')),'') is null then
    raise exception 'DAILY_REPORT_RECONCILIATION_ACTOR_REQUIRED';
  end if;

  perform id from public.daily_report_batches
  where id=p_batch_id and report_date=p_report_date and status='approved'
  for update;
  if not found then
    raise exception 'DAILY_REPORT_RECONCILIATION_BATCH_NOT_FOUND:%',p_report_date;
  end if;

  for v_cash in
    select c.*
    from public.daily_report_cash_movements c
    where c.batch_id=p_batch_id
      and not exists(
        select 1
        from jsonb_array_elements(p_payload->'cashMovements') incoming
        where (incoming->>'sourceRowNo')::integer=c.source_row_no
      )
    order by c.source_row_no,c.id
    for update
  loop
    v_finance_ref:=concat(
      'DR-',to_char(p_report_date,'YYYYMMDD'),'-F-',
      lpad(v_cash.source_row_no::text,4,'0')
    );
    v_collection_ref:=concat(
      'DR-',to_char(p_report_date,'YYYYMMDD'),'-C-',
      lpad(v_cash.source_row_no::text,4,'0')
    );

    for v_entry in
      select id
      from public.journal_entries
      where source_type='daily_report_collection'
        and source_id=concat(p_batch_id,':collection:',v_cash.id)
        and status='posted'
      order by created_at,id
    loop
      perform public.reverse_journal_entry(
        v_entry.id,
        p_actor,
        concat(
          'حركة غير موجودة في النسخة المعدلة لتقرير ',
          p_report_date,' — سطر ',v_cash.source_row_no
        )
      );
    end loop;

    select * into v_collection
    from public.collection_events
    where reference_no=v_collection_ref
    for update;
    if found then
      if nullif(trim(coalesce(v_collection.customer_external_id,'')),'') is not null
         and not (v_collection.customer_external_id=any(v_customers)) then
        v_customers:=array_append(v_customers,v_collection.customer_external_id);
      end if;
      update public.sales_payment_allocations
      set active=false,
          superseded_at=coalesce(superseded_at,now()),
          updated_at=now()
      where collection_id=v_collection.id and active=true;
      update public.collection_events
      set amount=0,
          allocated_amount=0,
          unallocated_amount=0,
          status='reversed',
          note=concat(
            coalesce(note,''),
            ' — عكس آلي: الحركة غير موجودة في النسخة المعدلة؛ القيمة الأصلية ',
            coalesce(v_collection.amount,0)
          )
      where id=v_collection.id;
    end if;

    update public.finance_events
    set amount=0,
        status='reversed',
        note=concat(
          coalesce(note,''),
          ' — عكس آلي: الحركة غير موجودة في النسخة المعدلة؛ القيمة الأصلية ',
          greatest(coalesce(v_cash.debit,0),coalesce(v_cash.credit,0))
        ),
        updated_at=now()
    where reference_no=v_finance_ref;

    update public.operational_records
    set amount=0,
        status='reversed',
        summary=concat(
          coalesce(summary,''),
          ' — عكس آلي: الحركة غير موجودة في النسخة المعدلة'
        ),
        updated_at=now()
    where reference_no=v_finance_ref and entity_type='finance_event';

    insert into public.audit_log(
      actor_type,actor_id,action,entity_type,entity_id,details
    ) values(
      'system',
      p_actor,
      'daily_report_cash_row_superseded',
      'daily_report_cash_movement',
      v_cash.id::text,
      jsonb_build_object(
        'batchId',p_batch_id,
        'reportDate',p_report_date,
        'sourceRowNo',v_cash.source_row_no,
        'treasuryCode',v_cash.treasury_code,
        'accountCode',v_cash.account_code,
        'debit',v_cash.debit,
        'credit',v_cash.credit,
        'voucherNo',v_cash.voucher_no,
        'lineIdentity',v_cash.line_identity,
        'financeReference',v_finance_ref,
        'collectionReference',case
          when v_cash.is_customer_collection then v_collection_ref
          else null
        end
      )
    );

    v_cash_count:=v_cash_count+1;
    v_cash_amount:=v_cash_amount+
      greatest(coalesce(v_cash.debit,0),coalesce(v_cash.credit,0));
    delete from public.daily_report_cash_movements where id=v_cash.id;
  end loop;

  for v_inventory in
    select i.*
    from public.daily_report_inventory_snapshots i
    where i.batch_id=p_batch_id
      and not exists(
        select 1
        from jsonb_array_elements(p_payload->'inventory') incoming
        where (incoming->>'sourceRowNo')::integer=i.source_row_no
          and incoming->>'inventoryType'=i.inventory_type
          and incoming->>'itemCode'=i.item_code
      )
    order by i.inventory_type,i.source_row_no,i.id
    for update
  loop
    insert into public.audit_log(
      actor_type,actor_id,action,entity_type,entity_id,details
    ) values(
      'system',
      p_actor,
      'daily_report_inventory_row_superseded',
      'daily_report_inventory_snapshot',
      v_inventory.id::text,
      jsonb_build_object(
        'batchId',p_batch_id,
        'reportDate',p_report_date,
        'sourceRowNo',v_inventory.source_row_no,
        'inventoryType',v_inventory.inventory_type,
        'itemCode',v_inventory.item_code,
        'itemName',v_inventory.item_name,
        'opening',v_inventory.opening_quantity,
        'received',v_inventory.received_quantity,
        'issued',v_inventory.issued_quantity,
        'closing',v_inventory.closing_quantity
      )
    );
    v_inventory_count:=v_inventory_count+1;
    delete from public.daily_report_inventory_snapshots
    where id=v_inventory.id;
  end loop;

  foreach v_customer in array v_customers
  loop
    perform public.rebuild_customer_fifo(
      v_customer,
      p_actor,
      'revised_daily_report_snapshot'
    );
  end loop;

  return jsonb_build_object(
    'cashMovementsSuperseded',v_cash_count,
    'cashAmountSuperseded',round(v_cash_amount,2),
    'inventoryRowsSuperseded',v_inventory_count,
    'customersRebuilt',coalesce(array_length(v_customers,1),0)
  );
end $$;

create or replace function public.upgrade_daily_report_details(
  p_report_date date,
  p_file_hash text,
  p_payload jsonb,
  p_actor text default 'erp-folder-sync-v3'
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_batch public.daily_report_batches%rowtype;
  v_cleanup jsonb;
  v_result jsonb;
  v_row jsonb;
  v_ref text;
begin
  select * into v_batch
  from public.daily_report_batches
  where report_date=p_report_date
  for update;
  if not found then
    raise exception 'DAILY_REPORT_UPGRADE_BATCH_NOT_FOUND:%',p_report_date;
  end if;
  if v_batch.file_hash is distinct from p_file_hash then
    raise exception 'DAILY_REPORT_UPGRADE_FILE_HASH_MISMATCH:%',v_batch.id;
  end if;

  v_cleanup:=public.reconcile_daily_report_upgrade_snapshot(
    v_batch.id,p_report_date,p_payload,p_actor
  );
  v_result:=public.upgrade_daily_report_details_v2_legacy(
    p_report_date,p_file_hash,p_payload,p_actor
  );

  for v_row in
    select value
    from jsonb_array_elements(coalesce(p_payload->'cashMovements','[]'::jsonb))
  loop
    v_ref:=concat(
      'DR-',to_char(p_report_date,'YYYYMMDD'),'-F-',
      lpad(v_row->>'sourceRowNo',4,'0')
    );
    update public.finance_events
    set status='recorded',updated_at=now()
    where reference_no=v_ref and coalesce(status,'')='reversed';

    if coalesce((v_row->>'isCustomerCollection')::boolean,false) then
      v_ref:=concat(
        'DR-',to_char(p_report_date,'YYYYMMDD'),'-C-',
        lpad(v_row->>'sourceRowNo',4,'0')
      );
      update public.collection_events
      set status='recorded'
      where reference_no=v_ref and amount>0 and coalesce(status,'')='reversed';
    end if;
  end loop;

  return coalesce(v_result,'{}'::jsonb)||
    jsonb_build_object('snapshotReconciliation',v_cleanup);
end $$;

-- Reconcile the three revised workbooks supplied for 23, 25 and 26 July.
-- These source-row manifests are generated from the attached XLSX files by the
-- canonical parser. The assertions make the migration roll back unless the
-- production discrepancy is exactly the reviewed 9 cash rows / SAR 10,020 and
-- 7 inventory rows.
do $$
declare
  v_item record;
  v_result jsonb;
  v_batch_id uuid;
  v_cash_count integer:=0;
  v_inventory_count integer:=0;
  v_cash_amount numeric:=0;
  v_daily_cash integer;
  v_daily_inventory integer;
begin
  for v_item in
    select *
    from (
      values
      (
        date '2026-07-23',
        '{
          "cashMovements":[
            {"sourceRowNo":48},{"sourceRowNo":49},{"sourceRowNo":50},
            {"sourceRowNo":51},{"sourceRowNo":52},{"sourceRowNo":53},
            {"sourceRowNo":54},{"sourceRowNo":58},{"sourceRowNo":59},
            {"sourceRowNo":60},{"sourceRowNo":61},{"sourceRowNo":62},
            {"sourceRowNo":63},{"sourceRowNo":64},{"sourceRowNo":65},
            {"sourceRowNo":66},{"sourceRowNo":67},{"sourceRowNo":68},
            {"sourceRowNo":69},{"sourceRowNo":70},{"sourceRowNo":71},
            {"sourceRowNo":72},{"sourceRowNo":73},{"sourceRowNo":74},
            {"sourceRowNo":80},{"sourceRowNo":81},{"sourceRowNo":82},
            {"sourceRowNo":83},{"sourceRowNo":84},{"sourceRowNo":85},
            {"sourceRowNo":88},{"sourceRowNo":89},{"sourceRowNo":90},
            {"sourceRowNo":91},{"sourceRowNo":92},{"sourceRowNo":93},
            {"sourceRowNo":94},{"sourceRowNo":95},{"sourceRowNo":96},
            {"sourceRowNo":97},{"sourceRowNo":98},{"sourceRowNo":99},
            {"sourceRowNo":100},{"sourceRowNo":101},{"sourceRowNo":102},
            {"sourceRowNo":103},{"sourceRowNo":104},{"sourceRowNo":105},
            {"sourceRowNo":106},{"sourceRowNo":107},{"sourceRowNo":108},
            {"sourceRowNo":109},{"sourceRowNo":110},{"sourceRowNo":111},
            {"sourceRowNo":112},{"sourceRowNo":113},{"sourceRowNo":114},
            {"sourceRowNo":115},{"sourceRowNo":116},{"sourceRowNo":117},
            {"sourceRowNo":118},{"sourceRowNo":119},{"sourceRowNo":120},
            {"sourceRowNo":121},{"sourceRowNo":122},{"sourceRowNo":123},
            {"sourceRowNo":124},{"sourceRowNo":125},{"sourceRowNo":126},
            {"sourceRowNo":127},{"sourceRowNo":128},{"sourceRowNo":129},
            {"sourceRowNo":130},{"sourceRowNo":131},{"sourceRowNo":132},
            {"sourceRowNo":133},{"sourceRowNo":134},{"sourceRowNo":135},
            {"sourceRowNo":136},{"sourceRowNo":137}
          ],
          "inventory":[
            {"sourceRowNo":34,"inventoryType":"finished_goods","itemCode":"10020006"},
            {"sourceRowNo":36,"inventoryType":"finished_goods","itemCode":"10020007"},
            {"sourceRowNo":37,"inventoryType":"finished_goods","itemCode":"10020008"},
            {"sourceRowNo":38,"inventoryType":"finished_goods","itemCode":"10020009"},
            {"sourceRowNo":41,"inventoryType":"raw_material","itemCode":"10010001"},
            {"sourceRowNo":42,"inventoryType":"raw_material","itemCode":"10010004"},
            {"sourceRowNo":43,"inventoryType":"raw_material","itemCode":"10010005"}
          ]
        }'::jsonb
      ),
      (
        date '2026-07-25',
        '{
          "cashMovements":[
            {"sourceRowNo":17},{"sourceRowNo":18},{"sourceRowNo":19},
            {"sourceRowNo":20},{"sourceRowNo":21},{"sourceRowNo":22},
            {"sourceRowNo":23},{"sourceRowNo":27},{"sourceRowNo":28},
            {"sourceRowNo":34},{"sourceRowNo":35},{"sourceRowNo":36},
            {"sourceRowNo":39},{"sourceRowNo":40},{"sourceRowNo":41},
            {"sourceRowNo":42},{"sourceRowNo":43},{"sourceRowNo":44},
            {"sourceRowNo":45},{"sourceRowNo":46},{"sourceRowNo":47}
          ],
          "inventory":[
            {"sourceRowNo":8,"inventoryType":"finished_goods","itemCode":"10020006"},
            {"sourceRowNo":9,"inventoryType":"finished_goods","itemCode":"10020007"},
            {"sourceRowNo":12,"inventoryType":"raw_material","itemCode":"10010001"}
          ]
        }'::jsonb
      ),
      (
        date '2026-07-26',
        '{
          "cashMovements":[
            {"sourceRowNo":33},{"sourceRowNo":34},{"sourceRowNo":35},
            {"sourceRowNo":36},{"sourceRowNo":37},{"sourceRowNo":43},
            {"sourceRowNo":44},{"sourceRowNo":47},{"sourceRowNo":48},
            {"sourceRowNo":49},{"sourceRowNo":50},{"sourceRowNo":51},
            {"sourceRowNo":52},{"sourceRowNo":53},{"sourceRowNo":54},
            {"sourceRowNo":55},{"sourceRowNo":56}
          ],
          "inventory":[
            {"sourceRowNo":22,"inventoryType":"finished_goods","itemCode":"10020006"},
            {"sourceRowNo":25,"inventoryType":"raw_material","itemCode":"10010001"}
          ]
        }'::jsonb
      )
    ) manifest(report_date,payload)
  loop
    select id into v_batch_id
    from public.daily_report_batches
    where report_date=v_item.report_date and status='approved';
    if v_batch_id is null then
      raise exception 'REVISED_DAILY_REPORT_BATCH_MISSING:%',v_item.report_date;
    end if;
    v_result:=public.reconcile_daily_report_upgrade_snapshot(
      v_batch_id,v_item.report_date,v_item.payload,'migration-031'
    );
    v_cash_count:=v_cash_count+
      coalesce((v_result->>'cashMovementsSuperseded')::integer,0);
    v_cash_amount:=v_cash_amount+
      coalesce((v_result->>'cashAmountSuperseded')::numeric,0);
    v_inventory_count:=v_inventory_count+
      coalesce((v_result->>'inventoryRowsSuperseded')::integer,0);
    v_batch_id:=null;
  end loop;

  if v_cash_count<>9 or round(v_cash_amount,2)<>10020 or v_inventory_count<>7 then
    raise exception
      'REVISED_SNAPSHOT_REPAIR_MISMATCH:cash=%,amount=%,inventory=%',
      v_cash_count,round(v_cash_amount,2),v_inventory_count;
  end if;

  select count(*) into v_daily_cash
  from public.daily_report_cash_movements c
  join public.daily_report_batches b on b.id=c.batch_id
  where b.report_date in (date '2026-07-23',date '2026-07-25',date '2026-07-26');
  select count(*) into v_daily_inventory
  from public.daily_report_inventory_snapshots i
  join public.daily_report_batches b on b.id=i.batch_id
  where b.report_date in (date '2026-07-23',date '2026-07-25',date '2026-07-26');
  if v_daily_cash<>118 or v_daily_inventory<>12 then
    raise exception
      'REVISED_SNAPSHOT_FINAL_COUNTS_INVALID:cash=%,inventory=%',
      v_daily_cash,v_daily_inventory;
  end if;

  insert into public.audit_log(
    actor_type,actor_id,action,entity_type,entity_id,details
  ) values(
    'system',
    'migration-031',
    'revised_daily_report_snapshots_reconciled',
    'daily_report',
    '2026-07-23,2026-07-25,2026-07-26',
    jsonb_build_object(
      'cashMovementsSuperseded',v_cash_count,
      'cashAmountSuperseded',round(v_cash_amount,2),
      'inventoryRowsSuperseded',v_inventory_count,
      'dailyCashAfter',v_daily_cash,
      'dailyInventoryAfter',v_daily_inventory
    )
  );
end $$;

insert into public.migration_history(version,migration_name)
values(31,'031_daily_report_snapshot_reconciliation')
on conflict(version) do update set migration_name=excluded.migration_name;

revoke all on function public.reconcile_daily_report_upgrade_snapshot(
  uuid,date,jsonb,text
) from public,anon,authenticated;
revoke all on function public.upgrade_daily_report_details(
  date,text,jsonb,text
) from public,anon,authenticated;
revoke all on function public.upgrade_daily_report_details_v2_legacy(
  date,text,jsonb,text
) from public,anon,authenticated;
grant execute on function public.reconcile_daily_report_upgrade_snapshot(
  uuid,date,jsonb,text
) to service_role;
grant execute on function public.upgrade_daily_report_details(
  date,text,jsonb,text
) to service_role;
grant execute on function public.upgrade_daily_report_details_v2_legacy(
  date,text,jsonb,text
) to service_role;
