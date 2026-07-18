import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { breakEvenEconomics, costDataQuality, productEconomics, tripEconomics, vehicleEconomics, workerEconomics } from '../api/_lib/bot-costs-data.js';

const source=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
const baseData=()=>({
  period:'2026-07',
  report:{
    period:{status:'approved'},
    economics:{
      block:{costCenter:'block',revenue:10000,actualCost:7000,quantity:1000,unitCost:7,averageSalePrice:10,grossMargin:3000,marginPerUnit:3,directCost:5000,indirectCost:2000,unclassifiedCost:0,completenessPercent:100,reliable:true},
      concrete:{costCenter:'concrete',revenue:20000,actualCost:15000,quantity:100,unitCost:150,averageSalePrice:200,grossMargin:5000,marginPerUnit:50,directCost:12000,indirectCost:3000,unclassifiedCost:0,completenessPercent:100,reliable:true}
    }
  },
  setup:{assetAssignments:[{asset_external_id:'V1'}],employeeAssignments:[{employee_external_id:'E1'}]},
  ledger:[
    {entry_type:'direct_cost',source_type:'driver_fuel_event',amount:600,metadata:{vehicle_external_id:'V1'}},
    {entry_type:'direct_cost',source_type:'maintenance_order',amount:400,metadata:{vehicle_external_id:'V1'}},
    {entry_type:'direct_cost',source_type:'salary_allocation',amount:3000,metadata:{employee_external_id:'E1'}}
  ],
  driverEvents:[
    {app_user_id:'U1',employee_external_id:'E1',vehicle_external_id:'V1',event_type:'trip_end',odometer:1000},
    {app_user_id:'U1',employee_external_id:'E1',vehicle_external_id:'V1',event_type:'trip_end',odometer:1200}
  ],
  attendance:[
    {app_user_id:'U1',employee_external_id:'E1',event_type:'check_in',occurred_at:'2026-07-01T05:00:00Z'},
    {app_user_id:'U1',employee_external_id:'E1',event_type:'check_in',occurred_at:'2026-07-02T05:00:00Z'}
  ],
  employees:[{external_id:'E1',full_name:'سائق تجريبي',salary:3500}],
  assignments:[{app_user_id:'U1',employee_external_id:'E1',vehicle_external_id:'V1'}],
  vehicles:[{external_id:'V1',plate_no:'1234'}]
});

test('product economics exposes margin and price gap without inventing target margin',()=>{
  const rows=productEconomics(baseData());
  assert.equal(rows.length,2);
  assert.equal(rows[0].marginRate,30);
  assert.equal(rows[0].priceGap,3);
});

test('vehicle and trip costs combine recorded fuel, maintenance and linked labor',()=>{
  const data=baseData(),vehicles=vehicleEconomics(data),trip=tripEconomics(data);
  assert.equal(vehicles[0].label,'1234');
  assert.equal(vehicles[0].direct,1000);
  assert.equal(vehicles[0].labor,3000);
  assert.equal(vehicles[0].operatingCost,4000);
  assert.equal(vehicles[0].costPerTrip,2000);
  assert.equal(vehicles[0].costPerKm,20);
  assert.equal(trip.averageTripCost,2000);
});

test('worker costs use calculated salary allocation and operational denominators',()=>{
  const worker=workerEconomics(baseData())[0];
  assert.equal(worker.monthlyCost,3000);
  assert.equal(worker.costSource,'cost_engine');
  assert.equal(worker.attendanceDays,2);
  assert.equal(worker.completedTrips,2);
  assert.equal(worker.costPerDay,1500);
  assert.equal(worker.costPerTrip,1500);
});

test('break-even uses indirect cost divided by contribution margin ratio',()=>{
  const rows=breakEvenEconomics(baseData());
  assert.equal(rows[0].breakEvenRevenue,4000);
  assert.equal(rows[0].breakEvenUnits,400);
});

test('cost decision is blocked when assignments or trip evidence are incomplete',()=>{
  const data=baseData();
  data.setup={assetAssignments:[],employeeAssignments:[]};
  data.driverEvents=[{event_type:'trip_end',vehicle_external_id:'',odometer:0}];
  const quality=costDataQuality(data);
  assert.equal(quality.reliable,false);
  assert.equal(quality.missingAssets.length,1);
  assert.equal(quality.missingEmployees.length,1);
  assert.equal(quality.tripsWithoutVehicle,1);
  assert.equal(quality.tripsWithoutOdometer,1);
});

test('Telegram menu and command routing expose each cost view only to its intended roles',async()=>{
  const enterprise=await source('api/_lib/bot-enterprise.js'),costs=await source('api/_lib/bot-costs.js'),help=await source('api/_lib/bot-help.js');
  assert.match(enterprise,/التكاليف والربحية/);
  assert.match(enterprise,/handleCostTextCommand/);
  assert.match(enterprise,/handleCostCallback/);
  for(const marker of ['cost_decision','cost_products','cost_trips','cost_vehicles','cost_workers','cost_breakeven','cost_quality','cost_customer','cost_mixes'])assert.ok(costs.includes(marker),`missing ${marker}`);
  assert.match(costs,/STANDARD_ROLES=new Set\(\['admin','manager','accountant','hr'\]\)/);
  assert.match(costs,/CUSTOMER_ROLES=new Set\(\['admin','manager','accountant'\]\)/);
  assert.match(costs,/MIX_ROLES=new Set\(\['admin','manager','accountant','quality','concrete_sales'\]\)/);
  assert.match(costs,/identity\.role==='concrete_sales'/);
  assert.match(help,/\/costs — نظام التكاليف والقرار/);
});
