import { select } from './supabase.js';

const PAGE_SIZE=1000;
const cleanDate=value=>String(value||'').slice(0,10);
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(cleanDate(value))&&!Number.isNaN(new Date(`${cleanDate(value)}T12:00:00Z`).getTime());
export const addDays=(value,days=1)=>{const date=new Date(`${cleanDate(value)}T12:00:00Z`);if(Number.isNaN(date.getTime()))return'';date.setUTCDate(date.getUTCDate()+Number(days||0));return date.toISOString().slice(0,10);};
function daysBetween(from,to,max=370){const out=[];let cursor=cleanDate(from);for(let index=0;index<max&&cursor&&cursor<to;index++){out.push(cursor);cursor=addDays(cursor,1);}return out;}
async function pagedSelect(table,query,maxPages=50){
  const rows=[];
  for(let page=0;page<maxPages;page++){
    const part=await select(table,`${query}&limit=${PAGE_SIZE}&offset=${page*PAGE_SIZE}`).catch(()=>[]);
    if(!Array.isArray(part)||!part.length)break;
    rows.push(...part);
    if(part.length<PAGE_SIZE)break;
  }
  return rows;
}

export async function loadDailyReportTimeline(reportDate){
  const target=cleanDate(reportDate);
  if(!validDate(target))throw Object.assign(new Error('تاريخ التقرير غير صحيح'),{status:400,code:'REPORT_DATE_INVALID'});
  const[openingRows,batches]=await Promise.all([
    pagedSelect('customer_opening_balances','select=balance_date&order=customer_code.asc'),
    pagedSelect('daily_report_batches','status=eq.approved&select=id,report_date,status&order=report_date.asc')
  ]);
  const openingDates=[...new Set((openingRows||[]).map(row=>cleanDate(row.balance_date)).filter(validDate))].sort();
  const openingDate=openingDates.at(-1)||'';
  const approvedDates=[...new Set((batches||[]).map(row=>cleanDate(row.report_date)).filter(validDate))].sort();
  const previousApprovedDates=approvedDates.filter(value=>value<target),latestApprovedDate=previousApprovedDates.at(-1)||'';
  const baseline=latestApprovedDate||openingDate;
  const expectedDate=baseline?addDays(baseline,1):'';
  const missingDates=expectedDate&&target>expectedDate?daysBetween(expectedDate,target):[];
  const errors=[],warnings=[];
  if(openingDates.length>1)errors.push({code:'OPENING_BALANCE_DATE_CONFLICT',message:`الأرصدة الافتتاحية تحتوي أكثر من تاريخ أساس: ${openingDates.join('، ')}. يلزم توحيد التاريخ قبل اعتماد حركة جديدة.`,dates:openingDates});
  if(openingDate&&target<=openingDate)errors.push({code:'REPORT_BEFORE_MOVEMENT_START',message:`الرصيد الافتتاحي مثبت حتى ${openingDate}. أول حركة مسموح بها هي ${addDays(openingDate,1)}.`,openingDate,firstMovementDate:addDays(openingDate,1)});
  if(!openingDate)warnings.push({code:'OPENING_BALANCE_DATE_MISSING',message:'لم أجد تاريخًا موحدًا للأرصدة الافتتاحية؛ ستتم المراجعة دون مطابقة نقطة البداية.'});
  if(missingDates.length)warnings.push({code:'MISSING_REPORT_DATES',message:`توجد أيام غير معتمدة قبل هذا التقرير: ${missingDates.join('، ')}.`,missingDates,expectedDate});
  return{reportDate:target,openingDate,openingDates,openingRowCount:openingRows.length,firstMovementDate:openingDate?addDays(openingDate,1):'',latestApprovedDate,expectedDate,missingDates,approvedDates,fromDate:openingDate?addDays(openingDate,1):(approvedDates[0]||target),toDate:target,errors,warnings};
}

export function timelineBlocksApproval(timeline={},allowDateGap=false){
  const hardErrors=Array.isArray(timeline.errors)?timeline.errors:[];
  if(hardErrors.length)return hardErrors;
  if(!allowDateGap&&Array.isArray(timeline.missingDates)&&timeline.missingDates.length)return[{code:'MISSING_REPORT_DATES',message:`يلزم مراجعة الأيام المفقودة قبل الاعتماد: ${timeline.missingDates.join('، ')}`,missingDates:timeline.missingDates}];
  return[];
}
