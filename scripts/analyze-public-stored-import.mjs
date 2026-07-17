import * as XLSX from 'xlsx';
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseDailyWorkbook } from '../api/_lib/daily-summary-parser.js';

const db=String(process.env.SUPABASE_DB_URL||'').trim();
const bucket=String(process.env.SUPABASE_STORAGE_BUCKET||'factory-documents').trim();
const output='stored-import-analysis.json';
const save=value=>writeFileSync(output,`${JSON.stringify({format:'binhamid-stored-import-analysis-v1',checkedAt:new Date().toISOString(),...value},null,2)}\n`,{mode:0o600});
const stop=(code,reason,extra={})=>{save({ok:false,code,reason,...extra});console.error(`[stored-import-analysis] ${code}`);process.exit(0);};
const query=sql=>{const result=spawnSync('psql',[db,'-X','-t','-A','-v','ON_ERROR_STOP=1','-c',sql],{encoding:'utf8',env:process.env,timeout:120000});if(result.error||result.status!==0)stop('IMPORT_QUERY_FAILED','The stored import metadata query failed.');return String(result.stdout||'').trim();};
if(!db)stop('DATABASE_URL_EMPTY','The resolved database connection is empty.');
let connection;try{connection=new URL(db);}catch{stop('DATABASE_URL_INVALID','The resolved database connection is invalid.');}
let projectRef=connection.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i)?.[1]||decodeURIComponent(connection.username||'').match(/^postgres\.([a-z0-9]+)$/i)?.[1]||'';
if(!projectRef)stop('PROJECT_REF_UNAVAILABLE','The Supabase project reference could not be derived safely.');
const metadataText=query(`select coalesce((select json_build_object('id',id,'originalName',original_name,'filePath',file_path,'reportType',report_type,'status',status,'rowCount',row_count)::text from public.imports where mime_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' or original_name ilike '%.xlsx' order by created_at desc limit 1),'{}');`);
let metadata;try{metadata=JSON.parse(metadataText);}catch{stop('IMPORT_METADATA_INVALID','The stored import metadata is invalid.');}
if(!metadata.filePath)stop('STORED_XLSX_NOT_FOUND','No stored XLSX import was found.');
const encodedPath=String(metadata.filePath).split('/').map(encodeURIComponent).join('/');
const publicUrl=`https://${projectRef}.supabase.co/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodedPath}`;
let response;try{response=await fetch(publicUrl,{headers:{Accept:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},signal:AbortSignal.timeout(20000)});}catch(error){stop('STORAGE_PUBLIC_FETCH_FAILED','The public Storage request failed.',{errorCode:error?.name||'FETCH_FAILED'});}
if(!response.ok)stop('STORAGE_OBJECT_NOT_PUBLIC','The stored workbook is not publicly readable.',{httpStatus:response.status,metadata});
const buffer=Buffer.from(await response.arrayBuffer());
if(buffer.length<4||buffer[0]!==0x50||buffer[1]!==0x4b)stop('STORED_FILE_NOT_XLSX','The stored object is not a valid XLSX file.',{sizeBytes:buffer.length,metadata});
let workbook;try{workbook=XLSX.read(buffer,{type:'buffer',cellDates:true});}catch{stop('XLSX_PARSE_FAILED','The stored workbook could not be parsed.',{sizeBytes:buffer.length,metadata});}
const parsed=parseDailyWorkbook(workbook,XLSX),customerMap=new Map();
const add=(code,name,source)=>{const customerCode=String(code||'').trim(),customerName=String(name||'').trim().replace(/\s+/g,' ');if(!customerCode||!customerName)return;const current=customerMap.get(customerCode)||{customerCode,names:new Set(),salesLines:0,collectionLines:0,salesAmount:0,collectionAmount:0};current.names.add(customerName);if(source.type==='sale'){current.salesLines+=1;current.salesAmount+=Number(source.amount||0);}else{current.collectionLines+=1;current.collectionAmount+=Number(source.amount||0);}customerMap.set(customerCode,current);};
for(const row of parsed.sales)add(row.customerCode,row.customer,{type:'sale',amount:row.amount});
for(const row of parsed.collections)add(row.customerCode,row.customer,{type:'collection',amount:row.amount});
const customers=[...customerMap.values()].map(item=>({customerCode:item.customerCode,names:[...item.names],conflict:item.names.size>1,salesLines:item.salesLines,collectionLines:item.collectionLines,salesAmount:Math.round(item.salesAmount*100)/100,collectionAmount:Math.round(item.collectionAmount*100)/100})).sort((a,b)=>a.customerCode.localeCompare(b.customerCode));
const conflicts=customers.filter(item=>item.conflict);
const report={ok:conflicts.length===0,code:conflicts.length?'CUSTOMER_NAME_CONFLICTS_FOUND':'STORED_IMPORT_PARSED',metadata:{...metadata,sizeBytes:buffer.length,sheetNames:workbook.SheetNames},summary:parsed.summary,customerCount:customers.length,customers,conflicts,publicRead:true,readOnly:true};
save(report);
console.log(`[stored-import-analysis] ${report.code}; customers=${customers.length}; invoices=${parsed.summary.invoiceCount}; collections=${parsed.summary.collectionCount}`);
