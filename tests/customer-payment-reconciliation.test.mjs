import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assignSettlementDate,
  buildCustomerPaymentCompletionPlan,
  isCustomerReceipt,
  paymentCompletionSummaryByCustomer
} from '../api/_lib/customer-payment-reconciliation.js';

test('undated customer receipts receive the reviewed settlement date',()=>{
  const result=assignSettlementDate([
    {accountType:'عميل',accountCode:'C1',accountName:'عميل 1',debit:500,credit:0,voucherNo:'100'},
    {accountType:'بنك',accountCode:'B1',debit:500,credit:0,voucherNo:'101'}
  ],'2026-07-26');
  assert.equal(result.accepted.length,1);
  assert.equal(result.accepted[0].movementDate,'2026-07-26');
  assert.equal(result.accepted[0].settlementDateAssigned,true);
  assert.equal(result.quarantined.length,1);
});

test('same customer, voucher, direction and amount is matched regardless of date or treasury',()=>{
  const existing=[{
    id:'old',account_type:'عميل',account_code:'C1',debit:500,credit:0,
    voucher_no:'100',movement_date_text:'2026-07-23',treasury_code:'101',
    is_customer_collection:true
  }];
  const incoming=[{
    accountType:'عميل',accountCode:'C1',debit:500,credit:0,
    voucherNo:'100',movementDate:'2026-07-26',treasuryCode:'105',
    isCustomerCollection:true
  }];
  const plan=buildCustomerPaymentCompletionPlan(existing,incoming);
  assert.equal(plan.matched.length,1);
  assert.equal(plan.missing.length,0);
  assert.equal(plan.conflicts.length,0);
});

test('same customer and voucher with a different amount is isolated as conflict',()=>{
  const existing=[{
    account_type:'عميل',account_code:'C1',debit:500,credit:0,
    voucher_no:'100',is_customer_collection:true
  }];
  const incoming=[{
    accountType:'عميل',accountCode:'C1',debit:700,credit:0,
    voucherNo:'100',isCustomerCollection:true
  }];
  const plan=buildCustomerPaymentCompletionPlan(existing,incoming);
  assert.equal(plan.missing.length,0);
  assert.equal(plan.conflicts.length,1);
  assert.equal(plan.conflicts[0].existingAmount,500);
  assert.equal(plan.conflicts[0].incomingAmount,700);
});

test('equal payments with different vouchers remain two legitimate payments',()=>{
  const incoming=[
    {accountType:'عميل',accountCode:'C1',accountName:'عميل 1',debit:500,credit:0,voucherNo:'100',isCustomerCollection:true},
    {accountType:'عميل',accountCode:'C1',accountName:'عميل 1',debit:500,credit:0,voucherNo:'101',isCustomerCollection:true}
  ];
  const plan=buildCustomerPaymentCompletionPlan([],incoming);
  assert.equal(plan.missing.length,2);
  assert.equal(plan.conflicts.length,0);
  assert.deepEqual(paymentCompletionSummaryByCustomer(plan.missing),[
    {customerCode:'C1',customerName:'عميل 1',count:2,amount:1000}
  ]);
});

test('customer credit notes are not misclassified as receipts',()=>{
  assert.equal(isCustomerReceipt({accountType:'عميل',accountCode:'C1',debit:0,credit:100,isCustomerCollection:true}),false);
});
