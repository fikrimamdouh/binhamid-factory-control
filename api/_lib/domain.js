import crypto from 'node:crypto';
export const DEPARTMENTS = ['workshop','finance','block','concrete'];
export const ROLES = ['admin','manager','accountant','mechanic','block_sales','concrete_sales','collector'];
export function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
export function inferDepartment(title = '') {
  const t = String(title).toLowerCase();
  if (/ورشة|صيانة|ميكانيك/.test(t)) return 'workshop';
  if (/مالي|محاسب|رواتب|حساب/.test(t)) return 'finance';
  if (/بلوك/.test(t)) return 'block';
  if (/خرسان|concrete/.test(t)) return 'concrete';
  return 'unassigned';
}
export function classifyFile(name = '', department = '', sheetNames = []) {
  const text = `${name} ${sheetNames.join(' ')}`.toLowerCase();
  if (/ديزل|وقود|fuel|diesel/.test(text)) return 'fuel';
  if (/راتب|رواتب|مسير|مدد|payroll|mudad/.test(text)) return 'payroll';
  if (/تحصيل|سند قبض|collection/.test(text)) return department === 'block' ? 'block_collections' : department === 'concrete' ? 'concrete_collections' : 'collections';
  if (/حركة|مبيعات|invoice|sales|daily/.test(text)) return department === 'block' ? 'block_daily_movement' : department === 'concrete' ? 'concrete_daily_movement' : 'daily_movement';
  return department === 'finance' ? 'financial_document' : 'unknown_excel';
}
export function extractPlate(text = '') {
  const normalized = String(text).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  const candidates = [...normalized.matchAll(/(?:لوح(?:ة|ه)?|رقم|السيار(?:ة|ه)|المركب(?:ة|ه))?\s*[:\-]?\s*([A-Za-z\u0600-\u06FF]{0,5}\s*)?([0-9]{3,6})/g)].map(m => `${String(m[1]||'').trim()} ${m[2]}`.trim());
  return candidates[0] || '';
}
export function isFaultMessage(text = '') { return /عطل|خرب|مشكلة|تسريب|فرامل|زيت|حرارة|متوقف|واقفة|صيانة|كسر|صوت/.test(String(text)); }
export function allowed(role, action) {
  if (role === 'admin') return true;
  const map = {
    manager: ['report','approve','reject','view'], accountant: ['finance','upload','invoice','payroll','view'], mechanic: ['maintenance','upload','view'], block_sales: ['block','upload','view'], concrete_sales: ['concrete','upload','view'], collector: ['collection','upload','view']
  };
  return (map[role] || []).includes(action);
}
export function reportSummary(payload = {}) {
  const D = payload.legacy || {}, OPS = payload.ops || {};
  const today = new Date().toISOString().slice(0,10);
  const same = v => String(v || '').slice(0,10) === today;
  const deliveries = (OPS.deliveries || []).filter(x => same(x.date || x.outAt));
  const collections = (OPS.collections || []).filter(x => same(x.date));
  const fuel = (OPS.fuel || []).filter(x => same(x.date));
  const maintenance = OPS.maintenance || [];
  return {
    employees: (D.emp || []).length, vehicles: (D.veh || []).length, clients: (D.cli || []).length,
    salesToday: deliveries.reduce((s,x)=>s+Number(x.total||x.amount||0),0),
    collectionsToday: collections.reduce((s,x)=>s+Number(x.amount||0),0),
    fuelLitersToday: fuel.reduce((s,x)=>s+Number(x.liters||0),0),
    fuelCostToday: fuel.reduce((s,x)=>s+Number(x.totalCost||x.amount||0),0),
    openMaintenance: maintenance.filter(x=>!['closed','accepted','cancelled'].includes(x.status)).length,
    stoppedVehicles: maintenance.filter(x=>!['closed','accepted','cancelled'].includes(x.status) && (x.vehicleStopped || /متوقف|واقفة/.test(x.problem||''))).length
  };
}
