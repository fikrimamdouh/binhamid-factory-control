import { getCostReport, getCostSetup } from './cost-engine.js';
import { requiredSelect } from './required-data.js';

const n=value=>{const parsed=Number(value||0);return Number.isFinite(parsed)?parsed:0;};
const meta=row=>row?.metadata&&typeof row.metadata==='object'?row.metadata:{};
const total=(rows,pick)=>rows.reduce((sum,row)=>sum+n(pick(row)),0);
const text=(...values)=>values.map(value=>String(value||'').trim()).find(Boolean)||'';

export function currentCostPeriod(){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit'}).formatToParts(new Date());
  return `${parts.find(x=>x.type==='year')?.value}-${parts.find(x=>x.type==='month')?.value}`;
}
export function normalizeCostPeriod(value){
  const match=String(value||'').match(/(20\d{2})[-/](0?[1-9]|1[0-2])/);
  return match?`${match[1]}-${String(match[2]).padStart(2,'0')}`:currentCostPeriod();
}
function bounds(period){
  const [year,month]=period.split('-').map(Number),next=new Date(Date.UTC(year,month,1));
  return{start:`${period}-01`,next:next.toISOString().slice(0,10)};
}

export async function loadCostDecisionData(periodValue){
  const period=normalizeCostPeriod(periodValue),{start,next}=bounds(period),range=`occurred_at=gte.${start}T00:00:00Z&occurred_at=lt.${next}T00:00:00Z`;
  const [report,setup,ledger,driverEvents,attendance,employees,assignments,vehicles]=await Promise.all([
    getCostReport(period),
    getCostSetup(),
    requiredSelect('cost_ledger',`period_start=eq.${start}&posted_status=eq.posted&select=entry_type,cost_center,source_type,source_reference,amount,quantity,metadata,occurred_at&order=occurred_at.asc&limit=5000`,'دفتر التكلفة المرحّل','COST_LEDGER_READ_FAILED'),
    requiredSelect('driver_events',`${range}&select=app_user_id,employee_external_id,vehicle_external_id,event_type,odometer,fuel_liters,fuel_amount,occurred_at&order=occurred_at.asc&limit=5000`,'حركات السائقين والديزل','COST_DRIVER_EVENTS_READ_FAILED'),
    requiredSelect('attendance_events',`${range}&select=app_user_id,employee_external_id,event_type,occurred_at&order=occurred_at.asc&limit=5000`,'حضور الموظفين','COST_ATTENDANCE_READ_FAILED'),
    requiredSelect('employees','active=eq.true&select=external_id,employee_no,full_name,salary,role&order=full_name.asc&limit=5000','سجل الموظفين','COST_EMPLOYEES_READ_FAILED'),
    requiredSelect('employee_assignments','active=eq.true&select=app_user_id,employee_external_id,vehicle_external_id,job_title&limit=5000','روابط الموظفين بالمركبات','COST_ASSIGNMENTS_READ_FAILED'),
    requiredSelect('vehicles','active=eq.true&select=external_id,plate_no,asset_no,vehicle_type,make,model,status&limit=5000','سجل المركبات','COST_VEHICLES_READ_FAILED')
  ]);
  return{period,start,next,report,setup,ledger,driverEvents,attendance,employees,assignments,vehicles};
}

export function productEconomics(data){
  return['block','concrete'].map(code=>data.report.economics?.[code]).filter(Boolean).map(item=>{
    const marginRate=item.revenue>0?(item.grossMargin/item.revenue)*100:null;
    const priceGap=item.quantity>0?item.averageSalePrice-item.unitCost:null;
    return{...item,marginRate,priceGap};
  });
}

function workerIndexes(data){
  const byExternal=new Map(data.employees.map(row=>[String(row.external_id),row]));
  const assignmentByUser=new Map(data.assignments.map(row=>[String(row.app_user_id),row]));
  const salaryByEmployee=new Map(),daysByEmployee=new Map(),tripsByEmployee=new Map(),fuelByEmployee=new Map();
  for(const row of data.ledger){
    if(row.source_type!=='salary_allocation')continue;
    const key=String(meta(row).employee_external_id||'');
    if(key)salaryByEmployee.set(key,(salaryByEmployee.get(key)||0)+n(row.amount));
  }
  for(const row of data.attendance){
    const assignment=assignmentByUser.get(String(row.app_user_id));
    const key=String(row.employee_external_id||assignment?.employee_external_id||'');
    if(!key)continue;
    if(!daysByEmployee.has(key))daysByEmployee.set(key,new Set());
    daysByEmployee.get(key).add(String(row.occurred_at||'').slice(0,10));
  }
  for(const row of data.driverEvents){
    const assignment=assignmentByUser.get(String(row.app_user_id));
    const key=String(row.employee_external_id||assignment?.employee_external_id||'');
    if(!key)continue;
    if(row.event_type==='trip_end')tripsByEmployee.set(key,(tripsByEmployee.get(key)||0)+1);
    if(n(row.fuel_amount)>0||n(row.fuel_liters)>0){const current=fuelByEmployee.get(key)||{amount:0,liters:0,events:0};current.amount+=n(row.fuel_amount);current.liters+=n(row.fuel_liters);current.events+=1;fuelByEmployee.set(key,current);}
  }
  return{byExternal,salaryByEmployee,daysByEmployee,tripsByEmployee,fuelByEmployee};
}

