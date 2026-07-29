-- Bin Hamid Factory Control — append reviewed customer receipts without
-- replaying invoices, inventory or previously posted payments.

do $$
begin
  if not exists(select 1 from public.migration_history where version=31) then
    raise exception 'MIGRATION_031_REQUIRED';
  end if;
end $$;

create or replace function public.append_daily_report_customer_payments(
  p_report_date date,
  p_file_hash text,
  p_payments jsonb,
  p_actor text default 'erp-customer-payment-reconciliation',
  p_source_name text default null
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_batch public.daily_report_batches%rowtype;
  v_row jsonb;
  v_existing public.daily_report_cash_movements%rowtype;
  v_cash_id uuid;
  v_collection_id uuid;
  v_next_row integer;
  v_customer text;
  v_customer_name text;
  v_voucher text;
  v_treasury text;
  v_treasury_name text;
  v_amount numeric(18,2);
  v_payment_method text;
  v_movement_type text;
  v_description text;
  v_occurred_at timestamptz;
  v_finance_ref text;
  v_collection_ref text;
  v_inserted integer:=0;
  v_matched integer:=0;
  v_conflict_count integer:=0;
  v_inserted_amount numeric(18,2):=0;
  v_conflicts jsonb:='[]'::jsonb;
  v_inserted_rows jsonb:='[]'::jsonb;
  v_accounting jsonb:='{}'::jsonb;
  v_collection_count integer:=0;
  v_collection_total numeric(18,2):=0;
  v_cash_count integer:=0;
begin
  if p_report_date is null then raise exception 'ERP_PAYMENT_REPORT_DATE_REQUIRED'; end if;
  if nullif(trim(coalesce(p_file_hash,'')),'') is null then raise exception 'ERP_PAYMENT_FILE_HASH_REQUIRED'; end if;
  if jsonb_typeof(p_payments) is distinct from 'array' then raise exception 'ERP_PAYMENT_ROWS_REQUIRED'; end if;
  if nullif(trim(coalesce(p_actor,'')),'') is null then raise exception 'ERP_PAYMENT_ACTOR_REQUIRED'; end if;

  select * into v_batch
  from public.daily_report_batches
  where report_date=p_report_date and status='approved'
  for update;
  if not found then raise exception 'ERP_PAYMENT_TARGET_BATCH_MISSING:%',p_report_date; end if;

  select coalesce(max(source_row_no),0) into v_next_row
  from public.daily_report_cash_movements
  where batch_id=v_batch.id;

  for v_row in select value from jsonb_array_elements(p_payments) loop
    v_customer:=nullif(trim(coalesce(v_row->>'accountCode',v_row->>'customerCode','')),'');
    v_customer_name:=nullif(trim(coalesce(v_row->>'accountName',v_row->>'customerName','')),'');
    v_voucher:=nullif(trim(coalesce(v_row->>'voucherNo',v_row->>'receipt','')),'');
    v_treasury:=nullif(trim(coalesce(v_row->>'treasuryCode','')),'');
    v_treasury_name:=nullif(trim(coalesce(v_row->>'treasuryName','')),'');
    v_amount:=round(public.safe_numeric(v_row->>'debit',0),2);
    v_movement_type:=coalesce(nullif(trim(v_row->>'movementType'),''),'إذن استلام');
    v_description:=coalesce(nullif(trim(v_row->>'description'),''),'استكمال سداد من ملف ERP');
    v_payment_method:=coalesce(nullif(trim(v_row->>'paymentMethod'),''),case when v_treasury='105' then 'bank' when v_treasury='104' then 'pos' else 'cash' end);
    v_occurred_at:=((p_report_date::text||' 12:00:00+03')::timestamptz);

    if v_customer is null or v_customer_name is null or v_voucher is null
       or v_amount<=0 or public.safe_numeric(v_row->>'credit',0)<>0
       or v_treasury not in ('101','104','105') then
      v_conflict_count:=v_conflict_count+1;
      v_conflicts:=v_conflicts||jsonb_build_array(jsonb_build_object(
        'customerCode',v_customer,'voucherNo',v_voucher,'amount',v_amount,
        'reason','سطر سداد غير مكتمل أو غير صالح'
      ));
      continue;
    end if;

    select * into v_existing
    from public.daily_report_cash_movements
    where is_customer_collection=true
      and account_code=v_customer
      and coalesce(voucher_no,'')=v_voucher
      and round(coalesce(debit,0),2)=v_amount
      and round(coalesce(credit,0),2)=0
    order by created_at,id
    limit 1;
    if found then
      v_matched:=v_matched+1;
      continue;
    end if;

    select * into v_existing
    from public.daily_report_cash_movements
    where is_customer_collection=true
      and account_code=v_customer
      and coalesce(voucher_no,'')=v_voucher
    order by created_at,id
    limit 1;
    if found then
      v_conflict_count:=v_conflict_count+1;
      v_conflicts:=v_conflicts||jsonb_build_array(jsonb_build_object(
        'customerCode',v_customer,'customerName',v_customer_name,
        'voucherNo',v_voucher,'incomingAmount',v_amount,
        'existingAmount',round(greatest(coalesce(v_existing.debit,0),coalesce(v_existing.credit,0)),2),
        'existingBatchId',v_existing.batch_id,'existingRowId',v_existing.id,
        'reason','السند موجود للعميل نفسه بقيمة مختلفة'
      ));
      continue;
    end if;

    select id into v_collection_id
    from public.collection_events
    where customer_external_id=v_customer
      and round(coalesce(amount,0),2)=v_amount
      and coalesce(status,'')<>'reversed'
      and coalesce(note,'') like concat('%',v_voucher,'%')
    order by created_at,id
    limit 1;
    if found then
      v_matched:=v_matched+1;
      continue;
    end if;

    v_next_row:=v_next_row+1;
    insert into public.daily_report_cash_movements(
      batch_id,source_row_no,treasury_code,treasury_name,debit,credit,
      account_name,account_type,account_code,description,movement_type,
      voucher_no,movement_date_text,payment_method,is_customer_collection
    ) values(
      v_batch.id,v_next_row,v_treasury,coalesce(v_treasury_name,case v_treasury when '105' then 'البنك' when '104' then 'نقاط البيع' else 'الخزينة' end),
      v_amount,0,v_customer_name,'عميل',v_customer,v_description,v_movement_type,
      v_voucher,p_report_date::text,v_payment_method,true
    ) returning id into v_cash_id;

    v_finance_ref:=concat('DR-',to_char(p_report_date,'YYYYMMDD'),'-F-',lpad(v_next_row::text,4,'0'));
    insert into public.finance_events(
      reference_no,event_type,party_name,amount,payment_method,note,status,
      source_audit_id,occurred_at,created_at,updated_at
    ) values(
      v_finance_ref,'customer_receipt',v_customer_name,v_amount,v_payment_method,
      concat(v_movement_type,' — إذن ',v_voucher,' — خزينة ',v_treasury,' — استكمال من ',coalesce(p_source_name,'ملف ERP')),
      'recorded',null,v_occurred_at,v_occurred_at,now()
    ) on conflict(reference_no) do nothing;

    v_collection_ref:=concat('DR-',to_char(p_report_date,'YYYYMMDD'),'-C-',lpad(v_next_row::text,4,'0'));
    insert into public.collection_events(
      reference_no,customer_external_id,customer_name,amount,payment_method,
      status,note,occurred_at,created_at
    ) values(
      v_collection_ref,v_customer,v_customer_name,v_amount,v_payment_method,'recorded',
      concat('إذن ',v_voucher,' — خزينة ',v_treasury,' — استكمال من ',coalesce(p_source_name,'ملف ERP')),
      v_occurred_at,v_occurred_at
    ) returning id into v_collection_id;
    perform public.allocate_collection_fifo(v_collection_id);

    v_inserted:=v_inserted+1;
    v_inserted_amount:=v_inserted_amount+v_amount;
    v_inserted_rows:=v_inserted_rows||jsonb_build_array(jsonb_build_object(
      'cashMovementId',v_cash_id,'sourceRowNo',v_next_row,'customerCode',v_customer,
      'customerName',v_customer_name,'voucherNo',v_voucher,'amount',v_amount,
      'treasuryCode',v_treasury,'reportDate',p_report_date
    ));
  end loop;

  if v_inserted>0 then
    v_accounting:=public.post_daily_report_accounting(v_batch.id,p_actor);
  end if;

  select count(*),coalesce(sum(debit),0) into v_collection_count,v_collection_total
  from public.daily_report_cash_movements
  where batch_id=v_batch.id and is_customer_collection=true;
  select count(*) into v_cash_count
  from public.daily_report_cash_movements
  where batch_id=v_batch.id;

  update public.daily_report_batches
  set summary=coalesce(summary,'{}'::jsonb)||jsonb_build_object(
        'collectionCount',v_collection_count,
        'collectionTotal',round(v_collection_total,2),
        'cashMovementCount',v_cash_count,
        'paymentReconciledAt',now(),
        'paymentReconciliationFileHash',p_file_hash
      ),
      preview_summary=coalesce(preview_summary,'{}'::jsonb)||jsonb_build_object(
        'collectionCount',v_collection_count,
        'collectionTotal',round(v_collection_total,2),
        'cashMovementCount',v_cash_count,
        'paymentReconciledAt',now()
      )
  where id=v_batch.id;

  insert into public.audit_log(actor_type,actor_id,action,entity_type,entity_id,details)
  values(
    'system',p_actor,'daily_report_customer_payments_reconciled','daily_report_batch',v_batch.id::text,
    jsonb_build_object(
      'reportDate',p_report_date,'fileHash',p_file_hash,'sourceName',p_source_name,
      'inserted',v_inserted,'insertedAmount',round(v_inserted_amount,2),
      'matched',v_matched,'conflictCount',v_conflict_count,
      'conflicts',v_conflicts,'insertedRows',v_inserted_rows,'accounting',v_accounting
    )
  );

  return jsonb_build_object(
    'ok',true,'batchId',v_batch.id,'reportDate',p_report_date,
    'inserted',v_inserted,'insertedAmount',round(v_inserted_amount,2),
    'matched',v_matched,'conflictCount',v_conflict_count,
    'conflicts',v_conflicts,'insertedRows',v_inserted_rows,'accounting',v_accounting
  );
end $$;

insert into public.migration_history(version,migration_name)
values(32,'032_customer_payment_reconciliation')
on conflict(version) do update set migration_name=excluded.migration_name;

revoke all on function public.append_daily_report_customer_payments(date,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.append_daily_report_customer_payments(date,text,jsonb,text,text) to service_role;
