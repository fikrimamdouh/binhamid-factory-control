import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildCustomerAnalytics, customerReportScope, extractStateCustomerData, findCustomers } from '../api/_lib/bot-customer-report-data.js';
import { cleanProductResearchText, collectResearchSources, validateProductQuery } from '../api/_lib/product-market-research.js';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('customer analytics combines opening balances, sales, collections, aging and credits',()=>{
  const analytics=buildCustomerAnalytics({
    role:'admin',asOf:new Date('2026-05-15T00:00:00Z'),
    customers:[{external_id:'1001',customer_code:'1001',customer_name:'مصنع الأمل',credit_limit:900,payment_days:30}],
    openingBalances:[{customer_code:'1001',customer_name:'مصنع الأمل',amount:300,balance_date:'2025-12-31',segment:'الاثنين'}],
    sales:[{reference_no:'S1',sales_type:'block',customer_external_id:'1001',customer_name:'مصنع الأمل',item:'بلوك 20',total_amount:1500,paid_amount:500,status:'registered',delivery_date:'2026-01-01',created_at:'2026-01-01T09:00:00Z'}],
    collections:[{reference_no:'C1',customer_external_id:'1001',customer_name:'مصنع الأمل',amount:600,allocated_amount:500,unallocated_amount:100,status:'recorded',occurred_at:'2026-02-01T09:00:00Z'}]
  });
  assert.equal(analytics.rows.length,1);
  const row=analytics.rows[0];
  assert.equal(row.openingBalance,300);
  assert.equal(row.grossSales,1500);
  assert.equal(row.paidApplied,500);
  assert.equal(row.salesOutstanding,1000);
  assert.equal(row.balance,1200);
  assert.equal(row.collections,600);
  assert.equal(row.unallocatedCredit,100);
  assert.equal(row.aging.days90plus,1200);
  assert.equal(row.overdue,1200);
  assert.equal(row.decision,'stop');
  assert.equal(analytics.totals.openingDebit,300);
  assert.equal(analytics.totals.stopped,1);
});

test('opening credit offsets later sales and becomes a customer credit when larger',()=>{
  const analytics=buildCustomerAnalytics({
    role:'admin',asOf:new Date('2026-07-19T00:00:00Z'),
    customers:[{external_id:'2001',customer_code:'2001',customer_name:'عميل مقدم'}],
    openingBalances:[{customer_code:'2001',customer_name:'عميل مقدم',amount:-1000,balance_date:'2026-07-01',segment:'الاثنين'}],
    sales:[{reference_no:'S1',sales_type:'concrete',customer_external_id:'2001',customer_name:'عميل مقدم',total_amount:400,paid_amount:0,status:'registered',delivery_date:'2026-07-10'}],collections:[]
  });
  const row=analytics.rows[0];
  assert.equal(row.balance,0);
  assert.equal(row.creditBalance,600);
  assert.equal(row.netBalance,-600);
  assert.equal(row.overdue,0);
  assert.equal(analytics.totals.creditBalance,600);
});

test('sales roles only see their customer sales and opening-balance scope',()=>{
  const input={
    customers:[{external_id:'B',customer_name:'عميل بلوك'},{external_id:'C',customer_name:'عميل خرسانة'}],
    sales:[
      {reference_no:'B1',sales_type:'block',customer_external_id:'B',customer_name:'عميل بلوك',total_amount:100,paid_amount:0,status:'registered',delivery_date:'2026-07-01'},
      {reference_no:'C1',sales_type:'concrete',customer_external_id:'C',customer_name:'عميل خرسانة',total_amount:200,paid_amount:0,status:'registered',delivery_date:'2026-07-01'}
    ],
    openingBalances:[
      {customer_code:'B',customer_name:'عميل بلوك',amount:50,balance_date:'2026-06-30',segment:'بلوك'},
      {customer_code:'C',customer_name:'عميل خرسانة',amount:70,balance_date:'2026-06-30',segment:'خرسانة'}
    ],collections:[],asOf:new Date('2026-07-10T00:00:00Z')
  };
  const block=buildCustomerAnalytics({...input,role:'block_sales'}),concrete=buildCustomerAnalytics({...input,role:'concrete_sales'});
  assert.deepEqual(block.rows.map(x=>x.code),['B']);
  assert.deepEqual(concrete.rows.map(x=>x.code),['C']);
  assert.equal(block.rows[0].balance,150);
  assert.equal(concrete.rows[0].balance,270);
  assert.equal(customerReportScope('collector'),'all');
});