export function workerEconomics(data){
  const indexes=workerIndexes(data),costAssigned=new Set((data.setup.employeeAssignments||[]).map(row=>String(row.employee_external_id))),vehicleByEmployee=new Map(data.assignments.map(row=>[String(row.employee_external_id||''),String(row.vehicle_external_id||'')]));
  return data.employees.map(employee=>{
    const key=String(employee.external_id),allocated=indexes.salaryByEmployee.get(key),monthlyCost=allocated===undefined?n(employee.salary):allocated,attendanceDays=indexes.daysByEmployee.get(key)?.size||0,completedTrips=indexes.tripsByEmployee.get(key)||0,fuel=indexes.fuelByEmployee.get(key)||{amount:0,liters:0,events:0};
    return{key,name:employee.full_name||employee.employee_no||key,vehicle:vehicleByEmployee.get(key)||'',monthlyCost,costSource:allocated===undefined?'salary_master':'cost_engine',attendanceDays,completedTrips,costPerDay:attendanceDays?monthlyCost/attendanceDays:null,costPerTrip:completedTrips?monthlyCost/completedTrips:null,costAssigned:costAssigned.has(key),responsibleFuelCost:fuel.amount,responsibleFuelLiters:fuel.liters,fuelEvents:fuel.events};
  }).sort((a,b)=>b.monthlyCost-a.monthlyCost);
}

export function analyzeOdometer(events=[],options={}){
  const maxKmPerDay=n(options.maxKmPerDay)||2000,minJumpThreshold=n(options.minJumpThreshold)||500;
  const readings=(events||[]).map((row,index)=>({value:n(row.odometer),time:Date.parse(row.occurred_at||''),index})).filter(row=>row.value>0).sort((a,b)=>Number.isFinite(a.time)&&Number.isFinite(b.time)?a.time-b.time:a.index-b.index);
  if(readings.length<2)return{distance:0,reliable:false,readingCount:readings.length,decreases:0,jumps:0,ignored:0,reason:'insufficient_readings'};
  let distance=0,decreases=0,jumps=0,ignored=0,previous=readings[0];
  for(let index=1;index<readings.length;index++){
    const current=readings[index],delta=current.value-previous.value;
    if(delta<0){decreases+=1;ignored+=1;previous=current;continue;}
    if(delta===0){previous=current;continue;}
    const elapsedDays=Number.isFinite(current.time)&&Number.isFinite(previous.time)&&current.time>previous.time?(current.time-previous.time)/86400000:null,maxAllowed=elapsedDays===null?5000:Math.max(minJumpThreshold,maxKmPerDay*Math.max(elapsedDays,1/24));
    if(delta>maxAllowed){jumps+=1;ignored+=1;previous=current;continue;}
    distance+=delta;previous=current;
  }
  const reliable=distance>0&&decreases===0&&jumps===0;
  return{distance,reliable,readingCount:readings.length,decreases,jumps,ignored,reason:reliable?'ok':decreases?'odometer_decrease':jumps?'unreasonable_jump':'no_positive_distance'};
}

