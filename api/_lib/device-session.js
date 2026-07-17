import crypto from 'node:crypto';
import { config } from './config.js';

export const DEVICE_COOKIE='bh_device_session';
// A same-origin request is not authentication. The automatic bootstrap cookie
// intentionally grants no business-data capability. Users must authenticate
// through the protected administrator/user gateway before reading or writing data.
export const DEVICE_CAPABILITIES=Object.freeze([]);
const MAX_AGE_SECONDS=24*60*60;
const clean=(value,max=160)=>String(value??'').trim().slice(0,max);
const signingKey=()=>{
  if(!config.adminToken||!config.supabaseKey)throw Object.assign(new Error('جلسة الجهاز السحابية غير مهيأة على الخادم'),{status:503,code:'DEVICE_SESSION_NOT_CONFIGURED'});
  return crypto.createHash('sha256').update(['binhamid-device-session-v3-bootstrap-only',config.adminToken,config.supabaseKey].join('|')).digest();
};
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const sign=value=>crypto.createHmac('sha256',signingKey()).update(value).digest('base64url');
const equal=(a,b)=>{const aa=Buffer.from(String(a||'')),bb=Buffer.from(String(b||''));return aa.length===bb.length&&aa.length>0&&crypto.timingSafeEqual(aa,bb);};
const cookieMap=req=>Object.fromEntries(String(req?.headers?.cookie||'').split(';').map(part=>part.trim()).filter(Boolean).map(part=>{const i=part.indexOf('=');return i<0?[part,'']:[part.slice(0,i),decodeURIComponent(part.slice(i+1))];}));
const forwarded=(req,name)=>String(req?.headers?.[`x-forwarded-${name}`]||'').split(',')[0].trim();
export function assertSameOrigin(req){
  const host=forwarded(req,'host')||String(req?.headers?.host||'').trim(),proto=forwarded(req,'proto')||'https',expected=`${proto}://${host}`,origin=String(req?.headers?.origin||'').trim(),referer=String(req?.headers?.referer||'').trim();
  if(!host||origin!==expected||(referer&&!referer.startsWith(`${expected}/`)))throw Object.assign(new Error('طلب ربط الجهاز يجب أن يصدر من نفس موقع النظام'),{status:403,code:'DEVICE_ORIGIN_REQUIRED'});
}
export function issueDeviceSession(req,res,deviceId){
  const id=clean(deviceId);if(!/^dev-[A-Za-z0-9-]{8,150}$/.test(id))throw Object.assign(new Error('معرف الجهاز غير صالح'),{status:400,code:'DEVICE_ID_INVALID'});
  const now=Math.floor(Date.now()/1000),payload={v:3,mode:'bootstrap-only',deviceId:id,iat:now,exp:now+MAX_AGE_SECONDS,capabilities:DEVICE_CAPABILITIES},body=encode(payload),token=`${body}.${sign(body)}`;
  const secure=(forwarded(req,'proto')||'https')==='https'?'; Secure':'';
  res.setHeader('Set-Cookie',`${DEVICE_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${MAX_AGE_SECONDS}; HttpOnly; SameSite=Strict${secure}`);
  return payload;
}
export function readDeviceSession(req){
  const token=cookieMap(req)[DEVICE_COOKIE]||'',parts=token.split('.');if(parts.length!==2||!equal(parts[1],sign(parts[0])))return null;
  let payload;try{payload=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));}catch{return null;}
  if(payload?.v!==3||payload?.mode!=='bootstrap-only'||!payload.deviceId||Number(payload.exp||0)<=Math.floor(Date.now()/1000))return null;
  return payload;
}
export function requireDeviceSession(req,capability){
  const session=readDeviceSession(req);if(!session)throw Object.assign(new Error('جلسة الجهاز غير موجودة أو انتهت'),{status:401,code:'DEVICE_SESSION_REQUIRED'});
  throw Object.assign(new Error('هذه العملية تتطلب تسجيل دخول مستخدم معتمد.'),{status:403,code:'AUTHENTICATED_USER_REQUIRED',capability});
}
