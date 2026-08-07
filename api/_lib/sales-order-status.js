const clean=value=>String(value??'').trim().toLowerCase();

export const SALES_ORDER_OPEN_STATUSES=Object.freeze([
  'registered',
  'confirmed',
  'scheduled',
  'in_production',
  'ready',
  'dispatched',
  'on_hold'
]);

const OPEN=new Set(SALES_ORDER_OPEN_STATUSES);

export function isDailyReportSalesOrder(order={}){
  const reference=String(order?.reference_no||'').trim();
  const owner=String(order?.sales_person_name||'').trim();
  return /^DR-\d{8}-S-\d+$/i.test(reference)||owner==='استيراد التقرير اليومي';
}

export function isOpenOperationalSalesOrder(order={}){
  return !isDailyReportSalesOrder(order)&&OPEN.has(clean(order?.status));
}
