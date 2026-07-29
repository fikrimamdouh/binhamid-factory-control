import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
writeFileSync(join(root,'api/_lib/bot-driver-pool-registration.js'),`export async function createDriverPoolLink(){return null;}
export async function handleDriverPoolStart(){return true;}
export async function handleDriverPoolCallback(){return true;}
export async function continueDriverPoolSession(){return false;}
`,'utf8');
console.log('Applied minimal hidden driver module probe.');