export function vehicleEconomics(data){
  const workers=workerEconomics(data),workerByVehicle=new Map();
  for(const worker of workers){if(!worker.vehicle)continue;if(!workerByVehicle.has(worker.vehicle))workerByVehicle.set(worker.vehicle,[]);workerByVehicle.get(worker.vehicle).push(worker);}
  const map=new Map(),get=key=>{if(!map.has(key))map.set(key,{key,fuel:0,fuelLiters:0,maintenance:0,maintenanceOrders:new Set(),other:0,trips:0,odometerEvents:[]});return map.get(key);};
  for(const row of data.ledger){
    const details=meta(row),key=text(details.vehicle_external_id,details.plate_or_asset);
    if(!key)continue;
    const item=get(key),amount=n(row.amount);
    if(row.source_type==='driver_fuel_event'){item.fuel+=amount;item.fuelLiters+=n(row.quantity||details.fuel_liters);}
    else if(row.source_type==='maintenance_order'){item.maintenance+=amount;if(row.source_reference)item.maintenanceOrders.add(String(row.source_reference));}
    else if(row.entry_type!=='revenue')item.other+=amount;
  }
  for(const row of data.driverEvents){
    const key=String(row.vehicle_external_id||'').trim();if(!key)continue;
    const item=get(key);if(row.event_type==='trip_end')item.trips+=1;if(n(row.odometer)>0)item.odometerEvents.push(row);
    if(n(row.fuel_liters)>0&&item.fuelLiters===0)item.fuelLiters+=n(row.fuel_liters);
  }
  const infoById=new Map(data.vehicles.map(row=>[String(row.external_id),row]));
  return[...map.values()].map(item=>{
    const info=infoById.get(item.key)||data.vehicles.find(row=>String(row.plate_no||'')===item.key||String(row.asset_no||'')===item.key)||{};
    const linkedWorkers=workerByVehicle.get(item.key)||[],labor=total(linkedWorkers,row=>row.monthlyCost),direct=item.fuel+item.maintenance+item.other,odometer=analyzeOdometer(item.odometerEvents),operatingCost=direct+labor;
    return{...item,maintenanceOrders:item.maintenanceOrders.size,label:text(info.plate_no,info.asset_no,item.key),assetNo:String(info.asset_no||''),vehicleType:String(info.vehicle_type||''),workers:linkedWorkers.map(row=>row.name),labor,direct,distance:odometer.distance,distanceReliable:odometer.reliable,odometerQuality:odometer,operatingCost,costPerTrip:item.trips?operatingCost/item.trips:null,costPerKm:odometer.reliable&&odometer.distance>0?operatingCost/odometer.distance:null};
  }).sort((a,b)=>b.operatingCost-a.operatingCost);
}

export function tripEconomics(data){
  const vehicles=vehicleEconomics(data),completedTrips=total(vehicles,row=>row.trips),directCost=total(vehicles,row=>row.direct),laborCost=total(vehicles,row=>row.labor),distance=total(vehicles,row=>row.distanceReliable?row.distance:0),operatingCost=directCost+laborCost,reliableDistanceVehicles=vehicles.filter(row=>row.distanceReliable).length;
  return{vehicles,completedTrips,directCost,laborCost,distance,operatingCost,averageTripCost:completedTrips?operatingCost/completedTrips:null,averageKmCost:distance>0?operatingCost/distance:null,costWithoutTrips:vehicles.filter(row=>row.operatingCost>0&&!row.trips).length,reliableDistanceVehicles,unreliableDistanceVehicles:vehicles.length-reliableDistanceVehicles};
}

export function breakEvenEconomics(data){
  return productEconomics(data).map(item=>{
    const contribution=item.revenue-item.directCost,ratio=item.revenue>0?contribution/item.revenue:0,unitContribution=item.quantity>0?contribution/item.quantity:0;
    return{...item,contribution,contributionRate:ratio*100,breakEvenRevenue:ratio>0?item.indirectCost/ratio:null,breakEvenUnits:unitContribution>0?item.indirectCost/unitContribution:null};
  });
}

export function costDataQuality(data){
  const products=productEconomics(data),unclassified=total(data.ledger,row=>meta(row).unclassified?Math.abs(n(row.amount)):0),assetAssigned=new Set((data.setup.assetAssignments||[]).map(row=>String(row.asset_external_id))),employeeAssigned=new Set((data.setup.employeeAssignments||[]).map(row=>String(row.employee_external_id))),missingAssets=data.vehicles.filter(row=>row.external_id&&!assetAssigned.has(String(row.external_id))),missingEmployees=data.employees.filter(row=>row.external_id&&!employeeAssigned.has(String(row.external_id))),tripEnds=data.driverEvents.filter(row=>row.event_type==='trip_end'),tripsWithoutVehicle=tripEnds.filter(row=>!String(row.vehicle_external_id||'').trim()).length,tripsWithoutOdometer=tripEnds.filter(row=>n(row.odometer)<=0).length,periodStatus=String(data.report.period?.status||'not_calculated'),approved=periodStatus==='approved',complete=products.length>0&&products.every(item=>item.reliable)&&unclassified===0;
  const blockers=[];
  if(!products.length)blockers.push('لا توجد نتيجة تكلفة وحدة.');
  if(!approved)blockers.push(`فترة التكلفة غير معتمدة (${periodStatus}).`);
  if(unclassified>0)blockers.push(`تكاليف غير مصنفة بقيمة ${unclassified}.`);
  if(missingAssets.length)blockers.push(`${missingAssets.length} أصل بلا مركز تكلفة.`);
  if(missingEmployees.length)blockers.push(`${missingEmployees.length} موظف بلا توزيع تكلفة.`);
  if(tripsWithoutVehicle)blockers.push(`${tripsWithoutVehicle} رحلة بلا سيارة.`);
  if(tripsWithoutOdometer)blockers.push(`${tripsWithoutOdometer} رحلة بلا قراءة عداد.`);
  return{products,unclassified,missingAssets,missingEmployees,tripsWithoutVehicle,tripsWithoutOdometer,periodStatus,approved,complete,reliable:complete&&approved&&!blockers.length,blockers};
}
