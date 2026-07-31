import crypto from 'node:crypto';
import { body, errorResponse, json, method } from '../http.js';
import { config } from '../config.js';
import { select } from '../supabase.js';
import { sendMessage } from '../telegram.js';
import { loadFuelAnalytics, loadLatestVehicleDieselBalance } from '../fuel-analytics.js';

const REPOSITORY='fikrimamdouh/binhamid-factory-control';
const OIDC_ISSUER='https://token.actions.githubusercontent.com';
const OIDC_AUDIENCE='binhamid-weekly-executive-report';
const WORKFLOW_PATH='/.github/workflows/weekly-executive-report.yml@refs/heads/main';
let jwksCache={expires:0,keys:[]};

const clean=(value,max=1000)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const num=value=>{const parsed=Number(value||0);return Number.isFinite(parsed)?parsed:0;};
const sum=(rows,pick)=>rows.reduce((total,row)=>total+num(typeof pick==='function'?pick(row):row?.[pick]),0);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money=value=>num(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const qty=(value,digits=2)=>num(value).toLocaleString('en-US',{maximumFractionDigits:digits});
const pct=value=>`${num(value).toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1})}%`;
const collectionAmount=row=>Math.max(num(row?.debit),num(row?.credit));
const dateRangeDays=(from,to)=>Math.max(0,Math.round((new Date(`${to}T12:00:00Z`)-new Date(`${from}T12:00:00Z`))/86400000)+1);
const base64Json=value=>{try{return JSON.parse(Buffer.from(value,'base64url').toString('utf8'));}catch{return null;}};
const audiences=value=>Array.isArray(value)?value:[value];

async function jwks(){
  if(jwksCache.expires>Date.now()&&jwksCache.keys.length)return jwksCache.keys;
  const response=await fetch(`${OIDC_ISSUER}/.well-known/jwks`,{headers:{Accept:'application/json'}});
  if(!response.ok)throw Object.assign(new Error('تعذر التحقق من هوية GitHub Actions'),{status:502,code:'GITHUB_OIDC_JWKS_FAILED'});
  const data=await response.json();
  jwksCache={expires:Date.now()+3600000,keys:Array.isArray(data.keys)?data.keys:[]};
  return jwksCache.keys;
}

async function verifyGithubOidc(req){
  const auth=clean(req.headers?.authorization,3000);
  if(!auth.startsWith('Bearer '))throw Object.assign(new Error('هوية تشغيل التقرير الأسبوعي مطلوبة'),{status:401,code:'WEEKLY_REPORT_AUTH_REQUIRED'});
  const token=auth.slice(7),parts=token.split('.');
  if(parts.length!==3)throw Object.assign(new Error('رمز GitHub Actions غير صالح'),{status:401,code:'WEEKLY_REPORT_AUTH_INVALID'});
  const header=base64Json(parts[0]),claims=base64Json(parts[1]);
  if(!header||!claims||header.alg!=='RS256'||!header.kid)throw Object.assign(new Error('بنية رمز GitHub Actions غير صالحة'),{status:401,code:'WEEKLY_REPORT_AUTH_INVALID'});
  const key=(await jwks()).find(item=>item.kid===header.kid);
  if(!key)throw Object.assign(new Error('مفتاح GitHub Actions غير معروف'),{status:401,code:'WEEKLY_REPORT_AUTH_KEY_UNKNOWN'});
  const valid=crypto.verify('RSA-SHA256',Buffer.from(`${parts[0]}.${parts[1]}`),crypto.createPublicKey({key,format:'jwk'}),Buffer.from(parts[2],'base64url'));
  const now=Math.floor(Date.now()/1000),workflowRef=String(claims.workflow_ref||'');
  if(!valid||claims.iss!==OIDC_ISSUER||!audiences(claims.aud).includes(OIDC_AUDIENCE)||claims.repository!==REPOSITORY||Number(claims.exp||0)<=now||Number(claims.nbf||0)>now+30)throw Object.assign(new Error('هوية GitHub Actions لا تخص مستودع مصنع بن حامد'),{status:401,code:'WEEKLY_REPORT_AUTH_INVALID'});
  if(claims.ref!=='refs/heads/main'||!workflowRef.includes(WORKFLOW_PATH))throw Object.assign(new Error('تشغيل التقرير الأسبوعي غير صادر من المسار المعتمد'),{status:403,code:'WEEKLY_REPORT_REF_FORBIDDEN'});
  return claims;
}

function uniqueApprovedBatches(rows){
  const byDate=new Map();
  for(const row of rows||[]){const day=String(row?.report_date||'').slice(0,10);if(day&&!byDate.has(day))byDate.set(day,row);}
  return [...byDate.values()];
}
async function loadBatches(){
  const rows=await select('daily_report_batches','status=eq.approved&select=id,report_date,original_name,summary,approved_at,committed_at&order=report_date.desc,committed_at.desc.nullslast,approved_at.desc.nullslast&limit=50');
  const unique=uniqueApprovedBatches(rows);
  return{current:unique.slice(0,7).reverse(),previous:unique.slice(7,14).reverse()};
}
function idFilter(batches){return batches.map(row=>String(row.id||'')).filter(Boolean).join(',');}
async function loadBatchRows(batches){
  const ids=idFilter(batches);
  if(!ids)return{sales:[],cash:[],balances:[]};
  const[sales,cash,balances]=await Promise.all([
    select('daily_report_sales_lines',`batch_id=in.(${ids})&select=batch_id,invoice_no,sales_type,customer_code,customer_name,item_name,quantity,unit,amount&limit=20000`).catch(()=>[]),
    select('daily_report_cash_movements',`batch_id=in.(${ids})&select=batch_id,treasury_code,treasury_name,debit,credit,account_name,account_type,account_code,description,movement_type,voucher_no,movement_date_text,payment_method,is_customer_collection&limit=20000`).catch(()=>[]),
    select('daily_report_treasury_balances',`batch_id=in.(${ids})&select=batch_id,treasury_code,treasury_name,opening_balance,closing_balance&limit=2000`).catch(()=>[])
  ]);
  return{sales:sales||[],cash:cash||[],balances:balances||[]};
}
function aggregatePeriod(batches,data){
  const ids=new Set(batches.map(row=>String(row.id))),sales=data.sales.filter(row=>ids.has(String(row.batch_id))),cash=data.cash.filter(row=>ids.has(String(row.batch_id))),collections=cash.filter(row=>row.is_customer_collection===true||String(row.is_customer_collection)==='true');
  const block=sales.filter(row=>row.sales_type==='block'),concrete=sales.filter(row=>row.sales_type==='concrete'),other=sales.filter(row=>!['block','concrete'].includes(String(row.sales_type||'')));
  const invoices=new Set(sales.map(row=>clean(row.invoice_no,100)).filter(Boolean));
  return{sales,collections,cash,totalSales:sum(sales,'amount'),blockSales:sum(block,'amount'),concreteSales:sum(concrete,'amount'),otherSales:sum(other,'amount'),blockQty:sum(block,'quantity'),concreteQty:sum(concrete,'quantity'),invoiceCount:invoices.size||sales.length,totalCollections:sum(collections,collectionAmount)};
}
function classifyChannel(row){
  const value=clean([row?.payment_method,row?.treasury_name,row?.treasury_code,row?.account_type,row?.description].filter(Boolean).join(' '),500).toLowerCase();
  if(/بنك|bank|تحويل|راجحي|اهلي|الأهلي|رياض|انماء|الانماء|بلاد|ساب|العربي/.test(value))return'bank';
  if(/خزن|خزنة|صندوق|كاش|نقد|cash/.test(value))return'cash';
  return'other';
}
function channelTotals(rows){const totals={bank:0,cash:0,other:0};for(const row of rows)totals[classifyChannel(row)]+=collectionAmount(row);return totals;}
function balanceGroups(rows){
  const groups={bank:[],cash:[],other:[]};
  for(const row of rows){const item={name:clean(row.treasury_name||row.treasury_code||'غير محدد',80),closing:num(row.closing_balance),opening:num(row.opening_balance)};groups[classifyChannel(row)].push(item);}
  for(const key of Object.keys(groups))groups[key].sort((a,b)=>b.closing-a.closing);
  return groups;
}
function groupTotals(rows,keyName,valuePicker){
  const map=new Map();
  for(const row of rows){const key=clean(row?.[keyName]||'غير محدد',70)||'غير محدد';map.set(key,(map.get(key)||0)+num(valuePicker(row)));}
  return[...map.entries()].sort((a,b)=>b[1]-a[1]);
}
function debtors(rows){
  const map=new Map();
  for(const row of rows||[]){const outstanding=Math.max(0,num(row.total_amount)-num(row.paid_amount));if(outstanding<=0)continue;const name=clean(row.customer_name||row.customer_external_id||'عميل غير محدد',70);map.set(name,(map.get(name)||0)+outstanding);}
  const list=[...map.entries()].sort((a,b)=>b[1]-a[1]);
  return{total:list.reduce((total,item)=>total+item[1],0),top:list.slice(0,3),count:list.length};
}
function duplicateCashCount(rows){
  const seen=new Set();let duplicates=0;
  for(const row of rows){const key=[clean(row.voucher_no),clean(row.movement_date_text),clean(row.treasury_code),clean(row.account_code),collectionAmount(row).toFixed(2)].join('|');if(key==='||||0.00')continue;if(seen.has(key))duplicates++;else seen.add(key);}
  return duplicates;
}
function trend(current,previous){if(!previous)return'لا توجد مقارنة كافية';const change=(current-previous)/Math.abs(previous)*100;return`${change>=0?'ارتفاع':'انخفاض'} ${pct(Math.abs(change))}`;}
function listLines(rows,label){if(!rows.length)return`• ${label}: لا توجد بيانات`;return rows.slice(0,3).map(([name,value],index)=>`${index+1}. ${esc(name)} — <b>${money(value)}</b> ر.س`).join('\n');}
function balanceLines(rows,label){if(!rows.length)return`• ${label}: لا توجد أرصدة`;return rows.slice(0,4).map(item=>`• ${esc(item.name)}: <b>${money(item.closing)}</b> ر.س`).join('\n');}

async function buildWeeklyReport(){
  const{current,previous}=await loadBatches();
  if(!current.length)throw Object.assign(new Error('لا يوجد تقرير يومي معتمد لبناء التقرير الأسبوعي'),{status:404,code:'WEEKLY_REPORT_NO_DATA'});
  const data=await loadBatchRows([...current,...previous]),currentAgg=aggregatePeriod(current,data),previousAgg=aggregatePeriod(previous,data);
  const from=String(current[0].report_date).slice(0,10),to=String(current.at(-1).report_date).slice(0,10),latestBatch=current.at(-1),latestBalances=data.balances.filter(row=>String(row.batch_id)===String(latestBatch.id));
  const channels=channelTotals(currentAgg.collections),balances=balanceGroups(latestBalances),expectedDays=dateRangeDays(from,to),missingDays=Math.max(0,expectedDays-current.length);
  const[topSales,topCollections,openOrders,maintenance,purchases,inventory,fuelDiesel,fuelPetrol,unusedDiesel]=await Promise.all([
    Promise.resolve(groupTotals(currentAgg.sales,'customer_name',row=>row.amount).slice(0,3)),
    Promise.resolve(groupTotals(currentAgg.collections,'account_name',collectionAmount).slice(0,3)),
    select('sales_orders','status=not.in.(cancelled,rejected,collected)&select=customer_external_id,customer_name,total_amount,paid_amount,status&limit=10000').catch(()=>[]),
    select('maintenance_orders','status=in.(reported,inspection,quotation_required,approval_pending,approved,in_repair,testing)&select=id,priority,vehicle_stopped,status&limit=2000').catch(()=>[]),
    select('purchase_requests','status=in.(requested,pending,open,under_review,approval_pending)&select=id,urgency,status&limit=2000').catch(()=>[]),
    select('inventory_items','active=eq.true&select=item_name,quantity_on_hand,minimum_quantity&limit=10000').catch(()=>[]),
    loadFuelAnalytics(7,{category:'diesel'}).catch(error=>({hasData:false,error:String(error?.message||error)})),
    loadFuelAnalytics(7,{category:'petrol'}).catch(error=>({hasData:false,error:String(error?.message||error)})),
    loadLatestVehicleDieselBalance().catch(()=>null)
  ]);
  const debt=debtors(openOrders),lowStock=(inventory||[]).filter(row=>num(row.quantity_on_hand)<=num(row.minimum_quantity)),criticalMaintenance=(maintenance||[]).filter(row=>row.priority==='urgent'||row.vehicle_stopped===true||String(row.vehicle_stopped)==='true');
  const bankBalance=sum(balances.bank,'closing'),cashBalance=sum(balances.cash,'closing'),otherBalance=sum(balances.other,'closing'),totalBalance=bankBalance+cashBalance+otherBalance;
  const collectionRate=currentAgg.totalSales>0?currentAgg.totalCollections/currentAgg.totalSales*100:0,netReceivables=currentAgg.totalSales-currentAgg.totalCollections;
  const missingDates=currentAgg.cash.filter(row=>!clean(row.movement_date_text)).length,unnamedCollections=currentAgg.collections.filter(row=>!clean(row.account_name)).length,duplicateCash=duplicateCashCount(currentAgg.collections);
  const dieselTotals=fuelDiesel?.hasData?fuelDiesel.totals:{liters:0,amount:0,fills:0},petrolTotals=fuelPetrol?.hasData?fuelPetrol.totals:{liters:0,amount:0,fills:0};
  const report=[
    '📊 <b>التقرير الأسبوعي الشامل | مصنع بن حامد</b>','━━━━━━━━━━━━━━━━━━━━',`📅 الفترة: <b>${esc(from)}</b> إلى <b>${esc(to)}</b>`,`📁 الأيام المعتمدة: <b>${current.length}</b>${missingDays?` | أيام غير متاحة: <b>${missingDays}</b>`:''}`,'',
    '🔷 <b>الملخص التنفيذي</b>',`• إجمالي المبيعات: <b>${money(currentAgg.totalSales)}</b> ر.س`,`• إجمالي التحصيلات: <b>${money(currentAgg.totalCollections)}</b> ر.س`,`• صافي زيادة المديونية: <b>${money(netReceivables)}</b> ر.س`,`• نسبة التحصيل: <b>${pct(collectionRate)}</b>`,`• الفواتير: <b>${currentAgg.invoiceCount}</b>`,`• مقارنة المبيعات: ${trend(currentAgg.totalSales,previousAgg.totalSales)}`,`• مقارنة التحصيلات: ${trend(currentAgg.totalCollections,previousAgg.totalCollections)}`,'',
    '🏭 <b>المبيعات حسب القطاع</b>',`• الخرسانة: <b>${money(currentAgg.concreteSales)}</b> ر.س | ${qty(currentAgg.concreteQty,3)} م³`,`• البلوك: <b>${money(currentAgg.blockSales)}</b> ر.س | ${qty(currentAgg.blockQty,0)} حبة`,currentAgg.otherSales?`• مبيعات أخرى: <b>${money(currentAgg.otherSales)}</b> ر.س`:null,'',
    '💳 <b>التحصيلات حسب القناة</b>',`• بنوك وتحويلات: <b>${money(channels.bank)}</b> ر.س`,`• نقدي وخزن: <b>${money(channels.cash)}</b> ر.س`,`• غير مصنف: <b>${money(channels.other)}</b> ر.س`,'',
    `🏦 <b>أرصدة البنوك والخزن | ${esc(String(latestBatch.report_date).slice(0,10))}</b>`,`• إجمالي البنوك: <b>${money(bankBalance)}</b> ر.س`,`• إجمالي الخزن: <b>${money(cashBalance)}</b> ر.س`,otherBalance?`• أرصدة أخرى: <b>${money(otherBalance)}</b> ر.س`:null,`• الإجمالي: <b>${money(totalBalance)}</b> ر.س`,balanceLines(balances.bank,'البنوك'),balanceLines(balances.cash,'الخزن'),'',
    '👥 <b>العملاء والمديونية</b>',`• إجمالي المديونية المفتوحة: <b>${money(debt.total)}</b> ر.س | ${debt.count} عميل`,'<b>أعلى المبيعات:</b>',listLines(topSales,'المبيعات'),'<b>أعلى المديونيات:</b>',listLines(debt.top,'المديونيات'),'<b>أعلى التحصيلات:</b>',listLines(topCollections,'التحصيلات'),'',
    '⛽ <b>الوقود — آخر 7 أيام</b>',`• الديزل: <b>${qty(dieselTotals.liters,2)}</b> لتر | <b>${money(dieselTotals.amount)}</b> ر.س | ${dieselTotals.fills||0} حركة`,`• البنزين: <b>${qty(petrolTotals.liters,2)}</b> لتر | <b>${money(petrolTotals.amount)}</b> ر.س | ${petrolTotals.fills||0} حركة`,unusedDiesel?`• رصيد الديزل غير المستخدم: <b>${money(unusedDiesel.total)}</b> ر.س`:null,'',
    '🛠️ <b>الموقف التشغيلي</b>',`• أوامر الصيانة المفتوحة: <b>${maintenance?.length||0}</b> | حرجة/موقوفة: <b>${criticalMaintenance.length}</b>`,`• طلبات الشراء المعلقة: <b>${purchases?.length||0}</b>`,`• أصناف عند أو تحت الحد الأدنى: <b>${lowStock.length}</b>`,'',
    '🔎 <b>الرقابة وجودة البيانات</b>',`• حركات خزينة بلا تاريخ: <b>${missingDates}</b>`,`• تحصيلات بلا اسم عميل: <b>${unnamedCollections}</b>`,`• تكرارات محتملة: <b>${duplicateCash}</b>`,`• الحالة: <b>${missingDays||missingDates||unnamedCollections||duplicateCash?'توجد نقاط تحتاج مراجعة':'لا توجد ملاحظات ظاهرة'}</b>`,'━━━━━━━━━━━━━━━━━━━━','<i>أُنشئ آليًا من ERP والبنوك والخزن والعملاء والوقود والصيانة والمخزون.</i>'
  ].filter(Boolean).join('\n');
  return{report,period:{from,to,approvedDays:current.length,missingDays},metrics:{sales:currentAgg.totalSales,collections:currentAgg.totalCollections,bankBalance,cashBalance,debt:debt.total,dieselLiters:num(dieselTotals.liters),petrolLiters:num(petrolTotals.liters)}};
}

export async function sendWeeklyReport(req,res){
  if(!method(req,res,['POST']))return;
  try{
    await verifyGithubOidc(req);
    await body(req,20_000).catch(()=>({}));
    if(!config.telegramOwnerId)throw Object.assign(new Error('معرف مالك البوت غير مضبوط'),{status:503,code:'TELEGRAM_OWNER_NOT_CONFIGURED'});
    const result=await buildWeeklyReport();
    if(result.report.length>4000)throw Object.assign(new Error(`رسالة التقرير تجاوزت حد تيليجرام: ${result.report.length}`),{status:500,code:'WEEKLY_REPORT_TOO_LONG'});
    const message=await sendMessage(config.telegramOwnerId,result.report,{disable_voice_reply:true,action_name:'weekly_executive_report',action_payload:result.period});
    return json(res,200,{ok:true,sent:true,messageId:message?.message_id||null,period:result.period,metrics:result.metrics});
  }catch(error){return errorResponse(res,error);}
}
