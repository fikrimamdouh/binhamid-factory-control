import test from 'node:test';
import assert from 'node:assert/strict';
import { earliestPortfolioSector, resolveCustomerPortfolioOwner } from '../shared/customer-portfolio-ownership.js';
import { renderCustomerPortfolioDeclaration } from '../shared/customer-portfolio-declaration.js';

const employees=[
  {id:'rep-block',name:'مندوب البلوك',role:'مسؤول مبيعات البلوك'},
  {id:'rep-concrete',name:'مندوب الخرسانة',role:'مسؤول مبيعات الخرسانة'}
];

test('master sector owns the customer even when the current invoice belongs to the other sector',()=>{
  const owner=resolveCustomerPortfolioOwner({customer:{seg:'خرسانة',rep:'rep-concrete'},employees,historySales:[{sales_type:'block',delivery_date:'2026-07-26'}],fallbackSector:'block'});
  assert.equal(owner.sector,'concrete');
  assert.equal(owner.source,'customer_segment');
  assert.equal(owner.employee.name,'مندوب الخرسانة');
});

test('assigned representative resolves an old both-sector customer before invoice fallback',()=>{
  const owner=resolveCustomerPortfolioOwner({customer:{seg:'الاثنين',rep:'rep-concrete'},employees,historySales:[{sales_type:'block',delivery_date:'2026-07-01'}],fallbackSector:'block'});
  assert.equal(owner.sector,'concrete');
  assert.equal(owner.source,'assigned_representative');
});

test('earliest sale is a deterministic fallback for an unassigned customer',()=>{
  const sales=[
    {sales_type:'block',delivery_date:'2026-07-26',reference_no:'18452'},
    {sales_type:'concrete',delivery_date:'2026-06-12',reference_no:'17001'}
  ];
  assert.equal(earliestPortfolioSector(sales),'concrete');
  assert.equal(resolveCustomerPortfolioOwner({customer:{seg:'الاثنين'},historySales:sales,fallbackSector:'block'}).sector,'concrete');
});

test('declaration renders cross-sector purchases separately without adding them to primary customer count',()=>{
  const rendered=renderCustomerPortfolioDeclaration({
    type:'block',
    employee:{name:'مندوب البلوك'},
    customers:[{name:'عميل بلوك',code:'B1'}],
    crossSectorPurchases:[{name:'عميل خرسانة',code:'C1',ownerSectorLabel:'الخرسانة',ownerEmployeeName:'مندوب الخرسانة',amount:1800,invoices:[{invoice:'18451'}]}],
    dateGregorian:'2026-07-26'
  });
  assert.equal(rendered.model.customers.length,1);
  assert.equal(rendered.model.crossSectorPurchases.length,1);
  assert.match(rendered.document,/مبيعات لعملاء تابعين للقطاع الآخر/);
  assert.match(rendered.document,/عميل خرسانة/);
  assert.match(rendered.document,/1,800/);
  assert.match(rendered.document,/لا تنشئ عميلاً جديدًا ولا تنقل العميل/);
  assert.match(rendered.document,/مسؤولية فاتورة القطاع البائع فقط/);
});
