import currentDailyReport from './daily-report-v6.js';
import customerPaymentReconciliation from './customer-payment-reconciliation-handler.js';

const clean=value=>String(value??'').trim().toLowerCase();

export default async function handler(req,res){
  const mode=clean(req?.headers?.['x-erp-mode']??req?.query?.mode);
  if(mode==='customer-payments'||mode==='customer-payment-reconciliation'){
    return customerPaymentReconciliation(req,res);
  }
  return currentDailyReport(req,res);
}

export * from './daily-report-v6.js';
