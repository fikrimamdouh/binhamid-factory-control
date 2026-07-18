import crypto from 'node:crypto';
import { config } from './config.js';
import { requireDeviceSession } from './device-session.js';

function equal(a,b){
  const aa=Buffer.from(String(a||'')),bb=Buffer.from(String(b||''));
  if(!aa.length||aa.length!==bb.length)return false;
  return crypto.timingSafeEqual(aa,bb);
}
export function requireAdmin(req){
  if(!config.adminToken)throw Object.assign(new Error('رمز إدارة النظام غير مضبوط في Vercel'),{status:503,code:'ADMIN_TOKEN_NOT_CONFIGURED'});
  const header=String(req?.headers?.authorization||'');
  const supplied=header.toLowerCase().startsWith('bearer ')?header.slice(7).trim():String(req?.headers?.['x-admin-token']||'');
  if(!equal(supplied,config.adminToken))throw Object.assign(new Error('اعتماد الإدارة مطلوب'),{status:401,code:'ADMIN_AUTH_REQUIRED'});
  return{role:'admin',actor:'web-admin',kind:'admin'};
}
export function requireAdminOrDevice(req,capability){
  try{return requireAdmin(req);}
  catch(error){
    if(error?.code!=='ADMIN_AUTH_REQUIRED')throw error;
    return requireDeviceSession(req,capability);
  }
}
export function verifyTelegram(req){
  if(!config.telegramSecret)throw Object.assign(new Error('سر Webhook غير مضبوط'),{status:503,code:'TELEGRAM_SECRET_NOT_CONFIGURED'});
  if(!equal(req?.headers?.['x-telegram-bot-api-secret-token'],config.telegramSecret))throw Object.assign(new Error('طلب Telegram غير موثق'),{status:401,code:'TELEGRAM_AUTH_REQUIRED'});
}
