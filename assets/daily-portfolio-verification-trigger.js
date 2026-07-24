// [BinHamid] 2026.07.24-daily-portfolio-verification-trigger-v1
// تشغيل صريح وآمن من رابط الموقع لإرسال إقرارات محفظة تقرير معتمد دون إعادة اعتماد التقرير.
(function(){
  'use strict';
  if(window.__BH_DAILY_PORTFOLIO_TRIGGER__)return;
  window.__BH_DAILY_PORTFOLIO_TRIGGER__=true;

  const VERSION='2026.07.24-daily-portfolio-verification-trigger-v1';
  const topWindow=window.parent&&window.parent!==window?window.parent:window;
  let url;
  try{url=new URL(topWindow.location.href);}catch{return;}

  const importId=String(url.searchParams.get('portfolioImportId')||'').trim();
  const reportDate=String(url.searchParams.get('portfolioDate')||'').trim();
  const rawKinds=String(url.searchParams.get('portfolioKinds')||'block,concrete');
  const kinds=[...new Set(rawKinds.split(',').map(value=>value.trim().toLowerCase()).filter(value=>value==='block'||value==='concrete'))];
  if(!importId||!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)||!kinds.length)return;

  const triggerKey=`binhamid_portfolio_trigger_${importId}_${kinds.join('_')}`;
  let attempts=0,running=false;

  function clearQuery(){
    try{
      const cleanUrl=new URL(topWindow.location.href);
      cleanUrl.searchParams.delete('portfolioImportId');
      cleanUrl.searchParams.delete('portfolioDate');
      cleanUrl.searchParams.delete('portfolioKinds');
      topWindow.history.replaceState(topWindow.history.state,'',cleanUrl.href);
    }catch{}
  }

  async function run(){
    if(running||typeof window.bhAfterDailyReportApproved!=='function')return false;
    if(typeof window.prCli!=='function'||typeof window.bhSendPrintedButtonToTelegram!=='function')return false;
    running=true;
    clearQuery();
    try{
      const sales=kinds.map(salesType=>({salesType}));
      const result=await window.bhAfterDailyReportApproved({
        context:{plan:{sales}},
        reportDate,
        cloud:{importId,postedBatchId:importId}
      });
      try{localStorage.setItem(triggerKey,JSON.stringify({completedAt:new Date().toISOString(),result}));}catch{}
      const sent=result?.sent?.length||0,failed=result?.failed?.length||0;
      if(failed)window.opsToast?.(`تم إرسال ${sent} إقرار، وتعذر ${failed}. راجع Console.`,'err');
      else window.opsToast?.(`تم إرسال ${sent} إقرار محفظة عملاء إلى Telegram بنفس تصميم الموقع.`);
      console.info('[BinHamid]',VERSION,'completed',{importId,reportDate,kinds,result});
      return true;
    }catch(error){
      console.error('[BinHamid]',VERSION,'failed',{importId,reportDate,kinds,error});
      window.opsToast?.(`تعذر إرسال إقرارات المحفظة: ${error?.message||error}`,'err');
      return true;
    }
  }

  const timer=setInterval(()=>{
    attempts++;
    Promise.resolve(run()).then(done=>{if(done||attempts>=240)clearInterval(timer);});
  },250);
})();
