import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const connectionUrl=String(process.env.SUPABASE_DB_URL||'').trim();
const outputPath=String(process.env.WORKSHOP_BASELINE_OUTPUT||'workshop-baseline.json').trim();
if(!connectionUrl)throw new Error('SUPABASE_DB_URL is required.');

function runScalar(sql){
  const wrapped=`begin read only; set local statement_timeout='30s'; ${sql}; commit;`;
  const result=spawnSync('psql',[connectionUrl,'-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-c',wrapped],{
    encoding:'utf8',env:process.env,stdio:['ignore','pipe','pipe'],timeout:45000,
  });
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error(String(result.stderr||'psql query failed').trim());
  return String(result.stdout||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean).at(-1)||'';
}

function bool(sql){return runScalar(sql)==='t';}
function number(sql){const value=Number(runScalar(sql));return Number.isFinite(value)?value:0;}
function json(sql,fallback){
  const raw=runScalar(sql);
  if(!raw)return fallback;
  try{return JSON.parse(raw);}catch{throw new Error(`Invalid JSON result for baseline query: ${raw.slice(0,160)}`);}
}
function tableExists(name){return bool(`select to_regclass('public.${name}') is not null`);}

const tables=[
  'maintenance_orders','maintenance_updates','operational_records','audit_log','unified_assets','vehicles',
  'maintenance_status_history','maintenance_labor_entries','maintenance_diagnostics','maintenance_parts',
  'maintenance_attachments','maintenance_checklist_templates','maintenance_checklist_items',
  'maintenance_checklist_results','preventive_maintenance_plans','preventive_maintenance_schedules',
  'preventive_maintenance_executions','asset_meter_readings','workshop_daily_reports'
];
const tablePresence=Object.fromEntries(tables.map(name=>[name,tableExists(name)]));
const columns=tablePresence.maintenance_orders?json(`select coalesce(json_agg(column_name order by ordinal_position),'[]'::json)::text from information_schema.columns where table_schema='public' and table_name='maintenance_orders'`,[]):[];
const hasColumn=name=>columns.includes(name);

const rowCounts={};
for(const name of ['maintenance_orders','maintenance_updates','operational_records','audit_log','unified_assets','vehicles']){
  rowCounts[name]=tablePresence[name]?number(`select count(*) from public.${name}`):null;
}

const maintenanceByStatus=tablePresence.maintenance_orders
  ?json(`select coalesce(json_object_agg(status,total),'{}'::json)::text from (select coalesce(status,'<null>') status,count(*) total from public.maintenance_orders group by coalesce(status,'<null>') order by coalesce(status,'<null>')) s`,{})
  :{};

const unlinked={withoutVehicleExternalId:null,withoutAssetExternalId:null,withoutUnifiedAssetLink:null};
if(tablePresence.maintenance_orders){
  if(hasColumn('vehicle_external_id'))unlinked.withoutVehicleExternalId=number(`select count(*) from public.maintenance_orders where nullif(trim(coalesce(vehicle_external_id,'')),'') is null`);
  if(hasColumn('asset_external_id'))unlinked.withoutAssetExternalId=number(`select count(*) from public.maintenance_orders where nullif(trim(coalesce(asset_external_id,'')),'') is null`);
  if(tablePresence.unified_assets){
    const linkColumn=hasColumn('asset_external_id')?'asset_external_id':hasColumn('vehicle_external_id')?'vehicle_external_id':null;
    if(linkColumn)unlinked.withoutUnifiedAssetLink=number(`select count(*) from public.maintenance_orders mo left join public.unified_assets ua on ua.external_id=mo.${linkColumn} where ua.id is null`);
  }
}

const telegramDuplicates=tablePresence.maintenance_orders&&['source_channel','source_chat_id','source_message_id'].every(hasColumn)
  ?number(`select count(*) from (select source_chat_id,source_message_id,count(*) from public.maintenance_orders where source_channel='telegram' and source_chat_id is not null and source_message_id is not null group by source_chat_id,source_message_id having count(*)>1) d`)
  :null;

const workshopAudit=tablePresence.audit_log?{
  totalWorkshopActions:number(`select count(*) from public.audit_log where entity_type in ('workshop','workshop_daily_report','equipment_inspection','maintenance_order') or action like 'mechanic_%' or action='spare_parts_request'`),
  dailyReports:number(`select count(*) from public.audit_log where action='mechanic_daily_report'`),
  inspections:number(`select count(*) from public.audit_log where action='mechanic_inspection'`),
  orderUpdates:number(`select count(*) from public.audit_log where action='mechanic_order_update'`),
}:null;

const latestMigration=tableExists('migration_history')?number(`select coalesce(max(version),0) from public.migration_history`):null;
const statusValues=tablePresence.maintenance_orders?Object.keys(maintenanceByStatus):[];
const plannedTablesMissing=tables.slice(6).filter(name=>!tablePresence[name]);

const result={
  format:'binhamid-workshop-baseline-v1',
  checkedAt:new Date().toISOString(),
  readOnly:true,
  schemaVersion:latestMigration,
  tables:tablePresence,
  rowCounts,
  maintenanceOrders:{
    columns,
    statuses:maintenanceByStatus,
    distinctStatusValues:statusValues,
    unlinked,
    duplicateTelegramSourceKeys:telegramDuplicates,
  },
  workshopAudit,
  plannedTablesMissing,
  blockers:[
    ...(tablePresence.operational_records?[]:['operational_records table is absent; any operations-center linkage must be verified in application code rather than assumed.']),
    ...(plannedTablesMissing.length?[`${plannedTablesMissing.length} planned workshop tables are not present.`]:[]),
    ...(unlinked.withoutUnifiedAssetLink>0?[`${unlinked.withoutUnifiedAssetLink} maintenance orders are not linked to unified_assets.`]:[]),
    ...(telegramDuplicates>0?[`${telegramDuplicates} duplicate Telegram source keys exist in maintenance_orders.`]:[]),
  ],
};

writeFileSync(outputPath,`${JSON.stringify(result,null,2)}\n`,{mode:0o600});
console.log(JSON.stringify({ok:true,output:outputPath,schemaVersion:result.schemaVersion,maintenanceOrders:rowCounts.maintenance_orders,blockers:result.blockers.length}));
