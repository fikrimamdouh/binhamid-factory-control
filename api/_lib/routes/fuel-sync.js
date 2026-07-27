import crypto from 'node:crypto';
import * as XLSX from 'xlsx';
import { config } from '../config.js';
import { errorResponse, json, method } from '../http.js';
import { parseFuelWorkbook } from '../fuel-summary-parser.js';
import { generateFuelReportPdfs } from '../fuel-report-pdf.js';
import { insert, patch, select, uploadObject } from '../supabase.js';
import { sendDocumentBuffer, sendMessage } from '../telegram.js';

const REPOSITORY='fikrimamdouh/binhamid-factory-control';
const OIDC_ISSUER='https://token.actions.githubusercontent.com';
const OIDC_AUDIENCE='binhamid-fuel-sync';
const MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PRIVATE_PLATE_KEY='DGD7293';
let jwksCache={expires:0,keys:[]};

const clean=(value,max=1000)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const safeFile=value=>{let name=clean(value,240).replace(/[^A-Za-z0-9._-]/g,'_').replace(/_+/g,'_').replace(/^_+|_+$/g,'');if(!name||name.startsWith('.'))name='fuel-report.xlsx';return name.slice(0,140);};
const riyadhDate=value=>{const date=value instanceof Date?value:new Date(value||Date.now());return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);};
const encoded=value=>encodeURIComponent(String(value??''));
const westernDigits=value=>String(value??'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d));
const compactKey=value=>westernDigits(value).toUpperCase().replace(/[^A-Z0-9\u0600-\u06FF]/g,'');
const privateFuelRow=row=>compactKey(row?.plateKey||row?.plate)===PRIVATE_PLATE_KEY||(/فكري\s*ممدوح|fikri\s*mamdouh/i.test(`${row?.driver||''} ${row?.vehicleName||''}`)&&/renault/i.test(String(row?.vehicleName||'')));

function upstreamDetail(error){return clean([error?.message,error?.data?.message,error?.data?.details,error?.data?.hint,error?.data?.code,error?.storageOperation,error?.storageCode,error?.storageBucket].filter(Boolean).join(' | '),900);}
function stageFailure(stage,label,error){
  if(error?.code||Number(error?.status||0)<500)return error;
  const detail=upstreamDetail(error)||'خطأ غير محدد من الخدمة السحابية';
  console.error('[FUEL_SYNC_STAGE_FAILED]',{stage,status:error?.status,upstreamStatus:error?.upstreamStatus,detail});
  return Object.assign(new Error(`${label}: ${detail}`),{status:Number(error?.status||502),code:'FUEL_SYNC_UPSTREAM_FAILED',stage});
}
async function runStage(stage,label,operation){try{return await operation();}catch(error){throw stageFailure(stage,label,error);}}
async function rawBody(req,limit){
  if(Buffer.isBuffer(req.body))return req.body;
  if(req.body instanceof Uint8Array)return Buffer.from(req.body);
  if(typeof req.body==='string')return Buffer.from(req.body,'binary');
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>limit)throw Object.assign(new Error('حجم ملف الوقود يتجاوز الحد المسموح'),{status:413,code:'FUEL_SYNC_FILE_TOO_LARGE'});chunks.push(chunk);}
  return Buffer.concat(chunks);
}
function filename(req){const value=clean(req.headers?.['x-fuel-filename-b64'],1000);if(value){try{return clean(Buffer.from(value,'base64').toString('utf8'),240)||'fuel-report.xlsx';}catch{}}return clean(req.headers?.['x-fuel-filename'],240)||'fuel-report.xlsx';}
function requestBalance(req){const raw=westernDigits(clean(req.headers?.['x-fuel-account-balance'],80)).replace(/[٬,\s]/g,'').replace('٫','.').replace(/[^0-9.-]/g,'');const amount=Number(raw);return Number.isFinite(amount)&&amount>=0?Number(amount.toFixed(2)):null;}
function requestBalanceCapturedAt(req,accountBalance){if(!Number.isFinite(accountBalance))return null;const raw=clean(req.headers?.['x-fuel-balance-captured-at'],80),date=new Date(raw);return Number.isNaN(date.getTime())?new Date().toISOString():date.toISOString();}
function requestBalanceDate(req,reportDate,accountBalance){if(!Number.isFinite(accountBalance))return null;const value=clean(req.headers?.['x-fuel-balance-date'],20);return value===reportDate?value:null;}
function requestNotify(req){return !/^(false|0|no)$/i.test(clean(req.headers?.['x-fuel-notify'],20)||'true');}
function base64Json(value){try{return JSON.parse(Buffer.from(value,'base64url').toString('utf8'));}catch{return null;}}
function audiences(value){return Array.isArray(value)?value:[value];}
async function jwks(){if(jwksCache.expires>Date.now()&&jwksCache.keys.length)return jwksCache.keys;const response=await fetch(`${OIDC_ISSUER}/.well-known/jwks`,{headers:{Accept:'application/json'}});if(!response.ok)throw Object.assign(new Error('تعذر التحقق من هوية GitHub Actions'),{status:502,code:'GITHUB_OIDC_JWKS_FAILED'});const data=await response.json();jwksCache={expires:Date.now()+60*60*1000,keys:Array.isArray(data.keys)?data.keys:[]};return jwksCache.keys;}
async function verifyGithubOidc(token){
  const parts=String(token||'').split('.');if(parts.length!==3)throw Object.assign(new Error('رمز GitHub Actions غير صالح'),{status:401,code:'FUEL_SYNC_AUTH_REQUIRED'});
  const header=base64Json(parts[0]),claims=base64Json(parts[1]);if(!header||!claims||header.alg!=='RS256'||!header.kid)throw Object.assign(new Error('بنية رمز GitHub Actions غير صالحة'),{status:401,code:'FUEL_SYNC_AUTH_INVALID'});
  const key=(await jwks()).find(item=>item.kid===header.kid);if(!key)throw Object.assign(new Error('مفتاح GitHub Actions غير معروف'),{status:401,code:'FUEL_SYNC_AUTH_KEY_UNKNOWN'});
  const valid=crypto.verify('RSA-SHA256',Buffer.from(`${parts[0]}.${parts[1]}`),crypto.createPublicKey({key,format:'jwk'}),Buffer.from(parts[2],'base64url')),now=Math.floor(Date.now()/1000);
  if(!valid||claims.iss!==OIDC_ISSUER||!audiences(claims.aud).includes(OIDC_AUDIENCE)||claims.repository!==REPOSITORY||Number(claims.exp||0)<=now||Number(claims.nbf||0)>now+30)throw Object.assign(new Error('هوية GitHub Actions لا تخص مستودع مصنع بن حامد'),{status:401,code:'FUEL_SYNC_AUTH_INVALID'});
  if(claims.ref!=='refs/heads/main'&&!String(claims.workflow_ref||'').includes('/.github/workflows/noor-khoy-fuel-sync.yml@refs/heads/main'))throw Object.assign(new Error('تشغيل مزامنة الوقود غير صادر من الفرع الرئيسي'),{status:403,code:'FUEL_SYNC_REF_FORBIDDEN'});
  return claims;
}
async function requireSyncIdentity(req){const auth=clean(req.headers?.authorization,3000);if(config.cronSecret&&auth===`Bearer ${config.cronSecret}`)return{kind:'cron-secret'};if(!auth.startsWith('Bearer '))throw Object.assign(new Error('هوية مزامنة الوقود مطلوبة'),{status:401,code:'FUEL_SYNC_AUTH_REQUIRED'});return{kind:'github-oidc',claims:await verifyGithubOidc(auth.slice(7))};}
function reportDate(req,rows){const explicit=clean(req.headers?.['x-fuel-report-date'],20);if(/^20\d{2}-\d{2}-\d{2}$/.test(explicit))return explicit;const dates=rows.map(row=>clean(row.date,30).slice(0,10)).filter(value=>/^20\d{2}-\d{2}-\d{2}$/.test(value)).sort();return dates.at(-1)||riyadhDate();}
function category(row){return row.category||(/petrol|gasoline|بنزين|91|95/i.test(row.fuelType||'')?'petrol':'diesel');}
function totals(rows){
  const byCategory={};const plates=new Set();
  for(const row of rows){const key=category(row);byCategory[key]??={rows:0,liters:0,amount:0};byCategory[key].rows++;byCategory[key].liters+=Number(row.liters||0);byCategory[key].amount+=Number(row.amount||0);if(row.plateKey||row.plate)plates.add(clean(row.plateKey||row.plate,100));}
  for(const value of Object.values(byCategory)){value.liters=Number(value.liters.toFixed(3));value.amount=Number(value.amount.toFixed(2));}
  return{rows:rows.length,plateCount:plates.size,liters:Number(rows.reduce((sum,row)=>sum+Number(row.liters||0),0).toFixed(3)),amount:Number(rows.reduce((sum,row)=>sum+Number(row.amount||0),0).toFixed(2)),categories:byCategory};
}
function storedRows(rows){return rows.map(row=>({receipt:row.receipt||'',driver:row.driver||'',station:row.station||'',vehicleName:row.vehicleName||'',plate:row.plate||'',plateKey:row.plateKey||'',fuelType:row.fuelType||'',category:category(row),date:row.date||'',liters:Number(row.liters||0),amount:Number(row.amount||0),price:Number(row.price||0),beforeTax:Number(row.beforeTax||0),tax:Number(row.tax||0),net:Number(row.net||row.amount||0),prevOdometer:Number(row.prevOdometer||0),currOdometer:Number(row.currOdometer||0),serviceKm:Number(row.serviceKm||0),sourceRow:Number(row.row||0)}));}
function categorySummary(summary){const names={diesel:'الديزل',petrol:'البنزين',other:'أنواع أخرى'};return Object.entries(summary.categories||{}).filter(([,value])=>Number(value.rows||0)>0).map(([key,value])=>`${names[key]||key}: <b>${value.rows}</b> حركة، <b>${value.liters}</b> لتر، <b>${value.amount} ر.س</b>`).join('\n');}
async function telegramDelivery({workbook,rows,sourceFile,reportDate,summary,accountBalance,duplicate}){
  if(!config.telegramOwnerId||!config.telegramToken)return{disabled:true};
  const prefix=duplicate?`إقرار الوقود بتاريخ <b>${reportDate}</b> مرفوع مسبقًا، ولم تتكرر الحركات.`:`تم رفع إقرار الوقود بتاريخ <b>${reportDate}</b>.`,detail=categorySummary(summary),balanceLine=Number.isFinite(accountBalance)?`\nرصيد خزنة المحطة المتبقي بنهاية يوم <b>${reportDate}</b>: <b>${Number(accountBalance).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} ر.س</b>`:'';
  await sendMessage(config.telegramOwnerId,`${prefix}\nإجمالي الحركات: <b>${summary.rows}</b>\nإجمالي اللترات: <b>${summary.liters}</b>\nإجمالي المبلغ: <b>${summary.amount} ر.س</b>${balanceLine}${detail?`\n\n${detail}`:''}\nالملف: <b>${clean(sourceFile,150)}</b>`).catch(()=>null);
  if(duplicate)return{duplicate:true};
  try{const reports=await generateFuelReportPdfs(workbook,XLSX,sourceFile,{reportDate,rows,accountBalance});for(const report of reports)await sendDocumentBuffer(config.telegramOwnerId,report.pdf,report.filename,'application/pdf',report.caption);return{reports:reports.map(item=>item.filename)};}catch(error){return{reports:[],error:clean(error?.message,300)};}
}

