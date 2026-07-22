import test from 'node:test';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../legacy.html',import.meta.url),'utf8');

test('print legacy vehicle roster contract for repair',()=>{
  const lines=source.split(/\r?\n/);
  const matched=[];
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    if(/rVeh|vehForm|tVeh|D\.veh|المركبات والمعدات|لا توجد مركبات|إضافة مركبة|operationalStatus|driverId/.test(line)){
      const start=Math.max(0,i-2),end=Math.min(lines.length,i+4);
      matched.push(`--- ${i+1} ---\n${lines.slice(start,end).join('\n')}`);
    }
  }
  console.log('\nVEHICLE_ROSTER_CONTRACT_BEGIN\n'+matched.join('\n')+'\nVEHICLE_ROSTER_CONTRACT_END');
});
