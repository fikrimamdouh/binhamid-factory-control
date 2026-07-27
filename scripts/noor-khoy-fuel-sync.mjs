import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import * as XLSX from 'xlsx';
import { chromium } from 'playwright';
import { parseFuelWorkbook } from '../api/_lib/fuel-summary-parser.js';

const LOGIN_URL=process.env.NOOR_KHOY_LOGIN_URL||'https://www.norkhoysa.com/companies/login';
const DASHBOARD_URL=process.env.NOOR_KHOY_DASHBOARD_URL||'https://www.norkhoysa.com/companies';
const REPORT_URL=process.env.NOOR_KHOY_REPORT_URL||'https://www.norkhoysa.com/companies/fuels?fueltype=all';
const UPLOAD_URL=process.env.BINHAMID_FUEL_UPLOAD_URL||'https://binhamid-factory-control.vercel.app/api/fuel/daily-report';
const username=String(process.env.NOOR_KHOY_USERNAME||'').trim();
const password=String(process.env.NOOR_KHOY_PASSWORD||'');
const artifacts=path.resolve(process.env.FUEL_SYNC_ARTIFACT_DIR||'artifacts/noor-khoy-fuel');
const sendBalance=!/^(false|0|no)$/i.test(String(process.env.FUEL_SEND_BALANCE||'true').trim());
const notify=!/^(false|0|no)$/i.test(String(process.env.FUEL_NOTIFY||'true').trim());