export async function fuelDailyReport(req,res){
  if(!method(req,res,['POST']))return;
  try{
    const identity=await requireSyncIdentity(req),buffer=await rawBody(req,config.maxImportFileBytes);if(!buffer.length)throw Object.assign(new Error('ملف الوقود غير موجود'),{status:400,code:'FUEL_SYNC_FILE_REQUIRED'});
    let workbook;try{workbook=XLSX.read(buffer,{type:'buffer',cellDates:true});}catch{throw Object.assign(new Error('الملف ليس Excel صالحًا'),{status:415,code:'FUEL_SYNC_EXCEL_REQUIRED'});}
    const parsed=parseFuelWorkbook(workbook,XLSX);if(!parsed.rowCount)throw Object.assign(new Error('لم يتم العثور على حركات وقود قابلة للقراءة داخل الملف'),{status:422,code:'FUEL_SYNC_NO_ROWS'});
    const operationalRows=parsed.rows.filter(row=>!privateFuelRow(row)),originalName=filename(req),hash=crypto.createHash('sha256').update(buffer).digest('hex'),date=reportDate(req,parsed.rows),accountBalance=requestBalance(req),balanceCapturedAt=requestBalanceCapturedAt(req,accountBalance),balanceDate=requestBalanceDate(req,date,accountBalance),notify=requestNotify(req),summary=totals(operationalRows),sourceSummary=totals(parsed.rows);
    const existing=await runStage('imports_lookup','تعذر فحص الملفات الواردة',async()=>((await select('imports',`file_hash=eq.${hash}&select=id,status,file_path,summary&limit=1`))?.[0]||null));
    const storagePath=existing?.file_path||`noor-khoy-fuel/${date}/${hash.slice(0,16)}-${safeFile(originalName)}`;
    if(!existing?.file_path)await runStage('storage_upload','تعذر حفظ ملف Excel الأصلي',()=>uploadObject(storagePath,buffer,MIME));
    const registrySummary={fuel:summary,sourceFuel:sourceSummary,fuelRows:storedRows(operationalRows),accountBalance,balanceDate,balanceCapturedAt,storage:{kind:'imports_registry',originalFile:storagePath},source:{kind:'noor-khoy',reportDate:date,receivedAt:new Date().toISOString(),identity:identity.kind,sheets:workbook.SheetNames}};
    if(existing&&['posted','approved'].includes(existing.status)){
      const mergedSummary={...(existing.summary||{}),...registrySummary};
      await runStage('import_update','تعذر تحديث سجل الوقود الموجود',()=>patch('imports',`id=eq.${encoded(existing.id)}`,{summary:mergedSummary,row_count:operationalRows.length,file_path:storagePath}));
      const telegram=notify?await telegramDelivery({workbook,rows:operationalRows,sourceFile:originalName,reportDate:date,summary,accountBalance,duplicate:true}):{skipped:true};
      return json(res,200,{ok:true,duplicate:true,reportDate:date,accountBalance,balanceDate,balanceCapturedAt,fileHash:hash,importId:existing.id,storagePath,storedRows:operationalRows.length,summary,storage:'imports_registry',telegram});
    }
    let imp=existing;
    if(!imp){const result=await runStage('import_insert','تعذر تسجيل ملف الوقود في مركز الوارد',()=>insert('imports',[{source:'noor-khoy',department:'operations',report_type:'fuel',status:'approved',original_name:originalName,mime_type:MIME,file_path:storagePath,file_hash:hash,row_count:operationalRows.length,error_count:0,warning_count:0,summary:registrySummary,last_error_code:null,last_error_message:null}]));imp=result?.[0];}
    else{const result=await runStage('import_update','تعذر تحديث ملف الوقود في مركز الوارد',()=>patch('imports',`id=eq.${encoded(imp.id)}`,{status:'approved',file_path:storagePath,row_count:operationalRows.length,summary:registrySummary,last_error_code:null,last_error_message:null}));imp=result?.[0]||imp;}
    if(!imp?.id)throw Object.assign(new Error('تعذر تسجيل تقرير الوقود في مركز الوارد'),{status:502,code:'FUEL_SYNC_IMPORT_REGISTER_FAILED'});
    const telegram=notify?await telegramDelivery({workbook,rows:operationalRows,sourceFile:originalName,reportDate:date,summary,accountBalance,duplicate:false}):{skipped:true};
    return json(res,200,{ok:true,duplicate:false,reportDate:date,accountBalance,balanceDate,balanceCapturedAt,fileHash:hash,importId:imp.id,storagePath,storedRows:operationalRows.length,summary,storage:'imports_registry',telegram});
  }catch(error){errorResponse(res,error);}
}
