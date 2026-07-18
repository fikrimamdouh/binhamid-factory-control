import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildCustomerProfitability, findCustomerProfitability, resolveSaleNetBeforeVat } from '../api/_lib/customer-profitability.js';

const read=path=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const close=(actual,expected,tolerance=1e-6)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);

test('net sales use explicit pre-tax fields when available',()=>{
  assert.deepEqual(resolveSaleNetBeforeVat({net_amount_before_vat:1000,return_amount:100,total_amount:1300}),{netSales:900,reliable:true,basis:'net_amount_before_vat'});
  assert.deepEqual(resolveSaleNetBeforeVat({subtotal_before_vat:1000,discount_amount:50,return_amount:100,total_amount:1200}),{netSales:850,reliable:true,basis:'subtotal_before_vat'});
  assert.deepEqual(resolveSaleNetBeforeVat({total_amount:1150,vat_amount:150}),{netSales:1000,reliable:true,basis:'total_less_recorded_vat'});
  close(resolveSaleNetBeforeVat({total_amount:1150,amount_includes_vat:true,vat_rate:15}).netSales,1000);
});

test('unknown tax basis remains an estimate instead of being presented as exact',()=>{
  const result=resolveSaleNetBeforeVat({total_amount:1000});
  assert.equal(result.netSales,1000);
  assert.equal(result.reliable,false);
  assert.equal(result.basis,'recorded_total_tax_unknown');
});

test('customer profitability combines block and concrete quantities using monthly unit costs',()=>{
  const rows=buildCustomerProfitability({unitCosts:{block:2,concrete:150},customers:[{external_id:'C1',customer_name:'شركة الاختبار'}],sales:[
    {reference_no:'INV-1',sales_type:'block',customer_external_id:'C1',customer_name:'شركة الاختبار',quantity:1000,total_amount:3000,amount_includes_vat:false,status:'registered'},
    {reference_no:'INV-2',sales_type:'concrete',customer_external_id:'C1',customer_name:'شركة الاختبار',quantity:10,total_amount:2500,amount_includes_vat:false,status:'registered'}
  ]});
  assert.equal(rows.length,1);
  const row=rows[0];assert.equal(row.blockQuantity,1000);assert.equal(row.concreteQuantity,10);assert.equal(row.blockCost,2000);assert.equal(row.concreteCost,1500);assert.equal(row.estimatedCost,3500);assert.equal(row.netSalesBeforeVat,5500);assert.equal(row.profit,2000);close(row.marginRate,36.3636363636,1e-5);assert.equal(row.reliable,true);
});

test('cancelled and duplicate invoices are excluded and missing unit cost blocks reliability',()=>{
  const rows=buildCustomerProfitability({unitCosts:{block:2},sales:[
    {reference_no:'A',sales_type:'block',customer_external_id:'C1',customer_name:'عميل',quantity:10,total_amount:30,amount_includes_vat:false,status:'registered'},
    {reference_no:'A',sales_type:'block',customer_external_id:'C1',customer_name:'عميل',quantity:10,total_amount:30,amount_includes_vat:false,status:'registered'},
    {reference_no:'B',sales_type:'block',customer_external_id:'C1',customer_name:'عميل',quantity:10,total_amount:30,status:'cancelled'},
    {reference_no:'C',sales_type:'concrete',customer_external_id:'C1',customer_name:'عميل',quantity:1,total_amount:200,amount_includes_vat:false,status:'registered'}
  ]});
  assert.equal(rows[0].invoiceCount,2);
  assert.deepEqual(rows[0].missingUnitCosts,['concrete']);
  assert.equal(rows[0].reliable,false);
});

test('customer search does not construct database filters from free text',()=>{
  const rows=[{code:'C-1',name:'شركة آمنة',profit:10},{code:'C-2',name:'شركة أخرى',profit:20}];
  assert.equal(findCustomerProfitability(rows,"'&or=(active.eq.true)").length,0);
  assert.equal(findCustomerProfitability(rows,'C-1')[0].name,'شركة آمنة');
  const source=read('api/_lib/customer-profitability.js');
  assert.match(source,/findCustomerProfitability/);
  assert.doesNotMatch(source,/customer_name=ilike\.\$\{/);
  assert.match(source,/الربحية تقديرية/);
});
