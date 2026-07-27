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

async function rawBody(req,limit){
  if(Buffer.isBuffer(req.body))return req.body;if(req.body instanceof Uint8Array)return Buffer.from(req.body);if(typeof req.body==='string')return Buffer.from(req.body,'binary');
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>limit)throw Object.assign(new Error('حجم ملف الوقود يتجاوز الحد المسموح'),{status:413,code:'FUEL_SYNC_FILE_TOO_LARGE'});chunks.push(chunk);}return Buffer.concat(chunks);
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
  if(claims.ref!=='refs/heads/main'&&!String(claims.workflow_ref||'').includes('/.github/workflows/noor-khoy-fuel-sync.yml@refs/heads/main'))throw Object.assign(new Error('تشغيل مزامنة الوقود غير صادر من الفرع الرئيسي'),{status:403,code:'FUEL_SYNC_REF_FORBIDDEN'});return claims;
}
async function requireSyncIdentity(req){const auth=clean(req.headers?.authorization,3000);if(config.cronSecret&&auth===`Bearer ${config.cronSecret}`)return{kind:'cron-secret'};if(!auth.startsWith('Bearer '))throw Object.assign(new Error('هوية مزامنة الوقود مطلوبة'),{status:401,code:'FUEL_SYNC_AUTH_REQUIRED'});return{kind:'github-oidc',claims:await verifyGithubOidc(auth.slice(7))};}
function reportDate(req,rows){const explicit=clean(req.headers?.['x-fuel-report-date'],20);if(/^20\d{2}-\d{2}-\d{2}$/.test(explicit))return explicit;const dates=rows.map(row=>clean(row.date,30).slice(0,10)).filter(value=>/^20\d{2}-\d{2}-\d{2}$/.test(value)).sort();return dates.at(-1)||riyadhDate();}
function category(row){return row.category||(/petrol|gasoline|بنزين|91|95/i.test(row.fuelType||'')?'petrol':'diesel');}
function rowKey(row){return [clean(row.receipt,80),clean(row.plateKey||row.plate,80),clean(row.date,40),Number(row.liters||0).toFixed(3),Number(row.amount||0).toFixed(2),category(row)].join('|');}
function stateRow(row,{hash,sourceFile,reportDate,index}){const key=rowKey(row),date=clean(row.date,40)||`${reportDate}T12:00:00.000Z`;return{id:`noor-khoy:${crypto.createHash('sha256').update(`${hash}:${key}`).digest('hex').slice(0,24)}`,source:'noor-khoy',sourceHash:hash,sourceFile,sourceRow:Number(row.row||index+1),date,reportDate,filledAt:date,receipt:row.receipt||'',driver:row.driver||'',station:row.station||'',vehicle:row.vehicleName||'',vehicleName:row.vehicleName||'',plate:row.plate||'',vehiclePlate:row.plate||'',plateKey:row.plateKey||'',fuelType:row.fuelType||'',category:category(row),liters:Number(row.liters||0),quantity:Number(row.liters||0),amount:Number(row.amount||0),cost:Number(row.amount||0),totalCost:Number(row.amount||0),price:Number(row.price||0),beforeTax:Number(row.beforeTax||0),tax:Number(row.tax||0),net:Number(row.net||row.amount||0),prevOdometer:Number(row.prevOdometer||0),currOdometer:Number(row.currOdometer||0),serviceKm:Number(row.serviceKm||0)};}
async function mergeIntoState(rows,context){
  for(let attempt=1;attempt<=4;attempt++){
    const state=(await select('app_state','key=eq.primary&select=revision,payload&limit=1'))?.[0];if(!state?.payload)return{stored:0,skipped:true,reason:'APP_STATE_NOT_FOUND'};
    const payload=state.payload&&typeof state.payload==='object'?state.payload:{},ops=payload.ops&&typeof payload.ops==='object'?payload.ops:{},existing=Array.isArray(ops.fuel)?ops.fuel:[],seen=new Set(existing.map(rowKey)),incoming=[];
    rows.forEach((row,index)=>{const mapped=stateRow(row,{...context,index}),key=rowKey(mapped);if(!seen.has(key)){seen.add(key);incoming.push(mapped);}});
    const balanceValid=Number.isFinite(context.accountBalance)&&Boolean(context.balanceCapturedAt)&&context.balanceDate===context.reportDate,balanceDate=balanceValid?context.balanceDate:null,existingBalances=Array.isArray(ops.fuelBalances)?ops.fuelBalances:[],balanceIndex=balanceValid?existingBalances.findIndex(item=>item?.date===balanceDate):-1,previousBalance=balanceIndex>=0?existingBalances[balanceIndex]:null;
    const balanceChanged=balanceValid&&(Number(previousBalance?.amount)!==Number(context.accountBalance)||String(previousBalance?.capturedAt)!==String(context.balanceCapturedAt)),nextBalances=existingBalances.slice();
    if(balanceValid&&balanceChanged){const snapshot={date:balanceDate,reportDate:balanceDate,amount:Number(context.accountBalance),currency:'SAR',kind:'closing',source:'noor-khoy',capturedAt:context.balanceCapturedAt};if(balanceIndex>=0)nextBalances[balanceIndex]=snapshot;else nextBalances.push(snapshot);}
    if(!incoming.length&&!balanceChanged)return{stored:0,duplicate:true,total:existing.length,balanceUpdated:false};
    const nextOps={...ops,fuel:[...existing,...incoming]};if(balanceValid){nextOps.fuelAccountBalance={amount:Number(context.accountBalance),currency:'SAR',kind:'closing',asOfDate:balanceDate,capturedAt:context.balanceCapturedAt,source:'noor-khoy'};nextOps.fuelBalances=nextBalances.sort((a,b)=>String(a.date).localeCompare(String(b.date)));}
    const revision=Number(state.revision||0),updated=await patch('app_state',`key=eq.primary&revision=eq.${revision}`,{payload:{...payload,ops:nextOps},revision:revision+1,updated_at:new Date().toISOString()});if(updated?.length)return{stored:incoming.length,total:existing.length+incoming.length,revision:revision+1,balanceUpdated:balanceChanged};
  }
  throw Object.assign(new Error('تعارضت مزامنة الوقود مع تحديث سحابي آخر؛ أعد المحاولة'),{status:409,code:'FUEL_SYNC_STATE_CONFLICT'});
}
function totals(rows){const byCategory={};for(const row of rows){const key=category(row);byCategory[key]??={rows:0,liters:0,amount:0};byCategory[key].rows++;byCategory[key].liters+=Number(row.liters||0);byCategory[key].amount+=Number(row.amount||0);}for(const value of Object.values(byCategory)){value.liters=Number(value.liters.toFixed(3));value.amount=Number(value.amount.toFixed(2));}return{rows:rows.length,liters:Number(rows.reduce((sum,row)=>sum+Number(row.liters||0),0).toFixed(3)),amount:Number(rows.reduce((sum,row)=>sum+Number(row.amount||0),0).toFixed(2)),categories:byCategory};}
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
    const context={hash,sourceFile:originalName,reportDate:date,accountBalance,balanceCapturedAt,balanceDate},existing=(await select('imports',`file_hash=eq.${hash}&select=id,status,file_path,summary&limit=1`))?.[0]||null;
    if(existing&&['posted','approved'].includes(existing.status)){
      const state=await mergeIntoState([],context),telegram=notify?await telegramDelivery({workbook,rows:operationalRows,sourceFile:originalName,reportDate:date,summary,accountBalance,duplicate:true}):{skipped:true};
      return json(res,200,{ok:true,duplicate:true,reportDate:date,accountBalance,balanceDate,balanceCapturedAt,fileHash:hash,importId:existing.id,storedRows:0,summary,state,telegram});
    }
    const storagePath=existing?.file_path||`noor-khoy-fuel/${date}/${hash.slice(0,16)}-${safeFile(originalName)}`;if(!existing?.file_path)await uploadObject(storagePath,buffer,MIME);
    const state=await mergeIntoState(operationalRows,context),importSummary={fuel:summary,sourceFuel:sourceSummary,accountBalance,balanceDate,balanceCapturedAt,state,source:{kind:'noor-khoy',receivedAt:new Date().toISOString(),identity:identity.kind,sheets:workbook.SheetNames}};
    let imp=existing;if(!imp){const result=await insert('imports',[{source:'noor-khoy',department:'operations',report_type:'fuel',status:'approved',original_name:originalName,mime_type:MIME,file_path:storagePath,file_hash:hash,row_count:operationalRows.length,error_count:0,warning_count:0,summary:importSummary,last_error_code:null,last_error_message:null}]);imp=result?.[0];}else{const result=await patch('imports',`id=eq.${encoded(imp.id)}`,{status:'approved',file_path:storagePath,row_count:operationalRows.length,summary:importSummary,last_error_code:null,last_error_message:null});imp=result?.[0]||imp;}
    if(!imp?.id)throw Object.assign(new Error('تعذر تسجيل تقرير الوقود في مركز الوارد'),{status:502,code:'FUEL_SYNC_IMPORT_REGISTER_FAILED'});
    const telegram=notify?await telegramDelivery({workbook,rows:operationalRows,sourceFile:originalName,reportDate:date,summary,accountBalance,duplicate:false}):{skipped:true};
    return json(res,200,{ok:true,duplicate:Boolean(state.duplicate),reportDate:date,accountBalance,balanceDate,balanceCapturedAt,fileHash:hash,importId:imp.id,storagePath,storedRows:Number(state.stored||0),summary,telegram});
  }catch(error){errorResponse(res,error);}
}