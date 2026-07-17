(function(){
  'use strict';
  const VERSION='2026.07.17-daily-report-source-v2',TOKEN_KEY='binhamid_cloud_access_token';
  let installed=false,activeContext=null;
  const clean=value=>String(value??'').trim();
  const num=value=>{const parsed=Number(String(value??0).replace(/[٬,]/g,'').replace(/٫/g,'.'));return Number.isFinite(parsed)?parsed:0;};
  const norm=value=>clean(value).toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/ـ/g,'').replace(/\s+/g,' ');
  const token=()=>{try{const local=localStorage.getItem(TOKEN_KEY)||'';if(local)return local;const match=document.cookie.match(/(?:^|; )bh_cloud_token=([^;]*)/);return match?decodeURIComponent(match[1]):'';}catch{return'';}};
  const isConcrete=row=>/خرسان/.test(norm(row?.item||row?.product));
  const isBlock=row=>/بلك|بلوك/.test(norm(row?.item||row?.product));
  const keySale=row=>[row.invoice||row.clientOrder,row.customerCode,row.item||row.product,num(row.quantity).toFixed(3),num(row.amount).toFixed(2)].join('|');
  const keyCollection=row=>[row.treasuryCode,row.customerCode,row.receipt||row.no,num(row.amount).toFixed(2)].join('|');
  const unique=(rows,keyFn)=>{const seen=new Set();return(rows||[]).filter(row=>{const key=keyFn(row);if(seen.has(key))return false;seen.add(key);return true;});};

  async function hashFile(file){const bytes=await file.arrayBuffer();const digest=await crypto.subtle.digest('SHA-256',bytes);return[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
  async function fileBase64(file){if(!file||file.size>2.4*1024*1024)return'';const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let index=0;index<bytes.length;index+=0x8000)binary+=String.fromCharCode(...bytes.subarray(index,index+0x8000));return btoa(binary);}

  function inventoryRows(stock){
    return unique(stock||[],row=>[row.code,row.item,row.section,row.warehouse].join('|')).map((row,index)=>{
      const direction=clean(row.direction).toLowerCase(),amount=num(row.quantity);
      return{sourceRowNo:Number(row.row)||index+1,inventoryType:/منتج|تامه|تامة/.test(norm(row.section))?'finished_goods':'raw_material',itemCode:clean(row.code),itemName:clean(row.item),unit:clean(row.unit)||null,opening:num(row.opening),received:direction==='in'?amount:num(row.received),issued:direction==='out'?amount:num(row.issued),closing:num(row.closing)};
    });
  }

  function payloadFromPlan(plan){
    const sales=unique(plan?.sales||[],keySale).map((row,index)=>({sourceRowNo:Number(row.row)||index+1,invoiceNo:clean(row.invoice||row.clientOrder),salesType:isConcrete(row)?'concrete':isBlock(row)?'block':'other',customerCode:clean(row.customerCode),customerName:clean(row.customer||row.customerName),item:clean(row.item||row.product),quantity:num(row.quantity),unit:clean(row.unit)||null,amount:num(row.amount),paymentTerms:clean(row.paymentTerms)||null,issues:Array.isArray(row.issues)?row.issues:[]}));
    const cashMovements=unique(plan?.collections||[],keyCollection).map((row,index)=>({sourceRowNo:Number(row.row)||index+1,treasuryCode:clean(row.treasuryCode)||(norm(row.method).includes('نقاط')?'104':'101'),treasuryName:clean(row.treasuryName)||null,debit:num(row.amount),credit:0,accountName:clean(row.customer||row.customerName),accountType:'عميل',accountCode:clean(row.customerCode),description:clean(row.notes)||null,movementType:clean(row.type)||'استلام تحصيل عميل',voucherNo:clean(row.receipt||row.no)||null,movementDate:clean(row.date)||null,paymentMethod:clean(row.method)||null,isCustomerCollection:true}));
    const block=sales.filter(row=>row.salesType==='block'),concrete=sales.filter(row=>row.salesType==='concrete');
    return{sales,cashMovements,treasuries:[],inventory:inventoryRows(plan?.stock||[]),summary:{invoiceCount:sales.length,totalSales:sales.reduce((sum,row)=>sum+row.amount,0),blockSales:block.reduce((sum,row)=>sum+row.amount,0),concreteSales:concrete.reduce((sum,row)=>sum+row.amount,0),blockQuantity:block.reduce((sum,row)=>sum+row.quantity,0),concreteQuantity:concrete.reduce((sum,row)=>sum+row.quantity,0),collectionTotal:cashMovements.reduce((sum,row)=>sum+row.debit,0)}};
  }

  async function request(input){
    const access=token();if(!access)throw new Error('يلزم ربط الجهاز بالنظام السحابي قبل اعتماد التقرير اليومي.');
    let response;try{response=await fetch('/api/daily-report',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${access}`},body:JSON.stringify(input)});}catch{throw new Error('تعذر الاتصال بالخادم. لم يعتمد التقرير ولم تُرحّل أي حركة.');}
    const data=await response.json().catch(()=>({}));
    if(!response.ok){if(response.status===401)window.bhCloudLogin?.();const first=data?.errors?.[0]?.message||data?.error||data?.message||`HTTP ${response.status}`;throw Object.assign(new Error(first),{details:data,status:response.status});}
    return data;
  }

  async function makeContext(file,mode){
    const bytes=new Uint8Array(await file.arrayBuffer()),workbook=window.XLSX.read(bytes,{type:'array',cellDates:false});
    let plan;
    if(mode==='summary')plan=window.bh12ParseDailyWorkbook(workbook)||{};
    else plan=window.opsParseMovementWorkbook(workbook,file.name)||{};
    const parsed=window.BinHamidDailySummaryParser.parseWorkbook(workbook,window.XLSX);
    plan={...plan,sales:unique([...(plan.sales||[]),...(parsed.sales||[])],keySale),collections:unique([...(plan.collections||[]),...(parsed.collections||[])],keyCollection)};
    return{file,mode,plan,fileHash:await hashFile(file),fileBase64Promise:fileBase64(file)};
  }

  async function cloudApprove(context,reportDate){
    const payload=payloadFromPlan(context.plan),base={reportDate,originalName:context.file.name,fileHash:context.fileHash,idempotencyKey:`daily:${reportDate}:${context.fileHash}`,payload};
    const preview=await request({...base,action:'preview'});if(preview.duplicate)throw new Error(`هذا التقرير معتمد سابقًا برقم ${preview.existingImportId||'غير متاح'}.`);if(preview.valid===false)throw new Error(preview.errors?.[0]?.message||'فشل تحقق التقرير اليومي.');
    const encoded=await context.fileBase64Promise,committed=await request({...base,action:'commit',fileBase64:encoded||undefined});
    if(!committed.ok)throw new Error('لم يؤكد الخادم اعتماد التقرير.');return committed;
  }

  function install(){
    if(installed||!window.BinHamidExistingDailyImportFix?.installed||!window.BinHamidDailySummaryParser||!window.XLSX||typeof window.opsOpenModal!=='function')return;
    installed=true;
    const baseOpen=window.opsOpenModal;
    window.opsOpenModal=function(title,html,onSave,label){
      const context=activeContext;activeContext=null;
      if(!context)return baseOpen.apply(this,arguments);
      const guardedSave=async function(){
        const dateField=context.mode==='summary'?'dailyDate':'reportDate',reportDate=document.querySelector(`#opsForm [name="${dateField}"]`)?.value||context.plan?.detectedDate||new Date().toISOString().slice(0,10);
        if(!token()){
          window.opsToast?.('اربط الجهاز بالنظام السحابي ثم اضغط اعتماد مرة أخرى. لم تُرحّل أي حركة.','err');
          window.bhCloudLogin?.();
          return false;
        }
        const cloud=await cloudApprove(context,reportDate),result=await onSave.apply(this,arguments);if(result===false)return false;
        const batch=(window.OPS?.imports||[]).find(row=>String(row.reportDate||'').slice(0,10)===reportDate&&row.sourceFileFingerprint===context.fileHash)||(window.OPS?.imports||[])[0];
        if(batch){batch.cloudImportId=cloud.importId||cloud.existingImportId||'';batch.cloudApprovedAt=new Date().toISOString();batch.cloudSchemaVersion=12;}
        window.save?.();await window.opsPersist?.(`تأكيد اعتماد سحابي للتقرير ${context.file.name}`);window.opsToast?.('تم اعتماد التقرير سحابيًا ومحليًا دون ترحيل مكرر.');return result;
      };
      return baseOpen.call(this,title,html,guardedSave,label);
    };
    for(const [name,mode] of [['opsImportDailySummary','summary'],['opsImportDailyMovement','movement']]){
      const original=window[name];if(typeof original!=='function')continue;
      window[name]=async function(file){activeContext=await makeContext(file,mode);try{return await original.apply(this,arguments);}catch(error){activeContext=null;throw error;}};
    }
    window.BinHamidDailyReportSourceOfTruth={version:VERSION,installed:true};console.info('[BinHamid]',VERSION,'loaded');
  }

  const timer=setInterval(()=>{install();if(installed)clearInterval(timer);},250);setTimeout(()=>clearInterval(timer),25000);
})();
