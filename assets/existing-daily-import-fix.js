(function(){
  'use strict';
  const VERSION='2026.07.17-existing-daily-import-v2';
  let installed=false,lastDailyPlan=null,lastMovementPlan=null;
  const num=value=>{const parsed=Number(String(value??0).replace(/,/g,''));return Number.isFinite(parsed)?parsed:0;};
  const fixed=(value,digits)=>num(value).toFixed(digits);
  const norm=value=>String(value??'').trim().toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/ـ/g,'').replace(/\s+/g,' ');
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const money=value=>num(value).toLocaleString('ar-SA',{minimumFractionDigits:2,maximumFractionDigits:2});
  const quantity=value=>num(value).toLocaleString('ar-SA',{maximumFractionDigits:3});
  const merge=(first,second,keyFn)=>{const result=[],seen=new Set();for(const row of [...(first||[]),...(second||[])]){const key=keyFn(row);if(seen.has(key))continue;seen.add(key);result.push(row);}return result;};
  const rowSaleKey=row=>[row.sheet||'',row.row||'',String(row.invoice||''),String(row.customerCode||''),norm(row.item),fixed(row.quantity,3),fixed(row.amount,2)].join('|');
  const rowCollectionKey=row=>[row.sheet||'',row.row||'',String(row.treasuryCode||''),String(row.customerCode||''),String(row.receipt||''),fixed(row.amount,2)].join('|');
  const rowStockKey=row=>[String(row.code||''),norm(row.item),String(row.direction||''),fixed(row.quantity,5),fixed(row.opening,5),fixed(row.closing,5),norm(row.section),norm(row.warehouse)].join('|');
  const isConcrete=row=>/خرسان/.test(norm(row?.item||row?.product));
  const isBlock=row=>/بلك|بلوك/.test(norm(row?.item||row?.product));
  const clientCode=id=>{const client=(window.D?.cli||[]).find(row=>row.id===id);return String(client?.code||'');};
  const canonicalSale=(row,date)=>[String(date||row.date||'').slice(0,10),String(row.invoice||row.clientOrder||'').trim(),String(row.customerCode||clientCode(row.clientId)||'').trim(),norm(row.item||row.product),fixed(row.quantity,3),fixed(row.amount,2)].join('|');
  const canonicalCollection=(row,date)=>[String(row.date||date||'').slice(0,10),String(row.customerCode||clientCode(row.clientId)||'').trim(),String(row.receipt||row.no||'').trim(),fixed(row.amount,2),norm(row.method)].join('|');
  const dedupeStock=rows=>merge([],rows,rowStockKey);

  function buildLegacyRows(parsed){
    const rows=[['المبيعات'],['رقم الفاتورة','الكمية','كود العميل','اسم العميل','الصنف','قيمة المبيعات','آجل']];
    for(const sale of parsed?.sales||[])rows.push([sale.invoice,sale.quantity,sale.customerCode,sale.customer,sale.item,sale.amount,sale.paymentTerms||'آجل']);
    rows.push([],['تحصيلات العملاء'],['التاريخ','كود العميل','اسم العميل','المبلغ','طريقة السداد','رقم السند','رقم الفاتورة','نوع الحركة','ملاحظات']);
    for(const collection of parsed?.collections||[])rows.push([collection.date||'',collection.customerCode,collection.customer,collection.amount,collection.method,collection.receipt||'',collection.invoice||'',collection.type||'تحصيل عميل',collection.notes||'']);
    return rows;
  }

  function buildSummaryFile(file,workbook,parsed){
    const sheetName='__ملخص_موحد';
    const names=(workbook.SheetNames||[]).filter(name=>name!==sheetName);
    workbook.SheetNames=[...names,sheetName];
    workbook.Sheets[sheetName]=window.XLSX.utils.aoa_to_sheet(buildLegacyRows(parsed));
    const bytes=window.XLSX.write(workbook,{type:'array',bookType:'xlsx'});
    return new File([bytes],file.name,{type:file.type||'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',lastModified:file.lastModified||Date.now()});
  }

  async function fingerprint(file){
    try{
      const bytes=await file.arrayBuffer();
      if(window.crypto?.subtle){const digest=await window.crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
    }catch(error){console.warn('[DailyImportFix] fingerprint fallback',error);}
    return `${file?.name||''}|${file?.size||0}|${file?.lastModified||0}`;
  }

  const findNewBatch=before=>(window.OPS?.imports||[]).find(batch=>!before.has(batch.id))||null;
  const duplicateBatch=(hash,date)=>(window.OPS?.imports||[]).find(batch=>batch.sourceFileFingerprint===hash&&String(batch.reportDate||'').slice(0,10)===String(date||'').slice(0,10));
  function attachBatch(batch,hash,mode,plan){
    if(!batch)return;
    batch.sourceFileFingerprint=hash;
    batch.importSource=mode;
    batch.importParserVersion=VERSION;
    if(mode==='movement'){
      batch.concreteSalesCount=(plan?.sales||[]).filter(isConcrete).length;
      batch.blockSalesCount=(plan?.sales||[]).filter(isBlock).length;
      batch.stockCount=(plan?.stock||[]).length;
    }
  }
  function filterFreshCollections(rows,date){
    const existing=new Set((window.OPS?.collections||[]).map(row=>canonicalCollection(row,row.date)));
    return (rows||[]).filter(row=>!existing.has(canonicalCollection(row,date)));
  }

  function previewCollections(rows){
    if(!rows?.length)return'';
    const total=rows.reduce((sum,row)=>sum+num(row.amount),0);
    return `<div class="ops-note" style="margin-top:12px"><b>تحصيلات العملاء من حركة الخزن:</b> ${rows.length} حركة بقيمة ${money(total)}. الخزينة 101 نقدي والخزينة 104 نقاط بيع. السلف والموردون مستبعدون.</div><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>الخزينة</th><th>كود العميل</th><th>العميل</th><th>المبلغ</th><th>الطريقة</th><th>الإذن</th></tr></thead><tbody>${rows.slice(0,60).map(row=>`<tr><td>${esc(row.treasuryCode||'—')}</td><td class="mono">${esc(row.customerCode)}</td><td>${esc(row.customer)}</td><td class="num">${money(row.amount)}</td><td>${esc(row.method)}</td><td class="mono">${esc(row.receipt||'—')}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function patchMovementHtml(html,plan){
    const host=document.createElement('div');host.innerHTML=html;
    const blockQty=(plan?.sales||[]).filter(isBlock).reduce((sum,row)=>sum+num(row.quantity),0);
    const blockCard=[...host.querySelectorAll('.ops-kpi')].find(node=>norm(node.textContent).includes('قطعه بلوك'));
    if(blockCard?.querySelector('b'))blockCard.querySelector('b').textContent=quantity(blockQty);
    const heading=[...host.querySelectorAll('h3')].find(node=>norm(node.textContent).startsWith('مبيعات'));
    const table=heading?.nextElementSibling?.querySelector('table');
    if(table?.tHead?.rows?.[0]&&!norm(table.tHead.rows[0].textContent).includes('كود العميل')){
      const th=document.createElement('th');th.textContent='كود العميل';table.tHead.rows[0].insertBefore(th,table.tHead.rows[0].cells[2]||null);
      [...(table.tBodies?.[0]?.rows||[])].forEach((tr,index)=>{const td=document.createElement('td');td.className='mono';td.textContent=plan?.sales?.[index]?.customerCode||'—';tr.insertBefore(td,tr.cells[2]||null);});
    }
    return host.innerHTML;
  }

  async function saveMovementCollections(rows,reportDate,batch){
    const fresh=filterFreshCollections(rows,reportDate);
    if(!fresh.length)return{count:0,amount:0};
    let count=0,amount=0;
    for(const source of fresh){
      const row={...source,date:source.date||reportDate};
      const resolved=typeof window.bh12ResolveClient==='function'?window.bh12ResolveClient(row.customerCode,row.customer,''):{client:window.opsFindOrCreateClient?.(row.customer,row.customerCode),created:false};
      const client=resolved?.client;if(!client)continue;
      const key=typeof window.bh12CollectionKey==='function'?window.bh12CollectionKey(row,reportDate):`daily-collection|${row.date}|${row.customerCode}|${row.receipt||row.row}|${fixed(row.amount,2)}|${norm(row.method)}`;
      const collection={id:window.opsUid('col'),no:window.opsNextNo('COL'),clientId:client.id,customerCode:row.customerCode||client.code||'',date:row.date,amount:num(row.amount),method:row.method||'غير محدد',receipt:row.receipt||'',employeeId:'',invoiceId:'',paymentType:'debt',isAdvance:false,allocationMode:'fifo',notes:[row.notes,row.treasuryCode?`خزينة ${row.treasuryCode}`:''].filter(Boolean).join(' — '),attachments:[],sourceDailyKey:key,sourceImportId:batch?.id||'',createdAt:new Date().toISOString()};
      window.OPS.collections.unshift(collection);
      window.opsAddMovementRecord?.('COLLECTION',{date:row.date+'T12:00',entityKind:'client',entityId:collection.clientId,amount:collection.amount,reference:collection.receipt||collection.no,notes:`تحصيل مستورد — ${collection.method}`,module:'daily-movement-collections',moduleId:collection.id});
      if(batch){(batch.rowKeys||(batch.rowKeys=[])).push(key);batch.collectionCount=num(batch.collectionCount)+1;batch.collectionValue=num(batch.collectionValue)+collection.amount;if(resolved.created)batch.newCustomerCount=num(batch.newCustomerCount)+1;}
      count++;amount+=collection.amount;
    }
    return{count,amount};
  }

  function enhanceMovement(base,extra){return{...(base||{}),sales:merge(base?.sales,extra?.sales,rowSaleKey),collections:merge(base?.collections,extra?.collections,rowCollectionKey),stock:dedupeStock(base?.stock||[]),warnings:[...new Set(base?.warnings||[])]};}
  function enhanceDaily(base,extra){return{...(base||{}),sales:merge(base?.sales,extra?.sales,rowSaleKey),collections:merge(base?.collections,extra?.collections,rowCollectionKey),stock:dedupeStock(base?.stock||[]),warnings:[...new Set((base?.warnings||[]).filter(text=>extra?.collections?.length?!norm(text).includes('لا يوجد قسم تحصيلات'):true))]};}

  function wrapImporter(original,mode){
    return async function(file){
      if(!file)return;
      const hash=await fingerprint(file),originalOpen=window.opsOpenModal;
      let restored=false,callFile=file;
      const restore=()=>{if(!restored){window.opsOpenModal=originalOpen;restored=true;}};
      if(mode==='summary'){
        const workbook=window.XLSX.read(new Uint8Array(await file.arrayBuffer()),{type:'array',cellDates:false});
        const extra=window.BinHamidDailySummaryParser.parseWorkbook(workbook,window.XLSX);
        const movement=enhanceMovement(window.opsParseMovementWorkbook(workbook,file.name),extra);
        lastDailyPlan=enhanceDaily({sales:[],collections:[],stock:movement.stock,warnings:movement.warnings,detectedDate:movement.sales?.[0]?.date||movement.stock?.[0]?.date||''},extra);
        callFile=buildSummaryFile(file,workbook,extra);
      }
      window.opsOpenModal=function(title,html,onSave,label){
        const plan=mode==='summary'?lastDailyPlan:lastMovementPlan;
        const body=mode==='movement'?patchMovementHtml(html,plan)+previewCollections(plan?.collections||[]):html;
        const wrappedSave=async function(){
          const dateField=mode==='summary'?'dailyDate':'reportDate';
          const reportDate=document.querySelector(`#opsForm [name="${dateField}"]`)?.value||plan?.detectedDate||new Date().toISOString().slice(0,10);
          const prior=duplicateBatch(hash,reportDate);
          if(prior)throw new Error(`هذا الملف معتمد سابقًا بتاريخ ${reportDate} من ${prior.importSource==='summary'?'ملخص اليوم':'تقرير الحركة'}`);
          if((plan?.sales||[]).some(isBlock)&&!window.opsSalesResponsible?.('block'))throw new Error('أكمل بيانات مسؤول مبيعات البلوك من الإعدادات أولًا');
          if((plan?.sales||[]).some(isConcrete)&&!window.opsSalesResponsible?.('concrete'))throw new Error('أكمل بيانات مسؤول مبيعات الخرسانة من الإعدادات أولًا');
          const before=new Set((window.OPS?.imports||[]).map(batch=>batch.id));
          const result=await onSave.apply(this,arguments);if(result===false)return false;
          const batch=findNewBatch(before);attachBatch(batch,hash,mode,plan);
          let collectionResult={count:0,amount:0};
          if(mode==='movement')collectionResult=await saveMovementCollections(plan?.collections||[],reportDate,batch);
          window.save?.();window.rAll?.();await window.opsPersist?.(`تثبيت مصدر استيراد ${file.name}`);
          if(mode==='movement'&&collectionResult.count)window.opsToast?.(`تم تسجيل ${collectionResult.count} تحصيل عميل بقيمة ${money(collectionResult.amount)}`);
          return result;
        };
        const result=originalOpen(title,body,wrappedSave,label);restore();return result;
      };
      try{return await original.call(this,callFile);}finally{restore();}
    };
  }

  function install(){
    if(installed)return;
    const parser=window.BinHamidDailySummaryParser;
    if(!parser||!window.XLSX||typeof window.bh12ParseDailyWorkbook!=='function'||typeof window.opsParseMovementWorkbook!=='function'||typeof window.opsImportDailySummary!=='function'||typeof window.opsImportDailyMovement!=='function'||typeof window.opsOpenModal!=='function')return;
    installed=true;
    const originalDailyParser=window.bh12ParseDailyWorkbook,originalMovementParser=window.opsParseMovementWorkbook;
    window.opsParseMovementWorkbook=function(workbook,fileName){const base=originalMovementParser.call(this,workbook,fileName)||{},extra=parser.parseWorkbook(workbook,window.XLSX),result=enhanceMovement(base,extra);lastMovementPlan=result;return result;};
    window.bh12ParseDailyWorkbook=function(workbook){const base=originalDailyParser.call(this,workbook)||{},extra=parser.parseWorkbook(workbook,window.XLSX),result=enhanceDaily(base,extra);lastDailyPlan=result;return result;};
    const originalSummary=window.opsImportDailySummary,originalMovement=window.opsImportDailyMovement;
    window.opsImportDailySummary=wrapImporter(originalSummary,'summary');
    window.opsImportDailyMovement=wrapImporter(originalMovement,'movement');
    window.BinHamidExistingDailyImportFix={version:VERSION,installed:true};
    console.info('[BinHamid]',VERSION,'loaded');
  }

  window.BinHamidExistingDailyImportHelpers={isBlock,isConcrete,dedupeStock,buildLegacyRows,patchMovementHtml};
  const timer=setInterval(()=>{install();if(installed)clearInterval(timer);},250);
  setTimeout(()=>clearInterval(timer),20000);
})();
