import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const directory=resolve('supabase/migrations'),files=readdirSync(directory).filter(name=>/^\d{3}_.+\.sql$/.test(name)).sort(),versions=files.map(name=>Number(name.slice(0,3))),errors=[];
const latest=11;
for(let version=1;version<=latest;version++){if(!versions.includes(version))errors.push(`missing migration ${String(version).padStart(3,'0')}`);}
if(new Set(versions).size!==versions.length)errors.push('duplicate migration version');
if(Math.max(...versions)!==latest)errors.push(`latest migration must be ${String(latest).padStart(3,'0')}`);
for(const file of files){
  const sql=readFileSync(resolve(directory,file),'utf8'),version=Number(file.slice(0,3));
  if(/\bdrop\s+table\b(?!\s+if\s+exists)/i.test(sql))errors.push(`${file}: destructive DROP TABLE without IF EXISTS`);
  if(/\btruncate\b/i.test(sql))errors.push(`${file}: TRUNCATE is not allowed`);
  if(version>=10&&!/migration_history/i.test(sql))errors.push(`${file}: migration_history marker missing`);
  if(version===11){for(const marker of ['cost_centers','cost_periods','cost_calculation_runs','cost_unit_monthly_report','run_cost_period','operational_alerts','role_capabilities','backup_runs','gps_provider_events'])if(!sql.includes(marker))errors.push(`${file}: missing ${marker}`);}
}
if(errors.length){console.error(errors.join('\n'));process.exit(1);}console.log(`MIGRATIONS_OK=${files.length};LATEST=${String(latest).padStart(3,'0')}`);
