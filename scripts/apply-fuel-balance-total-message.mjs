import fs from 'node:fs';

function read(file){return fs.readFileSync(file,'utf8');}
function write(file,content){fs.writeFileSync(file,content,'utf8');}
function replaceOnce(content,before,after,label){
  const first=content.indexOf(before);
  if(first<0)throw new Error(`Missing patch target: ${label}`);
  if(content.indexOf(before,first+before.length)>=0)throw new Error(`Patch target is not unique: ${label}`);
  return content.slice(0,first)+after+content.slice(first+before.length);
}

const routeFile='api/_lib/routes/fuel-sync.js';
let route=read(routeFile);
route=replaceOnce(
  route,
  "const REPOSITORY='fikrimamdouh/binhamid-factory-control',OIDC_ISSUER='https://token.actions.githubusercontent.com',OIDC_AUDIENCE='binhamid-fuel-sync',MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',PRIVATE_PLATE_KEY='DGD7293',FACTORY_MANAGER_CHAT_ID='6870312376';",
  "const REPOSITORY='fikrimamdouh/binhamid-factory-control',OIDC_ISSUER='https://token.actions.githubusercontent.com',OIDC_AUDIENCE='binhamid-fuel-sync',MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',PRIVATE_PLATE_KEY='DGD7293',FACTORY_MANAGER_CHAT_ID='6870312376',BALANCE_MESSAGE_VERSION='v2-total';",
  'balance message version constant'
);
route=replaceOnce(
  route,
  'return Number(details.total)===balance.amount&&Number(details.account_balance)===balance.accountBalance&&Number(details.vehicle_count)===balance.vehicleCount;',
  'return details.message_version===BALANCE_MESSAGE_VERSION&&Number(details.total)===balance.amount&&Number(details.account_balance)===balance.accountBalance&&Number(details.vehicle_count)===balance.vehicleCount;',
  'message-version duplicate check'
);
route=replaceOnce(
  route,
  "const amount=balance.amount.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}),accountAmount=balance.accountBalance.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}),message=`رصيد الديزل غير المستخدم في السيارات: <b>${amount} ر.س</b>\nالرصيد الموجود في الحساب: <b>${accountAmount} ر.س</b>`;",
  "const formatter=new Intl.NumberFormat('ar-SA-u-nu-latn',{minimumFractionDigits:2,maximumFractionDigits:2}),amount=formatter.format(balance.amount),accountAmount=formatter.format(balance.accountBalance),grandTotal=Number((balance.amount+balance.accountBalance).toFixed(2)),grandAmount=formatter.format(grandTotal),message=`<b>ملخص أرصدة الديزل</b>\n\nرصيد السيارات غير المستخدم: <b>${amount} ر.س</b>\nرصيد الحساب: <b>${accountAmount} ر.س</b>\n━━━━━━━━━━━━\n<b>إجمالي الرصيد المتاح: ${grandAmount} ر.س</b>`;",
  'formatted Telegram message with total'
);
route=replaceOnce(
  route,
  "action_payload:{day,total:balance.amount,accountBalance:balance.accountBalance,vehicleCount:balance.vehicleCount,capturedAt:balance.capturedAt}",
  "action_payload:{day,total:balance.amount,accountBalance:balance.accountBalance,grandTotal,vehicleCount:balance.vehicleCount,capturedAt:balance.capturedAt}",
  'Telegram payload total'
);
route=replaceOnce(
  route,
  "details:{total:balance.amount,account_balance:balance.accountBalance,vehicle_count:balance.vehicleCount,captured_at:balance.capturedAt,recipient_count:recipients.length}",
  "details:{total:balance.amount,account_balance:balance.accountBalance,grand_total:grandTotal,vehicle_count:balance.vehicleCount,message_version:BALANCE_MESSAGE_VERSION,captured_at:balance.capturedAt,recipient_count:recipients.length}",
  'audit total and message version'
);
route=replaceOnce(
  route,
  'return json(res,200,{ok:true,corrected:Boolean(previous),day,total:balance.amount,accountBalance:balance.accountBalance,vehicleCount:balance.vehicleCount,recipients:recipients.length});',
  'return json(res,200,{ok:true,corrected:Boolean(previous),day,total:balance.amount,accountBalance:balance.accountBalance,grandTotal,vehicleCount:balance.vehicleCount,recipients:recipients.length});',
  'response total'
);
write(routeFile,route);

const testFile='tests/noor-khoy-fuel-sync.test.mjs';
let tests=read(testFile);
tests=replaceOnce(
  tests,
  "assert.match(route,/الرصيد الموجود في الحساب/);\n  assert.match(route,/account_balance/);",
  "assert.match(route,/رصيد الحساب/);\n  assert.match(route,/إجمالي الرصيد المتاح/);\n  assert.match(route,/grandTotal/);\n  assert.match(route,/grand_total/);\n  assert.match(route,/message_version/);\n  assert.match(route,/account_balance/);",
  'total message assertions'
);
write(testFile,tests);

console.log('Fuel balance total message patch applied.');