function required(value,name){if(!value)throw new Error(`Missing required environment variable: ${name}`);return value;}
function riyadhDate(value=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(value);
  const get=type=>parts.find(part=>part.type===type)?.value||'';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function shiftedRiyadhDate(offsetDays=-1){
  const today=riyadhDate(),date=new Date(`${today}T12:00:00Z`),offset=Number.parseInt(String(offsetDays),10);
  date.setUTCDate(date.getUTCDate()+(Number.isFinite(offset)?offset:-1));
  return date.toISOString().slice(0,10);
}
function ddmmyyyy(iso){const[y,m,d]=iso.split('-');return`${d}/${m}/${y}`;}
function compact(value){return String(value??'').replace(/\s+/g,' ').trim();}
function safeName(value){return compact(value).replace(/[^A-Za-z0-9._-]/g,'_').replace(/_+/g,'_').slice(0,120)||'fuel-report.xlsx';}
function westernDigits(value){return String(value??'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d));}
function moneyNumber(value){
  const normalized=westernDigits(value).replace(/[٬,\s]/g,'').replace('٫','.').replace(/[^0-9.-]/g,'');
  const number=Number(normalized);return Number.isFinite(number)&&number>=0?Number(number.toFixed(2)):null;
}

async function visible(locator){try{return await locator.first().isVisible();}catch{return false;}}
async function fillFirst(page,selectors,value){
  for(const selector of selectors){const locator=page.locator(selector);if(await visible(locator)){await locator.first().fill(value);return true;}}
  return false;
}
async function clickFirst(page,selectors){
  for(const selector of selectors){const locator=page.locator(selector);if(await visible(locator)){await locator.first().click();return true;}}
  return false;
}
async function login(page){
  await page.goto(LOGIN_URL,{waitUntil:'domcontentloaded',timeout:60000});
  const passwordInput=page.locator('input[type="password"]');
  if(!(await visible(passwordInput)))return;
  const userFilled=await fillFirst(page,[
    'input[type="email"]','input[name="email"]','input[name="username"]','input[name="userName"]',
    'input[autocomplete="username"]','input[placeholder*="Email" i]','input[placeholder*="username" i]',
    'input[type="text"]'
  ],required(username,'NOOR_KHOY_USERNAME'));
  if(!userFilled)throw new Error('Noor Khoy username field was not found.');
  await passwordInput.first().fill(required(password,'NOOR_KHOY_PASSWORD'));
  const submitted=await clickFirst(page,[
    'button[type="submit"]','input[type="submit"]','button:has-text("Sign In")','button:has-text("Login")',
    'button:has-text("دخول")','a:has-text("Sign In")'
  ]);
  if(!submitted)await passwordInput.first().press('Enter');
  await page.waitForLoadState('domcontentloaded',{timeout:60000}).catch(()=>null);
  await page.waitForTimeout(1200);
  if(await visible(page.locator('input[type="password"]')))throw new Error('Noor Khoy login failed; the login form is still visible.');
}
async function ensureLogin(page,url){
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
  if(/\/login/i.test(page.url())||await visible(page.locator('input[type="password"]'))){await login(page);await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});}
}
function balanceCandidates(text){
  const lines=String(text||'').split(/\r?\n/).map(compact).filter(Boolean),candidates=[];
  const amountPattern=/([0-9٠-٩][0-9٠-٩٬,]*(?:[٫.][0-9٠-٩]{1,2})?)/g;
  for(let index=0;index<lines.length;index++){
    const context=lines.slice(Math.max(0,index-1),Math.min(lines.length,index+3)).join(' ');
    if(!/رصيد|متبقي|المتبقي|balance|credit/i.test(context))continue;
    let score=1;if(/ديزل|diesel/i.test(context))score+=5;if(/ر\.?\s*س|ريال|sar/i.test(context))score+=2;
    for(const match of context.matchAll(amountPattern)){const amount=moneyNumber(match[1]);if(amount!==null)candidates.push({amount,score,text:context});}
  }
  return candidates.sort((a,b)=>b.score-a.score||b.amount-a.amount);
}
async function extractDieselBalance(page){
  const selectors=['[class*="balance" i]','[id*="balance" i]','[class*="wallet" i]','[id*="wallet" i]','[class*="credit" i]','[id*="credit" i]'];
  const snippets=[];
  for(const selector of selectors){const locator=page.locator(selector);const count=Math.min(await locator.count().catch(()=>0),20);for(let index=0;index<count;index++)snippets.push(await locator.nth(index).innerText().catch(()=>''));}
  snippets.push(await page.locator('body').innerText().catch(()=>''));
  const candidates=balanceCandidates(snippets.join('\n'));
  return candidates[0]?.amount??null;
}

async function setNativeDate(locator,iso){
  await locator.evaluate((element,value)=>{
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
    if(setter)setter.call(element,value);else element.value=value;
    element.dispatchEvent(new Event('input',{bubbles:true}));
    element.dispatchEvent(new Event('change',{bubbles:true}));
  },iso);
}
async function setReportDate(page,iso){
  const nativeDates=page.locator('input[type="date"]:visible');
  const nativeCount=await nativeDates.count();
  if(nativeCount){for(let index=0;index<Math.min(nativeCount,2);index++)await setNativeDate(nativeDates.nth(index),iso);return;}
  const fromSelectors=['input[name*="from" i]','input[id*="from" i]','input[name*="start" i]','input[id*="start" i]','input[name*="date1" i]'];
  const toSelectors=['input[name*="to" i]','input[id*="to" i]','input[name*="end" i]','input[id*="end" i]','input[name*="date2" i]'];
  const formats=[iso,ddmmyyyy(iso)];
  let from=null,to=null;
  for(const selector of fromSelectors){const item=page.locator(`${selector}:visible`);if(await item.count()){from=item.first();break;}}
  for(const selector of toSelectors){const item=page.locator(`${selector}:visible`);if(await item.count()){to=item.first();break;}}
  if(!from||!to){const textDates=page.locator('input[type="text"]:visible');if(await textDates.count()>=2){from=textDates.nth(0);to=textDates.nth(1);}}
  if(!from||!to)throw new Error('Noor Khoy date fields were not found.');
  for(const value of formats){try{await from.fill(value);await to.fill(value);await from.dispatchEvent('change');await to.dispatchEvent('change');return;}catch{}}
  throw new Error('Noor Khoy date fields could not be filled.');
}
async function selectAllFuel(page){
  for(const selector of ['select[name*="fuel" i]','select[id*="fuel" i]']){
    const select=page.locator(`${selector}:visible`).first();if(!(await visible(select)))continue;
    const options=await select.locator('option').evaluateAll(items=>items.map(item=>({value:item.value,text:(item.textContent||'').trim()})));
    const all=options.find(item=>/^(all|الكل|جميع)/i.test(item.value)||/الكل|جميع|all/i.test(item.text));
    if(all){await select.selectOption(all.value);return;}
  }
}
async function applyFilter(page){
  await clickFirst(page,['button:has-text("بحث")','button:has-text("عرض")','button:has-text("تطبيق")','button:has-text("Search")','input[type="submit"][value*="بحث"]','input[type="submit"][value*="Search" i]']).catch(()=>false);
  await page.waitForTimeout(1200);
}
async function downloadExcel(page,reportDate){
  const candidates=['button:has-text("Excel")','a:has-text("Excel")','button:has-text("اكسل")','a:has-text("اكسل")','button:has-text("إكسل")','a:has-text("إكسل")','button:has-text("تصدير")','a:has-text("تصدير")','[href*="excel" i]','[href*="export" i]','[data-export*="excel" i]'];
  let trigger=null;for(const selector of candidates){const item=page.locator(`${selector}:visible`).first();if(await visible(item)){trigger=item;break;}}
  if(!trigger)throw new Error('Noor Khoy Excel export control was not found.');
  const downloadPromise=page.waitForEvent('download',{timeout:60000});await trigger.click();const download=await downloadPromise;
  const suggested=safeName(download.suggestedFilename()),extension=/\.(xlsx|xls)$/i.test(suggested)?path.extname(suggested):'.xlsx';
  const filePath=path.join(artifacts,`noor-khoy-fuel-${reportDate}${extension}`);await download.saveAs(filePath);return filePath;
}
async function githubOidcToken(){
  const requestUrl=required(process.env.ACTIONS_ID_TOKEN_REQUEST_URL,'ACTIONS_ID_TOKEN_REQUEST_URL'),requestToken=required(process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,'ACTIONS_ID_TOKEN_REQUEST_TOKEN');
  const url=new URL(requestUrl);url.searchParams.set('audience','binhamid-fuel-sync');const response=await fetch(url,{headers:{Authorization:`Bearer ${requestToken}`}});
  if(!response.ok)throw new Error(`GitHub OIDC token request failed: ${response.status}`);const data=await response.json();return required(data.value,'GitHub OIDC token value');
}
async function upload(filePath,reportDate,parsed,accountBalance,balanceCapturedAt){
  const token=await githubOidcToken(),buffer=await fs.readFile(filePath),headers={Authorization:`Bearer ${token}`,'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','x-fuel-filename-b64':Buffer.from(path.basename(filePath),'utf8').toString('base64'),'x-fuel-report-date':reportDate,'x-fuel-row-count':String(parsed.rowCount),'x-fuel-notify':notify?'true':'false'};
  if(Number.isFinite(accountBalance)){headers['x-fuel-account-balance']=String(accountBalance);headers['x-fuel-balance-captured-at']=balanceCapturedAt;}
  const response=await fetch(UPLOAD_URL,{method:'POST',headers,body:buffer});const text=await response.text();let data;try{data=text?JSON.parse(text):{};}catch{data={raw:text};}
  await fs.writeFile(path.join(artifacts,'upload-response.json'),JSON.stringify({status:response.status,data},null,2));
  if(!response.ok||!data?.ok)throw new Error(`Bin Hamid upload failed (${response.status}): ${compact(data?.error||data?.message||text).slice(0,500)}`);return data;
}

async function main(){
  required(username,'NOOR_KHOY_USERNAME');required(password,'NOOR_KHOY_PASSWORD');await fs.mkdir(artifacts,{recursive:true});
  const explicit=String(process.env.REPORT_DATE||'').trim(),offset=process.env.FUEL_REPORT_DATE_OFFSET_DAYS||'-1',reportDate=explicit||shiftedRiyadhDate(offset);
  const browser=await chromium.launch({headless:true}),context=await browser.newContext({acceptDownloads:true,locale:'ar-SA',timezoneId:'Asia/Riyadh'}),page=await context.newPage();
  try{
    let accountBalance=null,balanceCapturedAt='';
    if(sendBalance){
      await ensureLogin(page,DASHBOARD_URL);accountBalance=await extractDieselBalance(page);balanceCapturedAt=new Date().toISOString();
      await fs.writeFile(path.join(artifacts,'dashboard-balance.json'),JSON.stringify({accountBalance,capturedAt:balanceCapturedAt},null,2));
      if(accountBalance===null)await fs.writeFile(path.join(artifacts,'dashboard-text.txt'),await page.locator('body').innerText().catch(()=>''),'utf8');
      await page.goto(REPORT_URL,{waitUntil:'domcontentloaded',timeout:60000});
    }else{
      await ensureLogin(page,REPORT_URL);
    }
    await setReportDate(page,reportDate);await selectAllFuel(page);await applyFilter(page);
    const filePath=await downloadExcel(page,reportDate),buffer=await fs.readFile(filePath),workbook=XLSX.read(buffer,{type:'buffer',cellDates:true}),parsed=parseFuelWorkbook(workbook,XLSX);
    if(!parsed.rowCount)throw new Error('Downloaded Excel contains no recognizable fuel rows.');
    const result=await upload(filePath,reportDate,parsed,accountBalance,balanceCapturedAt);
    console.log(JSON.stringify({ok:true,reportDate,accountBalance,notify,file:path.basename(filePath),rows:parsed.rowCount,duplicate:Boolean(result.duplicate),stored:Number(result.storedRows||0)},null,2));
  }catch(error){await page.screenshot({path:path.join(artifacts,'failure.png'),fullPage:true}).catch(()=>null);await fs.writeFile(path.join(artifacts,'failure.html'),await page.content().catch(()=>''),'utf8').catch(()=>null);throw error;}finally{await browser.close();}
}

main().catch(error=>{console.error('[noor-khoy-fuel-sync]',error?.stack||error);process.exitCode=1;});
