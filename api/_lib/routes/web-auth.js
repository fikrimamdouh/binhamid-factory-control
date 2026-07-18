import crypto from 'node:crypto';
import { body, errorResponse, json, method } from '../http.js';
import { assertSameOrigin, issueDeviceSession } from '../device-session.js';
import { insert, patch, select } from '../supabase.js';
import { sendMessage } from '../telegram.js';
import { config } from '../config.js';

const clean=(value,max=160)=>String(value??'').trim().slice(0,max);
const validDevice=value=>/^dev-[A-Za-z0-9-]{8,150}$/.test(String(value||''));
const validTelegram=value=>/^\d{5,20}$/.test(String(value||''));
const hash=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const same=(a,b)=>{const aa=Buffer.from(String(a||'')),bb=Buffer.from(String(b||''));return aa.length===bb.length&&aa.length>0&&crypto.timingSafeEqual(aa,bb);};
async function activeUser(telegramId){
  const row=(await select('user_channels',`channel=eq.telegram&external_id=eq.${encodeURIComponent(String(telegramId))}&active=eq.true&select=user_id,app_users(id,full_name,role,active)&limit=1`).catch(()=>[]))?.[0],user=row?.app_users;
  return user?.active?user:null;
}
async function enrollment(deviceId){return(await select('device_enrollments',`device_id=eq.${encodeURIComponent(deviceId)}&select=device_id,status,app_user_id,metadata&limit=1`).catch(()=>[]))?.[0]||null;}
async function saveEnrollment(deviceId,values){const existing=await enrollment(deviceId);if(existing)return patch('device_enrollments',`device_id=eq.${encodeURIComponent(deviceId)}`,values);return insert('device_enrollments',[{device_id:deviceId,status:'pending',requested_at:new Date().toISOString(),last_seen_at:new Date().toISOString(),updated_at:new Date().toISOString(),metadata:values.metadata||{}}]);}

export async function requestWebLogin(req,res){
  if(!method(req,res,['POST']))return;
  try{
    assertSameOrigin(req);const input=await body(req,4096),deviceId=clean(input.deviceId),telegramId=clean(input.telegramId||config.telegramOwnerId,20);if(!validDevice(deviceId)||!validTelegram(telegramId))throw Object.assign(new Error('حساب مالك Telegram غير مضبوط في الخادم.'),{status:503});
    const user=await activeUser(telegramId);if(!user)throw Object.assign(new Error('هذا الحساب غير معتمد للدخول إلى الموقع.'),{status:403});
    const current=await enrollment(deviceId),previous=current?.metadata?.web_login||{},now=Date.now();if(Number(previous.sentAt||0)>now-45_000)throw Object.assign(new Error('تم إرسال رمز قبل قليل. انتظر 45 ثانية.'),{status:429});
    const code=String(crypto.randomInt(100000,1000000)),webLogin={telegramId,codeHash:hash(`${deviceId}:${code}`),sentAt:now,expiresAt:now+5*60_000,attempts:0};
    await saveEnrollment(deviceId,{status:'pending',last_seen_at:new Date().toISOString(),updated_at:new Date().toISOString(),metadata:{...(current?.metadata||{}),web_login:webLogin}});
    await sendMessage(telegramId,`<b>رمز دخول موقع مصنع بن حامد</b>\n\nالرمز: <code>${code}</code>\nصالح لمدة 5 دقائق. لا تشاركه مع أي شخص.`);
    json(res,200,{ok:true,expiresIn:300,maskedUser:user.full_name||'مستخدم معتمد'});
  }catch(error){errorResponse(res,error);}
}
export async function verifyWebLogin(req,res){
  if(!method(req,res,['POST']))return;
  try{
    assertSameOrigin(req);const input=await body(req,4096),deviceId=clean(input.deviceId),telegramId=clean(input.telegramId||config.telegramOwnerId,20),code=clean(input.code,12);if(!validDevice(deviceId)||!validTelegram(telegramId)||!/^\d{6}$/.test(code))throw Object.assign(new Error('بيانات الدخول غير صحيحة.'),{status:400});
    const current=await enrollment(deviceId),login=current?.metadata?.web_login||{};if(String(login.telegramId)!==telegramId||Number(login.expiresAt||0)<Date.now()||Number(login.attempts||0)>=5||!same(login.codeHash,hash(`${deviceId}:${code}`))) {await saveEnrollment(deviceId,{metadata:{...(current?.metadata||{}),web_login:{...login,attempts:Number(login.attempts||0)+1}}});throw Object.assign(new Error('الرمز غير صحيح أو انتهت صلاحيته.'),{status:401});}
    const user=await activeUser(telegramId);if(!user)throw Object.assign(new Error('الحساب غير معتمد أو موقوف.'),{status:403});
    await saveEnrollment(deviceId,{status:'approved',app_user_id:user.id,approved_at:new Date().toISOString(),approved_by:`telegram:${telegramId}`,last_seen_at:new Date().toISOString(),updated_at:new Date().toISOString(),metadata:{...(current?.metadata||{}),web_login:{verifiedAt:Date.now(),telegramId}}});
    const session=issueDeviceSession(req,res,deviceId,user.id);json(res,200,{ok:true,user:{id:user.id,name:user.full_name||'',role:user.role||'employee'},expiresAt:new Date(session.exp*1000).toISOString()});
  }catch(error){errorResponse(res,error);}
}
