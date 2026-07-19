import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('customer opening importer accepts the untouched old-system trial balance layout',async()=>{
  const source=await read('assets/customer-opening-balances.js');
  for(const marker of [
    'old_trial_balance','detectOldTrialBalance','ميزان مراجعه عن فتره','العميل','مدين','دائن','الرصيد','الاجمالي',
    "name:client+1","raw:true","raw:false",'parseOldRows','sourceFormat:row.sourceFormat'
  ])assert.ok(source.includes(marker),`missing ${marker}`);
  assert.match(source,/balance=parseAmount\(rowValue\(rawRow,layout\.balance\)\)/);
  assert.match(source,/previous\+debit-credit/);
  assert.match(source,/Math\.abs\(rounded\)<0\.005\?0:rounded/);
});

test('customer opening importer keeps the existing template path and Arabic debit-credit nature',async()=>{
  const source=await read('assets/customer-opening-balances.js');
  for(const marker of ['opening_balance_template','detectTemplate','نوع الرصيد','طبيعة الرصيد','دائن','مدين','balanceByType'])assert.ok(source.includes(marker),`missing ${marker}`);
});

test('Telegram analytics reads imported balances from the same cloud state snapshot',async()=>{
  const source=await read('api/_lib/bot-customer-report-data.js');
  for(const marker of ['extractStateCustomerData','customerOpeningBalances','customerCodeMap',"select('app_state'",'openingBalances:stateData.openingBalances'])assert.ok(source.includes(marker),`missing ${marker}`);
});
