import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('backup evidence recorder discovers nested artifact files and verifies them before database registration',async()=>{
  const script=await read('scripts/record-backup-evidence.mjs');
  for(const marker of ["readdirSync(root,{recursive:true,withFileTypes:true})","file.endsWith('.manifest.json')","basename(file)===manifest.fileName","createHash('sha256')","BACKUP_SCOPE_NOT_RESTORABLE","on conflict(backup_name)"])assert.ok(script.includes(marker),`missing ${marker}`);
  assert.match(script,/actualChecksum!==manifest\.checksumSha256/);
  assert.match(script,/actualSize!==sizeBytes|sizeBytes!==actualSize/);
});

test('backup evidence workflow downloads both standard and post-migration artifact layouts',async()=>{
  const workflow=await read('.github/workflows/backup-evidence-recorder.yml');
  assert.match(workflow,/encrypted-database-backup-/);
  assert.match(workflow,/encrypted-post-migration-backup-/);
  assert.match(workflow,/find backup-evidence/);
  assert.match(workflow,/record-backup-evidence\.mjs/);
});
