// [BinHamid] 2026.07.24-daily-portfolio-declarations-v1
// يولّد إقرار محفظة العملاء من نفس prCli/docCli الموجودين ويُرسل نفس نسخة الطباعة إلى Telegram.
(function(){
  'use strict';
  if(window.__BH_DAILY_PORTFOLIO_DECLARATIONS__)return;
  window.__BH_DAILY_PORTFOLIO_DECLARATIONS__=true;

  const VERSION='2026.07.24-daily-portfolio-declarations-v1';
  const clean=value=>String(value??'').replace(/\s+/g,' ').trim();
  const norm=value=>clean(value).toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/ؤ/g,'و').replace(/ئ/g,'ي').replace(/ـ/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  const esc=value=>clean(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const digits=value=>clean(value).replace(/[^0-9٠-٩]/g,'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  const state=()=>{
    let data={},ops={};
    try{data=typeof D!=='undefined'?D:(window.D||{});}catch{data=window.D||{};}
    try{ops=typeof OPS!=='undefined'?OPS:(window.OPS||{});}catch{ops=window.OPS||{};}
    return{D:data||{},OPS:ops||{}};
  };
  const salesKind=row=>{
    const declared=clean(row?.salesType||row?.kind).toLowerCase();
    if(declared==='block'||declared==='concrete')return declared;
    const text=norm(row?.item||row?.product||'');
    return /خرسان/.test(text)?'concrete':/(?:بلك|بلوك)/.test(text)?'block':'';
  };
  const isResidency=employee=>{
    const id=clean(employee?.id),nid=digits(employee?.nid||employee?.iqamaId||employee?.nationalId||employee?.no);
    return /^\d{10}$/.test(nid)&&!/^TG[-_:]/i.test(id)&&!/telegram/i.test(id);
  };
  const samePerson=(left,right)=>{
    if(!left||!right)return false;
    const leftName=norm(left.name),rightName=norm(right.name);
    if(leftName&&rightName&&leftName===rightName)return true;
    const leftNo=digits(left.tel||left.phone||left.no),rightNo=digits(right.tel||right.phone||right.no);
    return Boolean(leftNo&&rightNo&&leftNo===rightNo);
  };

  function responsibleEmployee(kind){
    const runtime=state(),employees=Array.isArray(runtime.D.emp)?runtime.D.emp:[];
    const configured=typeof window.opsSalesResponsible==='function'?window.opsSalesResponsible(kind):null;
    if(configured&&isResidency(configured))return configured;
    const same=employees.filter(employee=>employee?.act!==false&&samePerson(employee,configured));
    const residency=same.find(isResidency);
    if(residency)return residency;
    const roleNeedle=kind==='block'?'بلوك':'خرسان';
    const byRole=employees.find(employee=>employee?.act!==false&&isResidency(employee)&&norm(`${employee.role||''} ${employee.declarationRole||''}`).includes(roleNeedle));
    return byRole||configured||null;
  }

  function selectorEmployee(employee){
    const select=document.getElementById('pcEmp');
    if(!select||!employee)return false;
    let option=[...select.options].find(item=>item.value===employee.id);
    if(!option){
      try{window.rAll?.();}catch{}
      option=[...select.options].find(item=>item.value===employee.id);
    }
    if(!option){
      option=document.createElement('option');
      option.value=employee.id;
      option.textContent=employee.name||employee.nid||employee.id;
      select.appendChild(option);
    }
    select.value=employee.id;
    return select.value===employee.id;
  }

  function declarationButton(){
    return [...document.querySelectorAll('button')].find(button=>/\bprCli\s*\(/.test(button.getAttribute('onclick')||''))||null;
  }

  function prepareDeclaration(employee,kind){
    if(!selectorEmployee(employee))throw new Error('تعذر اختيار مسؤول المحفظة في نموذج الإقرار.');
    const segment=document.getElementById('pcSeg');
    if(!segment)throw new Error('حقل قطاع محفظة العملاء غير موجود.');
    segment.value=kind==='block'?'بلوك':'خرسانة';
    const button=declarationButton();
    if(!button)throw new Error('زر إقرار مسؤولية محفظة العملاء غير موجود.');
    return button;
  }

  function declarationStore(){
    const ops=state().OPS;
    if(!ops||typeof ops!=='object')return null;
    if(!Array.isArray(ops.dailyPortfolioDeclarations))ops.dailyPortfolioDeclarations=[];
    return ops.dailyPortfolioDeclarations;
  }

  function upsertRecord(record){
    const store=declarationStore();
    if(!store)return record;
    const key=`${record.cloudImportId||record.reportDate}:${record.employeeId}:${record.kind}`;
    const index=store.findIndex(item=>item.key===key);
    const value={...(index>=0?store[index]:{}),...record,key,updatedAt:new Date().toISOString()};
    if(index>=0)store[index]=value;else store.unshift(value);
    return value;
  }

  async function persistRecords(reason){
    try{window.save?.();}catch{}
    try{await window.opsPersist?.(reason||'تسجيل إقرار محفظة العملاء للتقرير اليومي');}catch(error){console.warn('[BinHamid daily portfolio persist]',error);}
  }

  async function sendDeclaration(kind,reportDate,cloud){
    const employee=responsibleEmployee(kind);
    if(!employee)throw new Error(`مسؤول مبيعات ${kind==='block'?'البلوك':'الخرسانة'} غير محدد.`);
    const base={reportDate,cloudImportId:cloud?.importId||cloud?.existingImportId||cloud?.postedBatchId||'',employeeId:employee.id,employeeName:employee.name||'',employeeResidency:digits(employee.nid||employee.iqamaId||employee.no),kind,segment:kind==='block'?'بلوك':'خرسانة',title:`محفظة عملاء — ${employee.name||''}`,telegramSent:false,status:'generated',createdAt:new Date().toISOString()};
    upsertRecord(base);
    const button=prepareDeclaration(employee,kind);
    if(typeof window.bhSendPrintedButtonToTelegram!=='function')throw new Error('خدمة إرسال نفس نسخة الطباعة إلى Telegram غير جاهزة.');
    const result=await window.bhSendPrintedButtonToTelegram(button,null);
    const saved=upsertRecord({...base,telegramSent:true,status:'sent',telegramMessageId:result?.messageId||result?.message_id||null,sentAt:new Date().toISOString()});
    return saved;
  }

  function filterRecords(){
    const store=declarationStore()||[],from=document.getElementById('repFrom')?.value||'',to=document.getElementById('repTo')?.value||'';
    return store.filter(item=>(!from||item.reportDate>=from)&&(!to||item.reportDate<=to));
  }

  function openSaved(record){
    const runtime=state(),employee=(runtime.D.emp||[]).find(item=>item.id===record.employeeId)||responsibleEmployee(record.kind);
    const button=prepareDeclaration(employee,record.kind);
    button.click();
  }

  function renderDailyReportDeclarations(){
    const content=document.getElementById('opsContent');
    if(!content)return;
    document.getElementById('bh-daily-portfolio-declarations-card')?.remove();
    const rows=filterRecords();
    const card=document.createElement('div');
    card.id='bh-daily-portfolio-declarations-card';
    card.className='ops-card ops-col-12';
    card.innerHTML=`<h3>إقرارات مسؤولية محفظة العملاء</h3><div class="ops-note">تُنشأ من نفس نموذج الإقرار الحالي بعد اعتماد التقرير اليومي، دون تغيير التصميم أو النص.</div>${rows.length?`<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>التاريخ</th><th>المسؤول</th><th>القطاع</th><th>الحالة</th><th></th></tr></thead><tbody>${rows.map((row,index)=>`<tr><td>${esc(row.reportDate)}</td><td>${esc(row.employeeName)}${row.employeeResidency?`<div class="ops-muted">إقامة: ${esc(row.employeeResidency)}</div>`:''}</td><td>${esc(row.segment)}</td><td>${row.telegramSent?'تم الإرسال إلى Telegram':'تم الإنشاء'}</td><td><button type="button" class="ops-btn ghost" data-bh-portfolio-open="${index}">فتح نفس الإقرار</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="ops-empty"><b>لا توجد إقرارات مولّدة في الفترة المحددة</b></div>'}`;
    content.appendChild(card);
    card.querySelectorAll('[data-bh-portfolio-open]').forEach(button=>button.addEventListener('click',()=>openSaved(rows[Number(button.dataset.bhPortfolioOpen)])));
  }

  function wrapReports(){
    if(typeof window.opsRenderReports!=='function'||window.opsRenderReports.__bhPortfolioWrapped)return false;
    const original=window.opsRenderReports;
    const wrapped=function(){const result=original.apply(this,arguments);setTimeout(renderDailyReportDeclarations,0);return result;};
    wrapped.__bhPortfolioWrapped=true;
    window.opsRenderReports=wrapped;
    return true;
  }

  async function afterApproved({context,reportDate,cloud}={}){
    const kinds=[...new Set((context?.plan?.sales||[]).map(salesKind).filter(kind=>kind==='block'||kind==='concrete'))];
    const sent=[],failed=[];
    for(const kind of kinds){
      try{sent.push(await sendDeclaration(kind,reportDate,cloud));}
      catch(error){failed.push({kind,error:error?.message||String(error)});console.error('[BinHamid daily portfolio declaration]',kind,error);upsertRecord({reportDate,cloudImportId:cloud?.importId||cloud?.existingImportId||'',kind,segment:kind==='block'?'بلوك':'خرسانة',employeeId:responsibleEmployee(kind)?.id||'',employeeName:responsibleEmployee(kind)?.name||'',telegramSent:false,status:'failed',error:error?.message||String(error),createdAt:new Date().toISOString()});}
    }
    await persistRecords(`إقرارات محفظة العملاء للتقرير ${reportDate}`);
    if(window.OPS_VIEW==='reports')renderDailyReportDeclarations();
    return{ok:failed.length===0,sent,failed};
  }

  window.bhAfterDailyReportApproved=afterApproved;
  window.bhRenderDailyPortfolioDeclarations=renderDailyReportDeclarations;
  window.BinHamidDailyPortfolioDeclarations={version:VERSION,installed:true,afterApproved,responsibleEmployee,renderDailyReportDeclarations};

  let attempts=0;
  const timer=setInterval(()=>{
    attempts++;
    const ready=wrapReports()&&typeof window.prCli==='function'&&typeof window.bhSendPrintedButtonToTelegram==='function';
    if(ready||attempts>=120){clearInterval(timer);console.info('[BinHamid]',VERSION,ready?'ready':'loaded with deferred declaration dependencies');}
  },250);
})();
