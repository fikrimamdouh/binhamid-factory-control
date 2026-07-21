import crypto from 'node:crypto';
import { config } from './config.js';

export const DEVICE_COOKIE='bh_device_session';
// The automatic cookie authenticates the browser transport only. It grants no
// business-data capability; every business action still requires an active user
// or the protected administrator credential.
export const DEVICE_CAPABILITIES=Object.freeze([]);
const SESSION_VERSION=4;
// رمز Telegram يعتمد الجهاز مرة واحدة. كل زيارة لاحقة تجدّد الجلسة الموقعة،
// لذلك لا يضطر المالك إلى إدخال اعتماد منفصل أو إعادة الربط ما دام يستخدم
// المتصفح نفسه ولم يمسح بيانات الموقع أو يلغِ الجهاز من النظام.
const MAX_AGE_SECONDS=365*24*60*60;
const clean=(value,max=160)=>String(value??'').trim().slice(0,max);
const signingKey=()=>{
  if(!config.adminToken||!config.supabaseKey)throw Object.assign(new Error('جلسة الجهاز السحابية غير مهيأة على الخادم'),{status:503,code:'DEVICE_SESSION_NOT_CONFIGURED'});
  return crypto.createHash('sha256').update(['binhamid-device-session-v4-transport-only',config.adminToken,config.supabaseKey].join('|')).digest();
};
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const sign=value=>crypto.createHmac('sha256',signingKey()).update(value).digest('base64url');
const equal=(a,b)=>{const aa=Buffer.from(String(a||'')),bb=Buffer.from(String(b||''));return aa.length===bb.length&&aa.length>0&&crypto.timingSafeEqual(aa,bb);};
const cookieMap=req=>Object.fromEntries(String(req?.headers?.cookie||'').split(';').map(part=>part.trim()).filter(Boolean).map(part=>{const i=part.indexOf('=');return i<0?[part,'']:[part.slice(0,i),decodeURIComponent(part.slice(i+1))];}));
const forwarded=(req,name)=>String(req?.headers?.[`x-forwarded-${name}`]||'').split(',')[0].trim();
const validAppUserId=value=>!value||/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value));
const secureSuffix=req=>(forwarded(req,'proto')||'https')==='https'?'; Secure':'';
export function assertSameOrigin(req){
  const host=forwarded(req,'host')||String(req?.headers?.host||'').trim(),proto=forwarded(req,'proto')||'https',expected=`${proto}://${host}`,origin=String(req?.headers?.origin||'').trim(),referer=String(req?.headers?.referer||'').trim();
  // بعض المتصفحات لا ترسل ترويسة Origin مع طلبات same-origin الصادرة من داخل
  // إطار التطبيق، فكان الربط يُرفض ويسقط معه كل ما يعتمد على جلسة الجهاز.
  // الحماية تبقى قائمة: إن وُجد Origin وجب تطابقه، وإن غاب وجب أن يثبت
  // الـReferer أن الطلب صادر من الموقع نفسه؛ ويُرفض الطلب إذا غاب الاثنان.
  if(!host)throw Object.assign(new Error('طلب ربط الجهاز يجب أن يصدر من نفس موقع النظام'),{status:403,code:'DEVICE_ORIGIN_REQUIRED'});
  if(origin&&origin!==expected)throw Object.assign(new Error('طلب ربط الجهاز يجب أن يصدر من نفس موقع النظام'),{status:403,code:'DEVICE_ORIGIN_REQUIRED'});
  if(referer&&!referer.startsWith(`${expected}/`))throw Object.assign(new Error('طلب ربط الجهاز يجب أن يصدر من نفس موقع النظام'),{status:403,code:'DEVICE_ORIGIN_REQUIRED'});
  if(!origin&&!referer)throw Object.assign(new Error('طلب ربط الجهاز يجب أن يصدر من نفس موقع النظام'),{status:403,code:'DEVICE_ORIGIN_REQUIRED'});
}
export function issueDeviceSession(req,res,deviceId,appUserId=''){
  const id=clean(deviceId);if(!/^dev-[A-Za-z0-9-]{8,150}$/.test(id))throw Object.assign(new Error('معرف الجهاز غير صالح'),{status:400,code:'DEVICE_ID_INVALID'});
  const userId=clean(appUserId);if(!validAppUserId(userId))throw Object.assign(new Error('معرف المستخدم غير صالح'),{status:400,code:'DEVICE_APP_USER_INVALID'});
  const now=Math.floor(Date.now()/1000),payload={v:SESSION_VERSION,mode:userId?'authenticated-user':'transport-only',deviceId:id,appUserId:userId||null,iat:now,exp:now+MAX_AGE_SECONDS,capabilities:DEVICE_CAPABILITIES},body=encode(payload),token=`${body}.${sign(body)}`;
  // البرنامج يعمل داخل إطار (iframe) داخل الموقع نفسه، والمتصفح لا يرسل كوكي
  // SameSite=Strict من داخل إطار، فكانت الجلسة تُنشأ ثم لا تصل مع أي طلب
  // لاحق فتفشل الأرصدة والحضور وسجل الموظفين جميعًا بـ401. القيمة Lax تسمح
  // بإرسالها ضمن الموقع نفسه مع بقاء الحماية من مواقع خارجية.
  res.setHeader('Set-Cookie',`${DEVICE_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${secureSuffix(req)}`);
  return payload;
}
export function clearDeviceSession(req,res){
  res.setHeader('Set-Cookie',`${DEVICE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secureSuffix(req)}`);
}
export function readDeviceSession(req){
  const token=cookieMap(req)[DEVICE_COOKIE]||'',parts=token.split('.');if(parts.length!==2||!equal(parts[1],sign(parts[0])))return null;
  let payload;try{payload=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));}catch{return null;}
  if(payload?.v!==SESSION_VERSION||!['transport-only','authenticated-user'].includes(payload?.mode)||!payload.deviceId||!validAppUserId(payload.appUserId)||Number(payload.exp||0)<=Math.floor(Date.now()/1000))return null;
  if(!Array.isArray(payload.capabilities)||payload.capabilities.some(value=>!DEVICE_CAPABILITIES.includes(value)))return null;
  return payload;
}
export function requireDeviceSession(req,capability){
  const session=readDeviceSession(req);if(!session)throw Object.assign(new Error('جلسة الجهاز غير موجودة أو انتهت'),{status:401,code:'DEVICE_SESSION_REQUIRED'});
  if(capability&&!session.appUserId&&!session.capabilities.includes(capability))throw Object.assign(new Error('هذه العملية تتطلب تسجيل دخول مستخدم معتمد.'),{status:403,code:'DEVICE_CAPABILITY_REQUIRED',capability});
  return{role:'device',actor:`device:${session.deviceId}`,deviceId:session.deviceId,appUserId:session.appUserId||null,capabilities:[...session.capabilities],kind:'device'};
}
