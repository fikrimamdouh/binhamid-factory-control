import fs from 'node:fs';

function read(file){return fs.readFileSync(file,'utf8');}
function write(file,content){fs.writeFileSync(file,content,'utf8');}
function replaceOnce(content,before,after,label){
  const first=content.indexOf(before);
  if(first<0)throw new Error(`Missing patch target: ${label}`);
  if(content.indexOf(before,first+before.length)>=0)throw new Error(`Patch target is not unique: ${label}`);
  return content.slice(0,first)+after+content.slice(first+before.length);
}
function replaceRegexOnce(content,pattern,after,label){
  const matches=[...content.matchAll(new RegExp(pattern.source,pattern.flags.includes('g')?pattern.flags:`${pattern.flags}g`))];
  if(matches.length!==1)throw new Error(`Expected one regex target for ${label}, found ${matches.length}`);
  return content.replace(pattern,after);
}

const scriptFile='scripts/noor-khoy-fuel-sync.mjs';
let script=read(scriptFile);
script=replaceOnce(script,'async function uploadVehicleBalance(summary){','async function uploadVehicleBalance(summary,accountBalance){','balance upload signature');
script=replaceOnce(script,"'x-fuel-operation':'vehicle-balance-report'","'x-fuel-operation':'combined-balance-report'",'combined operation header');
script=replaceOnce(script,'body:JSON.stringify({total:summary.total,vehicleCount:summary.rows.length,capturedAt})','body:JSON.stringify({total:summary.total,accountBalance,vehicleCount:summary.rows.length,capturedAt})','combined balance payload');
script=replaceOnce(
  script,
  "await ensureLogin(page);await page.goto(VEHICLES_URL,{waitUntil:'domcontentloaded',timeout:60000});",
  "await ensureLogin(page);const accountBalance=await extractDieselBalance(page),accountBalanceCapturedAt=new Date().toISOString();await fs.writeFile(path.join(artifacts,'dashboard-balance.json'),JSON.stringify({accountBalance,capturedAt:accountBalanceCapturedAt,meaning:'station-current-account-balance'},null,2));if(accountBalance===null)throw new Error('لم يتم العثور على الرصيد الموجود في الحساب بصفحة الشركات.');await page.goto(VEHICLES_URL,{waitUntil:'domcontentloaded',timeout:60000});",
  'dashboard balance capture'
);
script=replaceOnce(
  script,
  'const delivery=await uploadVehicleBalance(summary);console.log(JSON.stringify({ok:true,mode:syncMode,total:summary.total,vehicleCount:summary.rows.length,balanceHeader:summary.header,delivery},null,2));return;',
  'const delivery=await uploadVehicleBalance(summary,accountBalance);console.log(JSON.stringify({ok:true,mode:syncMode,total:summary.total,accountBalance,vehicleCount:summary.rows.length,balanceHeader:summary.header,delivery},null,2));return;',
  'combined balance delivery'
);
write(scriptFile,script);

