(function(){
  'use strict';
  const VERSION='2026.07.16-existing-daily-import-v1';
  let installed=false,lastDailyPlan=null,lastMovementPlan=null;
  const num=value=>{const parsed=Number(String(value??0).replace(/,/g,''));return Number.isFinite(parsed)?parsed:0;};
  const fixed=(value,digits)=>num(value).toFixed(digits);
  const norm=value=>String(value??'').trim().toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/ـ/g,'').replace(/\s+/g,' ');
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const money=value=>num(value).toLocaleString('ar-SA',{minimumFractionDigits:2,maximumFractionDigits:2});
  const merge=(first,second,keyFn)=>{const result=[],seen=new Set();for(const row of [...(first||[]),...(second||[])]){const key=keyFn(row);if(seen.has(key))continue;seen.add(key);result.push(row);}return result;};
  const rowSaleKey=row=>[row.sheet||'',row.row||'',String(row.invoice||''),String(row.customerCode||''),norm(row.item),fixed(row.quantity,3),fixed(row.amount,2)].join('|');
  const rowCollectionKey=row=>[row.sheet||'',row.row||'',String(row.treasuryCode||''),String(row.customerCode||''),String(row.receipt||''),fixed(row.amount,2)].join('|');
  const clientCode=id=>{const client=(window.D?.cli||[]).find(row=>row.id===id);return String(client?.code||'');};
  const canonicalSale=(row,date)=>[String(date||row.date||'').slice(0,10),String(row.invoice||row.clientOrder||'').trim(),String(row.customerCode||clientCode(row.clientId)||'').trim(),norm(row.item||row.product),fixed(row.quantity,3),fixed(row.amount,2)].join('|');
  const canonicalCollection=(row,date)=>[String(row.date||date||'').slice(0,10),String(row.customerCode||clientCode(row.clientId)||'').trim(),String(row.receipt||row.no||'').trim(),fixed(row.amount,2),norm(row.method)].join('|');

  async function fingerprint(file){
    try{
      const bytes=await file.arrayBuffer();
      if(window.crypto?.subtle){const digest=await window.crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
    }catch(error){console.warn('[DailyImportFix] fingerprint fallback',error);}
    return `${file?.name||''}|${file?.size||0}|${file?.lastModified||0}`;
  }
  const findNewBatch=before=>(window.OPS?.imports||[]).find(batch=>!before.has(batch.id))||null;
  const duplicateBatch=(hash,date)=>(window.OPS?.imports||[]).find(batch=>batch.sourceFileFingerprint===hash&&String(batch.reportDate||'').slice(0,10)===String(date||'').slice(0,10));
  function attachBatch(batch,hash,mode){if(!batch)return;batch.sourceFileFingerprint=hash;batch.importSource=mode;batch.importParserVersion=VERSION;}
  function filterFreshSales(rows,date){
    const existing=new Set((window.OPS?.deliveries||[]).map(row=>canonicalSale(row,row.date)));
    return (rows||[]).filter(row=>!existing.has(canonicalSale(row,date)));
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

  async function saveMovementCollections(rows,reportDate,fileName,batch){
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

  function wrapImporter(original,mode){
    return async function(file){
      if(!file)return;
      const hash=await fingerprint(file),originalOpen=window.opsOpenModal;
      let restored=false;
      const restore=()=>{if(!restored){window.opsOpenModal=originalOpen;restored=true;}};
      window.opsOpenModal=function(title,html,onSave,label){
        const plan=mode==='summary'?lastDailyPlan:lastMovementPlan;
        const body=mode==='movement'?html+previewCollections(plan?.collections||[]):html;
        const wrappedSave=async function(){
          const dateField=mode==='summary'?'dailyDate':'reportDate';
          const reportDate=document.querySelector(`#opsForm [name="${dateField}"]`)?.value||plan?.detectedDate||new Date().toISOString().slice(0,10);
          const prior=duplicateBatch(hash,reportDate);
          if(prior)throw new Error(`هذا الملف معتمد سابقًا بتاريخ ${reportDate} من ${prior.importSource==='summary'?'ملخص اليوم':'تقرير الحركة'}`);
          if(plan?.sales){const fresh=filterFreshSales(plan.sales,reportDate);plan.sales.splice(0,plan.sales.length,...fresh);}
          if(mode==='summary'&&plan?.collections){const fresh=filterFreshCollections(plan.collections,reportDate);plan.collections.splice(0,plan.collections.length,...fresh);}
          const before=new Set((window.OPS?.imports||[]).map(batch=>batch.id));
          const result=await onSave.apply(this,arguments);
          if(result===false)return false;
          const batch=findNewBatch(before);
          attachBatch(batch,hash,mode);
          let collectionResult={count:0,amount:0};
          if(mode==='movement')collectionResult=await saveMovementCollections(plan?.collections||[],reportDate,file.name,batch);
          window.save?.();window.rAll?.();
          await window.opsPersist?.(`تثبيت مصدر استيراد ${file.name}`);
          if(mode==='movement'&&collectionResult.count)window.opsToast?.(`تم تسجيل ${collectionResult.count} تحصيل عميل بقيمة ${money(collectionResult.amount)}`);
          return result;
        };
        const result=originalOpen(title,body,wrappedSave,label);restore();return result;
      };
      try{return await original.call(this,file);}finally{restore();}
    };
  }

  function install(){
    if(installed)return;
    const parser=window.BinHamidDailySummaryParser;
    if(!parser||!window.XLSX||typeof window.bh12ParseDailyWorkbook!=='function'||typeof window.opsParseMovementWorkbook!=='function'||typeof window.opsImportDailySummary!=='function'||typeof window.opsImportDailyMovement!=='function'||typeof window.opsOpenModal!=='function')return;
    installed=true;
    const originalDailyParser=window.bh12ParseDailyWorkbook,originalMovementParser=window.opsParseMovementWorkbook;
    window.opsParseMovementWorkbook=function(workbook,fileName){
      const base=originalMovementParser.call(this,workbook,fileName)||{},extra=parser.parseWorkbook(workbook,window.XLSX);
      const result={...base,sales:merge(base.sales,extra.sales,rowSaleKey),collections:merge(base.collections,extra.collections,rowCollectionKey),warnings:[...new Set(base.warnings||[])]};
      lastMovementPlan=result;return result;
    };
    window.bh12ParseDailyWorkbook=function(workbook){
      const base=originalDailyParser.call(this,workbook)||{},extra=parser.parseWorkbook(workbook,window.XLSX);
      const result={...base,sales:merge(base.sales,extra.sales,rowSaleKey),collections:merge(base.collections,extra.collections,rowCollectionKey),warnings:[...new Set(base.warnings||[])]};
      lastDailyPlan=result;return result;
    };
    const originalSummary=window.opsImportDailySummary,originalMovement=window.opsImportDailyMovement;
    window.opsImportDailySummary=wrapImporter(originalSummary,'summary');
    window.opsImportDailyMovement=wrapImporter(originalMovement,'movement');
    window.BinHamidExistingDailyImportFix={version:VERSION,installed:true};
    console.info('[BinHamid]',VERSION,'loaded');
  }
  const timer=setInterval(()=>{install();if(installed)clearInterval(timer);},250);
  setTimeout(()=>clearInterval(timer),20000);
})();
