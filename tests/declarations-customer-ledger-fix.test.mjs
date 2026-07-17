import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../assets/declarations-customer-ledger-fix.js',import.meta.url),'utf8');
function helpers(){const context={console,setInterval:()=>1,setTimeout:()=>1,clearInterval:()=>{}};context.globalThis=context;vm.runInNewContext(source,context);return context.BinHamidDeclarationsCustomerFix;}

function fixture(){
  const blockEmployee={id:'emp-block',name:'مسؤول البلوك',role:'مسؤول مبيعات البلوك',act:true};
  const D={cfg:{days:3},emp:[blockEmployee],cli:[
    {id:'client-master',name:'مؤسسة العميل الأول',code:'C-101',seg:'بلوك',rep:blockEmployee.id},
    {id:'client-imported',name:'مؤسسة العميل الأول',code:'C-101',seg:'بلوك'}
  ]};
  const OPS={settings:{blockSalesEmployeeId:blockEmployee.id},imports:[{id:'batch-1',reportDate:'2026-07-16',blockEmployeeId:'deleted-employee',blockSalesCount:0}],deliveries:[
    {id:'sale-1',sourceImportId:'batch-1',clientId:'client-imported',customerCode:'C-101',customerName:'مؤسسة العميل الأول',product:'بلوك أسود 20',quantity:700,amount:1260,cash:160,transfer:100,credit:1000,date:'2026-07-16',status:'delivered',employeeId:'deleted-employee'}
  ],collections:[
    {id:'payment-1',clientId:'client-imported',customerCode:'C-101',customer:'مؤسسة العميل الأول',amount:400,date:'2026-07-17',method:'نقدي'}
  ]};
  return{D,OPS,blockEmployee};
}

test('customer ledger matches imported movements by customer code when client ids differ',()=>{
  const api=helpers(),{D,OPS}=fixture(),ledger=api.buildClientLedger({D,OPS},'client-master');
  assert.equal(ledger.sales,1260);
  assert.equal(ledger.immediate,260);
  assert.equal(ledger.collections,400);
  assert.equal(ledger.paid,660);
  assert.equal(ledger.remaining,600);
  assert.equal(ledger.selected.length,1);
});

test('customer ledger counts overpayments as customer credit without a negative receivable',()=>{
  const api=helpers(),{D,OPS}=fixture();
  OPS.collections.push({id:'payment-2',customerCode:'C-101',customerName:'مؤسسة العميل الأول',amount:1000,date:'2026-07-18',method:'نقاط بيع'});
  const ledger=api.buildClientLedger({D,OPS},'client-master');
  assert.equal(ledger.paid,1660);
  assert.equal(ledger.remaining,0);
  assert.equal(ledger.creditBalance,400);
});

test('block imports and sales are relinked when the stored employee id no longer exists',()=>{
  const api=helpers(),{D,OPS,blockEmployee}=fixture(),result=api.reconcileSalesEmployees({D,OPS},{block:blockEmployee});
  assert.ok(result.changes>=2);
  assert.equal(OPS.imports[0].blockEmployeeId,blockEmployee.id);
  assert.equal(OPS.imports[0].blockSalesCount,1);
  assert.equal(OPS.deliveries[0].employeeId,blockEmployee.id);
});

test('block customer portfolio includes activity linked through customer code and assigned representative',()=>{
  const api=helpers(),{D,OPS,blockEmployee}=fixture();
  api.reconcileSalesEmployees({D,OPS},{block:blockEmployee});
  const portfolio=api.clientPortfolioForEmployee({D,OPS},blockEmployee,'بلوك');
  const client=portfolio.find(row=>row.id==='client-master');
  assert.ok(client);
  assert.equal(client._portfolioSales,1260);
  assert.equal(client._portfolioSegment,'بلوك');
});

test('script stays external and is injected after the existing daily import bridge',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const existing=html.indexOf('binhamid-existing-daily-import-fix');
  const ledger=html.indexOf('binhamid-declarations-customer-ledger-fix');
  assert.ok(existing>=0);
  assert.ok(ledger>existing);
  assert.match(html,/declarations-customer-ledger-fix\.js/);
});
