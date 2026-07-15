import crypto from 'node:crypto';
import { config } from './config.js';

function equalHex(left,right){
  try{
    const a=Buffer.from(String(left||''),'hex');
    const b=Buffer.from(String(right||''),'hex');
    return a.length===b.length&&a.length>0&&crypto.timingSafeEqual(a,b);
  }catch{return false;}
}

export function validateTelegramWebApp(initData,maxAgeSeconds=600){
  if(!config.telegramToken)throw Object.assign(new Error('Telegram Bot Token غير مضبوط'),{status:503});
  const params=new URLSearchParams(String(initData||''));
  const received=params.get('hash');
  if(!received)throw Object.assign(new Error('تعذر التحقق من جلسة Telegram'),{status:401});
  params.delete('hash');
  const check=[...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>`${key}=${value}`).join('\n');
  const secret=crypto.createHmac('sha256','WebAppData').update(config.telegramToken).digest();
  const calculated=crypto.createHmac('sha256',secret).update(check).digest('hex');
  if(!equalHex(received,calculated))throw Object.assign(new Error('جلسة Telegram غير صحيحة'),{status:401});
  const authDate=Number(params.get('auth_date')||0);
  const age=Date.now()/1000-authDate;
  if(!authDate||age< -60||age>maxAgeSeconds)throw Object.assign(new Error('انتهت صلاحية شاشة الحضور. افتحها من البوت مرة أخرى'),{status:401});
  let user=null;
  try{user=JSON.parse(params.get('user')||'{}');}catch{}
  if(!user?.id)throw Object.assign(new Error('بيانات مستخدم Telegram غير موجودة'),{status:401});
  return{user,queryId:params.get('query_id')||'',authDate};
}
