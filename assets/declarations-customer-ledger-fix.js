(function(root,factory){
  const api=factory(root);
  root.BinHamidDeclarationsCustomerFix=api;
  if(root.document)api.install();
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  const VERSION='2026.07.17-declarations-customer-ledger-v1';
  let installed=false,persistWrapped=false,printWrapped=false,rAllWrapped=false,bootPersisted=false;

  const num=value=>{const parsed=Number(value||0);return Number.isFinite(parsed)?parsed:0;};
  const clean=value=>String(value??'').trim();
  const norm=value=>clean(value).toLowerCase().replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/ؤ/g,'و').replace(/ئ/g,'ي').replace(/ـ/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();
  const code=value=>clean(value).replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\.0+$/,'').replace(/\s+/g,'').toUpperCase();
  const day=value=>clean(value).slice(0,10);
  const addDays=(value,days)=>{if(!value)return'';const date=new Date(`${day(value)}T12:00:00`);if(Number.isNaN(date.getTime()))return'';date.setDate(date.getDate()+Math.max(0,num(days)));return date.toISOString().slice(0,10);};
  const today=()=>typeof root.opsToday==='function'?root.opsToday():new Date().toISOString().slice(0,10);
  const daysLate=value=>{if(!value)return 0;const due=new Date(`${day(value)}T00:00:00`),now=new Date(`${today()}T00:00:00`);return Number.isNaN(due.getTime())?0:Math.max(0,Math.floor((now-due)/86400000));};
  const kindOf=row=>{const text=norm(row?.product||row?.item||row?.itemName||'');return /خرسان/.test(text)?'concrete':/(?:بلك|بلوك)/.test(text)?'block':'';};
  const clientCodes=client=>new Set([client?.code,client?.customerCode,client?.accountCode,client?.external_id,client?.externalId].map(code).filter(Boolean));
  const rowCodes=row=>new Set([row?.customerCode,row?.accountCode,row?.clientCode,row?.code,row?.customer_external_id,row?.customerExternalId].map(code).filter(Boolean));
  const namesFor=value=>new Set([value?.name,value?.customer,value?.customerName,value?.accountName,value?.clientName,value?.partyName].map(norm).filter(Boolean));
  const intersects=(a,b)=>{for(const value of a)if(b.has(value))return true;return false;};
  const validEmployee=(employees,id)=>Boolean(id&&employees.some(employee=>employee.id===id&&employee.act!==false));

  function resolveClient(row,clients=[]){
    if(row?.clientId){const direct=clients.find(client=>client.id===row.clientId);if(direct)return direct;}
    const codes=rowCodes(row);
    if(codes.size){const byCode=clients.find(client=>intersects(clientCodes(client),codes));if(byCode)return byCode;}
    const names=namesFor(row);
    if(names.size)return clients.find(client=>intersects(namesFor(client),names))||null;
    return null;
  }

  function matchesClient(row,client,clients=[]){
    if(!row||!client)return false;
    if(row.clientId&&row.clientId===client.id)return true;
    const targetCodes=clientCodes(client),sourceCodes=rowCodes(row);
    if(targetCodes.size&&sourceCodes.size)return intersects(targetCodes,sourceCodes);
    if(row.clientId){
      const linked=clients.find(item=>item.id===row.clientId);
      if(linked){
        const linkedCodes=clientCodes(linked);
        if(targetCodes.size&&linkedCodes.size)return intersects(targetCodes,linkedCodes);
        const linkedNames=namesFor(linked),targetNames=namesFor(client);
        if(linkedNames.size&&targetNames.size)return intersects(linkedNames,targetNames);
      }
    }
    const targetNames=namesFor(client),sourceNames=namesFor(row);
    return targetNames.size>0&&sourceNames.size>0&&intersects(targetNames,sourceNames);
  }

  const uniqueBy=(rows,keyFn)=>{const seen=new Set(),out=[];for(const row of rows){const key=keyFn(row);if(seen.has(key))continue;seen.add(key);out.push(row);}return out;};
  const invoiceKey=row=>clean(row.id||row.sourceRowKey||row.sourceDailyKey)||[day(row.date),clean(row.clientOrder||row.invoice||row.no),code(row.customerCode),norm(row.product||row.item),num(row.quantity).toFixed(3),num(row.amount).toFixed(2)].join('|');
  const collectionKey=row=>clean(row.id||row.sourceDailyKey)||[day(row.date),code(row.customerCode||row.accountCode),clean(row.receipt||row.reference||row.no),num(row.amount).toFixed(2),norm(row.method)].join('|');

  function buildClientLedger(state,clientId,requestedKind=''){
    const D=state?.D||{},OPS=state?.OPS||{},clients=Array.isArray(D.cli)?D.cli:[],client=clients.find(item=>item.id===clientId)||{};
    const paymentDays=Math.max(0,num(client.days??D.cfg?.days??3));
    const rawInvoices=(OPS.deliveries||[]).filter(row=>!['returned','cancelled','reversed'].includes(row?.status)&&matchesClient(row,client,clients));
    const invoices=uniqueBy(rawInvoices,invoiceKey).map(row=>{
      const amount=Math.max(0,num(row.amount));
      const immediate=Math.min(amount,Math.max(0,num(row.cash))+Math.max(0,num(row.transfer))+Math.max(0,num(row.immediatePaid)));
      return{id:row.id||invoiceKey(row),no:row.clientOrder||row.invoice||row.no||'',date:day(row.date),kind:kindOf(row),product:row.product||row.item||'',quantity:num(row.quantity),unit:row.unit||'',amount,immediatePaid:immediate,allocatedCollection:0,remaining:Math.max(0,amount-immediate),dueDate:addDays(day(row.date),paymentDays),source:row};
    }).sort((a,b)=>a.date.localeCompare(b.date)||String(a.no).localeCompare(String(b.no),'ar',{numeric:true}));
    const byId=new Map(invoices.flatMap(invoice=>[[invoice.id,invoice],invoice.source?.id&&invoice.source.id!==invoice.id?[invoice.source.id,invoice]:[]]).filter(Boolean));
    const collections=uniqueBy((OPS.collections||[]).filter(row=>!['cancelled','reversed'].includes(row?.status)&&matchesClient(row,client,clients)),collectionKey).sort((a,b)=>day(a.date).localeCompare(day(b.date))||String(a.receipt||a.no||'').localeCompare(String(b.receipt||b.no||''),'ar',{numeric:true}));
    let unapplied=0;
    const allocateTo=(invoice,left)=>{if(!invoice||left<=0||invoice.remaining<=0)return left;const allocated=Math.min(left,invoice.remaining);invoice.allocatedCollection+=allocated;invoice.remaining-=allocated;return left-allocated;};
    for(const payment of collections){
      let left=Math.max(0,num(payment.amount));
      if(payment.invoiceId)left=allocateTo(byId.get(payment.invoiceId),left);
      if(left>0&&payment.allocationMode!=='invoice_only'){
        const paymentDate=day(payment.date);
        for(const invoice of invoices){if(left<=0)break;if(!paymentDate||!invoice.date||invoice.date<=paymentDate)left=allocateTo(invoice,left);}
        for(const invoice of invoices){if(left<=0)break;left=allocateTo(invoice,left);}
      }
      unapplied+=left;
    }
    const selected=invoices.filter(invoice=>!requestedKind||invoice.kind===requestedKind);
    const aggregate=selected.reduce((result,invoice)=>{result.quantity+=invoice.quantity;result.sales+=invoice.amount;result.immediate+=invoice.immediatePaid;result.collections+=invoice.allocatedCollection;result.paid+=invoice.immediatePaid+invoice.allocatedCollection;result.grossRemaining+=invoice.remaining;if(invoice.remaining>0&&invoice.dueDate&&invoice.dueDate<today())result.overdue+=invoice.remaining;return result;},{quantity:0,sales:0,immediate:0,collections:0,paid:0,grossRemaining:0,overdue:0});
    const collectionTotal=collections.reduce((sum,row)=>sum+Math.max(0,num(row.amount)),0);
    const credit=requestedKind?0:unapplied,netBalance=aggregate.grossRemaining-credit;
    const openSelected=selected.filter(invoice=>invoice.remaining>0).sort((a,b)=>String(a.dueDate).localeCompare(String(b.dueDate)));
    return{client,invoices,selected,collectionRows:collections,...aggregate,paid:requestedKind?aggregate.paid:aggregate.immediate+collectionTotal,remaining:Math.max(0,netBalance),debitBalance:Math.max(0,netBalance),creditBalance:Math.max(0,-netBalance),netBalance,unapplied:credit,nextDueDate:openSelected[0]?.dueDate||'',maxDaysLate:openSelected.reduce((max,invoice)=>Math.max(max,daysLate(invoice.dueDate)),0)};
  }

  function responsibleFromState(state,kind){
    const D=state?.D||{},OPS=state?.OPS||{},employees=D.emp||[],key=kind==='concrete'?'concreteSalesEmployeeId':'blockSalesEmployeeId',configured=employees.find(employee=>employee.id===OPS.settings?.[key]&&employee.act!==false);
    if(configured)return configured;
    const target=kind==='concrete'?'مسؤول مبيعات الخرسانة':'مسؤول مبيعات البلوك';
    return employees.find(employee=>employee.act!==false&&norm(employee.role)===norm(target))||employees.find(employee=>employee.act!==false&&norm(employee.role).includes(kind==='concrete'?'خرسان':'بلوك'))||null;
  }

  function reconcileSalesEmployees(state,responsible={}){
    const D=state?.D||{},OPS=state?.OPS||{},employees=D.emp||[],deliveries=OPS.deliveries||[],imports=OPS.imports||[];
    const concrete=responsible.concrete||responsibleFromState(state,'concrete'),block=responsible.block||responsibleFromState(state,'block');
    const byKind={concrete,block};let changes=0;
    for(const batch of imports){
      const related=deliveries.filter(delivery=>delivery.sourceImportId&&delivery.sourceImportId===batch.id);
      for(const kind of ['concrete','block']){
        const field=kind==='concrete'?'concreteEmployeeId':'blockEmployeeId',countField=kind==='concrete'?'concreteSalesCount':'blockSalesCount',lines=related.filter(delivery=>kindOf(delivery)===kind),fallback=byKind[kind];
        const lineEmployeeIds=[...new Set(lines.map(line=>line.employeeId).filter(id=>validEmployee(employees,id)))];
        const resolved=validEmployee(employees,batch[field])?batch[field]:(lineEmployeeIds.length===1?lineEmployeeIds[0]:fallback?.id||'');
        if(resolved&&batch[field]!==resolved){batch[field]=resolved;changes++;}
        if(lines.length&&num(batch[countField])!==lines.length){batch[countField]=lines.length;changes++;}
      }
    }
    for(const delivery of deliveries){
      const kind=kindOf(delivery);if(!kind)continue;
      const batch=imports.find(item=>item.id===delivery.sourceImportId),field=kind==='concrete'?'concreteEmployeeId':'blockEmployeeId',candidate=batch?.[field]||byKind[kind]?.id||'';
      if(!validEmployee(employees,delivery.employeeId)&&validEmployee(employees,candidate)){delivery.employeeId=candidate;changes++;}
    }
    return{changes,concreteEmployeeId:concrete?.id||'',blockEmployeeId:block?.id||''};
  }

  function clientPortfolioForEmployee(state,employee,segment='auto'){
    const D=state?.D||{},OPS=state?.OPS||{},clients=D.cli||[],role=norm(employee?.role),requested=segment==='خرسانة'?'concrete':segment==='بلوك'?'block':segment==='all'?'':segment==='auto'?(role.includes('خرسان')?'concrete':role.includes('بلوك')?'block':''):segment;
    const activity=new Map();
    for(const delivery of OPS.deliveries||[]){
      if(['returned','cancelled','reversed'].includes(delivery?.status))continue;
      const candidates=clients.filter(client=>matchesClient(delivery,client,clients));
      const client=candidates.find(item=>item.rep===employee?.id||(Array.isArray(item.repIds)&&item.repIds.includes(employee?.id)))||resolveClient(delivery,clients);if(!client)continue;
      const assigned=delivery.employeeId===employee?.id||client.rep===employee?.id||(Array.isArray(client.repIds)&&client.repIds.includes(employee?.id));
      if(!assigned)continue;
      const current=activity.get(client.id)||{kinds:new Set(),lastDate:'',sales:0};const kind=kindOf(delivery);if(kind)current.kinds.add(kind);current.lastDate=day(delivery.date)>current.lastDate?day(delivery.date):current.lastDate;current.sales+=num(delivery.amount);activity.set(client.id,current);
    }
    return clients.filter(client=>{const assigned=client.rep===employee?.id||(Array.isArray(client.repIds)&&client.repIds.includes(employee?.id)),active=activity.has(client.id);if(!assigned&&!active)return false;if(!requested)return true;const item=activity.get(client.id);if(item?.kinds.has(requested))return true;return assigned&&(client.seg===(requested==='concrete'?'خرسانة':'بلوك')||client.seg==='الاثنين');}).map(client=>{const item=activity.get(client.id),kinds=item?.kinds||new Set(),actual=kinds.size>1?'الاثنين':kinds.has('concrete')?'خرسانة':kinds.has('block')?'بلوك':client.seg;return{...client,_portfolioSegment:actual,_portfolioLastDate:item?.lastDate||'',_portfolioSales:item?.sales||0};}).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'ar'));
  }

  const esc=value=>clean(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const money=value=>num(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const quantity=value=>num(value).toLocaleString('en-US',{maximumFractionDigits:3});
  const fmtDate=value=>{const parts=day(value).split('-');return parts.length===3?`${parts[2]}/${parts[1]}/${parts[0]}`:'—';};

  function renderClients(){
    const D=root.D,OPS=root.OPS,document=root.document;if(!D||!OPS||!document)return;
    const body=document.getElementById('tCli');if(!body)return;
    const table=body.closest('table'),head=table?.querySelector('thead tr');
    if(head)head.innerHTML='<th>اسم العميل</th><th>القطاع</th><th>الحركة</th><th>المبيعات</th><th>السداد</th><th>الرصيد</th><th>الاستحقاق</th><th>المندوب المسؤول</th><th></th>';
    const segment=document.getElementById('fSeg')?.value||'',representative=document.getElementById('fRep')?.value||'';let clients=D.cli||[];
    if(segment)clients=clients.filter(client=>client.seg===segment||client.seg==='الاثنين');
    if(representative)clients=clients.filter(client=>client.rep===representative||(Array.isArray(client.repIds)&&client.repIds.includes(representative)));
    if(!clients.length){body.innerHTML='<tr><td colspan="9"><div class="empty"><span class="big">🧾</span>لا يوجد عملاء — اضغط «إضافة عميل»</div></td></tr>';return;}
    body.innerHTML=clients.map(client=>{const ledger=buildClientLedger({D,OPS},client.id),concrete=buildClientLedger({D,OPS},client.id,'concrete'),block=buildClientLedger({D,OPS},client.id,'block'),parts=[];if(concrete.quantity)parts.push(`${quantity(concrete.quantity)} م³ خرسانة`);if(block.quantity)parts.push(`${quantity(block.quantity)} بلوك`);const rep=(D.emp||[]).find(employee=>employee.id===client.rep),due=ledger.nextDueDate?fmtDate(ledger.nextDueDate):'—',credit=ledger.creditBalance?`<div style="color:#1F7A4C;font-size:11px">دائن ${money(ledger.creditBalance)}</div>`:'',late=ledger.maxDaysLate?`<div style="color:var(--warn);font-size:11px">متأخر ${ledger.maxDaysLate} يوم</div>`:'';return `<tr><td><b>${esc(client.name)}</b><div style="font-size:11px;color:var(--muted)">${esc(client.code||client.customerCode||client.cr||'')}</div></td><td><span class="chip ${client.seg==='بلوك'?'blk':'con'}">${esc(client.seg||'—')}</span></td><td>${parts.join(' · ')||'لا توجد حركة'}</td><td class="mono">${money(ledger.sales)}</td><td class="mono">${money(ledger.paid)}</td><td class="mono ${ledger.remaining?'client-balance-positive':'client-balance-clear'}">${money(ledger.remaining)}${credit}</td><td>${due}${late}</td><td>${rep?esc(rep.name):'<span style="color:var(--warn)">غير مُسند</span>'}</td><td style="white-space:nowrap"><button class="btn btn-o btn-sm" onclick="cliForm('${esc(client.id)}')">تعديل</button><button class="btn btn-d btn-sm" onclick="del('cli','${esc(client.id)}')">×</button></td></tr>`;}).join('');
  }

  function runtimeState(){return{D:root.D||{},OPS:root.OPS||{}};}
  function runtimeResponsible(kind){return typeof root.opsSalesResponsible==='function'?root.opsSalesResponsible(kind):responsibleFromState(runtimeState(),kind);}
  function reconcileRuntime(){return reconcileSalesEmployees(runtimeState(),{concrete:runtimeResponsible('concrete'),block:runtimeResponsible('block')});}

  function install(){
    if(installed)return true;
    if(!root.D||!root.OPS||!root.document)return false;
    installed=true;
    const originalPersist=typeof root.opsPersist==='function'?root.opsPersist:null;
    const originalPrint=typeof root.opsPrintDailySalesDeclaration==='function'?root.opsPrintDailySalesDeclaration:null;
    const originalRAll=typeof root.rAll==='function'?root.rAll:null;

    root.bhClientLedger=(clientId,requestedKind)=>buildClientLedger(runtimeState(),clientId,requestedKind);
    root.bhClientAggregate=(client,kind)=>buildClientLedger(runtimeState(),client?.id,kind);
    root.clientPortfolioForEmployee=(employee,segment)=>clientPortfolioForEmployee(runtimeState(),employee,segment);
    root.rCli=renderClients;

    if(originalRAll&&!rAllWrapped){root.rAll=function(){const result=originalRAll.apply(this,arguments);renderClients();return result;};rAllWrapped=true;}
    if(originalPrint&&!printWrapped){root.opsPrintDailySalesDeclaration=function(){reconcileRuntime();return originalPrint.apply(this,arguments);};printWrapped=true;}
    if(originalPersist&&!persistWrapped){root.opsPersist=async function(){reconcileRuntime();return originalPersist.apply(this,arguments);};persistWrapped=true;}

    const result=reconcileRuntime();renderClients();
    if(result.changes&&!bootPersisted){bootPersisted=true;try{root.save?.();}catch{}if(originalPersist)Promise.resolve(originalPersist.call(root,'تصحيح ربط إقرارات المبيعات وكشف العملاء')).catch(error=>console.error('[BinHamid declarations fix]',error));}
    root.BinHamidDeclarationsCustomerFix.version=VERSION;
    root.BinHamidDeclarationsCustomerFix.installed=true;
    console.info('[BinHamid]',VERSION,'loaded',result);
    return true;
  }

  if(root.document){const timer=setInterval(()=>{if(install())clearInterval(timer);},250);setTimeout(()=>clearInterval(timer),20000);}
  return{VERSION,norm,code,kindOf,matchesClient,resolveClient,buildClientLedger,reconcileSalesEmployees,clientPortfolioForEmployee,install};
});