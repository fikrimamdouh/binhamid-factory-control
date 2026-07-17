import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const file=resolve('legacy.html'),content=readFileSync(file,'utf8'),lines=content.split(/\r?\n/).length,bytes=Buffer.byteLength(content),baselineLines=8273;
console.log(`LEGACY_LINES=${lines}`);console.log(`LEGACY_BYTES=${bytes}`);console.log(`LEGACY_BASELINE_LINES=${baselineLines}`);
if(lines>baselineLines){console.error(`legacy.html grew by ${lines-baselineLines} lines; new features must remain outside legacy.html`);process.exit(1);}console.log(`LEGACY_LINE_DELTA=${lines-baselineLines}`);
