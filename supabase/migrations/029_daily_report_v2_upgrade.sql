-- Bin Hamid Factory Control — upgrade approved daily reports from their exact
-- original workbook without deleting or duplicating operational history.
-- Run after 028_fuel_transactions_history.sql.

do $$
begin
  if not exists(select 1 from public.migration_history where version=28) then
    raise exception 'MIGRATION_028_REQUIRED';
  end if;
end $$;

insert into public.chart_of_accounts(account_code,account_name_ar,account_type,normal_side,parent_code)
values('110205','البنك الأهلي 105','asset','debit','110200')
on conflict(account_code) do update set
  account_name_ar=excluded.account_name_ar,
  account_type=excluded.account_type,
  normal_side=excluded.normal_side,
  parent_code=excluded.parent_code,
  active=true,
  updated_at=now();

create or replace function public.validate_daily_report_cash_line()
returns trigger
language plpgsql
security definer
set search_path=public,extensions
as $$
begin
  if new.treasury_code not in ('101','104','105') and coalesce(new.is_customer_collection,false) then
    raise exception 'DAILY_REPORT_UNSUPPORTED_COLLECTION_TREASURY:%',new.treasury_code;
  end if;
  if coalesce(new.is_customer_collection,false) and nullif(trim(new.account_code),'') is null then
    raise exception 'DAILY_REPORT_COLLECTION_CUSTOMER_CODE_REQUIRED';
  end if;
  if coalesce(new.is_customer_collection,false) and nullif(trim(coalesce(new.account_name,'')),'') is not null then
    perform public.ensure_daily_report_customer(new.account_code,new.account_name);
  end if;
  if coalesce(new.debit,0)<0 or coalesce(new.credit,0)<0 then
    raise exception 'DAILY_REPORT_NEGATIVE_CASH_VALUE';
  end if;
  new.line_identity:=public.daily_cash_identity(
    new.treasury_code,new.account_code,new.voucher_no,new.movement_type,
    new.debit,new.credit,new.movement_date_text
  );
  return new;
end $$;

create or replace function public.post_daily_report_accounting(p_batch_id uuid,p_actor text default 'system')
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_batch public.daily_report_batches%rowtype;
  v_sale record;
  v_cash record;
  v_entry uuid;
  v_account_debit uuid;
  v_account_credit uuid;
  v_sales integer:=0;
  v_collections integer:=0;
  v_total_debit numeric(18,2):=0;
  v_total_credit numeric(18,2):=0;
  v_ref text;
  v_source text;
  v_amount numeric(18,2);
  v_debit_code text;
