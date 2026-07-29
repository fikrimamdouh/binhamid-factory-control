import currentDailyReport from './daily-report-v7.js';
import { resumeReviewedReport20260728 } from './erp-reviewed-resume.js';

const clean=(value,max=200)=>String(value??'').trim().slice(0,max);

export default async function handler(req,res){
  if(req.method==='GET'){
    const params=new URL(req.url||'/api/erp/daily-report',`https://${String(req.headers?.host||'localhost')}`).searchParams;
    if(clean(params.get('action'))==='resume-reviewed-2026-07-28')return resumeReviewedReport20260728(req,res);
  }
  return currentDailyReport(req,res);
}

export * from './daily-report-v7.js';
export { resumeReviewedReport20260728 } from './erp-reviewed-resume.js';
