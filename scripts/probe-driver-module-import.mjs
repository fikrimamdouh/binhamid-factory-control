import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const path=join(root,'api/_lib/bot-invitations.js');
let content=readFileSync(path,'utf8');
const anchor="import { employeeAssetsSummary,maskNationalId,normalizeNationalId,resolveEmployeeIdentity } from './employee-identity-link.js';";
const replacement=anchor+"\nimport { createDriverPoolLink, handleDriverPoolStart } from './bot-driver-pool-registration.js';";
if(!content.includes(replacement)){
  if(!content.includes(anchor))throw new Error('Driver module probe anchor missing');
  content=content.replace(anchor,replacement);
}
writeFileSync(path,content,'utf8');
console.log('Applied hidden driver module import probe.');
