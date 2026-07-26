import { select } from './supabase.js';
import { htmlToPdf } from './pdf-service.js';
import { loadProjectedCumulativeDailyReport } from './daily-cumulative-report-data.js';
import { renderCustomerPortfolioDeclaration } from '../../shared/customer-portfolio-declaration.js';
import {
  CUSTOMER_PORTFOLIO_DECLARATION,
  CUSTOMER_PORTFOLIO_EXTRA,
  DECLARATION_ACK,
  CUSTOMER_PORTFOLIO_TEXT_VERSION
} from '../../shared/canonical-declaration-texts.js';

const norm=value=>String(value??'').trim().toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/[_-]+/g,' ').replace(/\s+/g,' ');
const clean=value=>String(value??'').trim();
const htmlEsc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const digits=value=>clean(value).replace(/\D/g,'');
const icon=type=>type==='block'?'🧱':'🏗️';
const ROLE_BY_TYPE={block:'مسؤول مبيعات البلوك',concrete:'مسؤول مبيعات الخرسانة'};
const ROLE_ALIASES={
  block:new Set(['مسؤول مبيعات البلوك','مندوب مبيعات البلوك','مندوب بلوك','مبيعات البلوك','block sales','block salesperson','block sales representative','block_sales'].map(norm)),
  concrete:new Set(['مسؤول مبيعات الخرسانة','مسؤول مبيعات الخرسانه','مندوب مبيعات الخرسانة','مندوب خرسانة','مبيعات الخرسانة','concrete sales','concrete salesperson','concrete sales representative','concrete_sales','ready mix sales','ready_mix_sales'].map(norm))
};
const VALID_TYPES=new Set(['block','concrete']);
function publicBase(){let value=String(process.env.PUBLIC_APP_URL||process.env.VERCEL_PROJECT_PRODUCTION_URL||'').trim().replace(/\/$/,'');if(value&&!/^https?:\/\//i.test(value))value=`https://${value}`;return value||'https://binhamid-factory-control.vercel.app';}
function isoDate(value){const day=clean(value).slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(day)?day:'';}
function dateFromName(value){const text=clean(value).replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d));let match=text.match(/(20\d{2})[./_-](\d{1,2})[./_-](\d{1,2})/);if(match)return`${match[1]}-${String(match[2]).padStart(2,'0')}-${String(match[3]).padStart(2,'0')}`;match=text.match(/(\d{1,2})[./_-](\d{1,2})[./_-](20\d{2})/);return match?`${match[3]}-${String(match[2]).padStart(2,'0')}-${String(match[1]).padStart(2,'0')}`:'';}
async function resolveReportDate(analysis,sourceFile){
  const direct=isoDate(analysis?.reportDate||analysis?.detectedDate||analysis?.summary?.reportDate);if(direct)return direct;
  const named=dateFromName(sourceFile);if(named)return named;
  const rows=await select('daily_report_batches',`original_name=eq.${encodeURIComponent(sourceFile)}&status=eq.approved&select=report_date,committed_at&order=committed_at.desc&limit=1`),approved=isoDate(rows?.[0]?.report_date);if(approved)return approved;
  throw Object.assign(new Error('تعذر تحديد تاريخ التقرير المعتمد؛ تم منع إنشاء إقرار بتاريخ اليوم.'),{status:422,code:'PORTFOLIO_REPORT_DATE_REQUIRED'});
}

