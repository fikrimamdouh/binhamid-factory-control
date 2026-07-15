import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.TELEGRAM_BOT_TOKEN='123456:test-token-for-validation';

const { validateTelegramWebApp }=await import('../api/_lib/telegram-webapp.js');

function buildInitData({userId=596067272,authDate=Math.floor(Date.now()/1000),name='Test User'}={}){
  const values={
    auth_date:String(authDate),
    query_id:'AAE-test-query',
    user:JSON.stringify({id:userId,first_name:name,language_code:'ar'})
  };
  const check=Object.entries(values).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>`${key}=${value}`).join('\n');
  const secret=crypto.createHmac('sha256','WebAppData').update(process.env.TELEGRAM_BOT_TOKEN).digest();
  const hash=crypto.createHmac('sha256',secret).update(check).digest('hex');
  return new URLSearchParams({...values,hash}).toString();
}

test('accepts a correctly signed Telegram Mini App session',()=>{
  const result=validateTelegramWebApp(buildInitData());
  assert.equal(result.user.id,596067272);
  assert.equal(result.queryId,'AAE-test-query');
});

test('rejects a modified Telegram Mini App session',()=>{
  const valid=buildInitData();
  const modified=valid.replace('Test+User','Changed+User');
  assert.throws(()=>validateTelegramWebApp(modified),/غير صحيحة|التحقق/);
});

test('rejects an expired Telegram Mini App session',()=>{
  const expired=buildInitData({authDate:Math.floor(Date.now()/1000)-3600});
  assert.throws(()=>validateTelegramWebApp(expired),/انتهت صلاحية/);
});
