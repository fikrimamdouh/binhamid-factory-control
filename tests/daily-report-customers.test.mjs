import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDailyReportCustomerContext } from '../api/_lib/daily-report-customers.js';

const payload=(sales=[],cashMovements=[])=>({sales,cashMovements});

test('named customer from first sales report is prepared for atomic creation',()=>{
  const result=buildDailyReportCustomerContext(payload([{customerCode:'C100',customerName:'عميل جديد'}]),[]);
  assert.equal(result.errors.length,0);
  assert.equal(result.pendingCustomers.length,1);
  assert.equal(result.customerMap.get('C100').customer_name,'عميل جديد');
  assert.ok(result.warnings.some(item=>item.code==='CUSTOMER_WILL_BE_CREATED'));
});

test('collection-only customer can be prepared from account name',()=>{
  const result=buildDailyReportCustomerContext(payload([],[{isCustomerCollection:true,accountCode:'C200',accountName:'عميل تحصيل'}]),[]);
  assert.equal(result.errors.length,0);
  assert.equal(result.pendingCustomers[0].customer_code,'C200');
});

test('conflicting names for one new code stop approval',()=>{
  const result=buildDailyReportCustomerContext(payload([
    {customerCode:'C300',customerName:'الاسم الأول'},
    {customerCode:'C300',customerName:'الاسم الثاني'}
  ]),[]);
  assert.ok(result.errors.some(item=>item.code==='CUSTOMER_NAME_CONFLICT'));
  assert.equal(result.pendingCustomers.length,0);
});

test('inactive existing customer is never reactivated automatically',()=>{
  const result=buildDailyReportCustomerContext(payload([{customerCode:'C400',customerName:'عميل متوقف'}]),[
    {id:'1',external_id:'C400',customer_code:'C400',customer_name:'عميل متوقف',active:false}
  ]);
  assert.ok(result.errors.some(item=>item.code==='CUSTOMER_INACTIVE'));
  assert.equal(result.pendingCustomers.length,0);
});

test('existing customer name is preserved and mismatch becomes warning',()=>{
  const result=buildDailyReportCustomerContext(payload([{customerCode:'C500',customerName:'اسم مختلف'}]),[
    {id:'1',external_id:'C500',customer_code:'C500',customer_name:'الاسم المعتمد',active:true}
  ]);
  assert.equal(result.errors.length,0);
  assert.ok(result.warnings.some(item=>item.code==='CUSTOMER_NAME_MISMATCH'));
  assert.equal(result.customerMap.get('C500').customer_name,'الاسم المعتمد');
});

test('new collection customer without a name is rejected',()=>{
  const result=buildDailyReportCustomerContext(payload([],[{isCustomerCollection:true,accountCode:'C600',accountName:''}]),[]);
  assert.ok(result.errors.some(item=>item.code==='CUSTOMER_NAME_REQUIRED'));
});
