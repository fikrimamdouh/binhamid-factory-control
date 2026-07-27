import { generateCustomerPortfolioPdfs } from './customer-portfolio-pdf.js';

const VALID_TYPES=new Set(['block','concrete']);
const clean=value=>String(value??'').trim();
const noActivity=error=>String(error?.code||'').endsWith('_NO_SALES_ACTIVITY');

export async function generateAvailablePortfolioPdfs(analysis={},sourceFile='daily-report.xlsx',requestedTypes=['block','concrete'],options={}){
  const types=[...new Set((Array.isArray(requestedTypes)?requestedTypes:[requestedTypes]).map(clean).filter(type=>VALID_TYPES.has(type)))],reports=[],missingTypes=[],errors=[];
  for(const type of types){
    try{reports.push(...await generateCustomerPortfolioPdfs(analysis,sourceFile,[type],options));}
    catch(error){
      if(noActivity(error)){missingTypes.push(type);errors.push({type,code:error.code,message:String(error.message||'')});continue;}
      throw error;
    }
  }
  if(!reports.length){const first=errors[0],message=first?.message||'لا توجد مبيعات سابقة غير مسددة أو حركة تقرير لأي قطاع مطلوب.';throw Object.assign(new Error(message),{status:409,code:first?.code||'PORTFOLIO_NO_SALES_ACTIVITY',missingTypes});}
  return{reports,missingTypes,errors};
}