function roleMatchesValue(value,type){return ROLE_ALIASES[type]?.has(norm(value))||false;}
function roleMatches(employee,type){return[employee?.declarationRole,employee?.role,employee?.job,employee?.position].some(value=>roleMatchesValue(value,type));}
function mergeEmployeeSources(legacyRows,cloudRows){
  const merged=(Array.isArray(legacyRows)?legacyRows:[]).map(row=>({...row})),byId=new Map(),byNationalId=new Map();
  const indexRow=(row,index)=>{const id=clean(row?.id||row?.external_id),nationalId=digits(row?.nid||row?.national_id);if(id)byId.set(id,index);if(nationalId)byNationalId.set(nationalId,index);};merged.forEach(indexRow);
  for(const row of cloudRows||[]){
    const id=clean(row.external_id),nationalId=digits(row.national_id),cloudRole=clean(row.role),candidate=(nationalId?byNationalId.get(nationalId):undefined)??byId.get(id),values={id:id||undefined,name:clean(row.full_name)||undefined,nid:nationalId||undefined,no:clean(row.employee_no)||undefined,tel:clean(row.phone)||undefined,role:cloudRole||undefined,_cloudSource:true};
    if(candidate!==undefined){const current=merged[candidate]||{},next={...current,...Object.fromEntries(Object.entries(values).filter(([,value])=>value!==undefined))};if(!clean(current.declarationRole)&&cloudRole&&(roleMatchesValue(cloudRole,'block')||roleMatchesValue(cloudRole,'concrete')))next.declarationRole=cloudRole;merged[candidate]=next;indexRow(next,candidate);}
    else{const next=Object.fromEntries(Object.entries({...values,declarationRole:cloudRole||undefined}).filter(([,value])=>value!==undefined));merged.push(next);indexRow(next,merged.length-1);}
  }
  return merged;
}
async function loadAppState(){
  const[stateRows,cloudEmployees]=await Promise.all([select('app_state','key=eq.primary&select=payload&limit=1'),select('employees','active=eq.true&select=external_id,national_id,employee_no,full_name,phone,role&order=full_name.asc&limit=5000')]),legacy=stateRows?.[0]?.payload?.legacy||{},cfg=legacy?.cfg||{};
  return{companyName:cfg.name||'مصنع بن حامد للبلوك والخرسانة الجاهزة',company:{unifiedNumber:clean(cfg.uni),commercialRegistration:clean(cfg.cr),vatNumber:clean(cfg.vat),industrialLicense:clean(cfg.ind),address:clean(cfg.addr),phone:clean(cfg.tel),email:clean(cfg.mail)},days:Number(cfg.days||3)||3,cap:Number(cfg.cap||0)||0,authorizedName:[cfg.auth,cfg.authT].filter(Boolean).join(' — '),employees:mergeEmployeeSources(legacy?.emp,cloudEmployees),clients:Array.isArray(legacy?.cli)?legacy.cli:[]};
}
function repScore(employee,type){if(!roleMatches(employee,type))return-1;let score=1000;if(roleMatchesValue(employee?.declarationRole,type))score+=250;if(digits(employee?.nid||employee?.national_id).length>=10)score+=200;if(clean(employee?.no||employee?.employee_no))score+=40;if(employee?._cloudSource)score+=20;if(Array.isArray(employee?.employeeAliases)&&employee.employeeAliases.length)score+=10;return score;}
function findRep(employees,type){return(employees||[]).filter(employee=>employee?.act!==false&&repScore(employee,type)>=0).sort((a,b)=>repScore(b,type)-repScore(a,type)||clean(a.name).localeCompare(clean(b.name),'ar'))[0]||null;}
function repIds(rep){return new Set([rep?.id,rep?.external_id,...(Array.isArray(rep?.employeeAliases)?rep.employeeAliases:[])].map(clean).filter(Boolean));}
function customerKey(value){return clean(value).toLowerCase();}
function saleType(row){const raw=norm(row?.sales_type||row?.kind||row?.type||row?.segment||'');if(raw==='block'||raw.includes('بلوك')||raw.includes('بلك')||raw.includes('block'))return'block';if(raw==='concrete'||raw.includes('خرسان')||raw.includes('concrete')||raw.includes('ready mix')||raw.includes('readymix')||raw==='rmc')return'concrete';return'';}
function directDailyCustomers(type,analysis={}){const rows=[];for(const row of analysis?.sales||[]){if(saleType(row)!==type||Number(row?.amount??row?.total??row?.total_amount??0)<=0)continue;rows.push({customerCode:clean(row?.customerCode||row?.customer_code||row?.code),customerName:clean(row?.customer||row?.customerName||row?.customer_name||row?.name)});}return rows;}
function invoiceRows(type,analysis={}){return(analysis?.sales||[]).filter(row=>saleType(row)===type&&Number(row?.amount??row?.total??row?.total_amount??0)>0).map((row,index)=>({invoice:clean(row?.invoice||row?.invoiceNo||row?.invoice_no)||`سطر ${row?.row||index+1}`,customer:clean(row?.customer||row?.customerName||row?.customer_name||'عميل غير محدد'),customerCode:clean(row?.customerCode||row?.customer_code),item:clean(row?.item||row?.itemName||row?.item_name||'صنف غير محدد'),quantity:Number(row?.quantity||0),amount:Number(row?.amount??row?.total??row?.total_amount??0)}));}
function injectTelegramEvidence(document,{reportDate,sourceFile,invoices,storedReportDate,dateSource,sourceBatchId}){
  const refs=[...new Set(invoices.map(row=>row.invoice).filter(Boolean))],shown=refs.slice(0,30),more=Math.max(0,refs.length-shown.length),corrected=isoDate(storedReportDate)&&isoDate(storedReportDate)!==reportDate;
  const band=`<div data-telegram-portfolio-proof="1" style="border:1.4px solid #B4893A;background:#F5EDDF;border-radius:4px;padding:7px 10px;margin:0 0 8px;color:#14425F;direction:rtl;font:700 8px/1.55 'IBM Plex Sans Arabic',Arial,Tahoma,sans-serif"><div style="display:flex;gap:12px;flex-wrap:wrap"><span>تاريخ التقرير: <b>${htmlEsc(reportDate)}</b></span><span>فواتير الدفعة: <b>${invoices.length}</b></span><span>المصدر: <b>${htmlEsc(sourceFile||'التقرير اليومي')}</b></span></div><div style="margin-top:3px;font-weight:500">أرقام الفواتير: ${shown.length?shown.map(htmlEsc).join('، '):'لا توجد'}${more?`، و${more} فاتورة أخرى`:''}</div>${corrected?`<div style="margin-top:3px;color:#8A2D20">تم تصحيح تاريخ السجل ${htmlEsc(storedReportDate)} إلى ${htmlEsc(reportDate)} من ملف Excel الأصلي.</div>`:`<div style="margin-top:3px;font-weight:500">مصدر التاريخ: ${dateSource==='database'?'سجل التقرير المعتمد':'ملف Excel الأصلي'}${sourceBatchId?` — مرجع الدفعة ${htmlEsc(String(sourceBatchId).slice(0,12))}`:''}</div>`}</div>`;
  return document.includes('<div class="sec')?document.replace('<div class="sec',`${band}<div class="sec`):document.replace('</body>',`${band}</body>`);
}
function hasCurrentActivity(row){return Number(row?.currentSales||0)>0||Number(row?.currentApplied||0)>0||Number(row?.currentCollections||0)>0||Number(row?.currentUnallocated||0)>0||(Array.isArray(row?.invoices)&&row.invoices.length>0);}
// حركة كل عميل من إسقاط التقرير: قيمة المشتريات والمسدَّد خلال الفترة، والمتبقي هو
// كامل الرصيد غير المسدَّد (شاملًا ما سبق) لأنه ما يبقى فعلًا في ذمة المندوب.
// مفاتيح العملاء فقط — لا علاقة لها بمطابقة الموظفين التي تبقى بالهوية والمعرّف حصرًا.
function ledgerIndex(type,projection){
  const byCustomerCode=new Map(),byCustomerName=new Map();
  for(const row of projection?.departments?.[type]?.rows||[]){
    const items=[...new Set((row.invoices||[]).map(line=>clean(line?.item)).filter(Boolean))];
    const entry={sales:Number(row.currentSales||0),paid:Number(row.currentApplied||0),outstanding:Number(row.closingBalance||0),quantity:Number(row.currentQuantity||0),item:items.slice(0,2).join('، ')+(items.length>2?` +${items.length-2}`:'')};
    const code=customerKey(row.code||row.customerCode),name=customerKey(row.name||row.customerName);
    if(code&&!byCustomerCode.has(code))byCustomerCode.set(code,entry);
    if(name&&!byCustomerName.has(name))byCustomerName.set(name,entry);
  }
  return{byCustomerCode,byCustomerName};
}
function canonicalCustomers(type,analysis,projection,state,rep,{dailyOnly=true}={}){
  const masterByCode=new Map(),masterByName=new Map();for(const client of state.clients){if(client?.code||client?.cr||client?.id)masterByCode.set(customerKey(client.code||client.cr||client.id),client);if(client?.name)masterByName.set(customerKey(client.name),client);}const selected=new Map(),linkedRepIds=repIds(rep),ledger=ledgerIndex(type,projection);
  const add=(client,source={})=>{const name=clean(client?.name||source?.name||source?.customerName),code=clean(client?.code||client?.cr||source?.code||source?.customerCode),key=customerKey(client?.id||code||name);if(!key||selected.has(key))return;const money=ledger.byCustomerCode.get(customerKey(code))||ledger.byCustomerName.get(customerKey(name))||{sales:0,paid:0,outstanding:0,quantity:0,item:''};selected.set(key,{name:name||code||'عميل غير مسمى',segment:type==='block'?'بلوك':'خرسانة',registry:clean(client?.cr||client?.nationalId||client?.registry||code),code,phone:clean(client?.tel||client?.phone),creditLimit:Number(client?.cap??state.cap??0)||0,paymentDays:Number(client?.days??state.days??3)||state.days,sales:money.sales,paid:money.paid,outstanding:money.outstanding,quantity:money.quantity,item:money.item});};
  if(!dailyOnly)for(const client of state.clients){const assigned=linkedRepIds.has(clean(client?.rep))||(Array.isArray(client?.repIds)&&client.repIds.some(id=>linkedRepIds.has(clean(id)))),segment=norm(client?.seg||'');if(assigned&&(!segment||segment.includes(type==='block'?'بلوك':'خرسان')||segment.includes('الاثنين')))add(client);}
  const direct=directDailyCustomers(type,analysis);for(const row of direct){const master=masterByCode.get(customerKey(row.customerCode))||masterByName.get(customerKey(row.customerName));add(master||{},row);}
  const projected=projection?.departments?.[type]?.rows||[];for(const row of projected){if(dailyOnly&&!hasCurrentActivity(row))continue;const master=masterByCode.get(customerKey(row.code||row.customerCode))||masterByName.get(customerKey(row.name||row.customerName));add(master||{},row);}
  return[...selected.values()].sort((a,b)=>a.name.localeCompare(b.name,'ar'));
}