test('state snapshot exposes legacy customers and imported opening balances to Telegram reports',()=>{
  const result=extractStateCustomerData({
    legacy:{cli:[{id:'client-1',code:'10001',name:'مؤسسة بن حامد',tel:'0500000000',seg:'الاثنين',cap:5000,days:30}]},
    ops:{settings:{customerCodeMap:{10001:'client-1'}},customerOpeningBalances:[{clientId:'client-1',customerCode:'10001',customerName:'مؤسسة بن حامد',amount:-1093551.48,date:'2026-07-19',sourceFormat:'old_trial_balance'}]}
  });
  assert.equal(result.customers[0].customer_code,'10001');
  assert.equal(result.openingBalances[0].amount,-1093551.48);
  assert.equal(result.openingBalances[0].source_format,'old_trial_balance');
});

test('customer lookup prioritizes exact code and supports Arabic name',()=>{
  const analytics=buildCustomerAnalytics({role:'admin',customers:[{external_id:'1001',customer_code:'1001',customer_name:'مصنع الأمل'}],openingBalances:[{customer_code:'1001',customer_name:'مصنع الأمل',amount:100,balance_date:'2026-07-01'}],sales:[],collections:[],asOf:new Date('2026-07-10T00:00:00Z')});
  assert.equal(findCustomers(analytics,'1001')[0].name,'مصنع الأمل');
  assert.equal(findCustomers(analytics,'الأمل')[0].code,'1001');
});

test('product research cleans citations and extracts safe unique sources',()=>{
  const data={output:[
    {type:'web_search_call',action:{sources:[{url:'https://store.example/a',title:'Store A'}]}},
    {type:'message',content:[{type:'output_text',text:'السعر **100 ريال** citex',annotations:[{type:'url_citation',url:'https://store.example/a',title:'Duplicate'},{type:'url_citation',url:'https://store.example/b',title:'Store B'}]}]}
  ]};
  assert.equal(cleanProductResearchText('السعر **100 ريال** citex'),'السعر 100 ريال');
  assert.deepEqual(collectResearchSources(data).map(x=>x.url),['https://store.example/a','https://store.example/b']);
  assert.equal(validateProductQuery('6205 SKF'),'6205 SKF');
  assert.throws(()=>validateProductQuery('gun ammo'),/مخصص للمشتريات/);
});

test('Telegram menu exposes professional customer reports and sourced product assistant',async()=>{
  const [enterprise,reports,procurement,gateway,help]=await Promise.all([
    read('api/_lib/bot-enterprise.js'),read('api/_lib/bot-customer-reports.js'),read('api/_lib/bot-procurement-secure.js'),read('api/_lib/telegram-webhook-gateway.js'),read('api/_lib/bot-help.js')
  ]);
  for(const marker of ['ent:customer_menu','handleCustomerReportTextCommand','continueCustomerReportSession'])assert.ok(enterprise.includes(marker),`missing ${marker}`);
  for(const marker of ['customer_balances','customer_sales','كشف حساب عميل','أكبر العملاء مبيعات','رصيد العميل'])assert.ok(reports.includes(marker),`missing ${marker}`);
  for(const marker of ['proc:product','handleProductTextCommand','product_market_query'])assert.ok(procurement.includes(marker),`missing ${marker}`);
  assert.ok(gateway.includes("state==='product_market_query'"));
  assert.ok(gateway.includes('productPriceText'));
  assert.ok(!gateway.includes("state.startsWith('product_')"));
  assert.ok(help.includes('/customers'));
  assert.ok(help.includes('/products'));
});

test('OpenAuth assessment records the safe adoption decision',async()=>{
  const doc=await read('docs/OPENAUTH_ASSESSMENT_AR.md');
  for(const marker of ['OAuth 2.0','لا يدير سجل المستخدمين','خدمة مستقلة','app_users','Beta'])assert.ok(doc.includes(marker),`missing ${marker}`);
});
