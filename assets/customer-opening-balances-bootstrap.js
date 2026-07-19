(function customerOpeningBalanceEncryptedBootstrap(){
  'use strict';

  const VERSION='2026.07.19-customer-opening-encrypted-bootstrap-v2-auth-resume';
  const HASH_PARAM='customer-seed';
  const PACKAGE_MARKER='binhamid-customer-opening-package-v1';
  const IMPORT_MARKER='binhamid_customer_seed_20260719';
  const PENDING_KEY='binhamid_customer_seed_pending_v1';
  let running=false,loginRequested=false;

  const clean=value=>String(value??'').trim();
  const code=value=>clean(value).replace(/\.0+$/,'').replace(/\s+/g,'');
  const money=value=>Math.abs(Number(value)||0)<0.005?0:Math.round((Number(value)+Number.EPSILON)*100)/100;
  const hostWindow=()=>window.parent&&window.parent!==window?window.parent:window;
  const validPackage=pack=>Boolean(pack?.marker===PACKAGE_MARKER&&pack?.key&&pack?.envelope);
  const storage=()=>{try{return hostWindow().sessionStorage;}catch{return window.sessionStorage;}};
  const b64url=value=>{
    const text=clean(value).replace(/-/g,'+').replace(/_/g,'/');
    const padded=text+'='.repeat((4-text.length%4)%4);
    const binary=atob(padded),bytes=new Uint8Array(binary.length);
    for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);
    return bytes;
  };
  const hex=buffer=>[...new Uint8Array(buffer)].map(value=>value.toString(16).padStart(2,'0')).join('');
  function rememberPackage(pack){if(validPackage(pack))storage().setItem(PENDING_KEY,JSON.stringify(pack));}
  function pendingPackage(){try{const pack=JSON.parse(storage().getItem(PENDING_KEY)||'null');return validPackage(pack)?pack:null;}catch{return null;}}
  function clearPackage(){try{storage().removeItem(PENDING_KEY);}catch{}}
  function readPackage(){
    const host=hostWindow(),rawHash=host.location.hash||'',hash=rawHash.startsWith('#')?rawHash.slice(1):rawHash,params=new URLSearchParams(hash);
    let pack=null;
    if(params.get(HASH_PARAM)==='1'){
      try{pack=JSON.parse(host.name||'');}catch{}
      if(validPackage(pack))rememberPackage(pack);
      params.delete(HASH_PARAM);
      const next=params.toString();
      host.history.replaceState(null,'',host.location.pathname+host.location.search+(next?`#${next}`:''));
      try{host.name='';}catch{}
    }
    return validPackage(pack)?pack:pendingPackage();
  }
  async function gunzip(bytes){
    if(typeof DecompressionStream!=='function')throw new Error('المتصفح لا يدعم فك ضغط حزمة العملاء. استخدم Chrome أو Edge محدثًا.');
    const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function decryptSeed(secret,envelope){
    if(!globalThis.crypto?.subtle)throw new Error('التشفير الآمن غير متاح في هذا المتصفح.');
    if(envelope.v!==1||envelope.alg!=='A256GCM'||envelope.zip!=='gzip')throw new Error('صيغة حزمة العملاء غير معروفة.');
    const rawKey=b64url(secret);
    if(rawKey.length!==32)throw new Error('مفتاح تفعيل بيانات العملاء غير صحيح.');
    const key=await crypto.subtle.importKey('raw',rawKey,{name:'AES-GCM'},false,['decrypt']);
    let compressed;
    try{compressed=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64url(envelope.iv),additionalData:b64url(envelope.aad),tagLength:128},key,b64url(envelope.ct));}
    catch{throw new Error('مفتاح تفعيل بيانات العملاء غير صحيح أو الحزمة تالفة.');}
    const plain=await gunzip(new Uint8Array(compressed));
    const digest=hex(await crypto.subtle.digest('SHA-256',plain));
    if(digest!==envelope.sha)throw new Error('فشل التحقق من سلامة بيانات العملاء.');
    const payload=JSON.parse(new TextDecoder().decode(plain));
    if(payload.v!==1||payload.t!=='bh-customer-opening-seed'||!Array.isArray(payload.r))throw new Error('محتوى حزمة العملاء غير صالح.');
    if(payload.sha!==envelope.src||payload.r.length!==envelope.rows)throw new Error('عدد العملاء أو بصمة المصدر غير متطابقة.');
    return payload;
  }
  async function deviceReady(){
    if(window.bhCloudDeviceReady)await window.bhCloudDeviceReady;
    const session=window.BinHamidCloudDeviceSession;
    if(!session?.ready||!session.deviceId)throw new Error('تعذر إنشاء جلسة الجهاز السحابية.');
    return session;
  }
  async function stateRequest(path,options={}){
    const response=await fetch(path,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){const error=new Error(data.error||data.message||`HTTP ${response.status}`);error.status=response.status;error.code=data.code||'';throw error;}
    return data;
  }
  function ensurePayload(remote){
    const localLegacy=typeof D!=='undefined'&&D?D:{cfg:{days:3},cli:[],emp:[],veh:[]};
    const localOps=typeof OPS!=='undefined'&&OPS?OPS:{settings:{},customerOpeningBalances:[]};
    const payload=remote?.payload&&typeof remote.payload==='object'?structuredClone(remote.payload):{schemaVersion:1,capturedAt:new Date().toISOString(),legacy:structuredClone(localLegacy),ops:structuredClone(localOps)};
    payload.legacy=payload.legacy&&typeof payload.legacy==='object'?payload.legacy:{cfg:{days:3},cli:[],emp:[],veh:[]};
    payload.ops=payload.ops&&typeof payload.ops==='object'?payload.ops:{settings:{},customerOpeningBalances:[]};
    payload.legacy.cli=Array.isArray(payload.legacy.cli)?payload.legacy.cli:[];
    payload.ops.settings=payload.ops.settings&&typeof payload.ops.settings==='object'?payload.ops.settings:{};
    payload.ops.customerOpeningBalances=Array.isArray(payload.ops.customerOpeningBalances)?payload.ops.customerOpeningBalances:[];
    return payload;
  }
  function mergeSeed(payload,seed){
    const [rowCount,ignoredPageRows,duplicatePageRows,warningCount,debitTotal,creditTotal,netTotal,chequesTotal]=seed.s||[];
    if(payload.ops.settings?.customerOpeningBalanceImport?.sourceHash===seed.sha&&Number(payload.ops.settings.customerOpeningBalanceImport.rowCount)===Number(rowCount))return{already:true,payload};
    const clients=payload.legacy.cli,opening=payload.ops.customerOpeningBalances,map=payload.ops.settings.customerCodeMap=payload.ops.settings.customerCodeMap||{},stamp=new Date().toISOString(),sourceFile=`opening-balance|${seed.sha}`;
    const byCode=new Map();
    for(const customer of clients){
      const values=[customer?.code,customer?.no,...(Array.isArray(customer?.sourceCustomerCodes)?customer.sourceCustomerCodes:[])].map(code).filter(Boolean);
      for(const value of values)if(!byCode.has(value))byCode.set(value,customer);
    }
    for(const packed of seed.r){
      const [customerCodeRaw,customerName,balanceRaw,previousRaw,debitRaw,creditRaw,chequesRaw]=packed,customerCode=code(customerCodeRaw),balance=money(balanceRaw),previous=money(previousRaw),debit=money(debitRaw),credit=money(creditRaw),cheques=money(chequesRaw),difference=money(balance-(previous+debit-credit));
      let customer=byCode.get(customerCode);
      if(!customer){
        customer={id:`legacy-client-${customerCode}`,code:customerCode,name:clean(customerName),seg:'الاثنين',cr:'',ct:'',tel:'',days:Number(payload.legacy.cfg?.days||3),rep:'',addr:'',note:'مضاف من ملف أرصدة البرنامج القديم',aliases:[],sourceCustomerCodes:[customerCode],createdAt:stamp};
        clients.push(customer);byCode.set(customerCode,customer);
      }
      customer.code=customer.code||customerCode;
      if(!customer.name&&customerName)customer.name=clean(customerName);
      customer.seg=customer.seg||'الاثنين';
      customer.sourceCustomerCodes=Array.isArray(customer.sourceCustomerCodes)?customer.sourceCustomerCodes:[];
      if(!customer.sourceCustomerCodes.some(value=>code(value)===customerCode))customer.sourceCustomerCodes.push(customerCode);
      customer.openingBalance=balance;customer.openingBalanceDate=seed.date;customer.openingBalanceCheques=cheques;customer.openingBalanceSource=sourceFile;
      map[customerCode]=customer.id;
      const prior=opening.find(item=>item?.clientId===customer.id||code(item?.customerCode)===customerCode);
      const record={id:prior?.id||`opb-legacy-${customerCode}`,clientId:customer.id,customerCode,customerName:customer.name,date:seed.date,amount:balance,previous,debit,credit,cheques,difference,note:'رصيد افتتاحي من ميزان مراجعة العملاء — البرنامج القديم',sourceFile,sourceHash:seed.sha,sourceFormat:'legacy_trial_balance',updatedAt:stamp,createdAt:prior?.createdAt||stamp};
      if(prior)Object.assign(prior,record);else opening.push(record);
    }
    payload.schemaVersion=payload.schemaVersion||1;
    payload.capturedAt=stamp;
    payload.ops.settings.customerOpeningBalanceImport={fileName:seed.src,sourceHash:seed.sha,sourceFormat:'legacy_trial_balance',reportDate:seed.date,rowCount:Number(rowCount),warningCount:Number(warningCount),duplicatePageRows:Number(duplicatePageRows),ignoredPageRows:Number(ignoredPageRows),debitTotal:Number(debitTotal),creditTotal:Number(creditTotal),netTotal:Number(netTotal),chequesTotal:Number(chequesTotal),importedAt:stamp,encryptedBootstrap:true};
    return{already:false,payload,summary:payload.ops.settings.customerOpeningBalanceImport};
  }
  function requestOwnerLogin(pack){
    rememberPackage(pack);
    if(loginRequested)return;
    loginRequested=true;
    window.addEventListener('binhamid-owner-authenticated',()=>{loginRequested=false;setTimeout(run,300);},{once:true});
    const openLogin=()=>{if(typeof window.bhCloudLogin==='function')window.bhCloudLogin();else setTimeout(openLogin,250);};
    openLogin();
  }
  async function run(){
    if(running)return;
    const pack=readPackage();
    if(!pack)return;
    running=true;
    try{
      const seed=await decryptSeed(pack.key,pack.envelope),session=await deviceReady(),remote=await stateRequest('/api/state',{method:'GET',cache:'no-store'}),merged=mergeSeed(ensurePayload(remote),seed);
      if(merged.already){clearPackage();localStorage.setItem(IMPORT_MARKER,seed.sha);alert('بيانات العملاء والأرصدة موجودة بالفعل في النظام ولم يتم تكرارها.');return;}
      const result=await stateRequest('/api/state',{method:'PUT',body:JSON.stringify({baseRevision:Number(remote.revision||0),reason:`استيراد مشفر لأرصدة ${seed.r.length} عميل من البرنامج القديم`,deviceId:session.deviceId,payload:merged.payload})});
      localStorage.setItem('binhamid_v1',JSON.stringify(merged.payload.legacy));
      localStorage.setItem('binhamid_factory_control_v3',JSON.stringify(merged.payload.ops));
      localStorage.setItem('binhamid_cloud_revision',String(result.revision||0));
      localStorage.setItem(IMPORT_MARKER,seed.sha);
      clearPackage();
      alert(`تم دمج ${merged.summary.rowCount} عميل ورصيد افتتاحي في قاعدة النظام بنجاح.\nصافي رصيد العملاء: ${Number(merged.summary.netTotal).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} ر.س`);
      location.reload();
    }catch(error){
      console.error('[BinHamid]',VERSION,error);
      if(error?.status===401||error?.status===403){requestOwnerLogin(pack);return;}
      alert(`تعذر دمج بيانات العملاء: ${error.message||error}`);
    }finally{running=false;}
  }
  run();
  window.addEventListener('binhamid-owner-authenticated',()=>setTimeout(run,300));
  console.info('[BinHamid]',VERSION,'ready');
})();
