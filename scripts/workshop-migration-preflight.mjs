import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const databaseUrl=String(process.env.SUPABASE_DB_URL||'').trim();
const outputPath=String(process.env.WORKSHOP_MIGRATION_PREFLIGHT||'workshop-migration-preflight.json').trim();
if(!databaseUrl)throw new Error('SUPABASE_DB_URL is required.');
function run(sql){
  const result=spawnSync('psql',[databaseUrl,'-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-c',`begin read only; set local statement_timeout='30s'; ${sql}; commit;`],{encoding:'utf8',env:process.env,stdio:['ignore','pipe','pipe'],timeout:45000});
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error(String(result.stderr||'psql query failed').trim());
  return String(result.stdout||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean).at(-1)||'';
}
const number=sql=>{const value=Number(run(sql));return Number.isFinite(value)?value:0;};
const bool=sql=>run(sql)==='t';
const version=number('select coalesce(max(version),0) from public.migration_history');
const result={
  format:'binhamid-workshop-migration-preflight-v1',
  checkedAt:new Date().toISOString(),
  readOnly:true,
  currentVersion:version,
  counts:{
    maintenanceOrders:number('select count(*) from public.maintenance_orders'),
    maintenanceUpdates:number('select count(*) from public.maintenance_updates'),
    operationalRecords:number('select count(*) from public.operational_records'),
    workshopOperationalRecords:number("select count(*) from public.operational_records where department='workshop' or entity_type in ('maintenance','maintenance_order','workshop','spare_parts_request')"),
    auditLog:number('select count(*) from public.audit_log'),
    unifiedAssets:number('select count(*) from public.unified_assets'),
  },
  anomalies:{
    maintenanceWithoutOperational:number('select count(*) from public.maintenance_orders mo where not exists(select 1 from public.operational_records o where o.reference_no=mo.reference_no)'),
    orphanWorkshopOperational:number("select count(*) from public.operational_records o where (o.department='workshop' or o.entity_type in ('maintenance','maintenance_order','workshop','spare_parts_request')) and not exists(select 1 from public.maintenance_orders mo where mo.reference_no=o.reference_no)"),
    maintenanceWithoutUnifiedAsset:number("select count(*) from public.maintenance_orders mo left join public.unified_assets ua on ua.external_id=coalesce(nullif(mo.asset_external_id,''),nullif(mo.vehicle_external_id,'')) where ua.id is null")
  },
  migrationAlreadyApplied:version>=25,
  requiredTablesPresent:['maintenance_orders','maintenance_updates','operational_records','audit_log','unified_assets'].every(table=>bool(`select to_regclass('public.${table}') is not null`)),
};
const errors=[];
if(version<24)errors.push(`database schema ${version} is below required version 24`);
if(!result.requiredTablesPresent)errors.push('one or more prerequisite tables are missing');
result.ok=errors.length===0;
result.errors=errors;
writeFileSync(outputPath,`${JSON.stringify(result,null,2)}\n`,{mode:0o600});
if(errors.length){console.error(errors.join('\n'));process.exit(1);}
console.log(`WORKSHOP_PREFLIGHT_OK=${version};ORDERS=${result.counts.maintenanceOrders};OPERATIONAL=${result.counts.operationalRecords}`);
