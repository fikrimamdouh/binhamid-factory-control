import { downloadObject, uploadObject } from './supabase.js';

const clean=value=>String(value??'').trim();
const isMissing=error=>/404|not found|تعذر تنزيل المرفق/i.test(String(error?.message||''));
const pointerPath=type=>`portfolio-documents/latest-daily-${type}.json`;

async function existingSnapshot(report){
  try{
    const file=await downloadObject(pointerPath(report.type)),pointer=JSON.parse(file.buffer.toString('utf8'));
    if(pointer?.snapshotVersion==='portfolio-settlement-v2'&&pointer?.portfolioType===report.type&&String(pointer?.reportDate||'')===String(report.reportDate||'')&&pointer?.pdfPath&&pointer?.snapshotPath)return pointer;
    return null;
  }catch(error){if(isMissing(error))return null;throw error;}
}

export async function persistPortfolioReportSnapshot(report={}){
  if(!report?.pdf||!report?.type||!report?.reportDate||!report?.snapshot)return null;
  const existing=await existingSnapshot(report);if(existing)return{...existing,reused:true};
  const suffix=clean(report.snapshot?.sourceBatchId)||clean(report.snapshot?.documentRef)||'initial',safeSuffix=suffix.replace(/[^A-Za-z0-9_-]/g,'_').slice(0,80),base=`portfolio-snapshots/${report.reportDate}/${report.type}/${safeSuffix}`,pdfPath=`${base}.pdf`,snapshotPath=`${base}.json`,pointer={...report.snapshot,pdfPath,snapshotPath,filename:report.filename,customerCount:report.customerCount,contentType:'application/pdf'};
  await Promise.all([uploadObject(pdfPath,report.pdf,'application/pdf'),uploadObject(snapshotPath,Buffer.from(JSON.stringify(report.snapshot,null,2),'utf8'),'application/json')]);
  // The pointer is written only for the first immutable snapshot of this date/type.
  const raced=await existingSnapshot(report);if(raced)return{...raced,reused:true};
  await uploadObject(pointerPath(report.type),Buffer.from(JSON.stringify(pointer,null,2),'utf8'),'application/json');
  return{...pointer,reused:false};
}
