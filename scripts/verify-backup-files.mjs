import { createHash } from 'node:crypto';
import { basename,join } from 'node:path';
import { appendFileSync,readFileSync,readdirSync,statSync,writeFileSync } from 'node:fs';

const directory=String(process.env.BACKUP_OUTPUT_DIR||'backup-output');
const resultFile=String(process.env.BACKUP_RESULT_FILE||'backup-result.jsonl');
const verificationFile=String(process.env.BACKUP_VERIFICATION_FILE||'backup-verification.json');
const manifestEnvName=String(process.env.BACKUP_MANIFEST_ENV_NAME||'VERIFIED_BACKUP_MANIFEST');
const expectedSchema=process.env.EXPECTED_SCHEMA_VERSION==null||process.env.EXPECTED_SCHEMA_VERSION===''?null:Number(process.env.EXPECTED_SCHEMA_VERSION);
const fail=(code,reason,extra={})=>{writeFileSync(verificationFile,`${JSON.stringify({ok:false,code,reason,...extra},null,2)}\n`);console.error(`[backup-verifier] ${code}: ${reason}`);process.exit(1);};
const files=readdirSync(directory),encrypted=files.filter(n=>n.endsWith('.enc')),manifests=files.filter(n=>n.endsWith('.manifest.json')),plain=files.filter(n=>n.endsWith('.sql')||n.endsWith('.sql.gz'));
if(plain.length)fail('UNENCRYPTED_BACKUP_REMAINS','Unencrypted SQL files remain in the backup directory.');
if(encrypted.length!==1||manifests.length!==1)fail('BACKUP_FILE_SET_INVALID','Expected exactly one encrypted file and one manifest.',{encryptedFiles:encrypted.length,manifestFiles:manifests.length});
const encryptedPath=join(directory,encrypted[0]),manifestPath=join(directory,manifests[0]),size=statSync(encryptedPath).size;
if(size<=154)fail('ENCRYPTED_BACKUP_TOO_SMALL','The encrypted backup file is too small.',{sizeBytes:size});
let manifest;try{manifest=JSON.parse(readFileSync(manifestPath,'utf8'));}catch{fail('BACKUP_MANIFEST_INVALID','The backup manifest is invalid JSON.');}
if(manifest.format!=='binhamid-backup-v1'||manifest.encrypted!==true||manifest.fileName!==encrypted[0])fail('BACKUP_MANIFEST_MISMATCH','The backup manifest does not match the encrypted file.');
if(expectedSchema!==null&&Number(manifest.schemaVersion)!==expectedSchema)fail('BACKUP_SCHEMA_VERSION_MISMATCH','The backup schema version does not match the expected version.',{expectedSchema,actualSchema:Number(manifest.schemaVersion)});
const checksum=createHash('sha256').update(readFileSync(encryptedPath)).digest('hex');
if(checksum!==manifest.checksumSha256)fail('BACKUP_CHECKSUM_MISMATCH','The encrypted backup checksum does not match the manifest.');
const resultText=readFileSync(resultFile,'utf8').trim();if(!resultText)fail('BACKUP_RESULT_EMPTY','The backup result file is empty.');
let result;try{result=JSON.parse(resultText.split(/\r?\n/).filter(Boolean).at(-1));}catch{fail('BACKUP_RESULT_INVALID','The backup result does not end with valid JSON.');}
if(result.ok!==true||basename(String(result.file||''))!==encrypted[0]||Number(result.sizeBytes)!==size||result.checksumSha256!==checksum||result.storagePath!==null)fail('BACKUP_RESULT_MISMATCH','The backup result does not match the verified encrypted file.');
if(process.env.GITHUB_ENV)appendFileSync(process.env.GITHUB_ENV,`${manifestEnvName}=${manifestPath}\n`,{encoding:'utf8',mode:0o600});
const verification={ok:true,code:'BACKUP_VERIFIED',fileName:encrypted[0],sizeBytes:size,checksumSha256:checksum,schemaVersion:Number(manifest.schemaVersion),encrypted:true,pgDumpVersion:manifest.pgDumpVersion||result.pgDumpVersion||null,manifestPath};
writeFileSync(verificationFile,`${JSON.stringify(verification,null,2)}\n`,{mode:0o600});
console.log(`[backup-verifier] VERIFIED ${encrypted[0]} (${size} bytes) schema=${verification.schemaVersion}`);
