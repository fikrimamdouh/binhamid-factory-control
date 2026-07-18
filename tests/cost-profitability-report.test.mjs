import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderCostProfitabilityHtml } from '../api/_lib/cost-profitability-report.js';

const read=path=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const report={period:'2026-07',generatedAt:'2026-07-18T10:00:00.000Z',periodStatus:'approved',decisionReady:false,customerCount:2,products:[{costCenter:'block',quantity:100,revenue:1000,actualCost:700,unitCost:7,averageSalePrice:10,grossMargin:300,marginRate:30}],vehicles:[{label:'1234 <script>',workers:['سائق'],fuel:100,fuelLiters:50,maintenance:20,maintenanceOrders:1,trips:2,distance:100,distanceReliable:true,operatingCost:500,costPerKm:5}],vehiclesWithoutTrips:[],unreliableOdometers:[],workers:[{name:'عامل',vehicle:'1234',monthlyCost:3000,attendanceDays:20,completedTrips:2,responsibleFuelCost:100,responsibleFuelLiters:50}],negativeCustomers:[{code:'C1',name:'عميل <img>',netSalesBeforeVat:100,estimatedCost:120,profit:-20,marginRate:-20,balance:50}],bestCustomers:[{code:'C2',name:'عميل جيد',netSalesBeforeVat:500,estimatedCost:300,profit:200,marginRate:40,collectionDaysEstimate:6}],mixes:[{mix_design_id:'m1',code:'C30',name:'خلطة',version_no:1,price_date:'2026-07-01',total_cost_per_m3:150,recommended_price:200,target_margin_percent:25}],comparisons:[{code:'C30',name:'خلطة',standardCost:150,actualCost:160,variance:10,variancePercent:6.67}],breakEven:[{costCenter:'block',revenue:1000,directCost:500,indirectCost:200,breakEvenRevenue:400,breakEvenUnits:40}],quality:{blockers:['بيانات ناقصة <script>']},customerDisclaimer:'تقرير تقديري',pdfStatus:{configured:false}};

test('comprehensive cost HTML escapes database and user-controlled content',()=>{
  const html=renderCostProfitabilityHtml(report);
  assert.match(html,/تقرير التكلفة والربحية الشامل/);
  assert.match(html,/1234 &lt;script&gt;/);
  assert.match(html,/عميل &lt;img&gt;/);
  assert.doesNotMatch(html,/1234 <script>/);
  assert.doesNotMatch(html,/عميل <img>/);
});

test('comprehensive report includes products vehicles customers mixes break-even and data quality',()=>{
  const html=renderCostProfitabilityHtml(report);
  for(const marker of ['تكلفة المنتجات وربحيتها','أعلى المركبات تكلفة','أعلى الموظفين تكلفة','العملاء ذوو الهامش السالب','أفضل العملاء ربحية','تكلفة الخلطات المعتمدة','المعياري مقابل الفعلي للخرسانة','نقطة التعادل','جودة البيانات وموانع القرار'])assert.match(html,new RegExp(marker));
});

test('cost API returns report data when PDF provider is unavailable instead of failing calculation',()=>{
  const route=read('api/_lib/routes/costs.js'),service=read('api/_lib/cost-profitability-report.js');
  assert.match(route,/action==='comprehensive_pdf'/);
  assert.match(route,/if\(!result\.pdf\)return json\(res,200/);
  assert.match(service,/catch\(error\)\{return\{ok:true,pdf:false/);
  assert.match(service,/pdfError/);
});

test('cost and mix workspaces use protected endpoints and safe DOM rendering',()=>{
  const costPage=read('cost-reports.html'),mixPage=read('mix-designs.html');
  assert.match(costPage,/\/api\/costs/);
  assert.match(costPage,/comprehensive_pdf/);
  assert.match(mixPage,/\/api\/mix-designs/);
  assert.match(mixPage,/material_create/);
  assert.match(mixPage,/design_clone/);
  assert.match(mixPage,/item_upsert/);
  assert.match(mixPage,/overhead_upsert/);
  assert.match(mixPage,/action:'approve'/);
  assert.doesNotMatch(costPage,/\.innerHTML\s*=/);
  assert.doesNotMatch(mixPage,/\.innerHTML\s*=/);
});
