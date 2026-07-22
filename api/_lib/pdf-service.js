import { config } from './config.js';

const cleanUrl=value=>String(value||'').trim().replace(/\/$/,'');
const providerName=()=>String(config.pdfProvider||process.env.PDF_PROVIDER||'auto').trim().toLowerCase();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let cloudflareQueue=Promise.resolve();

function resolvedProvider(){
  const url=String(config.pdfApiUrl||'');
  if(/api\.cloudflare\.com\/client\/v4\/accounts\/[^/]+\/browser-rendering\/pdf/i.test(url))return 'cloudflare';
  const explicit=providerName();
  if(explicit&&explicit!=='auto')return explicit;
  return /gotenberg|\/forms\/chromium\/convert\/html/i.test(url)?'gotenberg':'json';
}

function assertPdf(buffer){
  const bytes=Buffer.isBuffer(buffer)?buffer:Buffer.from(buffer||[]);
  if(bytes.length<100||bytes.subarray(0,5).toString('ascii')!=='%PDF-'){
    throw Object.assign(new Error('خدمة التحويل لم تُرجع ملف PDF صالحًا.'),{status:502,code:'PDF_INVALID_RESPONSE'});
  }
  return bytes;
}

async function gotenbergPdf(html,{filename='report',landscape=false}={}){
  const base=cleanUrl(config.pdfApiUrl);
  const endpoint=/\/forms\/chromium\/convert\/html$/i.test(base)?base:`${base}/forms/chromium/convert/html`;
  const form=new FormData();
  form.append('files',new Blob([Buffer.from(String(html||''),'utf8')],{type:'text/html;charset=utf-8'}),'index.html');
  form.append('preferCssPageSize','true');
  form.append('printBackground','true');
  form.append('landscape',landscape?'true':'false');
  const headers={'Gotenberg-Output-Filename':String(filename||'report').replace(/[^A-Za-z0-9._-]/g,'-').slice(0,80)};
  if(config.pdfApiKey)headers.Authorization=`Bearer ${config.pdfApiKey}`;
  const response=await fetch(endpoint,{method:'POST',headers,body:form,signal:AbortSignal.timeout(45_000)});
  if(!response.ok){
    const detail=(await response.text().catch(()=>'' )).replace(/\s+/g,' ').slice(0,300);
    throw Object.assign(new Error(`تعذر إنشاء PDF عبر Gotenberg: ${response.status}${detail?` — ${detail}`:''}`),{status:502,code:'PDF_GOTENBERG_FAILED',upstreamStatus:response.status});
  }
  return assertPdf(Buffer.from(await response.arrayBuffer()));
}

function retryDelay(response,attempt){
  const header=Number(response.headers.get('retry-after')||0);
  if(Number.isFinite(header)&&header>0)return Math.min(header*1000,12_000);
  return[2500,5000,9000][attempt]||9000;
}

async function runCloudflarePdf(html,{landscape=false}={}){
  if(/\/accounts\/ACCOUNT_ID\//i.test(String(config.pdfApiUrl||''))){
    throw Object.assign(new Error('PDF_API_URL يحتوي ACCOUNT_ID الحرفية — استبدلها بمعرّف حساب Cloudflare الفعلي (32 خانة) من لوحة التحكم.'),{status:503,code:'PDF_SERVICE_NOT_CONFIGURED'});
  }
  const headers={'Content-Type':'application/json'};
  if(config.pdfApiKey)headers.Authorization=`Bearer ${config.pdfApiKey}`;
  const send=()=>fetch(cleanUrl(config.pdfApiUrl),{
    method:'POST',headers,
    body:JSON.stringify({html:String(html||''),pdfOptions:{format:'a4',landscape:Boolean(landscape),printBackground:true}}),
    signal:AbortSignal.timeout(45_000)
  });
  let response;
  for(let attempt=0;attempt<4;attempt++){
    response=await send();
    if(response.status!==429)break;
    if(attempt<3)await sleep(retryDelay(response,attempt));
  }
  if(response.status===429)throw Object.assign(new Error('خدمة PDF ما زالت مشغولة بعد الانتظار وإعادة المحاولة تلقائيًا.'),{status:503,code:'PDF_RATE_LIMITED',upstreamStatus:429,retryable:true});
  if(!response.ok){
    const detail=(await response.text().catch(()=>'' )).replace(/\s+/g,' ').slice(0,300);
    throw Object.assign(new Error(`تعذر إنشاء PDF عبر Cloudflare: ${response.status}${detail?` — ${detail}`:''}`),{status:502,code:'PDF_SERVICE_FAILED',upstreamStatus:response.status});
  }
  return assertPdf(Buffer.from(await response.arrayBuffer()));
}

async function cloudflarePdf(html,options={}){
  const execute=()=>runCloudflarePdf(html,options);
  const queued=cloudflareQueue.then(execute,execute);
  cloudflareQueue=queued.catch(()=>{});
  return queued;
}

async function jsonPdf(html,{filename='report',landscape=false}={}){
  const headers={'Content-Type':'application/json'};
  if(config.pdfApiKey)headers.Authorization=`Bearer ${config.pdfApiKey}`;
  const response=await fetch(cleanUrl(config.pdfApiUrl),{
    method:'POST',headers,
    body:JSON.stringify({html:String(html||''),format:'A4',landscape:Boolean(landscape),printBackground:true,filename}),
    signal:AbortSignal.timeout(45_000)
  });
  if(!response.ok){
    const detail=(await response.text().catch(()=>'' )).replace(/\s+/g,' ').slice(0,300);
    throw Object.assign(new Error(`تعذر إنشاء PDF: ${response.status}${detail?` — ${detail}`:''}`),{status:502,code:'PDF_SERVICE_FAILED',upstreamStatus:response.status});
  }
  return assertPdf(Buffer.from(await response.arrayBuffer()));
}

export function pdfServiceStatus(){
  return{configured:Boolean(config.pdfApiUrl),provider:resolvedProvider(),keyConfigured:Boolean(config.pdfApiKey)};
}

export async function htmlToPdf(html,options={}){
  if(!config.pdfApiUrl)throw Object.assign(new Error('خدمة PDF غير مضبوطة. أضف PDF_PROVIDER وPDF_API_URL في Vercel.'),{status:503,code:'PDF_SERVICE_NOT_CONFIGURED'});
  const provider=resolvedProvider();
  if(provider==='cloudflare')return cloudflarePdf(html,options);
  return provider==='gotenberg'?gotenbergPdf(html,options):jsonPdf(html,options);
}
