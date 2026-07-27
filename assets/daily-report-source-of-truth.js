(function(){
  'use strict';
  const VERSION='2026.07.27-daily-report-source-v5',TOKEN_KEY='binhamid_cloud_access_token';
  let installed=false,activeContext=null,modalWrapped=false;
  const wrappedImports=new Set();
  const guardedByAccessor=new Set();
  const clean=value=>String(value??'').trim();
  const num=value=>{const parsed=Number(String(value??0).replace(/[٬,]/g,'').replace(/٫/g,'.'));return Number.isFinite(parsed)?parsed:0;};
  const norm=value=>clean(value).toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/ـ/g,'').replace(/\s+/g,' ');
  const token=()=>{try{const local=localStorage.getItem(TOKEN_KEY)||'';if(local)return local;const match=document.cookie.match(/(?:^|; )bh_cloud_token=([^;]*)/);return match?decodeURIComponent(match[1]):'';}catch{return'';}};
  const isConcrete=row=>/خرسان/.test(norm(row?.item||row?.product));
  const isBlock=row=>/بلك|بلوك/.test(norm(row?.item||row?.product));
  const keySale=row=>[row.invoice||row.clientOrder,row.customerCode,row.item||row.product,num(row.quantity).toFixed(3),num(row.amount).toFixed(2)].join('|');
  const keyCollection=row=>[row.treasuryCode,row.customerCode,row.receipt||row.no,num(row.amount).toFixed(2)].join('|');
  const keyCash=row=>[row.movementDate||row.date,row.treasuryCode,row.accountCode||row.customerCode,row.voucherNo||row.receipt||row.no,row.movementType||row.type,num(row.debit??row.amount).toFixed(2),num(row.credit).toFixed(2)].join('|');
  const unique=(rows,keyFn)=>{const seen=new Set();return(rows||[]).filter(row=>{const key=keyFn(row);if(seen.has(key))return false;seen.add(key);return true;});};

  const IMPORT_FNS=[['opsImportDailySummary','summary'],['opsImportDailyMovement','movement']];

  // ---------------------------------------------------------------------------
  // حارس الفشل الصامت: يمنع الاستيراد المحلي قبل اكتمال طبقة الاعتماد السحابي.
  // يُركَّب فورًا عند تحميل الملف، ولا ينتظر install().
  // ---------------------------------------------------------------------------
  function blockedImport(){
    return async function(){
      const message='طبقة الاعتماد السحابي لم تكتمل بعد. انتظر ثوانٍ وحدّث الصفحة ثم أعد المحاولة — لم تُرحّل أي حركة ولم يُعتمد أي تقرير.';
      window.opsToast?.(message,'err');
      console.error('[BinHamid]',VERSION,'استيراد مرفوض: طبقة الاعتماد السحابي غير جاهزة.');
      throw Object.assign(new Error('DAILY_CLOUD_APPROVAL_NOT_READY'),{code:'DAILY_CLOUD_APPROVAL_NOT_READY'});
    };
  }

  // المخزن الحقيقي لدوال الاستيراد. الحارس يعيد دالة رفض للمستهلكين،
  // بينما wrapImports يقرأ القيمة الأصلية من هنا مباشرة.
  const realImports=new Map();

  function installEarlyGuard(){
    for(const [name] of IMPORT_FNS){
      realImports.set(name,window[name]);
      try{
        Object.defineProperty(window,name,{
          configurable:true,
          get(){
            // بعد اكتمال التركيب تُعاد الدالة الملفوفة الحقيقية.
            if(installed&&wrappedImports.has(name))return realImports.get(name);
            // قبل اكتمال التركيب: يُرفض الاستيراد بصوت عالٍ بدل الحفظ المحلي الصامت.
            if(!installed)return blockedImport();
            return realImports.get(name);
          },
          set(value){realImports.set(name,value);}
        });
        guardedByAccessor.add(name);
      }catch(error){
        // الدالة معرّفة كخاصية غير قابلة لإعادة التعريف (تصريح دالة عام). لا نستسلم:
        // نُركّب الحارس بالإسناد المباشر لأن الخاصية تبقى قابلة للكتابة. الأصل محفوظ
        // في realImports، وwrapImports سيُسند الغلاف الحقيقي لاحقًا بالطريقة ذاتها.
        try{window[name]=blockedImport();}
        catch(assignError){console.warn('[BinHamid] تعذر تركيب حارس الاستيراد لـ',name,assignError);}
      }
    }
  }

  function bannerText(missing){
    return'⚠️ الاعتماد السحابي غير مفعّل — لا تضغط «اعتماد». حدّث الصفحة. (المفقود: '+missing.join('، ')+')';
  }

  function showBanner(missing){
    const existing=document.getElementById('bh-daily-guard-banner');
    if(existing){existing.textContent=bannerText(missing);return;}
    if(!document.body)return;
    const el=document.createElement('div');
    el.id='bh-daily-guard-banner';
    el.setAttribute('role','alert');
    el.style.cssText='position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#b91c1c;color:#fff;padding:12px 16px;font:600 14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;text-align:center;direction:rtl;box-shadow:0 2px 8px rgba(0,0,0,.35)';
    el.textContent=bannerText(missing);
    document.body.appendChild(el);
  }

  function hideBanner(){
    document.getElementById('bh-daily-guard-banner')?.remove();
  }

  function missingDependencies(){
    const missing=[];
    if(!window.BinHamidExistingDailyImportFix?.installed)missing.push('existing-daily-import-fix');
    if(!window.BinHamidDailySummaryParser)missing.push('daily-summary-parser');
    if(!window.XLSX)missing.push('XLSX');
    if(typeof window.opsOpenModal!=='function')missing.push('opsOpenModal');
    const pendingImports=IMPORT_FNS.filter(([name])=>!wrappedImports.has(name)&&typeof realImports.get(name)!=='function').map(([name])=>name);
    return missing.concat(pendingImports);
  }

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
    const sourceCash=plan?.cashMovements?.length?plan.cashMovements:(plan?.collections||[]).map(row=>({...row,debit:row.amount,credit:0,accountName:row.customer||row.customerName,accountCode:row.customerCode,description:row.notes,movementType:row.type,voucherNo:row.receipt||row.no,movementDate:row.date,isCustomerCollection:true}));
    const cashMovements=unique(sourceCash,keyCash).map((row,index)=>({sourceRowNo:Number(row.row)||index+1,treasuryCode:clean(row.treasuryCode)||(norm(row.method).includes('نقاط')?'104':'101'),treasuryName:clean(row.treasuryName)||null,debit:num(row.debit??row.amount),credit:num(row.credit),accountName:clean(row.accountName||row.customer||row.customerName),accountType:clean(row.accountType)||(row.isCustomerCollection?'عميل':null),accountCode:clean(row.accountCode||row.customerCode),description:clean(row.description||row.notes)||null,movementType:clean(row.movementType||row.type)||null,voucherNo:clean(row.voucherNo||row.receipt||row.no)||null,movementDate:clean(row.movementDate||row.date)||null,paymentMethod:clean(row.paymentMethod||row.method)||null,isCustomerCollection:Boolean(row.isCustomerCollection)}));
    const block=sales.filter(row=>row.salesType==='block'),concrete=sales.filter(row=>row.salesType==='concrete');
    const treasuries=unique(plan?.treasuries||[],row=>[row.treasuryCode,num(row.opening).toFixed(2),num(row.closing).toFixed(2)].join('|')).map(row=>({treasuryCode:clean(row.treasuryCode),treasuryName:clean(row.treasuryName)||null,opening:num(row.opening),closing:num(row.closing)}));
    return{sales,cashMovements,treasuries,inventory:inventoryRows(plan?.stock||[]),summary:{parserVersion:'daily-report-v2',invoiceCount:sales.length,totalSales:sales.reduce((sum,row)=>sum+row.amount,0),blockSales:block.reduce((sum,row)=>sum+row.amount,0),concreteSales:concrete.reduce((sum,row)=>sum+row.amount,0),blockQuantity:block.reduce((sum,row)=>sum+row.quantity,0),concreteQuantity:concrete.reduce((sum,row)=>sum+row.quantity,0),cashMovementCount:cashMovements.length,bankMovementCount:cashMovements.filter(row=>row.treasuryCode==='105'||row.paymentMethod==='bank').length,collectionTotal:cashMovements.filter(row=>row.isCustomerCollection).reduce((sum,row)=>sum+row.debit,0)}};
  }

  async function request(input){
    const access=token();if(!access)throw new Error('يلزم ربط الجهاز بالنظام السحابي قبل اعتماد التقرير اليومي.');
    let response;try{response=await fetch('/api/daily-report',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${access}`},body:JSON.stringify(input)});}catch{throw new Error('تعذر الاتصال بالخادم. لم يعتمد التقرير ولم تُرحّل أي حركة.');}
    const data=await response.json().catch(()=>({}));
    if(!response.ok){if(response.status===401)window.bhCloudLogin?.();const first=data?.errors?.[0]?.message||data?.error||data?.message||`HTTP ${response.status}`;throw Object.assign(new Error(first),{details:data,status:response.status});}
    return data;
  }

  async function notifyTelegram(context,reportDate,cloud){
    const access=token(),preview=cloud?.preview||payloadFromPlan(context.plan).summary;
    const response=await fetch('/api/telegram/notify',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${access}`},body:JSON.stringify({event:'daily_report_approved',reportDate,originalName:context.file.name,importId:cloud?.importId||cloud?.existingImportId||'',preview})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data?.error||data?.message||`تعذر إشعار Telegram (${response.status})`);
    return data;
  }

  async function makeContext(file,mode){
    const bytes=new Uint8Array(await file.arrayBuffer()),workbook=window.XLSX.read(bytes,{type:'array',cellDates:false});
    let plan;
    if(mode==='summary')plan=window.bh12ParseDailyWorkbook(workbook)||{};
    else plan=window.opsParseMovementWorkbook(workbook,file.name)||{};
    const parsed=window.BinHamidDailySummaryParser.parseWorkbook(workbook,window.XLSX);
    plan={...plan,sales:unique([...(plan.sales||[]),...(parsed.sales||[])],keySale),collections:unique([...(plan.collections||[]),...(parsed.collections||[])],keyCollection),cashMovements:unique([...(plan.cashMovements||[]),...(parsed.cashMovements||[])],keyCash),treasuries:unique([...(plan.treasuries||[]),...(parsed.treasuries||[])],row=>[row.treasuryCode,num(row.opening).toFixed(2),num(row.closing).toFixed(2)].join('|'))};
    return{file,mode,plan,fileHash:await hashFile(file),fileBase64Promise:fileBase64(file)};
  }

  async function cloudApprove(context,reportDate){
    const payload=payloadFromPlan(context.plan),base={reportDate,originalName:context.file.name,fileHash:context.fileHash,idempotencyKey:`daily:${reportDate}:${context.fileHash}`,payload};
    const preview=await request({...base,action:'preview'});if(preview.duplicate)throw new Error(`هذا التقرير معتمد سابقًا برقم ${preview.existingImportId||'غير متاح'}.`);if(preview.valid===false)throw new Error(preview.errors?.[0]?.message||'فشل تحقق التقرير اليومي.');
    const encoded=await context.fileBase64Promise,committed=await request({...base,action:'commit',fileBase64:encoded||undefined});
    if(!committed.ok)throw new Error('لم يؤكد الخادم اعتماد التقرير.');
    try{await notifyTelegram(context,reportDate,committed);committed.telegramNotified=true;}catch(error){committed.telegramNotified=false;committed.telegramNotificationError=error.message;console.warn('[BinHamid daily report Telegram notification]',error);}
    return committed;
  }

  // ---------------------------------------------------------------------------
  // لف نافذة الاعتماد. يُنفَّذ مرة واحدة فقط.
  // ---------------------------------------------------------------------------
  function wrapModal(){
    if(modalWrapped||typeof window.opsOpenModal!=='function')return false;
    modalWrapped=true;
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
        if(batch){batch.cloudImportId=cloud.importId||cloud.existingImportId||'';batch.cloudApprovedAt=new Date().toISOString();batch.cloudSchemaVersion=12;batch.telegramNotified=cloud.telegramNotified!==false;}
        window.save?.();await window.opsPersist?.(`تأكيد اعتماد سحابي للتقرير ${context.file.name}`);window.opsToast?.(cloud.telegramNotified===false?'تم اعتماد التقرير سحابيًا ومحليًا، لكن تعذر إرسال إشعار Telegram.':'تم اعتماد التقرير وإرسال إشعار Telegram دون ترحيل مكرر.',cloud.telegramNotified===false?'err':undefined);return result;
      };
      return baseOpen.call(this,title,html,guardedSave,label);
    };
    return true;
  }

  // ---------------------------------------------------------------------------
  // لف دوال الاستيراد. تُلف كل دالة بمجرد توفرها، ولا تُتخطى نهائيًا.
  // ترجع true فقط عندما تُلف كل الدوال المطلوبة.
  // ---------------------------------------------------------------------------
  function wrapImports(){
    for(const [name,mode] of IMPORT_FNS){
      if(wrappedImports.has(name))continue;
      // القراءة من المخزن الحقيقي، لا من الـgetter الذي يعيد دالة الرفض.
      const original=realImports.has(name)?realImports.get(name):window[name];
      if(typeof original!=='function')continue;
      const wrapped=async function(file){
        activeContext=await makeContext(file,mode);
        try{return await original.apply(this,arguments);}
        catch(error){activeContext=null;throw error;}
      };
      Object.defineProperty(wrapped,'name',{value:`bhWrapped_${name}`,configurable:true});
      realImports.set(name,wrapped);
      wrappedImports.add(name);
      // إن تعذّر تركيب الـaccessor، فإن window[name] لا يمرّ عبر realImports، فنُسند
      // الغلاف مباشرةً (الخاصية قابلة للكتابة) وإلا بقي الاستيراد الأصلي بلا اعتماد سحابي.
      if(!guardedByAccessor.has(name)){
        try{window[name]=wrapped;}
        catch(assignError){console.warn('[BinHamid] تعذر إسناد غلاف الاستيراد لـ',name,assignError);}
      }
    }
    return IMPORT_FNS.every(([name])=>wrappedImports.has(name));
  }

  function install(){
    if(installed)return;
    if(!window.BinHamidExistingDailyImportFix?.installed)return;
    if(!window.BinHamidDailySummaryParser)return;
    if(!window.XLSX)return;
    wrapModal();
    const importsReady=wrapImports();
    // لا يُعلن اكتمال التركيب إلا بعد لف النافذة وكل دوال الاستيراد.
    if(!modalWrapped||!importsReady)return;
    installed=true;
    hideBanner();
    window.BinHamidDailyReportSourceOfTruth={version:VERSION,installed:true,wrapped:[...wrappedImports]};
    console.info('[BinHamid]',VERSION,'loaded — طبقة الاعتماد السحابي مفعّلة.');
  }

  installEarlyGuard();

  let attempts=0,warned=false;
  const timer=setInterval(()=>{
    attempts++;
    install();
    if(installed){clearInterval(timer);return;}
    // تحذير مرئي بعد 30 ثانية — بلا استسلام: المحاولة مستمرة.
    if(attempts>=120&&!warned){
      warned=true;
      const missing=missingDependencies();
      console.error('[BinHamid]',VERSION,'الاعتماد السحابي غير مفعّل. المفقود:',missing);
      showBanner(missing.length?missing:['غير محدد']);
    }
    // بعد 3 دقائق يُخفَّض معدل المحاولة لتقليل الحمل دون التوقف.
    if(attempts===720){
      clearInterval(timer);
      const slow=setInterval(()=>{install();if(installed){clearInterval(slow);hideBanner();}},2000);
    }
  },250);
})();