begin
  select * into v_batch from public.daily_report_batches where id=p_batch_id for update;
  if not found then raise exception 'DAILY_REPORT_BATCH_NOT_FOUND:%',p_batch_id; end if;
  if v_batch.status<>'approved' then raise exception 'DAILY_REPORT_NOT_APPROVED:%',p_batch_id; end if;
  select id into v_account_debit from public.chart_of_accounts where account_code='110100' and active=true;
  if v_account_debit is null then raise exception 'ACCOUNT_RECEIVABLE_MISSING'; end if;

  for v_sale in select * from public.daily_report_sales_lines where batch_id=p_batch_id order by id loop
    v_amount:=round(coalesce(v_sale.amount,0),2);
    if v_amount<=0 then raise exception 'SALE_AMOUNT_INVALID:%',v_sale.id; end if;
    select id into v_account_credit from public.chart_of_accounts
    where account_code=case when v_sale.sales_type='block' then '410100' else '410200' end and active=true;
    if v_account_credit is null then raise exception 'SALES_ACCOUNT_MISSING:%',v_sale.sales_type; end if;
    v_source:=concat(p_batch_id,':sale:',v_sale.id);
    v_ref:=concat('JE-',to_char(v_batch.report_date,'YYYYMMDD'),'-S-',lpad(v_sale.id::text,8,'0'));
    insert into public.journal_entries(reference_no,entry_date,description,source_type,source_id,source_batch_id,status,posted_by,metadata)
    values(v_ref,v_batch.report_date,concat('فاتورة ',v_sale.invoice_no,' — ',v_sale.customer_name),'daily_report_sale',v_source,p_batch_id,'draft',p_actor,jsonb_build_object('invoiceNo',v_sale.invoice_no,'salesType',v_sale.sales_type,'sourceRowNo',v_sale.source_row_no))
    on conflict(source_type,source_id) do update set updated_at=now()
    returning id into v_entry;
    if not exists(select 1 from public.journal_entry_lines where journal_entry_id=v_entry) then
      insert into public.journal_entry_lines(journal_entry_id,line_no,account_id,debit,credit,customer_external_id,cost_center_code,memo,source_line_id) values
        (v_entry,1,v_account_debit,v_amount,0,v_sale.customer_code,v_sale.sales_type,concat('مديونية فاتورة ',v_sale.invoice_no),v_sale.id::text),
        (v_entry,2,v_account_credit,0,v_amount,v_sale.customer_code,v_sale.sales_type,concat('إيراد ',v_sale.item_name),v_sale.id::text);
    end if;
    perform public.assert_journal_entry_balanced(v_entry);
    update public.journal_entries
    set status='posted',posted_by=p_actor,posted_at=coalesce(posted_at,now()),updated_at=now()
    where id=v_entry and status='draft';
    v_sales:=v_sales+1;
    v_total_debit:=v_total_debit+v_amount;
    v_total_credit:=v_total_credit+v_amount;
  end loop;

  for v_cash in
    select * from public.daily_report_cash_movements
    where batch_id=p_batch_id and is_customer_collection=true
    order by id
  loop
    v_amount:=round(greatest(coalesce(v_cash.debit,0),coalesce(v_cash.credit,0)),2);
    if v_amount<=0 then raise exception 'COLLECTION_AMOUNT_INVALID:%',v_cash.id; end if;
    v_debit_code:=case
      when v_cash.treasury_code='104' then '110204'
      when v_cash.treasury_code='105' then '110205'
      else '110201'
    end;
    select id into v_account_debit from public.chart_of_accounts where account_code=v_debit_code and active=true;
    select id into v_account_credit from public.chart_of_accounts where account_code='110100' and active=true;
    if v_account_debit is null or v_account_credit is null then
      raise exception 'COLLECTION_ACCOUNT_MISSING:%',v_cash.treasury_code;
    end if;
    v_source:=concat(p_batch_id,':collection:',v_cash.id);
    v_ref:=concat('JE-',to_char(v_batch.report_date,'YYYYMMDD'),'-C-',lpad(v_cash.id::text,8,'0'));
    insert into public.journal_entries(reference_no,entry_date,description,source_type,source_id,source_batch_id,status,posted_by,metadata)
    values(v_ref,v_batch.report_date,concat('تحصيل ',v_cash.account_name,' — خزينة ',v_cash.treasury_code),'daily_report_collection',v_source,p_batch_id,'draft',p_actor,jsonb_build_object('treasuryCode',v_cash.treasury_code,'voucherNo',v_cash.voucher_no,'sourceRowNo',v_cash.source_row_no))
    on conflict(source_type,source_id) do update set updated_at=now()
    returning id into v_entry;
    if not exists(select 1 from public.journal_entry_lines where journal_entry_id=v_entry) then
      insert into public.journal_entry_lines(journal_entry_id,line_no,account_id,debit,credit,customer_external_id,cost_center_code,memo,source_line_id) values
        (v_entry,1,v_account_debit,v_amount,0,v_cash.account_code,'finance',concat('تحصيل خزينة ',v_cash.treasury_code),v_cash.id::text),
        (v_entry,2,v_account_credit,0,v_amount,v_cash.account_code,'finance',concat('تسوية ذمة ',v_cash.account_name),v_cash.id::text);
    end if;
    perform public.assert_journal_entry_balanced(v_entry);
    update public.journal_entries
    set status='posted',posted_by=p_actor,posted_at=coalesce(posted_at,now()),updated_at=now()
    where id=v_entry and status='draft';
    v_collections:=v_collections+1;
    v_total_debit:=v_total_debit+v_amount;
    v_total_credit:=v_total_credit+v_amount;
  end loop;

  insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details)
  values('system',coalesce(nullif(p_actor,''),'system'),'daily_report_accounting_posted','daily_report_batch',p_batch_id::text,jsonb_build_object('salesEntries',v_sales,'collectionEntries',v_collections,'totalDebit',v_total_debit,'totalCredit',v_total_credit))
  on conflict do nothing;
  return jsonb_build_object('batchId',p_batch_id,'salesEntries',v_sales,'collectionEntries',v_collections,'entryCount',v_sales+v_collections,'totalDebit',v_total_debit,'totalCredit',v_total_credit,'balanced',round(v_total_debit,2)=round(v_total_credit,2));
