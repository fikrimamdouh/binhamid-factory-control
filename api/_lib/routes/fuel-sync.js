import crypto from 'node:crypto';
import * as XLSX from 'xlsx';
import { config } from '../config.js';
import { body, errorResponse, json, method } from '../http.js';
import { parseFuelWorkbook } from '../fuel-summary-parser.js';
import { generateFuelReportPdfs } from '../fuel-report-pdf.js';
import { insert, patch, remove, select, uploadObject } from '../supabase.js';
import { storeFuelRows, storeFailureReason } from '../fuel-analytics.js';
import { sendDocumentBuffer, sendMessage } from '../telegram.js';

const REPOSITORY='fikrimamdouh/binhamid-factory-control',OIDC_ISSUER='https://token.actions.githubusercontent.com',OIDC_AUDIENCE='binhamid-fuel-sync',MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',PRIVATE_PLATE_KEY='DGD7293',FACTORY_MANAGER_CHAT_ID='6870312376';
const INVALID_JULY_IMPORT_IDS=['1e2848b6-457e-4b3c-a692-d9fa0e24c4ea','e30e5ca5-26e1-4ea0-a466-8aca45eef4e9','8b40ecfa-88f8-4baf-b52a-d12d44889981','e97aaff0-d340-4ab1-9112-a4c2b568641e','fc627334-35de-46f8-8f04-a7db90578213','64e2fa75-f7d3-43eb-9a39-1d2c34a8a660','33fcf520-0d71-4e7b-8293-920accadd033'];
let jwksCache={expires:0,keys:[]};
const clean=(value,max=1000)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max),encoded=value=>encodeURIComponent(String(value??'')),westernDigits=value=>String(value??'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)),compactKey=value=>westernDigits(value).toUpperCase().replace(/[^A-Z0-9\u0600-\u06FF]/g,''),validDate=value=>/^20\d{2}-\d{2}-\d{2}$/.test(String(value||''));
const safeFile=value=>{let name=clean(value,240).replace(/[^A-Za-z0-9._-]/g,'_').replace(/_+/g,'_').replace(/^_+|_+$/g,'');if(!name||name.startsWith('.'))name='fuel-report.xlsx';return name.slice(0,140);};
const riyadhDate=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(value instanceof Date?value:new Date(value||Date.now()));
const privateFuelRow=row=>compactKey(row?.plateKey||row?.plate)===PRIVATE_PLATE_KEY||(/فكري\s*ممدوح|fikri\s*mamdouh/i.test(`${row?.driver||''} ${row?.vehicleName||''}`)&&/renault/i.test(String(row?.vehicleName||'')));
function upstreamDetail(error){return clean([error?.message,error?.data?.message,error?.data?.details,error?.data?.hint,error?.data?.code,error?.storageOperation,error?.storageCode,error?.storageBucket].filter(Boolean).join(' | '),900);}
function stageFailure(stage,label,error){if(error?.code||Number(error?.status||0)<500)return error;const detail=upstreamDetail(error)||'خطأ غير محدد من الخدمة السحابية';console.error('[FUEL_SYNC_STAGE_FAILED]',{stage,status:error?.status,upstreamStatus:error?.upstreamStatus,detail});return Object.assign(new Error(`${label}: ${detail}`),{status:Number(error?.status||502),code:'FUEL_SYNC_UPSTREAM_FAILED',stage});}
async function runStage(stage,label,operation){try{return await operation();}catch(error){throw stageFailure(stage,label,error);}}
async function rawBody(req,limit){if(Buffer.isBuffer(req.body))return req.body;if(req.body instanceof Uint8Array)return Buffer.from(req.body);if(typeof req.body==='string')return Buffer.from(req.body,'binary');const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>limit)throw Object.assign(new Error('حجم ملف الوقود يتجاوز الحد المسموح'),{status:413,code:'FUEL_SYNC_FILE_TOO_LARGE'});chunks.push(chunk);}return Buffer.concat(chunks);}
function filename(req){const value=clean(req.headers?.['x-fuel-filename-b64'],1000);if(value){try{return clean(Buffer.from(value,'base64').toString('utf8'),240)||'fuel-report.xlsx';}catch{}}return clean(req.headers?.['x-fuel-filename'],240)||'fuel-report.xlsx';}
function requestBalance(req){const raw=westernDigits(clean(req.headers?.['x-fuel-account-balance'],80)).replace(/[٬,\s]/g,'').replace('٫','.').replace(/[^0-9.-]/g,''),amount=Number(raw);return Number.isFinite(amount)&&amount>=0?Number(amount.toFixed(2)):null;}
function requestBalanceCapturedAt(req,amount){if(!Number.isFinite(amount))return null;const date=new Date(clean(req.headers?.['x-fuel-balance-captured-at'],80));return Number.isNaN(date.getTime())?new Date().toISOString():date.toISOString();}
function requestBalanceDate(req,reportDate,amount){if(!Number.isFinite(amount))return null;const value=clean(req.headers?.['x-fuel-balance-date'],20);return value===reportDate?value:null;}
const requestNotify=req=>!/^(false|0|no)$/i.test(clean(req.headers?.['x-fuel-notify'],20)||'true');
function requestPeriod(req,fallbackDate){const start=clean(req.headers?.['x-fuel-period-start'],20),end=clean(req.headers?.['x-fuel-period-end'],20);return validDate(start)&&validDate(end)&&start<=end?{start,end}:{start:fallbackDate,end:fallbackDate};}
function base64Json(value){try{return JSON.parse(Buffer.from(value,'base64url').toString('utf8'));}catch{return null;}}
const audiences=value=>Array.isArray(value)?value:[value];
async function jwks(){if(jwksCache.expires>Date.now()&&jwksCache.keys.length)return jwksCache.keys;const response=await fetch(`${OIDC_ISSUER}/.well-known/jwks`,{headers:{Accept:'application/json'}});if(!response.ok)throw Object.assign(new Error('تعذر التحقق من هوية GitHub Actions'),{status:502,code:'GITHUB_OIDC_JWKS_FAILED'});const data=await response.json();jwksCache={expires:Date.now()+3600000,keys:Array.isArray(data.keys)?data.keys:[]};return jwksCache.keys;}
async function verifyGithubOidc(token){const parts=String(token||'').split('.');if(parts.length!==3)throw Object.assign(new Error('رمز GitHub Actions غير صالح'),{status:401,code:'FUEL_SYNC_AUTH_REQUIRED'});const header=base64Json(parts[0]),claims=base64Json(parts[1]);if(!header||!claims||header.alg!=='RS256'||!header.kid)throw Object.assign(new Error('بنية رمز GitHub Actions غير صالحة'),{status:401,code:'FUEL_SYNC_AUTH_INVALID'});const key=(await jwks()).find(item=>item.kid===header.kid);if(!key)throw Object.assign(new Error('مفتاح GitHub Actions غير معروف'),{status:401,code:'FUEL_SYNC_AUTH_KEY_UNKNOWN'});const valid=crypto.verify('RSA-SHA256',Buffer.from(`${parts[0]}.${parts[1]}`),crypto.createPublicKey({key,format:'jwk'}),Buffer.from(parts[2],'base64url')),now=Math.floor(Date.now()/1000);if(!valid||claims.iss!==OIDC_ISSUER||!audiences(claims.aud).includes(OIDC_AUDIENCE)||claims.repository!==REPOSITORY||Number(claims.exp||0)<=now||Number(claims.nbf||0)>now+30)throw Object.assign(new Error('هوية GitHub Actions لا تخص مستودع مصنع بن حامد'),{status:401,code:'FUEL_SYNC_AUTH_INVALID'});if(claims.ref!=='refs/heads/main'&&!String(claims.workflow_ref||'').includes('/.github/workflows/noor-khoy-fuel-sync.yml@refs/heads/main'))throw Object.assign(new Error('تشغيل مزامنة الوقود غير صادر من الفرع الرئيسي'),{status:403,code:'FUEL_SYNC_REF_FORBIDDEN'});return claims;}
async function requireSyncIdentity(req){const auth=clean(req.headers?.authorization,3000);if(config.cronSecret&&auth===`Bearer ${config.cronSecret}`)return{kind:'cron-secret'};if(!auth.startsWith('Bearer '))throw Object.assign(new Error('هوية مزامنة الوقود مطلوبة'),{status:401,code:'FUEL_SYNC_AUTH_REQUIRED'});return{kind:'github-oidc',claims:await verifyGithubOidc(auth.slice(7))};}
function reportDate(req,rows){const explicit=clean(req.headers?.['x-fuel-report-date'],20);if(validDate(explicit))return explicit;return rows.map(row=>clean(row.date,30).slice(0,10)).filter(validDate).sort().at(-1)||riyadhDate();}
const category=row=>row.category||(/petrol|gasoline|بنزين|91|95/i.test(row.fuelType||'')?'petrol':'diesel');
function totals(rows){const byCategory={},plates=new Set();for(const row of rows){const key=category(row);byCategory[key]??={rows:0,liters:0,amount:0};byCategory[key].rows++;byCategory[key].liters+=Number(row.liters||0);byCategory[key].amount+=Number(row.amount||0);if(row.plateKey||row.plate)plates.add(clean(row.plateKey||row.plate,100));}for(const value of Object.values(byCategory)){value.liters=Number(value.liters.toFixed(3));value.amount=Number(value.amount.toFixed(2));}return{rows:rows.length,plateCount:plates.size,liters:Number(rows.reduce((sum,row)=>sum+Number(row.liters||0),0).toFixed(3)),amount:Number(rows.reduce((sum,row)=>sum+Number(row.amount||0),0).toFixed(2)),categories:byCategory};}
function storedRows(rows){return rows.map(row=>({receipt:row.receipt||'',driver:row.driver||'',station:row.station||'',vehicleName:row.vehicleName||'',plate:row.plate||'',plateKey:row.plateKey||'',fuelType:row.fuelType||'',category:category(row),date:row.date||'',liters:Number(row.liters||0),amount:Number(row.amount||0),price:Number(row.price||0),beforeTax:Number(row.beforeTax||0),tax:Number(row.tax||0),net:Number(row.net||row.amount||0),prevOdometer:Number(row.prevOdometer||0),currOdometer:Number(row.currOdometer||0),serviceKm:Number(row.serviceKm||0),sourceRow:Number(row.row||0)}));}
function categorySummary(summary){const names={diesel:'الديزل',petrol:'البنزين',other:'أنواع أخرى'};return Object.entries(summary.categories||{}).filter(([,value])=>Number(value.rows||0)>0).map(([key,value])=>`${names[key]||key}: <b>${value.rows}</b> حركة، <b>${value.liters}</b> لتر، <b>${value.amount} ر.س</b>`).join('\n');}
const periodLabel=period=>period.start===period.end?period.end:`من <b>${period.start}</b> إلى <b>${period.end}</b>`;
function telegramRecipients(){return [...new Set([config.telegramOwnerId,FACTORY_MANAGER_CHAT_ID].map(value=>clean(value,40)).filter(Boolean))];}
async function telegramDelivery({workbook,rows,sourceFile,reportDate,period,summary,accountBalance,duplicate}){
  const recipients=telegramRecipients();
  if(!recipients.length||!config.telegramToken)return{disabled:true};
  const label=periodLabel(period),prefix=duplicate?`تم إعادة إرسال إقرار الوقود للفترة ${label}.`:`تم رفع إقرار الوقود للفترة ${label}.`,detail=categorySummary(summary),balanceLine=Number.isFinite(accountBalance)?`\nرصيد خزنة المحطة المتبقي بنهاية يوم <b>${reportDate}</b>: <b>${Number(accountBalance).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} ر.س</b>`:'',message=`${prefix}\nإجمالي الحركات: <b>${summary.rows}</b>\nإجمالي اللترات: <b>${summary.liters}</b>\nإجمالي المبلغ: <b>${summary.amount} ر.س</b>${balanceLine}${detail?`\n\n${detail}`:''}\nالملف: <b>${clean(sourceFile,150)}</b>`;
  const messageResults=await Promise.allSettled(recipients.map(chatId=>sendMessage(chatId,message)));
  try{
    const reports=await generateFuelReportPdfs(workbook,XLSX,sourceFile,{reportDate,rows,accountBalance});
    const documentResults=[];
    for(const chatId of recipients){for(const report of reports)documentResults.push(await Promise.resolve(sendDocumentBuffer(chatId,report.pdf,report.filename,'application/pdf',report.caption)).then(()=>({ok:true})).catch(error=>({ok:false,error:clean(error?.message,200)})));}
    return{duplicate,reports:reports.map(item=>item.filename),recipients:recipients.length,messageFailures:messageResults.filter(result=>result.status==='rejected').length,documentFailures:documentResults.filter(result=>!result.ok).length};
  }catch(error){return{duplicate,reports:[],recipients:recipients.length,messageFailures:messageResults.filter(result=>result.status==='rejected').length,error:clean(error?.message,300)};}
}
function vehicleBalanceInput(value){const amount=Number(value?.total),vehicleCount=Number(value?.vehicleCount),capturedAt=new Date(clean(value?.capturedAt,80)||Date.now());if(!Number.isFinite(amount)||amount<0||amount>10_000_000)throw Object.assign(new Error('إجمالي رصيد المركبات غير صالح'),{status:400,code:'VEHICLE_BALANCE_INVALID'});if(!Number.isInteger(vehicleCount)||vehicleCount<1||vehicleCount>5000)throw Object.assign(new Error('عدد المركبات غير صالح'),{status:400,code:'VEHICLE_BALANCE_INVALID'});if(Number.isNaN(capturedAt.getTime()))throw Object.assign(new Error('وقت قراءة الرصيد غير صالح'),{status:400,code:'VEHICLE_BALANCE_INVALID'});return{amount:Number(amount.toFixed(2)),vehicleCount,capturedAt:capturedAt.toISOString()};}
async function vehicleBalanceAlreadySent(day){const key=`vehicle_diesel_balance:${day}`,rows=await select('audit_log',`action=eq.vehicle_diesel_balance_report_sent&entity_id=eq.${encoded(key)}&select=id&limit=1`).catch(()=>[]);return Boolean(rows?.[0]);}
async function sendVehicleBalanceReport(req,res){
  const balance=vehicleBalanceInput(await body(req,30_000)),day=riyadhDate(balance.capturedAt);
  if(await vehicleBalanceAlreadySent(day))return json(res,200,{ok:true,duplicate:true,day});
  const recipients=telegramRecipients();if(!recipients.length||!config.telegramToken)throw Object.assign(new Error('إعدادات إرسال تيليجرام غير مكتملة'),{status:503,code:'TELEGRAM_NOT_CONFIGURED'});
  const amount=balance.amount.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}),message=`<b>رصيد الديزل المتوفر في المركبات</b>\n\nالرصيد المتوفر في المركبات مبلغه: <b>${amount} ر.س</b>\nعدد المركبات ذات الرصيد: <b>${balance.vehicleCount}</b>\nوقت القراءة: <b>${new Intl.DateTimeFormat('ar-SA',{timeZone:'Asia/Riyadh',dateStyle:'medium',timeStyle:'short'}).format(new Date(balance.capturedAt))}</b>`;
  const results=await Promise.allSettled(recipients.map(chatId=>sendMessage(chatId,message,{action_name:'vehicle_diesel_balance_report',action_payload:{day,total:balance.amount,vehicleCount:balance.vehicleCount,capturedAt:balance.capturedAt}}))),failures=results.filter(item=>item.status==='rejected').length;
  if(failures)throw Object.assign(new Error(`تعذر إرسال التقرير إلى ${failures} مستلم`),{status:502,code:'VEHICLE_BALANCE_DELIVERY_FAILED'});
  await insert('audit_log',[{actor_type:'system',actor_id:'github-actions',action:'vehicle_diesel_balance_report_sent',entity_type:'fuel_balance',entity_id:`vehicle_diesel_balance:${day}`,details:{total:balance.amount,vehicle_count:balance.vehicleCount,captured_at:balance.capturedAt,recipient_count:recipients.length},created_at:new Date().toISOString()}],{prefer:'return=minimal'}).catch(()=>{});
  return json(res,200,{ok:true,day,total:balance.amount,vehicleCount:balance.vehicleCount,recipients:recipients.length});
}
// الصفوف تُحفظ أيضًا في fuel_transactions المفهرس. سجل imports يحتفظ بها كـJSON
// داخل summary، وهو صالح للأرشيف لا للاستعلام: لا يجيب «كم سحبت هذه المركبة من
// أول الشهر حتى أمس» دون مسح كل الملفات. الفشل هنا لا يُسقط المزامنة لكنه يُبلَّغ
// في الاستجابة بدل أن يُبتلع.
async function persistFuelLedger(rows,sourceFile){
  try{return await storeFuelRows(rows,{sourceFile,source:'noor-khoy'});}
  catch(error){const reason=storeFailureReason(error);console.warn('[fuel ledger]',{reason,message:clean(error?.message,200)});return{stored:0,skipped:0,failed:rows.length,reason};}
}

