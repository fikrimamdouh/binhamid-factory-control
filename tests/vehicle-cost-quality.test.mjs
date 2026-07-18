import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeOdometer, tripEconomics, vehicleEconomics, workerEconomics } from '../api/_lib/bot-costs-data.js';

const base=()=>({
  setup:{assetAssignments:[{asset_external_id:'V1'}],employeeAssignments:[{employee_external_id:'E1'}]},
  report:{period:{status:'approved'},economics:{}},
  ledger:[
    {entry_type:'direct_cost',source_type:'driver_fuel_event',source_reference:'F1',amount:600,quantity:300,metadata:{vehicle_external_id:'V1'}},
    {entry_type:'direct_cost',source_type:'maintenance_order',source_reference:'M1',amount:400,metadata:{vehicle_external_id:'V1'}},
    {entry_type:'direct_cost',source_type:'maintenance_order',source_reference:'M2',amount:100,metadata:{vehicle_external_id:'V1'}},
    {entry_type:'direct_cost',source_type:'salary_allocation',source_reference:'S1',amount:3000,metadata:{employee_external_id:'E1'}}
  ],
  driverEvents:[
    {app_user_id:'U1',employee_external_id:'E1',vehicle_external_id:'V1',event_type:'fuel',fuel_amount:600,fuel_liters:300,odometer:1000,occurred_at:'2026-07-01T06:00:00Z'},
    {app_user_id:'U1',employee_external_id:'E1',vehicle_external_id:'V1',event_type:'trip_end',odometer:1100,occurred_at:'2026-07-02T06:00:00Z'},
    {app_user_id:'U1',employee_external_id:'E1',vehicle_external_id:'V1',event_type:'trip_end',odometer:1200,occurred_at:'2026-07-03T06:00:00Z'}
  ],
  attendance:[],
  employees:[{external_id:'E1',full_name:'سائق',salary:3500}],
  assignments:[{app_user_id:'U1',employee_external_id:'E1',vehicle_external_id:'V1'}],
  vehicles:[{external_id:'V1',plate_no:'1234',asset_no:'A-1',vehicle_type:'خلاطة'}]
});

test('ordered odometer analysis accepts plausible positive movement',()=>{
  const result=analyzeOdometer([
    {odometer:1200,occurred_at:'2026-07-03T06:00:00Z'},
    {odometer:1000,occurred_at:'2026-07-01T06:00:00Z'},
    {odometer:1100,occurred_at:'2026-07-02T06:00:00Z'}
  ]);
  assert.equal(result.distance,200);
  assert.equal(result.reliable,true);
  assert.equal(result.decreases,0);
  assert.equal(result.jumps,0);
});

test('odometer decrease is detected and blocks cost per kilometre',()=>{
  const result=analyzeOdometer([
    {odometer:1000,occurred_at:'2026-07-01T00:00:00Z'},
    {odometer:900,occurred_at:'2026-07-02T00:00:00Z'},
    {odometer:950,occurred_at:'2026-07-03T00:00:00Z'}
  ]);
  assert.equal(result.decreases,1);
  assert.equal(result.distance,50);
  assert.equal(result.reliable,false);
  assert.equal(result.reason,'odometer_decrease');
});

test('unreasonable odometer jump is ignored and blocks cost per kilometre',()=>{
  const result=analyzeOdometer([
    {odometer:1000,occurred_at:'2026-07-01T00:00:00Z'},
    {odometer:10000,occurred_at:'2026-07-01T01:00:00Z'}
  ]);
  assert.equal(result.jumps,1);
  assert.equal(result.distance,0);
  assert.equal(result.reliable,false);
  assert.equal(result.reason,'unreasonable_jump');
});

test('vehicle report includes fuel litres maintenance orders and reliable distance',()=>{
  const row=vehicleEconomics(base())[0];
  assert.equal(row.fuel,600);
  assert.equal(row.fuelLiters,300);
  assert.equal(row.maintenance,500);
  assert.equal(row.maintenanceOrders,2);
  assert.equal(row.distance,200);
  assert.equal(row.distanceReliable,true);
  assert.equal(row.costPerKm,20.5);
});

test('driver fuel is a responsibility metric and is not added to salary cost',()=>{
  const row=workerEconomics(base())[0];
  assert.equal(row.monthlyCost,3000);
  assert.equal(row.responsibleFuelCost,600);
  assert.equal(row.responsibleFuelLiters,300);
  assert.equal(row.fuelEvents,1);
});

test('trip average kilometre cost excludes vehicles with unreliable odometers',()=>{
  const data=base();
  data.driverEvents[2].odometer=800;
  const vehicle=vehicleEconomics(data)[0],trip=tripEconomics(data);
  assert.equal(vehicle.distanceReliable,false);
  assert.equal(vehicle.costPerKm,null);
  assert.equal(trip.averageKmCost,null);
  assert.equal(trip.unreliableDistanceVehicles,1);
});