end $$;

create or replace function public.upgrade_daily_report_details(
  p_report_date date,
  p_file_hash text,
  p_payload jsonb,
  p_actor text default 'erp-folder-sync-v2'
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_batch public.daily_report_batches%rowtype;
  v_row jsonb;
  v_sales_id uuid;
  v_collection_id uuid;
  v_collection_exists boolean;
  v_ref text;
  v_collection_ref text;
  v_amount numeric;
  v_created_at timestamptz:=((p_report_date::text||' 12:00:00+03')::timestamptz);
  v_movement_at timestamptz;
  v_before_sales integer;
  v_before_cash integer;
  v_before_treasuries integer;
  v_before_inventory integer;
  v_after_sales integer;
  v_after_cash integer;
  v_after_treasuries integer;
  v_after_inventory integer;
  v_accounting jsonb;
begin
  if p_report_date is null then raise exception 'DAILY_REPORT_UPGRADE_DATE_REQUIRED'; end if;
  if nullif(trim(coalesce(p_file_hash,'')),'') is null then raise exception 'DAILY_REPORT_UPGRADE_HASH_REQUIRED'; end if;
  if nullif(trim(coalesce(p_actor,'')),'') is null then raise exception 'DAILY_REPORT_UPGRADE_ACTOR_REQUIRED'; end if;

  select * into v_batch from public.daily_report_batches where report_date=p_report_date for update;
  if not found then raise exception 'DAILY_REPORT_UPGRADE_BATCH_NOT_FOUND:%',p_report_date; end if;
  if v_batch.status<>'approved' then raise exception 'DAILY_REPORT_UPGRADE_BATCH_NOT_APPROVED:%',v_batch.id; end if;
  if v_batch.file_hash is distinct from p_file_hash then
    raise exception 'DAILY_REPORT_UPGRADE_FILE_HASH_MISMATCH:%',v_batch.id;
  end if;

  select count(*) into v_before_sales from public.daily_report_sales_lines where batch_id=v_batch.id;
  select count(*) into v_before_cash from public.daily_report_cash_movements where batch_id=v_batch.id;
  select count(*) into v_before_treasuries from public.daily_report_treasury_balances where batch_id=v_batch.id;
  select count(*) into v_before_inventory from public.daily_report_inventory_snapshots where batch_id=v_batch.id;

  for v_row in select value from jsonb_array_elements(coalesce(p_payload->'sales','[]'::jsonb)) loop
    insert into public.daily_report_sales_lines(
      batch_id,source_row_no,invoice_no,sales_type,customer_code,customer_name,
      item_name,quantity,unit,amount,payment_terms,issues
    ) values(
      v_batch.id,(v_row->>'sourceRowNo')::integer,v_row->>'invoiceNo',v_row->>'salesType',
      nullif(v_row->>'customerCode',''),v_row->>'customerName',v_row->>'item',
      public.safe_numeric(v_row->>'quantity',0),v_row->>'unit',
      public.safe_numeric(v_row->>'amount',0),v_row->>'paymentTerms',
      coalesce(v_row->'issues','[]'::jsonb)
    )
    on conflict(batch_id,source_row_no) do update set
      invoice_no=excluded.invoice_no,
      sales_type=excluded.sales_type,
      customer_code=excluded.customer_code,
      customer_name=excluded.customer_name,
      item_name=excluded.item_name,
      quantity=excluded.quantity,
      unit=excluded.unit,
      amount=excluded.amount,
      payment_terms=excluded.payment_terms,
      issues=excluded.issues;

    v_ref:=concat('DR-',to_char(p_report_date,'YYYYMMDD'),'-S-',lpad(v_row->>'sourceRowNo',4,'0'));
    insert into public.sales_orders(
      reference_no,sales_type,customer_external_id,customer_name,item,quantity,
      quantity_text,unit,unit_price,total_amount,delivery_date,delivery_text,
      payment_method,notes,status,sales_person_name,raw_order_text,created_at,updated_at
    ) values(
      v_ref,v_row->>'salesType',nullif(v_row->>'customerCode',''),v_row->>'customerName',
      v_row->>'item',public.safe_numeric(v_row->>'quantity',0),v_row->>'quantity',
      v_row->>'unit',
      case when public.safe_numeric(v_row->>'quantity',0)>0
        then public.safe_numeric(v_row->>'amount',0)/public.safe_numeric(v_row->>'quantity',1)
        else 0 end,
      public.safe_numeric(v_row->>'amount',0),p_report_date,'التقرير اليومي','credit',
      concat('فاتورة المصدر ',v_row->>'invoiceNo',' — سطر ',v_row->>'sourceRowNo'),
      'registered','استيراد التقرير اليومي',v_row::text,v_created_at,now()
    )
    on conflict(reference_no) do update set
      customer_external_id=excluded.customer_external_id,
      customer_name=excluded.customer_name,
      item=excluded.item,
      quantity=excluded.quantity,
      unit=excluded.unit,
      unit_price=excluded.unit_price,
      total_amount=excluded.total_amount,
      delivery_date=excluded.delivery_date,
      notes=excluded.notes,
      raw_order_text=excluded.raw_order_text,
      updated_at=now()
    returning id into v_sales_id;

    insert into public.cost_ledger(
      entry_type,cost_center,source_type,source_reference,amount,quantity,unit,
      allocation_basis,metadata,occurred_at
    ) values(
      'revenue',v_row->>'salesType','daily_report_sale',v_ref,
      public.safe_numeric(v_row->>'amount',0),public.safe_numeric(v_row->>'quantity',0),
      v_row->>'unit','direct',
      jsonb_build_object('batch_id',v_batch.id,'invoice_no',v_row->>'invoiceNo','customer_code',v_row->>'customerCode','item',v_row->>'item'),
      v_created_at
    )
    on conflict(source_type,source_reference,entry_type) do update set
      amount=excluded.amount,
      quantity=excluded.quantity,
      unit=excluded.unit,
      metadata=excluded.metadata,
      occurred_at=excluded.occurred_at;
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(p_payload->'cashMovements','[]'::jsonb)) loop
    insert into public.daily_report_cash_movements(
      batch_id,source_row_no,treasury_code,treasury_name,debit,credit,account_name,
      account_type,account_code,description,movement_type,voucher_no,
      movement_date_text,payment_method,is_customer_collection
    ) values(
      v_batch.id,(v_row->>'sourceRowNo')::integer,v_row->>'treasuryCode',
      v_row->>'treasuryName',public.safe_numeric(v_row->>'debit',0),
      public.safe_numeric(v_row->>'credit',0),v_row->>'accountName',v_row->>'accountType',
      nullif(v_row->>'accountCode',''),v_row->>'description',v_row->>'movementType',
      v_row->>'voucherNo',v_row->>'movementDate',v_row->>'paymentMethod',
      coalesce((v_row->>'isCustomerCollection')::boolean,false)
    )
    on conflict(batch_id,source_row_no) do update set
      treasury_code=excluded.treasury_code,
      treasury_name=excluded.treasury_name,
      debit=excluded.debit,
      credit=excluded.credit,
      account_name=excluded.account_name,
      account_type=excluded.account_type,
      account_code=excluded.account_code,
      description=excluded.description,
      movement_type=excluded.movement_type,
      voucher_no=excluded.voucher_no,
      movement_date_text=excluded.movement_date_text,
      payment_method=excluded.payment_method,
      is_customer_collection=excluded.is_customer_collection;

    v_ref:=concat('DR-',to_char(p_report_date,'YYYYMMDD'),'-F-',lpad(v_row->>'sourceRowNo',4,'0'));
    v_amount:=case when public.safe_numeric(v_row->>'debit',0)>0
      then public.safe_numeric(v_row->>'debit',0)
      else public.safe_numeric(v_row->>'credit',0) end;
    v_movement_at:=case
      when coalesce(v_row->>'movementDate','')~'^\d{4}-\d{2}-\d{2}$'
        then (((v_row->>'movementDate')||' 12:00:00+03')::timestamptz)
      else v_created_at
    end;
    insert into public.finance_events(
      reference_no,event_type,party_name,amount,payment_method,note,status,
      source_audit_id,occurred_at,created_at,updated_at
    ) values(
      v_ref,
      case when public.safe_numeric(v_row->>'credit',0)>0 then 'cash_payment'
        when coalesce((v_row->>'isCustomerCollection')::boolean,false) then 'customer_receipt'
        else 'cash_receipt' end,
      v_row->>'accountName',v_amount,v_row->>'paymentMethod',
      concat(coalesce(v_row->>'movementType',''),' — إذن ',coalesce(v_row->>'voucherNo',''),' — خزينة ',v_row->>'treasuryCode'),
      'recorded',null,v_movement_at,v_movement_at,now()
    )
    on conflict(reference_no) do update set
      event_type=excluded.event_type,
      party_name=excluded.party_name,
      amount=excluded.amount,
      payment_method=excluded.payment_method,
      note=excluded.note,
      occurred_at=excluded.occurred_at,
      updated_at=now();

    if coalesce((v_row->>'isCustomerCollection')::boolean,false) then
      v_collection_ref:=concat('DR-',to_char(p_report_date,'YYYYMMDD'),'-C-',lpad(v_row->>'sourceRowNo',4,'0'));
      select exists(select 1 from public.collection_events where reference_no=v_collection_ref)
      into v_collection_exists;
      insert into public.collection_events(
        reference_no,customer_external_id,customer_name,amount,payment_method,
        status,note,occurred_at,created_at
      ) values(
        v_collection_ref,nullif(v_row->>'accountCode',''),v_row->>'accountName',
        public.safe_numeric(v_row->>'debit',0),v_row->>'paymentMethod','recorded',
        concat('إذن ',coalesce(v_row->>'voucherNo',''),' — خزينة ',v_row->>'treasuryCode'),
        v_movement_at,v_movement_at
      )
      on conflict(reference_no) do update set
        customer_external_id=excluded.customer_external_id,
        customer_name=excluded.customer_name,
        amount=excluded.amount,
        payment_method=excluded.payment_method,
        note=excluded.note,
        occurred_at=excluded.occurred_at
      returning id into v_collection_id;
      if not v_collection_exists then
        perform public.allocate_collection_fifo(v_collection_id);
      end if;
    end if;
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(p_payload->'treasuries','[]'::jsonb)) loop
    insert into public.daily_report_treasury_balances(
      batch_id,treasury_code,treasury_name,opening_balance,closing_balance
    ) values(
      v_batch.id,v_row->>'treasuryCode',v_row->>'treasuryName',
      public.safe_numeric(v_row->>'opening',0),public.safe_numeric(v_row->>'closing',0)
    )
    on conflict(batch_id,treasury_code) do update set
      treasury_name=excluded.treasury_name,
      opening_balance=excluded.opening_balance,
      closing_balance=excluded.closing_balance;
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(p_payload->'inventory','[]'::jsonb)) loop
    insert into public.daily_report_inventory_snapshots(
      batch_id,source_row_no,inventory_type,item_code,item_name,unit,
      opening_quantity,received_quantity,issued_quantity,closing_quantity
    ) values(
      v_batch.id,(v_row->>'sourceRowNo')::integer,v_row->>'inventoryType',
      v_row->>'itemCode',v_row->>'itemName',v_row->>'unit',
      public.safe_numeric(v_row->>'opening',0),public.safe_numeric(v_row->>'received',0),
      public.safe_numeric(v_row->>'issued',0),public.safe_numeric(v_row->>'closing',0)
    )
    on conflict(batch_id,inventory_type,item_code,source_row_no) do update set
      item_name=excluded.item_name,
      unit=excluded.unit,
      opening_quantity=excluded.opening_quantity,
      received_quantity=excluded.received_quantity,
      issued_quantity=excluded.issued_quantity,
      closing_quantity=excluded.closing_quantity;
  end loop;

  update public.daily_report_batches set
    summary=coalesce(summary,'{}'::jsonb)||coalesce(p_payload->'summary','{}'::jsonb)||
      jsonb_build_object('parserVersion','daily-report-v2','upgradedAt',now()),
    preview_summary=coalesce(preview_summary,'{}'::jsonb)||coalesce(p_payload->'summary','{}'::jsonb)||
      jsonb_build_object('parserVersion','daily-report-v2','upgradedAt',now())
  where id=v_batch.id;

  v_accounting:=public.post_daily_report_accounting(v_batch.id,p_actor);

  select count(*) into v_after_sales from public.daily_report_sales_lines where batch_id=v_batch.id;
  select count(*) into v_after_cash from public.daily_report_cash_movements where batch_id=v_batch.id;
  select count(*) into v_after_treasuries from public.daily_report_treasury_balances where batch_id=v_batch.id;
  select count(*) into v_after_inventory from public.daily_report_inventory_snapshots where batch_id=v_batch.id;

  insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details)
  values(
    'system',p_actor,'daily_report_v2_upgraded','daily_report_batch',v_batch.id::text,
    jsonb_build_object(
      'reportDate',p_report_date,'fileHash',p_file_hash,
      'salesAdded',v_after_sales-v_before_sales,
      'cashMovementsAdded',v_after_cash-v_before_cash,
      'treasuriesAdded',v_after_treasuries-v_before_treasuries,
      'inventoryAdded',v_after_inventory-v_before_inventory,
      'accounting',v_accounting
    )
  );

  return jsonb_build_object(
    'ok',true,
    'upgraded',true,
    'batchId',v_batch.id,
    'reportDate',p_report_date,
    'salesAdded',v_after_sales-v_before_sales,
    'cashMovementsAdded',v_after_cash-v_before_cash,
    'treasuriesAdded',v_after_treasuries-v_before_treasuries,
    'inventoryAdded',v_after_inventory-v_before_inventory,
    'salesCount',v_after_sales,
    'cashMovementCount',v_after_cash,
    'treasuryCount',v_after_treasuries,
    'inventoryCount',v_after_inventory,
    'accounting',v_accounting
  );
end $$;

insert into public.migration_history(version,migration_name)
values(29,'029_daily_report_v2_upgrade')
on conflict(version) do update set migration_name=excluded.migration_name;

revoke all on function public.validate_daily_report_cash_line() from public,anon,authenticated;
revoke all on function public.post_daily_report_accounting(uuid,text) from public,anon,authenticated;
revoke all on function public.upgrade_daily_report_details(date,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.validate_daily_report_cash_line() to service_role;
grant execute on function public.post_daily_report_accounting(uuid,text) to service_role;
grant execute on function public.upgrade_daily_report_details(date,text,jsonb,text) to service_role;