async function cleanupInvalidJulyImports(period){if(period.start!=='2026-07-01'||period.end!=='2026-07-26')return{removed:0,skipped:true};const removed=await remove('imports',`id=in.(${INVALID_JULY_IMPORT_IDS.join(',')})`);return{removed:Array.isArray(removed)?removed.length:0,ids:INVALID_JULY_IMPORT_IDS};}
async function findExisting(period,hash){const periodQuery=`source=eq.noor-khoy&report_type=eq.fuel&summary->period->>start=eq.${period.start}&summary->period->>end=eq.${period.end}&select=id,status,file_path,summary&limit=1`;const byPeriod=(await select('imports',periodQuery))?.[0];if(byPeriod)return byPeriod;return(await select('imports',`file_hash=eq.${hash}&select=id,status,file_path,summary&limit=1`))?.[0]||null;}

export async function fuelDailyReport(req,res){
  if(!method(req,res,['POST']))return;
  try{
    const identity=await requireSyncIdentity(req);
    if(clean(req.headers?.['x-fuel-operation'],80)==='vehicle-balance-report')return sendVehicleBalanceReport(req,res);
    const buffer=await rawBody(req,config.maxImportFileBytes);if(!buffer.length)throw Object.assign(new Error('ملف الوقود غير موجود'),{status:400,code:'FUEL_SYNC_FILE_REQUIRED'});
    let workbook;try{workbook=XLSX.read(buffer,{type:'buffer',cellDates:true});}catch{throw Object.assign(new Error('الملف ليس Excel صالحًا'),{status:415,code:'FUEL_SYNC_EXCEL_REQUIRED'});}
    const parsed=parseFuelWorkbook(workbook,XLSX);if(!parsed.rowCount)throw Object.assign(new Error('لم يتم العثور على حركات وقود قابلة للقراءة داخل الملف'),{status:422,code:'FUEL_SYNC_NO_ROWS'});
    const operationalRows=parsed.rows.filter(row=>!privateFuelRow(row)),originalName=filename(req),hash=crypto.createHash('sha256').update(buffer).digest('hex'),date=reportDate(req,parsed.rows),period=requestPeriod(req,date),accountBalance=requestBalance(req),balanceCapturedAt=requestBalanceCapturedAt(req,accountBalance),balanceDate=requestBalanceDate(req,date,accountBalance),notify=requestNotify(req),summary=totals(operationalRows),sourceSummary=totals(parsed.rows);
    const cleanup=await runStage('cleanup_invalid_trials','تعذر تنظيف سجلات الوقود التجريبية',()=>cleanupInvalidJulyImports(period));
    const existing=await runStage('imports_lookup','تعذر فحص الملفات الواردة',()=>findExisting(period,hash));
    const storagePath=existing?.file_path||`noor-khoy-fuel/${date}/${hash.slice(0,16)}-${safeFile(originalName)}`;
    if(!existing?.file_path)await runStage('storage_upload','تعذر حفظ ملف Excel الأصلي',()=>uploadObject(storagePath,buffer,MIME));
    const registrySummary={fuel:summary,sourceFuel:sourceSummary,fuelRows:storedRows(operationalRows),accountBalance,balanceDate,balanceCapturedAt,period,storage:{kind:'imports_registry',originalFile:storagePath},source:{kind:'noor-khoy',reportDate:date,receivedAt:new Date().toISOString(),identity:identity.kind,sheets:workbook.SheetNames}};
    if(existing&&['posted','approved'].includes(existing.status)){
      await runStage('import_update','تعذر تحديث سجل الوقود الموجود',()=>patch('imports',`id=eq.${encoded(existing.id)}`,{summary:{...(existing.summary||{}),...registrySummary},row_count:operationalRows.length,file_path:storagePath,file_hash:hash,original_name:originalName}));
      const ledger=await persistFuelLedger(operationalRows,originalName);
      const telegram=notify?await telegramDelivery({workbook,rows:operationalRows,sourceFile:originalName,reportDate:date,period,summary,accountBalance,duplicate:true}):{skipped:true};
      return json(res,200,{ok:true,duplicate:true,ledger,period,reportDate:date,accountBalance,balanceDate,balanceCapturedAt,fileHash:hash,importId:existing.id,storagePath,storedRows:operationalRows.length,summary,cleanup,storage:'imports_registry',telegram});
    }
    let imp=existing;
    if(!imp){const result=await runStage('import_insert','تعذر تسجيل ملف الوقود في مركز الوارد',()=>insert('imports',[{source:'noor-khoy',department:'operations',report_type:'fuel',status:'approved',original_name:originalName,mime_type:MIME,file_path:storagePath,file_hash:hash,row_count:operationalRows.length,error_count:0,warning_count:0,summary:registrySummary,last_error_code:null,last_error_message:null}]));imp=result?.[0];}
    else{const result=await runStage('import_update','تعذر تحديث ملف الوقود في مركز الوارد',()=>patch('imports',`id=eq.${encoded(imp.id)}`,{status:'approved',original_name:originalName,file_path:storagePath,file_hash:hash,row_count:operationalRows.length,summary:registrySummary,last_error_code:null,last_error_message:null}));imp=result?.[0]||imp;}
    if(!imp?.id)throw Object.assign(new Error('تعذر تسجيل تقرير الوقود في مركز الوارد'),{status:502,code:'FUEL_SYNC_IMPORT_REGISTER_FAILED'});
    const ledger=await persistFuelLedger(operationalRows,originalName);
    const telegram=notify?await telegramDelivery({workbook,rows:operationalRows,sourceFile:originalName,reportDate:date,period,summary,accountBalance,duplicate:false}):{skipped:true};
    return json(res,200,{ok:true,duplicate:false,ledger,period,reportDate:date,accountBalance,balanceDate,balanceCapturedAt,fileHash:hash,importId:imp.id,storagePath,storedRows:operationalRows.length,summary,cleanup,storage:'imports_registry',telegram});
  }catch(error){errorResponse(res,error);}
}
