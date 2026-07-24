// [BinHamid] 2026.07.24-exact-portfolio-metadata-bridge-v1
(function(){
  'use strict';
  if(window.__BH_EXACT_PORTFOLIO_METADATA_BRIDGE__)return;
  window.__BH_EXACT_PORTFOLIO_METADATA_BRIDGE__=true;
  const VERSION='2026.07.24-exact-portfolio-metadata-bridge-v1';
  const clean=value=>String(value??'').replace(/\s+/g,' ').trim();
  const digits=value=>clean(value).replace(/\D/g,'');
  let latestCommit=null,installedSender=null;

  function runtime(){let data={},ops={};try{data=typeof D!=='undefined'?D:(window.D||{});}catch{data=window.D||{};}try{ops=typeof OPS!=='undefined'?OPS:(window.OPS||{});}catch{ops=window.OPS||{};}return{D:data||{},OPS:ops||{}};}
  function kindFromSegment(value){return clean(value)==='بلوك'?'block':clean(value)==='خرسانة'?'concrete':'';}
  function selectedEmployee(){const id=document.getElementById('pcEmp')?.value||'',employees=runtime().D.emp||[];return employees.find(row=>String(row.id)===String(id))||null;}
  function declarationButton(button){return Boolean(button&&(/\bprCli\s*\(/.test(button.getAttribute?.('onclick')||'')||button.dataset?.bhPortfolioRangePrint==='1'));}
  function storedDate(employee,kind){const rows=runtime().OPS.dailyPortfolioDeclarations||[];return rows.filter(row=>row.employeeId===employee?.id&&row.kind===kind&&row.reportDate).sort((a,b)=>String(b.reportDate).localeCompare(String(a.reportDate)))[0]?.reportDate||'';}
  function customerCount(employee,segment){try{return typeof window.clientPortfolioForEmployee==='function'?(window.clientPortfolioForEmployee(employee,segment)||[]).length:0;}catch{return 0;}}
  function metadata(){
    const employee=selectedEmployee(),segment=document.getElementById('pcSeg')?.value||'',kind=kindFromSegment(segment);
    if(!employee||!kind)return null;
    const reportDate=latestCommit?.reportDate||storedDate(employee,kind)||new Date().toISOString().slice(0,10);
    return{documentType:'customer_portfolio',portfolioType:kind,periodMode:'daily',periodFrom:reportDate,periodTo:reportDate,reportDate,employeeId:clean(employee.id),employeeName:clean(employee.name),employeeNationalId:digits(employee.nid||employee.iqamaId||employee.nationalId||employee.no),customerCount:customerCount(employee,segment),sector:kind};
  }
  function wrapFetch(){
    if(typeof window.fetch!=='function'||window.fetch.__bhExactPortfolioMetadata)return true;
    const original=window.fetch;
    const wrapped=async function(input,options={}){
      const response=await original.apply(this,arguments),url=typeof input==='string'?input:input?.url||'';
      if(response.ok&&url.includes('/api/daily-report')){
        let request={};try{request=typeof options?.body==='string'?JSON.parse(options.body):{};}catch{}
        if(request?.action==='commit'){
          const result=await response.clone().json().catch(()=>null);
          if(result?.ok)latestCommit={reportDate:request.reportDate||result?.preview?.reportDate||'',importId:result.importId||result.existingImportId||result.postedBatchId||''};
        }
      }
      return response;
    };
    wrapped.__bhExactPortfolioMetadata=true;window.fetch=wrapped;return true;
  }
  function wrapSender(){
    const current=window.bhSendPrintedButtonToTelegram;
    if(typeof current!=='function')return false;
    if(current===installedSender||current.__bhExactPortfolioMetadata)return true;
    const wrapped=async function(printButton,sendButton){
      if(declarationButton(printButton)&&!window.__BH_PORTFOLIO_EXPLICIT_METADATA_LOCK__){const value=metadata();if(value)window.bhSetNextPrintMetadata?.(value);}
      return current.apply(this,arguments);
    };
    wrapped.__bhExactPortfolioMetadata=true;wrapped.__bhOriginal=current;installedSender=wrapped;window.bhSendPrintedButtonToTelegram=wrapped;return true;
  }
  let attempts=0;
  (function install(){attempts++;const ready=wrapFetch()&&wrapSender();if(!ready&&attempts<120)return setTimeout(install,250);console.info('[BinHamid]',VERSION,ready?'ready':'loaded with deferred sender');})();
})();