export async function generateCustomerPortfolioPdfs(analysis={},sourceFile='daily-report.xlsx',requestedTypes=['block','concrete'],options={}){
  const types=[...new Set((Array.isArray(requestedTypes)?requestedTypes:[requestedTypes]).map(clean).filter(type=>VALID_TYPES.has(type)))];if(!types.length)throw Object.assign(new Error('حدد إقرار البلوك أو إقرار الخرسانة.'),{status:400,code:'PORTFOLIO_TYPE_REQUIRED'});
  const reportDate=isoDate(options?.reportDate)||await resolveReportDate(analysis,sourceFile),dailyOnly=options?.dailyOnly!==false,dueOnly=options?.dueOnly===true,[state,projection]=await Promise.all([loadAppState(),loadProjectedCumulativeDailyReport(analysis,reportDate,{currentBatch:true})]),baseUrl=`${publicBase()}/`,reports=[];
  for(const type of types){
    const rep=findRep(state.employees,type);if(!rep)throw Object.assign(new Error(`لا يوجد موظف نشط بدور ${ROLE_BY_TYPE[type]}؛ تم منع إصدار الإقرار باسم موظف غير صحيح.`),{status:409,code:`PORTFOLIO_${type.toUpperCase()}_REP_NOT_FOUND`});
    const allCustomers=canonicalCustomers(type,analysis,projection,state,rep,{dailyOnly});
    // «المديونين فقط» اختياري: يقصر الإقرار على من عليه رصيد غير مسدَّد فيبقى قصيرًا مهما
    // زاد العملاء. الافتراضي كل العملاء حتى تظل الوثيقة مُثبِتة لكامل المحفظة المُسندة.
    const priced=allCustomers.some(row=>Number(row.sales||0)||Number(row.paid||0)||Number(row.outstanding||0));
    const customers=dueOnly&&priced?allCustomers.filter(row=>Number(row.outstanding||0)>0):allCustomers;
    const invoices=invoiceRows(type,analysis),documentRef=`BHF-${type.toUpperCase()}-${reportDate.replace(/-/g,'')}-TG`,rendered=renderCustomerPortfolioDeclaration({type,companyName:state.companyName,company:state.company,employee:{name:rep?.name||'',nationalId:digits(rep?.nid||rep?.national_id),role:ROLE_BY_TYPE[type],number:rep?.no||'',phone:rep?.tel||''},customers,days:state.days,defaultCreditLimit:state.cap,declarationText:CUSTOMER_PORTFOLIO_DECLARATION,extraText:CUSTOMER_PORTFOLIO_EXTRA,ackText:DECLARATION_ACK,authorizedName:state.authorizedName,documentRef,dateGregorian:reportDate,logoUrl:`${baseUrl}assets/branding/binhamid-factory-logo.png`,baseUrl});
    const pdf=await htmlToPdf(rendered.document,{filename:`portfolio-${type}-${reportDate}`,landscape:false}),department=type==='block'?'البلوك':'الخرسانة';
    reports.push({type,pdf,filename:`إقرار محفظة عملاء ${department}${dueOnly?' — المديونين':''} — ${reportDate} — ${invoices.length} فاتورة.pdf`,caption:`${icon(type)} إقرار محفظة عملاء ${department} — ${rep.name} — ${reportDate} — ${invoices.length} فاتورة — ${customers.length} عميل`,templateVersion:CUSTOMER_PORTFOLIO_TEXT_VERSION,sourceFile,reportDate,customerCount:customers.length,totalCustomerCount:allCustomers.length,dueOnly,invoiceCount:invoices.length,employeeExternalId:clean(rep?.id||rep?.external_id),employeeNationalId:digits(rep?.nid||rep?.national_id)});
  }
  return reports;
}