const routeFile='api/_lib/routes/fuel-sync.js';
let route=read(routeFile);
route=replaceOnce(
  route,
  'function vehicleBalanceInput(value){const amount=Number(value?.total),vehicleCount=Number(value?.vehicleCount),capturedAt=new Date(clean(value?.capturedAt,80)||Date.now());',
  'function vehicleBalanceInput(value){const amount=Number(value?.total),accountBalance=Number(value?.accountBalance),vehicleCount=Number(value?.vehicleCount),capturedAt=new Date(clean(value?.capturedAt,80)||Date.now());',
  'combined balance input'
);
route=replaceOnce(
  route,
  "if(!Number.isFinite(amount)||amount<0||amount>10_000_000)throw Object.assign(new Error('إجمالي رصيد المركبات غير صالح'),{status:400,code:'VEHICLE_BALANCE_INVALID'});if(!Number.isInteger(vehicleCount)",
  "if(!Number.isFinite(amount)||amount<0||amount>10_000_000)throw Object.assign(new Error('إجمالي رصيد المركبات غير صالح'),{status:400,code:'VEHICLE_BALANCE_INVALID'});if(!Number.isFinite(accountBalance)||accountBalance<0||accountBalance>10_000_000)throw Object.assign(new Error('رصيد الحساب غير صالح'),{status:400,code:'ACCOUNT_BALANCE_INVALID'});if(!Number.isInteger(vehicleCount)",
  'account balance validation'
);
route=replaceOnce(route,'return{amount:Number(amount.toFixed(2)),vehicleCount,capturedAt:capturedAt.toISOString()};','return{amount:Number(amount.toFixed(2)),accountBalance:Number(accountBalance.toFixed(2)),vehicleCount,capturedAt:capturedAt.toISOString()};','normalized combined balance');
route=replaceOnce(route,'return Number(details.total)===balance.amount&&Number(details.vehicle_count)===balance.vehicleCount;','return Number(details.total)===balance.amount&&Number(details.account_balance)===balance.accountBalance&&Number(details.vehicle_count)===balance.vehicleCount;','combined duplicate comparison');
route=replaceRegexOnce(
  route,
  /^  const amount=balance\.amount\.toLocaleString.*$/m,
  "  const amount=balance.amount.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}),accountAmount=balance.accountBalance.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}),message=`رصيد الديزل غير المستخدم في السيارات: <b>${amount} ر.س</b>\\nالرصيد الموجود في الحساب: <b>${accountAmount} ر.س</b>`;",
  'two-line Telegram message'
);
route=replaceOnce(route,'action_payload:{day,total:balance.amount,vehicleCount:balance.vehicleCount,capturedAt:balance.capturedAt}','action_payload:{day,total:balance.amount,accountBalance:balance.accountBalance,vehicleCount:balance.vehicleCount,capturedAt:balance.capturedAt}','Telegram action payload');
route=replaceOnce(route,'details:{total:balance.amount,vehicle_count:balance.vehicleCount,captured_at:balance.capturedAt,recipient_count:recipients.length}','details:{total:balance.amount,account_balance:balance.accountBalance,vehicle_count:balance.vehicleCount,captured_at:balance.capturedAt,recipient_count:recipients.length}','audit details');
route=replaceOnce(route,'return json(res,200,{ok:true,corrected:Boolean(previous),day,total:balance.amount,vehicleCount:balance.vehicleCount,recipients:recipients.length});','return json(res,200,{ok:true,corrected:Boolean(previous),day,total:balance.amount,accountBalance:balance.accountBalance,vehicleCount:balance.vehicleCount,recipients:recipients.length});','combined response');
route=replaceOnce(route,"if(clean(req.headers?.['x-fuel-operation'],80)==='vehicle-balance-report')return sendVehicleBalanceReport(req,res);","if(['vehicle-balance-report','combined-balance-report'].includes(clean(req.headers?.['x-fuel-operation'],80)))return sendVehicleBalanceReport(req,res);",'combined operation routing');
write(routeFile,route);

const testFile='tests/noor-khoy-fuel-sync.test.mjs';
let tests=read(testFile);
tests=replaceOnce(tests,"assert.match(script,/x-fuel-operation':'vehicle-balance-report/);","assert.match(script,/x-fuel-operation':'combined-balance-report/);\n  assert.match(script,/accountBalance=await extractDieselBalance/);",'script assertions');
tests=replaceOnce(tests,'assert.match(route,/رصيد الديزل المتوفر في المركبات/);','assert.match(route,/رصيد الديزل غير المستخدم في السيارات/);\n  assert.match(route,/الرصيد الموجود في الحساب/);\n  assert.match(route,/account_balance/);','message assertions');
tests=replaceOnce(tests,'assert.match(route,/تصحيح رصيد الديزل المتوفر في المركبات/);','assert.match(route,/combined-balance-report/);','combined route assertion');
write(testFile,tests);

console.log('Combined vehicle/account fuel balance patch applied.');
