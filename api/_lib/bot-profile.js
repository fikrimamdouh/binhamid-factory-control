import { config } from './config.js';
import { select } from './supabase.js';
import { DEPARTMENT_LABELS, ROLE_LABELS } from './domain.js';

const REPORT_LABELS={fuel:'تقرير الديزل والوقود',payroll:'مسير الرواتب',block_collections:'تحصيلات البلوك',concrete_collections:'تحصيلات الخرسانة',collections:'التحصيلات العامة',block_daily_movement:'التقرير اليومي للبلوك',concrete_daily_movement:'التقرير اليومي للخرسانة',daily_movement:'التقرير اليومي للمبيعات والتحصيل والمخزون',financial_document:'مستند مالي',unknown_excel:'ملف Excel يحتاج تحديد النوع',quotation:'عرض سعر',invoice:'فاتورة',unclassified_document:'مستند يحتاج تصنيف'};
export async function enrichIdentity(basic,from){
  const identity=Array.isArray(basic)?basic[0]:basic;
  if(!identity?.user_id)return {...identity,external_id:String(from?.id||''),full_name:[from?.first_name,from?.last_name].filter(Boolean).join(' ')};
  const profile=(await select('app_users',`id=eq.${encodeURIComponent(identity.user_id)}&select=id,full_name,role,active&limit=1`))?.[0];
  return {...identity,...profile,user_id:identity.user_id,external_id:identity.external_id||String(from?.id||'')};
}
export function displayName(identity,from){
  if(config.telegramOwnerId&&String(from?.id)===config.telegramOwnerId)return 'أبو مالك';
  const stored=String(identity?.full_name||'').trim();
  return stored&&!/^\d+$/.test(stored)?stored:[from?.first_name,from?.last_name].filter(Boolean).join(' ')||'أستاذي';
}
export const roleLabel=role=>ROLE_LABELS[role]||role||ROLE_LABELS.pending;
export function welcomeMessage(identity,from){
  const name=displayName(identity,from),role=identity?.role||'pending';
  return identity?.active?`<b>مساعد مصنع بن حامد</b>\nمرحبًا ${name}.\n\nالدور: <b>${roleLabel(role)}</b>\nالحالة: <b>معتمد</b>\n\nاكتب طلبك مباشرة أو استخدم /menu.`:`<b>مساعد مصنع بن حامد</b>\nمرحبًا ${name}.\n\nأكمل تسجيل بياناتك، ثم ينتظر الحساب اعتماد مدير النظام. استخدم /register للبدء.`;
}
export const reportTypeLabel=type=>REPORT_LABELS[type]||type;
export function reportDestination(type,department='unassigned'){
  if(type==='fuel')return DEPARTMENT_LABELS.fuel;
  if(type==='payroll'||type==='financial_document'||type==='invoice')return DEPARTMENT_LABELS.finance;
  if(type==='daily_movement')return 'التقرير اليومي — مراجعة واعتماد المبيعات والتحصيل والمخزون';
  if(type.startsWith('block_'))return DEPARTMENT_LABELS.block;
  if(type.startsWith('concrete_'))return DEPARTMENT_LABELS.concrete;
  if(type==='quotation'&&department==='workshop')return 'الورشة — عروض أسعار الإصلاح';
  return DEPARTMENT_LABELS.unassigned;
}
