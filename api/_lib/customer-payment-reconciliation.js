const clean=(value,max=1000)=>String(value??'').trim().slice(0,max);
const norm=value=>clean(value,1000)
  .toLowerCase()
  .replace(/[أإآٱ]/g,'ا')
  .replace(/ة/g,'ه')
  .replace(/ى/g,'ي')
  .replace(/[ً-ْـ]/g,'')
  .replace(/\s+/g,' ');
const money=value=>Math.round((Number(value||0)+Number.EPSILON)*100)/100;

export const paymentCustomerCode=row=>clean(
  row?.accountCode??row?.account_code??row?.customerCode??row?.customer_code,
  120
);
export const paymentVoucherNo=row=>clean(
  row?.voucherNo??row?.voucher_no??row?.receipt,
  120
);
export const paymentMovementDate=row=>clean(
  row?.movementDate??row?.movement_date_text??row?.reportDate,
  10
);
export const paymentDebit=row=>money(row?.debit??row?.amount);
export const paymentCredit=row=>money(row?.credit);
export const paymentAmount=row=>Math.max(paymentDebit(row),paymentCredit(row));
export const paymentDirection=row=>{
  const debit=paymentDebit(row),credit=paymentCredit(row);
  if(debit>0&&credit===0)return'debit';
  if(credit>0&&debit===0)return'credit';
  return'mixed';
};
export const isCustomerReceipt=row=>{
  const explicit=Boolean(row?.isCustomerCollection??row?.is_customer_collection);
  const accountType=norm(row?.accountType??row?.account_type);
  const customer=explicit||accountType.includes('عميل');
  return customer&&paymentDirection(row)==='debit'&&paymentAmount(row)>0&&Boolean(paymentCustomerCode(row));
};

export function paymentReferenceKey(row){
  const customer=paymentCustomerCode(row);
  const voucher=paymentVoucherNo(row);
  const direction=paymentDirection(row);
  if(voucher)return['voucher',customer,voucher,direction].join('|');
  return[
    'fallback',customer,direction,paymentAmount(row),
    norm(row?.movementType??row?.movement_type??row?.type),
    norm(row?.description??row?.notes)
  ].join('|');
}

export function paymentExactKey(row){
  return[paymentReferenceKey(row),paymentAmount(row)].join('|');
}

export function assignSettlementDate(rows=[],settlementDate){
  const date=clean(settlementDate,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){
    throw Object.assign(new Error('تاريخ تسوية السداد غير صحيح'),{
      status:422,code:'ERP_PAYMENT_SETTLEMENT_DATE_REQUIRED'
    });
  }
  const accepted=[];
  const quarantined=[];
  for(const row of rows||[]){
    if(!isCustomerReceipt(row)){
      quarantined.push({row,reason:'الحركة ليست سداد عميل مدينًا صالحًا'});
      continue;
    }
    const originalDate=paymentMovementDate(row);
    accepted.push({
      ...row,
      movementDate:originalDate||date,
      reportDate:originalDate||date,
      settlementDateAssigned:!originalDate,
      settlementDateSource:originalDate?'source':'fallback'
    });
  }
  return{accepted,quarantined};
}

export function buildCustomerPaymentCompletionPlan(existingRows=[],incomingRows=[]){
  const existingIndex=new Map();
  for(const row of existingRows||[]){
    if(!isCustomerReceipt(row))continue;
    const key=paymentReferenceKey(row);
    if(!existingIndex.has(key))existingIndex.set(key,[]);
    existingIndex.get(key).push(row);
  }

  const seenIncoming=new Map();
  const matched=[];
  const missing=[];
  const conflicts=[];
  const invalid=[];

  for(const row of incomingRows||[]){
    if(!isCustomerReceipt(row)){
      invalid.push({row,reason:'الحركة ليست سداد عميل مدينًا صالحًا'});
      continue;
    }
    const referenceKey=paymentReferenceKey(row);
    const exactKey=paymentExactKey(row);
    const previous=seenIncoming.get(referenceKey);
    if(previous){
      if(paymentAmount(previous)===paymentAmount(row)){
        matched.push({existing:previous,incoming:row,scope:'incoming-duplicate'});
      }else{
        conflicts.push({
          type:'customer-payment',referenceKey,
          customerCode:paymentCustomerCode(row),voucherNo:paymentVoucherNo(row),
          existingAmount:paymentAmount(previous),incomingAmount:paymentAmount(row),
          reason:'نفس العميل ورقم السند داخل الملف يحملان مبلغين مختلفين'
        });
      }
      continue;
    }
    seenIncoming.set(referenceKey,row);

    const candidates=existingIndex.get(referenceKey)||[];
    const exact=candidates.find(item=>paymentExactKey(item)===exactKey);
    if(exact){
      matched.push({existing:exact,incoming:row,scope:'database'});
      continue;
    }
    if(candidates.length){
      conflicts.push({
        type:'customer-payment',referenceKey,
        customerCode:paymentCustomerCode(row),voucherNo:paymentVoucherNo(row),
        existingAmount:paymentAmount(candidates[0]),incomingAmount:paymentAmount(row),
        reason:'السند موجود للعميل نفسه بقيمة مختلفة'
      });
      continue;
    }
    missing.push(row);
  }

  return{
    matched,missing,conflicts,invalid,
    totals:{
      incoming:incomingRows.length,
      matched:matched.length,
      missing:missing.length,
      conflicts:conflicts.length,
      invalid:invalid.length,
      missingAmount:money(missing.reduce((sum,row)=>sum+paymentAmount(row),0)),
      matchedAmount:money(matched.reduce((sum,item)=>sum+paymentAmount(item.incoming),0))
    }
  };
}

export function paymentCompletionSummaryByCustomer(rows=[]){
  const map=new Map();
  for(const row of rows||[]){
    const code=paymentCustomerCode(row);
    if(!code)continue;
    const current=map.get(code)||{
      customerCode:code,
      customerName:clean(row?.accountName??row?.account_name??row?.customer,500)||code,
      count:0,amount:0
    };
    current.count+=1;
    current.amount=money(current.amount+paymentAmount(row));
    map.set(code,current);
  }
  return[...map.values()].sort((a,b)=>b.amount-a.amount||a.customerCode.localeCompare(b.customerCode));
}
