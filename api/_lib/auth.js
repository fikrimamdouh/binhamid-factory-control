import crypto from 'node:crypto';
import { config } from './config.js';
function equal(a, b) {
  const aa = Buffer.from(String(a || '')); const bb = Buffer.from(String(b || ''));
  if (!aa.length || aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}
export function requireAdmin(req) {
  if (!config.adminToken) throw Object.assign(new Error('رمز إدارة النظام غير مضبوط في Vercel'), { status: 503 });
  const header = String(req.headers.authorization || '');
  const supplied = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : String(req.headers['x-admin-token'] || '');
  if (!equal(supplied, config.adminToken)) throw Object.assign(new Error('رمز الدخول غير صحيح'), { status: 401 });
  return { role: 'admin', actor: 'web-admin' };
}
export function verifyTelegram(req) {
  if (!config.telegramSecret) throw Object.assign(new Error('سر Webhook غير مضبوط'), { status: 503 });
  if (!equal(req.headers['x-telegram-bot-api-secret-token'], config.telegramSecret)) throw Object.assign(new Error('طلب Telegram غير موثق'), { status: 401 });
}