// بيانات محفظة المندوب دون توليد PDF — يستخدمها كشف الحساب المستقل ليعرض كل العملاء
// بنفس أرقام الإقرار بالضبط، فلا يختلف مصدر الرقم بين المستندين.
export async function collectPortfolioRows(analysis={},sourceFile='daily-report.xlsx',requestedTypes=['block','concrete'],options={}){
  const types=[...new Set((Array.isArray(requestedTypes)?requestedTypes:[requestedTypes]).map(clean).filter(type=>VALID_TYPES.has(type)))];
  if(!types.length)throw Object.assign(new Error('حدد قطاع البلوك أو الخرسانة.'),{status:400,code:'PORTFOLIO_TYPE_REQUIRED'});
  const reportDate=isoDate(options?.reportDate)||await resolveReportDate(analysis,sourceFile),dailyOnly=options?.dailyOnly!==false;
  const [state,projection]=await Promise.all([loadAppState(),loadProjectedCumulativeDailyReport(analysis,reportDate,{currentBatch:true})]);
  return types.map(type=>{
    const rep=findRep(state.employees,type);
    if(!rep)throw Object.assign(new Error(`لا يوجد موظف نشط بدور ${ROLE_BY_TYPE[type]}؛ تم منع إصدار الكشف باسم موظف غير صحيح.`),{status:409,code:`PORTFOLIO_${type.toUpperCase()}_REP_NOT_FOUND`});
    return{type,reportDate,companyName:state.companyName,employee:{name:rep?.name||'',nationalId:digits(rep?.nid||rep?.national_id)},customers:canonicalCustomers(type,analysis,projection,state,rep,{dailyOnly})};
  });
}
