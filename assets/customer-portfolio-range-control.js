// [BinHamid] 2026.07.27-customer-portfolio-primary-owner-cross-sector-v3
// مصدر واحد لتاريخ إقرار محفظة العملاء ونطاقه، ويُرسل إلى Telegram نفس #sheet الذي يطبعه الموقع.
(function(){
  'use strict';
  if(window.__BH_CUSTOMER_PORTFOLIO_RANGE_CONTROL__)return;
  window.__BH_CUSTOMER_PORTFOLIO_RANGE_CONTROL__=true;

  // منع الوحدة القديمة من إرسال إقرار ثانٍ بمنطق مختلف.
  window.__BH_DAILY_PORTFOLIO_DECLARATIONS__=true;

  const VERSION='2026.07.27-customer-portfolio-primary-owner-cross-sector-v3';
  const clean=value=>String(value??'').replace(/\s+/g,' ').trim();
  const norm=value=>clean(value).toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/ؤ/g,'و').replace(/ئ/g,'ي').replace(/ـ/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  const digits=value=>clean(value).replace(/[^0-9٠-٩]/g,'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  const iso=value=>{const day=clean(value).slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(day)?day:'';};
  const day=value=>iso(value)||clean(value).slice(0,10);
  const inRange=(value,from,to)=>{const d=day(value);return Boolean(d&&(!from||d>=from)&&(!to||d<=to));};
  const salesKind=row=>{const declared=clean(row?.salesType||row?.sales_type||row?.kind).toLowerCase();if(declared==='block'||declared==='concrete')return declared;const text=norm(row?.item||row?.itemName||row?.product||'');return /خرسان/.test(text)?'concrete':/(?:بلك|بلوك)/.test(text)?'block':'';};
  const esc=value=>clean(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const fmt=value=>{const parts=iso(value).split('-');return parts.length===3?`${parts[2]}/${parts[1]}/${parts[0]}`:clean(value)||'—';};
  const state=()=>({D:window.D||{},OPS:window.OPS||{}});
  const completedApprovals=new Set();
  let pendingApproval=null,pendingPrintContext=null,activePrintContext=null;

  function sameClient(client,row){
    const codes=[client?.code,client?.customerCode,client?.cr,client?.id].map(value=>clean(value).toLowerCase()).filter(Boolean);
    const rowCodes=[row?.customerCode,row?.customer_code,row?.code,row?.customerExternalId,row?.customer_external_id].map(value=>clean(value).toLowerCase()).filter(Boolean);
    if(codes.some(value=>rowCodes.includes(value)))return true;
    const clientName=norm(client?.name),rowName=norm(row?.customer||row?.customerName||row?.customer_name||row?.name);
    return Boolean(clientName&&rowName&&clientName===rowName);
  }

  function isResidency(employee){
    const id=clean(employee?.id),nid=digits(employee?.nid||employee?.iqamaId||employee?.nationalId||employee?.no);
    return /^\d{10}$/.test(nid)&&!/^TG[-_:]/i.test(id)&&!/telegram/i.test(id);
  }
  function samePerson(left,right){
    if(!left||!right)return false;
    const leftName=norm(left.name),rightName=norm(right.name);
    if(leftName&&rightName&&leftName===rightName)return true;
    const leftNo=digits(left.tel||left.phone||left.no),rightNo=digits(right.tel||right.phone||right.no);
    return Boolean(leftNo&&rightNo&&leftNo===rightNo);
  }
  function responsibleEmployee(kind){
    const runtime=state(),employees=Array.isArray(runtime.D.emp)?runtime.D.emp:[];
    const configured=typeof window.opsSalesResponsible==='function'?window.opsSalesResponsible(kind):null;
    if(configured&&isResidency(configured))return configured;
    const linked=employees.filter(employee=>employee?.act!==false&&samePerson(employee,configured));
    const residency=linked.find(isResidency);if(residency)return residency;
    const needle=kind==='block'?'بلوك':'خرسان';
    return employees.find(employee=>employee?.act!==false&&isResidency(employee)&&norm(`${employee.role||''} ${employee.declarationRole||''}`).includes(needle))||configured||null;
  }

  function rangeFromControls(){
    const from=iso(document.getElementById('pcFrom')?.value),to=iso(document.getElementById('pcTo')?.value);
    return{fromDate:from,toDate:to||from,reportDate:to||from};
  }
  function validateRange(range){
    if(!range.fromDate||!range.toDate)throw new Error('حدد تاريخ البداية وتاريخ النهاية لإقرار محفظة العملاء.');
    if(range.fromDate>range.toDate)throw new Error('تاريخ البداية يجب ألا يكون بعد تاريخ النهاية.');
    return range;
  }

  function ensureRangeControls(){
    const employee=document.getElementById('pcEmp'),segment=document.getElementById('pcSeg');
    if(!employee||!segment)return false;
    let host=document.getElementById('bh-portfolio-date-range');
    if(!host){
      host=document.createElement('div');host.id='bh-portfolio-date-range';host.className='grid g2';host.style.cssText='margin-top:12px;grid-column:1/-1';
      host.innerHTML='<div><label for="pcFrom">من تاريخ <span class="hint">تاريخ الفواتير</span></label><input type="date" id="pcFrom" name="pcFrom"></div><div><label for="pcTo">إلى تاريخ <span class="hint">تاريخ الإقرار</span></label><input type="date" id="pcTo" name="pcTo"></div><div class="note" style="grid-column:1/-1;margin:0">يصدر الإقرار للعملاء الذين لديهم فواتير داخل الفترة فقط. تاريخ الرفع لا يغيّر تاريخ التقرير.</div>';
      const parent=segment.closest('.grid')||segment.parentElement?.parentElement||segment.parentElement;
      parent?.appendChild(host);
    }
    const today=typeof window.opsToday==='function'?iso(window.opsToday()):new Date().toISOString().slice(0,10);
    const from=document.getElementById('pcFrom'),to=document.getElementById('pcTo');
    if(from&&!from.value)from.value=today;if(to&&!to.value)to.value=from?.value||today;
    return true;
  }

  function exactClients(employee,segment,context){
    const runtime=state(),clients=Array.isArray(runtime.D.cli)?runtime.D.cli:[],kind=segment==='خرسانة'?'concrete':segment==='بلوك'?'block':'';
    const sales=(context?.sales||[]).filter(row=>(!kind||salesKind(row)===kind)&&inRange(row?.date||context.reportDate,context.fromDate,context.toDate));
    const selected=new Map(),cross=new Map(),ownerSector=client=>window.BinHamidDeclarationsCustomerFix?.primarySector?.(runtime,client,kind)||(norm(client?.seg).includes('خرسان')?'concrete':/(?:بلك|بلوك)/.test(norm(client?.seg))?'block':kind);
    for(const sale of sales){
      const client=clients.find(item=>sameClient(item,sale));
      if(!client)continue;
      const owner=ownerSector(client);
      if(owner&&owner!==kind){
        const key=client.id||clean(client.code)||norm(client.name),ownerEmployee=(runtime.D.emp||[]).find(item=>item.id===client.rep),current=cross.get(key)||{name:client.name,code:client.code||client.cr||'',phone:client.tel||client.phone||'',ownerSector:owner,ownerSectorLabel:owner==='concrete'?'الخرسانة':'البلوك',ownerEmployeeName:ownerEmployee?.name||'',sellingSector:kind,amount:0,quantity:0,item:new Set(),invoices:[],firstDate:'',lastDate:''},date=day(sale?.date||context.reportDate);
        current.amount+=Number(sale.amount||sale.total||sale.total_amount||0);current.quantity+=Number(sale.quantity||0);if(sale.item||sale.itemName||sale.product)current.item.add(sale.item||sale.itemName||sale.product);current.invoices.push({invoice:sale.invoice||sale.invoiceNo||sale.invoice_no||sale.clientOrder||sale.no||'',date,amount:Number(sale.amount||sale.total||sale.total_amount||0)});if(date){current.firstDate=!current.firstDate||date<current.firstDate?date:current.firstDate;current.lastDate=date>current.lastDate?date:current.lastDate;}cross.set(key,current);continue;
      }
      const key=client.id||clean(client.code)||norm(client.name),current=selected.get(key)||{client,reportSales:0,reportQuantity:0};
      current.reportSales+=Number(sale.amount||sale.total||sale.total_amount||0);current.reportQuantity+=Number(sale.quantity||0);selected.set(key,current);
    }
    const rows=[...selected.values()].map(({client,reportSales,reportQuantity})=>{
      const ledger=typeof window.bhClientLedger==='function'?window.bhClientLedger(client.id,kind):null;
      return{...client,_portfolioSegment:kind==='concrete'?'خرسانة':kind==='block'?'بلوك':client.seg,_portfolioLastDate:context.reportDate||context.toDate,_portfolioQty:Number(ledger?.quantity??reportQuantity),_portfolioSales:Number(ledger?.sales??reportSales),_portfolioPaid:Number(ledger?.paid||0),_portfolioBalance:Number(ledger?.remaining??reportSales),_portfolioOverdue:Number(ledger?.overdue||0),_portfolioDue:ledger?.nextDueDate||'',_portfolioLateDays:Number(ledger?.maxDaysLate||0)};
    }).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'ar'));
    rows.crossSectorPurchases=[...cross.values()].map(item=>({...item,item:[...item.item].join('، ')})).sort((a,b)=>b.amount-a.amount||String(a.name||'').localeCompare(String(b.name||''),'ar'));context.crossSectorPurchases=rows.crossSectorPurchases;return rows;
  }

  function filterClientsByRange(rows,employee,segment,context){
    const runtime=state(),deliveries=Array.isArray(runtime.OPS.deliveries)?runtime.OPS.deliveries:[],kind=segment==='خرسانة'?'concrete':segment==='بلوك'?'block':'';
    const filtered=(rows||[]).filter(client=>deliveries.some(delivery=>{
      if(!inRange(delivery?.date,context.fromDate,context.toDate))return false;
      if(kind&&salesKind(delivery)!==kind)return false;
      if(!sameClient(client,delivery))return false;
      const assigned=delivery.employeeId===employee?.id||client.rep===employee?.id||(Array.isArray(client.repIds)&&client.repIds.includes(employee?.id));
      return assigned;
    }));
    filtered.crossSectorPurchases=(rows?.crossSectorPurchases||[]).map(item=>{const invoices=(item.invoices||[]).filter(invoice=>inRange(invoice.date,context.fromDate,context.toDate));if(!invoices.length)return null;return{...item,invoices,amount:invoices.reduce((sum,row)=>sum+Number(row.amount||0),0),firstDate:invoices.map(row=>row.date).filter(Boolean).sort()[0]||'',lastDate:invoices.map(row=>row.date).filter(Boolean).sort().at(-1)||''};}).filter(Boolean);context.crossSectorPurchases=filtered.crossSectorPurchases;return filtered;
  }

  function installPortfolioFilter(){
    const original=window.clientPortfolioForEmployee;
    if(typeof original!=='function')return false;if(original.__bhDateRangeWrapped)return true;
    const wrapped=function(employee,segment){
      const context=activePrintContext||window.__BH_PORTFOLIO_PRINT_CONTEXT__;
      if(context?.exactSales)return exactClients(employee,segment,context);
      const rows=original.apply(this,arguments);
      return context?.fromDate?filterClientsByRange(rows,employee,segment,context):rows;
    };
    wrapped.__bhDateRangeWrapped=true;wrapped.__bhOriginal=original;window.clientPortfolioForEmployee=wrapped;return true;
  }

  function declarationButton(){return[...document.querySelectorAll('button')].find(button=>/\bprCli\s*\(/.test(button.getAttribute('onclick')||''))||null;}
  function selectorEmployee(employee){
    const select=document.getElementById('pcEmp');if(!select||!employee)return false;
    let option=[...select.options].find(item=>item.value===employee.id);
    if(!option){try{window.rAll?.();}catch{}option=[...select.options].find(item=>item.value===employee.id);}
    if(!option){option=document.createElement('option');option.value=employee.id;option.textContent=employee.name||employee.nid||employee.id;select.appendChild(option);}
    select.value=employee.id;return select.value===employee.id;
  }
  function prepareDeclaration(employee,kind,context){
    ensureRangeControls();
    if(!selectorEmployee(employee))throw new Error('تعذر اختيار مسؤول المحفظة في نموذج الإقرار.');
    const segment=document.getElementById('pcSeg');if(!segment)throw new Error('حقل قطاع محفظة العملاء غير موجود.');
    segment.value=kind==='block'?'بلوك':'خرسانة';
    document.getElementById('pcFrom').value=context.fromDate;
    document.getElementById('pcTo').value=context.toDate;
    const button=declarationButton();if(!button)throw new Error('زر إقرار مسؤولية محفظة العملاء غير موجود.');
    return button;
  }

  function insertCrossSectorPage(sheet,context){
    sheet.querySelectorAll('.bh-cross-sector-page').forEach(node=>node.remove());
    const rows=context?.crossSectorPurchases||[];if(!rows.length)return;
    const existing=[...sheet.querySelectorAll('.doc,.portfolio-page,[data-document-page]')],source=existing[0];if(!source)return;
    const page=document.createElement('div');page.className=`${source.className||'doc'} bh-cross-sector-page`;page.dataset.documentPage='cross-sector';
    const spine=source.querySelector('.spine')?.cloneNode(true),body=document.createElement('div');body.className=source.querySelector('.body')?.className||'body';
    const watermark=source.querySelector('.wm')?.cloneNode(true),mast=source.querySelector('.mast')?.cloneNode(true),bar=source.querySelector('.tbar')?.cloneNode(true);if(watermark)body.appendChild(watermark);if(mast)body.appendChild(mast);if(bar){const title=bar.querySelector('h1');if(title)title.textContent='مبيعات لعملاء تابعين للقطاع الآخر';body.appendChild(bar);}
    const total=rows.reduce((sum,row)=>sum+Number(row.amount||0),0),section=document.createElement('section');section.className='sec';section.innerHTML=`<div class="sh"><span class="n">٢-أ</span><span class="t">مبيعات لعملاء تابعين للقطاع الآخر</span><span class="fill"></span><span class="tag">${rows.length} عملية</span></div><table class="led"><thead><tr><th>م</th><th>العميل</th><th>الكود</th><th>المحفظة الأساسية</th><th>الفاتورة</th><th>قيمة البيع</th><th>نطاق المسؤولية</th></tr></thead><tbody>${rows.map((row,index)=>`<tr><td class="idx">${index+1}</td><td class="nm">${esc(row.name)}</td><td class="mono">${esc(row.code||'—')}</td><td>${esc(row.ownerSectorLabel||'—')}<div style="font-size:6.2pt;color:#8C8368">${esc(row.ownerEmployeeName||'مسؤول القطاع الأساسي')}</div></td><td class="mono">${esc((row.invoices||[]).map(item=>item.invoice).filter(Boolean).join('، ')||'—')}</td><td class="num">${Number(row.amount||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td><td>مسؤولية فاتورة القطاع البائع فقط</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="5" class="lbl">إجمالي مبيعات القطاع لعملاء قطاع آخر</td><td class="num">${total.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td><td></td></tr></tfoot></table><div style="margin-top:3mm;border:1pt solid #C6B187;background:#FBF3E5;padding:2.5mm 3mm;font-size:7.7pt;line-height:1.7;color:#4C3A1A;text-align:justify">لا تنشئ هذه العمليات عميلاً جديدًا ولا تنقل العميل من محفظته الأساسية. يتحمل المندوب الموقّع مسؤولية صحة وتنفيذ ومتابعة فواتير قطاعه المبينة أعلاه فقط، بينما تبقى ملكية العميل ورصيده العام وتحصيلاته لدى مسؤول محفظته الأساسية.</div>`;
    body.appendChild(section);if(spine)page.appendChild(spine);page.appendChild(body);
    const before=existing.find(node=>/الإقرارات والاعتماد|الإقرارات والالتزامات/.test(node.textContent||''))||existing.at(-1);if(before)sheet.insertBefore(page,before);else sheet.appendChild(page);
  }
  function annotateSheet(context){
    const sheet=document.getElementById('sheet');if(!sheet)return;
    insertCrossSectorPage(sheet,context);
    const pages=sheet.querySelectorAll('.doc,.portfolio-page,[data-document-page]');
    const targets=pages.length?[...pages]:[sheet];
    const label=context.fromDate===context.toDate?`تاريخ التقرير: ${fmt(context.toDate)}`:`فترة المحفظة: من ${fmt(context.fromDate)} إلى ${fmt(context.toDate)}`;
    for(const page of targets){
      page.querySelector('[data-bh-portfolio-range]')?.remove();
      const band=document.createElement('div');band.dataset.bhPortfolioRange='1';band.textContent=label;band.style.cssText='margin:0 0 3mm;padding:2.2mm 4mm;border:1px solid #D9B570;background:#F5EDDF;color:#14425F;border-radius:2mm;font-weight:700;text-align:center;font-size:9.5pt;direction:rtl';
      const body=page.querySelector('.doc-body,.doc-main,.content,.body')||page;body.insertBefore(band,body.firstChild);
    }
    sheet.dataset.bhPortfolioFrom=context.fromDate;sheet.dataset.bhPortfolioTo=context.toDate;sheet.dataset.bhPortfolioSource=context.exactSales?'approved-batch':'manual-range';
  }

  function installPrintWrapper(){
    const original=window.prCli;if(typeof original!=='function')return false;if(original.__bhDateRangeWrapped)return true;
    const wrapped=function(){
      ensureRangeControls();
      const context=validateRange(pendingPrintContext||rangeFromControls());pendingPrintContext=null;
      const previous=window.__BH_PORTFOLIO_PRINT_CONTEXT__,previousToday=window.opsToday,previousPrint=window.print;
      activePrintContext=context;window.__BH_PORTFOLIO_PRINT_CONTEXT__=context;window.opsToday=()=>context.reportDate||context.toDate;
      window.print=function(){annotateSheet(context);return previousPrint.apply(this,arguments);};
      try{const result=original.apply(this,arguments);annotateSheet(context);return result;}
      finally{activePrintContext=null;window.__BH_PORTFOLIO_PRINT_CONTEXT__=previous;window.print=previousPrint;if(previousToday)window.opsToday=previousToday;else delete window.opsToday;}
    };
    wrapped.__bhDateRangeWrapped=true;wrapped.__bhOriginal=original;window.prCli=wrapped;return true;
  }

  function findApprovalDateInput(){
    const form=document.getElementById('opsForm');if(!form)return null;
    const excluded=new Set(['pcFrom','pcTo','repFrom','repTo']);
    const candidates=[...form.querySelectorAll('input[type="date"],input[name*="date" i],input[id*="date" i]')].filter(input=>!excluded.has(input.id)&&!input.disabled);
    const scored=candidates.map(input=>{let score=0;const key=norm(`${input.name||''} ${input.id||''}`);if(/dailydate|reportdate|report date|تاريخ التقرير|تاريخ اليوم/.test(key))score+=20;if(input.type==='date')score+=10;if(input.offsetParent!==null)score+=5;if(iso(input.value))score+=30;return{input,score};}).sort((a,b)=>b.score-a.score);
    return scored[0]?.input||null;
  }
  function syncApprovalDateAliases(){
    const form=document.getElementById('opsForm'),source=findApprovalDateInput();if(!form||!source)return'';
    const value=iso(source.value);if(!value)return'';
    for(const name of ['dailyDate','reportDate']){
      let alias=form.querySelector(`[name="${name}"]`);
      if(!alias){alias=document.createElement('input');alias.type='hidden';alias.name=name;alias.dataset.bhDateAlias='1';form.appendChild(alias);}
      alias.value=value;
    }
    return value;
  }

  function declarationStore(){const ops=state().OPS;if(!ops||typeof ops!=='object')return null;if(!Array.isArray(ops.dailyPortfolioDeclarations))ops.dailyPortfolioDeclarations=[];return ops.dailyPortfolioDeclarations;}
  function recordKey(record){return`${record.cloudImportId||record.reportDate}:${record.employeeId}:${record.kind}:${record.fromDate}:${record.toDate}`;}
  function upsertRecord(record){const store=declarationStore();if(!store)return record;const key=recordKey(record),index=store.findIndex(item=>item.key===key),value={...(index>=0?store[index]:{}),...record,key,updatedAt:new Date().toISOString()};if(index>=0)store[index]=value;else store.unshift(value);return value;}
  async function persistRecords(reason){try{window.save?.();}catch{}try{await window.opsPersist?.(reason||'تسجيل إقرار محفظة العملاء');}catch(error){console.warn('[BinHamid portfolio persist]',error);}}

  async function sendDeclaration(kind,reportDate,cloud,sales){
    const employee=responsibleEmployee(kind);if(!employee)throw new Error(`مسؤول مبيعات ${kind==='block'?'البلوك':'الخرسانة'} غير محدد.`);
    const kindSales=(sales||[]).filter(row=>salesKind(row)===kind),hasExactRows=kindSales.some(row=>clean(row?.customerCode||row?.customer_code||row?.customer||row?.customerName||row?.customer_name||row?.invoice||row?.invoiceNo||row?.invoice_no||row?.item||row?.product));
    const context={fromDate:reportDate,toDate:reportDate,reportDate,exactSales:hasExactRows,sales:kindSales,cloudImportId:cloud?.importId||cloud?.existingImportId||cloud?.postedBatchId||''};
    const base={reportDate,fromDate:reportDate,toDate:reportDate,cloudImportId:context.cloudImportId,employeeId:employee.id,employeeName:employee.name||'',employeeResidency:digits(employee.nid||employee.iqamaId||employee.no),kind,segment:kind==='block'?'بلوك':'خرسانة',title:`محفظة عملاء — ${employee.name||''}`,telegramSent:false,status:'generated',createdAt:new Date().toISOString()};
    const existing=(declarationStore()||[]).find(item=>item.key===recordKey(base)&&item.telegramSent);if(existing)return existing;
    upsertRecord(base);const button=prepareDeclaration(employee,kind,context);if(typeof window.bhSendPrintedButtonToTelegram!=='function')throw new Error('خدمة إرسال نفس نسخة الطباعة إلى Telegram غير جاهزة.');
    pendingPrintContext=context;const result=await window.bhSendPrintedButtonToTelegram(button,null);
    return upsertRecord({...base,telegramSent:true,status:'sent',telegramMessageId:result?.messageId||result?.message_id||null,sentAt:new Date().toISOString()});
  }

  async function afterApproved({reportDate,cloud,payload,context}={}){
    payload=payload||context?.plan||{};
    reportDate=iso(reportDate);if(!reportDate)throw new Error('تعذر تحديد تاريخ التقرير المعتمد؛ لم يُرسل إقرار بتاريخ اليوم تلقائيًا.');
    const key=cloud?.importId||cloud?.existingImportId||cloud?.postedBatchId||`${reportDate}:${cloud?.fileHash||''}`;if(completedApprovals.has(key))return{ok:true,duplicate:true,sent:[],failed:[]};completedApprovals.add(key);
    const sales=payload?.sales||[],kinds=[...new Set(sales.map(salesKind).filter(kind=>kind==='block'||kind==='concrete'))],sent=[],failed=[];
    for(const kind of kinds){try{sent.push(await sendDeclaration(kind,reportDate,cloud,sales));}catch(error){failed.push({kind,error:error?.message||String(error)});console.error('[BinHamid portfolio declaration]',kind,error);}}
    await persistRecords(`إقرارات محفظة العملاء للتقرير ${reportDate}`);if(window.OPS_VIEW==='reports')renderRecords();return{ok:failed.length===0,sent,failed};
  }
  async function completePendingApproval(){const pending=pendingApproval;if(!pending)return null;pendingApproval=null;const result=await afterApproved(pending);const count=result.sent?.length||0;if(result.failed?.length)window.opsToast?.(`تم اعتماد التقرير، وتعذر إرسال ${result.failed.length} إقرار محفظة إلى Telegram.`,'err');else if(count)window.opsToast?.(`تم اعتماد التقرير وإرسال ${count} إقرار محفظة بالتاريخ الصحيح ونفس تصميم الموقع.`);return result;}

  function filterRecords(){const store=declarationStore()||[],from=document.getElementById('repFrom')?.value||'',to=document.getElementById('repTo')?.value||'';return store.filter(item=>(!from||item.toDate>=from)&&(!to||item.fromDate<=to));}
  function openSaved(record){const runtime=state(),employee=(runtime.D.emp||[]).find(item=>item.id===record.employeeId)||responsibleEmployee(record.kind),context={fromDate:record.fromDate||record.reportDate,toDate:record.toDate||record.reportDate,reportDate:record.reportDate||record.toDate,exactSales:false};prepareDeclaration(employee,record.kind,context);pendingPrintContext=context;declarationButton()?.click();}
  function renderRecords(){
    const content=document.getElementById('opsContent');if(!content)return;document.getElementById('bh-daily-portfolio-declarations-card')?.remove();const rows=filterRecords(),card=document.createElement('div');card.id='bh-daily-portfolio-declarations-card';card.className='ops-card ops-col-12';
    card.innerHTML=`<h3>إقرارات مسؤولية محفظة العملاء</h3><div class="ops-note">الإقرار اليدوي يعتمد فترة «من/إلى». الإقرار التلقائي يعتمد تاريخ الملف المعتمد نفسه، وتُرسل إلى Telegram لقطة #sheet المطابقة لطباعة الموقع.</div>${rows.length?`<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>من</th><th>إلى</th><th>المسؤول</th><th>القطاع</th><th>الحالة</th><th></th></tr></thead><tbody>${rows.map((row,index)=>`<tr><td>${esc(row.fromDate||row.reportDate)}</td><td>${esc(row.toDate||row.reportDate)}</td><td>${esc(row.employeeName)}</td><td>${esc(row.segment)}</td><td>${row.telegramSent?'تم الإرسال إلى Telegram':'تم الإنشاء'}</td><td><button type="button" class="ops-btn ghost" data-bh-portfolio-open="${index}">فتح نفس الإقرار</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="ops-empty"><b>لا توجد إقرارات مولّدة في الفترة المحددة</b></div>'}`;content.appendChild(card);card.querySelectorAll('[data-bh-portfolio-open]').forEach(button=>button.addEventListener('click',()=>openSaved(rows[Number(button.dataset.bhPortfolioOpen)])));
  }

  function installReportsWrapper(){const original=window.opsRenderReports;if(typeof original!=='function')return false;if(original.__bhPortfolioRangeWrapped)return true;const wrapped=function(){const result=original.apply(this,arguments);setTimeout(renderRecords,0);return result;};wrapped.__bhPortfolioRangeWrapped=true;window.opsRenderReports=wrapped;return true;}
  function installFetchWrapper(){
    const original=window.fetch;if(typeof original!=='function')return false;if(original.__bhPortfolioRangeWrapped)return true;
    const wrapped=async function(input,options={}){const response=await original.apply(this,arguments),url=typeof input==='string'?input:input?.url||'';if(response.ok&&url.includes('/api/daily-report')){let body={};try{body=typeof options?.body==='string'?JSON.parse(options.body):{};}catch{}if(body?.action==='commit'){const cloud=await response.clone().json().catch(()=>null);if(cloud?.ok)pendingApproval={reportDate:body.reportDate||cloud?.preview?.reportDate||'',payload:body.payload||{},cloud};}}return response;};
    wrapped.__bhPortfolioRangeWrapped=true;window.fetch=wrapped;return true;
  }
  function installModalWrapper(){
    const original=window.opsOpenModal;if(typeof original!=='function')return false;if(original.__bhPortfolioRangeWrapped)return true;
    const wrapped=function(title,html,onSave,label){
      if(typeof onSave!=='function')return original.apply(this,arguments);
      const completedSave=async function(){
        const value=syncApprovalDateAliases();
        if(/اعتماد|تقرير يومي|ملخص اليوم|تقرير الحركه|تقرير الحركة/.test(norm(title))&&!value)throw new Error('حدد تاريخ التقرير داخل شاشة الاعتماد. تم منع استخدام تاريخ اليوم تلقائيًا.');
        try{const result=await onSave.apply(this,arguments);if(pendingApproval)await completePendingApproval();return result;}
        catch(error){if(pendingApproval&&/كل صفوف الملف مستورده سابقا|هذا الملف معتمد سابقا|مستورده سابقا|مستورد سابقا/.test(norm(error?.message||error))){await completePendingApproval();window.opsToast?.('تم اعتماد التقرير وإرسال ملفاته إلى Telegram دون تكرار الصفوف المحلية.');return true;}throw error;}
      };
      const result=original.call(this,title,html,completedSave,label);setTimeout(()=>{syncApprovalDateAliases();const source=findApprovalDateInput();source?.addEventListener('change',syncApprovalDateAliases);},0);return result;
    };
    wrapped.__bhPortfolioRangeWrapped=true;window.opsOpenModal=wrapped;return true;
  }

  window.bhAfterDailyReportApproved=afterApproved;
  window.BinHamidCustomerPortfolioRange={version:VERSION,getContext:()=>activePrintContext||pendingPrintContext||rangeFromControls(),afterApproved,renderRecords,ensureRangeControls};

  let attempts=0;
  const timer=setInterval(()=>{
    attempts++;ensureRangeControls();
    const ready=installPortfolioFilter()&&installPrintWrapper()&&installReportsWrapper()&&installFetchWrapper()&&installModalWrapper()&&typeof window.bhSendPrintedButtonToTelegram==='function';
    if(ready||attempts>=240){clearInterval(timer);console.info('[BinHamid]',VERSION,ready?'ready':'loaded with deferred dependencies');}
  },250);
})();
