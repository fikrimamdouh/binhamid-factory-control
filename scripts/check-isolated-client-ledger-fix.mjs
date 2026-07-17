import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const allowed=new Set([
  'assets/declarations-customer-ledger-fix.js',
  'index.html',
  'tests/declarations-customer-ledger-fix.test.mjs',
  'scripts/check-isolated-client-ledger-fix.mjs'
]);
const output=execFileSync('git',['diff','--name-only','origin/main...HEAD'],{encoding:'utf8'}).trim();
for(const file of output.split(/\r?\n/).filter(Boolean)){
  if(!allowed.has(file))throw new Error(`Unexpected file in isolated fix: ${file}`);
  if(file.startsWith('supabase/migrations/')||file.startsWith('debug/')||file.startsWith('.github/workflows/'))throw new Error(`Forbidden path in isolated fix: ${file}`);
}
if(!existsSync('assets/declarations-customer-ledger-fix.js'))throw new Error('Missing declaration/customer ledger fix');
const index=readFileSync('index.html','utf8');
if(!index.includes('binhamid-declarations-customer-ledger-fix'))throw new Error('Fix script is not loaded by index.html');
console.log('Isolated client ledger fix scope verified.');
