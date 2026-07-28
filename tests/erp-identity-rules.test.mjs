import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFullSnapshot,buildSnapshotPlan } from '../api/_lib/daily-report-v5.js';

test('invoice number is immutable and an exact re-upload does not add or alter it',()=>{
  const existing={sales:[{id:'s1',batch_id:'b1',source_row_no:1,invoice_no:'18448',customer_code:'11508',customer_name:'الاسم المعتمد',sales_type:'block',item_name:'بلوك 20',quantity:10,amount:100,payment_terms:'نقدي'}],cash:[],inventory:[],treasuries:[]};
  const incoming={sales:[{invoice:'18448',customerCode:'11508',customer:'اسم مختلف شكليًا',kind:'بلوك',item:'بلوك 20',quantity:10,amount:100,paymentTerms:'تحويل'}],cashMovements:[],finishedGoods:[],rawMaterials:[],treasuries:[]};
  const plan=buildSnapshotPlan(existing.sales,existing.cash,incoming,{currentBatchId:'b1'});
  assert.equal(plan.conflicts.length,0);
  assert.equal(plan.matchedSales.length,1);
  assert.equal(plan.missingSales.length,0);
  const full=buildFullSnapshot(existing,plan,incoming);
  assert.equal(full.sales.length,1);
  assert.equal(full.sales[0].customer,'الاسم المعتمد');
  assert.equal(full.sales[0].paymentTerms,'نقدي');
  assert.equal(full.sales[0].amount,100);
});

test('same invoice number with changed customer item quantity or amount is blocked',()=>{
  const existing=[{id:'s1',batch_id:'b1',source_row_no:1,invoice_no:'18448',customer_code:'11508',customer_name:'عميل',sales_type:'block',item_name:'بلوك 20',quantity:10,amount:100}];
  const changed=buildSnapshotPlan(existing,[],{sales:[{invoice:'18448',customerCode:'11508',kind:'بلوك',item:'بلوك 20',quantity:10,amount:150}],cashMovements:[]},{currentBatchId:'b1'});
  assert.equal(changed.conflicts.length,1);
  assert.equal(changed.missingSales.length,0);
  assert.match(changed.conflicts[0].reason,/لا تُعدّل/);
});

test('customer payment identity is date plus customer number plus amount',()=>{
  const incoming={sales:[],cashMovements:[
    {movementDate:'2026-07-25',accountCode:'13063',debit:800,credit:0,treasuryCode:'101',voucherNo:'500',isCustomerCollection:true},
    {movementDate:'2026-07-25',accountCode:'13063',debit:800,credit:0,treasuryCode:'105',voucherNo:'999',isCustomerCollection:true}
  ]};
  const plan=buildSnapshotPlan([],[],incoming,{});
  assert.equal(plan.conflicts.length,1);
  assert.match(plan.conflicts[0].reason,/التاريخ ورقم العميل والمبلغ/);
});

test('same customer and amount on a different date remains a separate payment',()=>{
  const incoming={sales:[],cashMovements:[
    {movementDate:'2026-07-25',accountCode:'13063',debit:800,credit:0,treasuryCode:'101',voucherNo:'500',isCustomerCollection:true},
    {movementDate:'2026-07-26',accountCode:'13063',debit:800,credit:0,treasuryCode:'101',voucherNo:'501',isCustomerCollection:true}
  ]};
  const plan=buildSnapshotPlan([],[],incoming,{});
  assert.equal(plan.conflicts.length,0);
  assert.equal(plan.missingCash.length,2);
});

test('legacy 19-23 payment matches the old 23 July row and only corrects its date',()=>{
  const existing={sales:[],cash:[{id:'c1',batch_id:'b23',source_row_no:4,treasury_code:'101',treasury_name:'الخزينة',debit:800,credit:0,account_name:'عميل',account_type:'عميل',account_code:'13063',movement_type:'إذن استلام',voucher_no:'500',movement_date_text:'2026-07-23',is_customer_collection:true}],inventory:[],treasuries:[]};
  const incoming={sales:[],cashMovements:[{movementDate:'2026-07-20',accountCode:'13063',accountName:'اسم جديد لا يعتمد',debit:800,credit:0,treasuryCode:'101',voucherNo:'500',isCustomerCollection:true}],finishedGoods:[],rawMaterials:[],treasuries:[]};
  const plan=buildSnapshotPlan(existing.sales,existing.cash,incoming,{currentBatchId:'b23',legacyBaseline:true});
  assert.equal(plan.conflicts.length,0);
  assert.equal(plan.matchedCash.length,1);
  assert.equal(plan.missingCash.length,0);
  assert.equal(plan.datesCorrected,1);
  const full=buildFullSnapshot(existing,plan,incoming);
  assert.equal(full.cashMovements.length,1);
  assert.equal(full.cashMovements[0].movementDate,'2026-07-20');
  assert.equal(full.cashMovements[0].accountName,'عميل');
  assert.equal(full.cashMovements[0].debit,800);
});
