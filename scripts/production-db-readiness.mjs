import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { DATABASE_TABLES,DATABASE_VIEWS,DATABASE_COLUMN_CHECKS,LATEST_REQUIRED_VERSION } from '../api/_lib/routes/system-runtime.js';

const db=String(process.env.SUPABASE_DB_URL||'').trim();
const output=String(process.env.PRODUCTION_READINESS_PATH||'production-readiness.json');
const save=value=>writeFileSync(output,`${JSON.stringify({format:'binhamid-production-readiness-v2',checkedAt:new Date().toISOString(),...value},null,2)}\n`,{mode:0o600});
const stop=(code,reason,extra={})=>{save({ok:false,code,reason,...extra});console.error(`[production-readiness] ${code}: ${reason}`);process.exit(1);};
const query=sql=>{const result=spawnSync('psql',[db,'-X','-t','-A','-v','ON_ERROR_STOP=1','-c',sql],{encoding:'utf8',env:process.env,timeout:120000});if(result.error||result.status!==0)stop('READINESS_QUERY_FAILED','A read-only PostgreSQL readiness query failed.',{exitCode:result.status??-1});return String(result.stdout||'').trim();};
if(!db)stop('DATABASE_URL_EMPTY','The resolved database connection is empty.');
const literal=value=>`'${String(value).replaceAll("'","''")}'`;
const missingTables=DATABASE_TABLES.filter(name=>query(`select to_regclass('public.'||${literal(name)}) is not null;`)!=='t');
const missingViews=DATABASE_VIEWS.filter(name=>query(`select to_regclass('public.'||${literal(name)}) is not null;`)!=='t');
const missingColumns=[];
for(const [table,columns] of Object.entries(DATABASE_COLUMN_CHECKS))for(const column of columns){const exists=query(`select exists(select 1 from information_schema.columns where table_schema='public' and table_name=${literal(table)} and column_name=${literal(column)});`);if(exists!=='t')missingColumns.push({table,column});}
const migrationRows=JSON.parse(query(`select coalesce(json_agg(json_build_object('version',version,'name',migration_name) order by version),'[]'::json)::text from public.migration_history;`));
const found=new Set(migrationRows.map(row=>Number(row.version))),missingMigrations=[];
for(let version=1;version<=LATEST_REQUIRED_VERSION;version++)if(!found.has(version))missingMigrations.push(String(version).padStart(3,'0'));
const schemaVersion=migrationRows.length?Math.max(...migrationRows.map(row=>Number(row.version)||0)):0;
const report={ok:!missingTables.length&&!missingViews.length&&!missingColumns.length&&!missingMigrations.length&&schemaVersion===LATEST_REQUIRED_VERSION,code:'PRODUCTION_SCHEMA_CHECK',schemaVersion:String(schemaVersion).padStart(3,'0'),latestRequiredVersion:String(LATEST_REQUIRED_VERSION).padStart(3,'0'),missingTables,missingViews,missingColumns,missingMigrations,appliedMigrationCount:migrationRows.length,readOnly:true};
save(report);
console.log(`[production-readiness] ready=${report.ok}; schema=${report.schemaVersion}`);
if(!report.ok)process.exit(1);
