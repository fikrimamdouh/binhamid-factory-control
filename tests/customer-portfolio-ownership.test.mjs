import test from 'node:test';
import assert from 'node:assert/strict';
import { earliestPortfolioSector, resolveCustomerPortfolioOwner, salePortfolioSector } from '../shared/customer-portfolio-ownership.js';
import { renderCustomerPortfolioDeclaration } from '../shared/customer-portfolio-declaration.js';

const employees=[
  {id:'rep-block',name:'مندوب البلوك',role:'مسؤول مبيعات البلوك'},
  {id:'rep-concrete',name:'مندوب الخرسانة',role:'مسؤول مبيعات الخرسانة'}
];

test('assigned representative owns the customer when the stored segment is stale',()=>{
  const owner=resolveCustomerPortfolioOwner({customer:{seg:'بلوك',rep:'rep-concrete'},employees,historySales:[{sales_type:'block',item:'خرسانة 9 كيس',delivery_date:'2026-07-26'}],fallbackSector:'block'});
  assert.equal(owner.sector,'concrete');
  assert.equal(owner.source,'assigned_representative');
  assert.equal(owner.employee.name,'مندوب الخرسانة');
});

test('explicit primary sector remains stronger than representative and invoice type',()=>{
  const owner=resolveCustomerPortfolioOwner({customer:{primarySector:'خرسانة',seg:'بلوك',rep:'rep-block'},employees,historySales:[{sales_type:'block',delivery_date:'2026-07-26'}],fallbackSector:'block'});
  assert.equal(owner.sector,'concrete');
  assert.equal(owner.source,'explicit_primary_sector');
});

test('assigned representative resolves an old both-sector customer before invoice fallback',()=>{
  const owner=resolveCustomerPortfolioOwner({customer:{seg:'الاثنين',rep:'rep-concrete'},employees,historySales:[{sales_type:'block',delivery_date:'2026-07-01'}],fallbackSector:'block'});
  assert.equal(owner.sector,'concrete');
  assert.equal(owner.source,'assigned_representative');
});

test('item description overrides a conflicting stored sales type in both directions',()=>{
  assert.equal(salePortfolioSector({sales_type:'block',item:'خرسانة 9 كيس'}),'concrete');
  assert.equal(salePortfolioSector({sales_type:'concrete',item:'بلك اسود مقاس 40*20*20'}),'block');
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
  assert.match(rendered.document,/عملاء تابعون لقطاع آخر اشتروا من البلوك|مبيعات لعملاء تابعين للقطاع الآخر/);
  assert.match(rendered.document,/عميل خرسانة/);
  assert.match(rendered.document,/1,800/);
  assert.match(rendered.document,/لا تنشئ عميلاً جديدًا ولا تنقل العميل/);
  assert.match(rendered.document,/مسؤولية فاتورة القطاع البائع فقط/);
});
