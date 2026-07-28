import { select, uploadObject } from './supabase.js';
import { htmlToPdf } from './pdf-service.js';
import { loadCustomerAnalytics } from './bot-customer-report-data.js';
import {
  aggregateSettlements,
  buildReportActivityIndex,
  indexCustomerAnalytics,
  lookupActivity,
  lookupCustomer,
  normalizeCustomerValue,
  settleCustomerAccount
} from './customer-settlement.js';
import { enhancePortfolioDocument } from './customer-portfolio-document.js';
import { renderCustomerPortfolioDeclaration } from '../../shared/customer-portfolio-declaration.js';
import { portfolioSectorLabel, resolveCustomerPortfolioOwner } from '../../shared/customer-portfolio-ownership.js';
import { combinePortfolioTotals } from '../../shared/customer-portfolio-totals.js';
import {
  CUSTOMER_PORTFOLIO_DECLARATION,
  CUSTOMER_PORTFOLIO_EXTRA,
  DECLARATION_ACK,
  CUSTOMER_PORTFOLIO_TEXT_VERSION
} from '../../shared/canonical-declaration-texts.js';

const SNAPSHOT_VERSION='portfolio-settlement-v3-cross-sector';
const CROSS_SECTOR_SALES_MARKER='2026.07.28-cross-sector-sales-v1';
const clean=value=>String(value??'').trim();
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const digits=value=>clean(value).replace(/\D/g,'');
const money=value=>Number(value||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const icon=type=>type==='block'?'🧱':'🏗️';
const ROLE_BY_TYPE={block:'مسؤول مبيعات البلوك',concrete:'مسؤول مبيعات الخرسانة'};
const ANALYTICS_ROLE={block:'block_sales',concrete:'concrete_sales'};
const ROLE_ALIASES={
  block:new Set(['مسؤول مبيعات البلوك','مندوب مبيعات البلوك','مندوب بلوك','مبيعات البلوك','block sales','block salesperson','block sales representative','block_sales'].map(normalizeCustomerValue)),
  concrete:new Set(['مسؤول مبيعات الخرسانة','مسؤول مبيعات الخرسانه','مندوب مبيعات الخرسانة','مندوب خرسانة','مبيعات الخرسانة','concrete sales','concrete salesperson','concrete sales representative','concrete_sales','ready mix sales','ready_mix_sales'].map(normalizeCustomerValue))
};
const VALID_TYPES=new Set(['block','concrete']);

function publicBase(){let value=String(process.env.PUBLIC_APP_URL||process.env.VERCEL_PROJECT_PRODUCTION_URL||'').trim().replace(/\/$/,'');if(value&&!/^https?:\/\//i.test(value))value=`https://${value}`;return value||'https://binhamid-factory-control.vercel.app';}
function isoDate(value){const day=clean(value).slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(day)?day:'';}
function dateFromName(value){const text=clean(value).replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d));let match=text.match(/(20\d{2})[./_-](\d{1,2})[./_-](\d{1,2})/);if(match)return`${match[1]}-${String(match[2]).padStart(2,'0')}-${String(match[3]).padStart(2,'0')}`;match=text.match(/(\d{1,2})[./_-](\d{1,2})[./_-](20\d{2})/);return match?`${match[3]}-${String(match[2]).padStart(2,'0')}-${String(match[1]).padStart(2,'0')}`:'';}
async function resolveReportDate(analysis,sourceFile){const direct=isoDate(analysis?.reportDate||analysis?.detectedDate||analysis?.summary?.reportDate);if(direct)return direct;const named=dateFromName(sourceFile);if(named)return named;const rows=await select('daily_report_batches',`original_name=eq.${encodeURIComponent(sourceFile)}&status=eq.approved&select=report_date,committed_at&order=committed_at.desc&limit=1`),approved=isoDate(rows?.[0]?.report_date);if(approved)return approved;throw Object.assign(new Error('تعذر تحديد تاريخ التقرير المعتمد؛ تم منع إنشاء إقرار بتاريخ اليوم.'),{status:422,code:'PORTFOLIO_REPORT_DATE_REQUIRED'});}

function roleMatchesValue(value,type){return ROLE_ALIASES[type]?.has(normalizeCustomerValue(value))||false;}
function roleMatches(employee,type){return[employee?.declarationRole,employee?.role,employee?.job,employee?.position].some(value=>roleMatchesValue(value,type));}
function mergeEmployeeSources(legacyRows,cloudRows){
  const merged=(Array.isArray(legacyRows)?legacyRows:[]).map(row=>({...row})),byId=new Map(),byNationalId=new Map();
  const indexRow=(row,index)=>{for(const id of [row?.id,row?.external_id,...(Array.isArray(row?.employeeAliases)?row.employeeAliases:[])].map(clean).filter(Boolean))byId.set(id,index);const nationalId=digits(row?.nid||row?.national_id);if(nationalId)byNationalId.set(nationalId,index);};
  merged.forEach(indexRow);
  for(const row of cloudRows||[]){
    const cloudId=clean(row.external_id),nationalId=digits(row.national_id),cloudRole=clean(row.role),candidate=(nationalId?byNationalId.get(nationalId):undefined)??byId.get(cloudId);
    if(candidate!==undefined){const current=merged[candidate]||{},aliases=[...new Set([...(Array.isArray(current.employeeAliases)?current.employeeAliases:[]),current.id,current.external_id,cloudId].map(clean).filter(Boolean))],next={...current,id:clean(current.id)||cloudId||undefined,external_id:cloudId||clean(current.external_id)||undefined,name:clean(row.full_name)||current.name,nid:nationalId||current.nid,no:clean(row.employee_no)||current.no,tel:clean(row.phone)||current.tel,role:cloudRole||current.role,employeeAliases:aliases,_cloudSource:true};if(!clean(current.declarationRole)&&cloudRole&&(roleMatchesValue(cloudRole,'block')||roleMatchesValue(cloudRole,'concrete')))next.declarationRole=cloudRole;merged[candidate]=next;indexRow(next,candidate);}
    else{const next={id:cloudId||undefined,external_id:cloudId||undefined,name:clean(row.full_name)||undefined,nid:nationalId||undefined,no:clean(row.employee_no)||undefined,tel:clean(row.phone)||undefined,role:cloudRole||undefined,declarationRole:cloudRole||undefined,employeeAliases:cloudId?[cloudId]:[],_cloudSource:true};merged.push(next);indexRow(next,merged.length-1);}
  }
  return merged;
}
async function loadAppState(){
  const[stateRows,cloudEmployees]=await Promise.all([select('app_state','key=eq.primary&select=payload&limit=1'),select('employees','active=eq.true&select=external_id,national_id,employee_no,full_name,phone,role&order=full_name.asc&limit=5000')]),legacy=stateRows?.[0]?.payload?.legacy||{},cfg=legacy?.cfg||{};
  return{companyName:cfg.name||'مصنع بن حامد للبلوك والخرسانة الجاهزة',company:{unifiedNumber:clean(cfg.uni),commercialRegistration:clean(cfg.cr),vatNumber:clean(cfg.vat),industrialLicense:clean(cfg.ind),address:clean(cfg.addr),phone:clean(cfg.tel),email:clean(cfg.mail)},days:Number(cfg.days||3)||3,cap:Number(cfg.cap||0)||0,authorizedName:[cfg.auth,cfg.authT].filter(Boolean).join(' — '),employees:mergeEmployeeSources(legacy?.emp,cloudEmployees),clients:Array.isArray(legacy?.cli)?legacy.cli:[]};
}
function repScore(employee,type){if(!roleMatches(employee,type))return-1;let score=1000;if(roleMatchesValue(employee?.declarationRole,type))score+=250;if(digits(employee?.nid||employee?.national_id).length>=10)score+=200;if(clean(employee?.no||employee?.employee_no))score+=40;if(employee?._cloudSource)score+=20;if(Array.isArray(employee?.employeeAliases)&&employee.employeeAliases.length)score+=10;return score;}
function findRep(employees,type){return(employees||[]).filter(employee=>employee?.act!==false&&repScore(employee,type)>=0).sort((a,b)=>repScore(b,type)-repScore(a,type)||clean(a.name).localeCompare(clean(b.name),'ar'))[0]||null;}
function masterIndexes(clients=[]){const byCode=new Map(),byName=new Map();for(const client of clients||[]){for(const value of [client?.id,client?.code,client?.cr].map(normalizeCustomerValue).filter(Boolean))if(!byCode.has(value))byCode.set(value,client);const name=normalizeCustomerValue(client?.name);if(name&&!byName.has(name))byName.set(name,client);}return{byCode,byName};}
function lookupMaster(index,code,name){return index.byCode.get(normalizeCustomerValue(code))||index.byName.get(normalizeCustomerValue(name))||{};}
function sameCustomer(row,code,name){
  const wantedCode=normalizeCustomerValue(code),rowCode=normalizeCustomerValue(row?.customerCode||row?.customer_code||row?.customer_external_id),wantedName=normalizeCustomerValue(name),rowName=normalizeCustomerValue(row?.customer||row?.customerName||row?.customer_name);
  return Boolean(wantedCode&&rowCode&&wantedCode===rowCode||wantedName&&rowName===wantedName);
}
function ownershipHistory(analysis,base,code,name){return[...(Array.isArray(base?.sales)?base.sales:[]),...(analysis?.sales||[]).filter(row=>sameCustomer(row,code,name))];}
function reportCustomerCandidates(type,analyticsRows,activityRows){
  const candidates=new Map(),add=(code,name,source)=>{const key=normalizeCustomerValue(code)||`name:${normalizeCustomerValue(name)}`;if(!key)return;const current=candidates.get(key)||{code:clean(code),name:clean(name),sources:[]};current.sources.push(source);if(!current.code&&code)current.code=clean(code);if(!current.name&&name)current.name=clean(name);candidates.set(key,current);};
  for(const row of analyticsRows||[])if(Number(row.grossSales||0)>0)add(row.code||row.externalId,row.name,'history');
  for(const row of activityRows||[])if(Number(row.sales||0)>0||Number(row.collections||0)>0)add(row.code,row.name,'report');
  return[...candidates.values()];
}
function customerRows(type,analysis,state,analytics,ownershipAnalytics,reportDate){
  const analyticsIndex=indexCustomerAnalytics(analytics?.rows||[]),ownershipIndex=indexCustomerAnalytics(ownershipAnalytics?.rows||[]),activityIndex=buildReportActivityIndex(analysis,type,reportDate),masters=masterIndexes(state.clients),rows=[],crossSectorPurchases=[];
  for(const candidate of reportCustomerCandidates(type,analytics?.rows||[],activityIndex.rows)){
    const base=lookupCustomer(analyticsIndex,candidate.code,candidate.name)||{},activity=lookupActivity(activityIndex,candidate.code,candidate.name),settlement=settleCustomerAccount(base,activity,{reportDate}),hasSectionSales=Number(base.grossSales||0)+Number(activity.sales||0)>0;
    if(!hasSectionSales||(!(settlement.remainingPriorSales>0||settlement.remainingCurrent>0)&&!settlement.hasReportActivity))continue;
    const master=lookupMaster(masters,candidate.code,candidate.name),code=clean(master?.code||master?.cr||candidate.code||base.code||base.externalId),name=clean(master?.name||candidate.name||base.name)||code||'عميل غير مسمى',ownershipBase=lookupCustomer(ownershipIndex,code,name)||{},owner=resolveCustomerPortfolioOwner({customer:{segment:ownershipBase.segment,...master},employees:state.employees,historySales:ownershipHistory(analysis,ownershipBase,code,name),fallbackSector:type}),items=[...new Set([...(activity.items||[]),...(Array.isArray(base.products)?base.products:[])])];
    if(owner.sector!==type){
      if(Number(activity.sales||0)>0)crossSectorPurchases.push({
        name,code,phone:clean(master?.tel||master?.phone||base.phone),ownerSector:owner.sector,ownerSectorLabel:portfolioSectorLabel(owner.sector),ownerEmployeeName:clean(owner.employee?.name||owner.employee?.full_name),ownerSource:owner.source,sellingSector:type,amount:Number(activity.sales||0),quantity:(activity.invoices||[]).reduce((sum,row)=>sum+Number(row.quantity||0),0),item:[...(activity.items||[])].join('، '),invoices:activity.invoices||[]
      });
      continue;
    }
    rows.push({
      ...settlement,name,code,registry:clean(master?.cr||master?.nationalId||master?.registry||code),phone:clean(master?.tel||master?.phone||base.phone),segment:type==='block'?'بلوك':'خرسانة',creditLimit:Number(master?.cap??base.creditLimit??state.cap??0)||0,
      item:items.slice(0,2).join('، '),quantity:(activity.invoices||[]).reduce((sum,row)=>sum+Number(row.quantity||0),0),
      sales:settlement.previousBalance+settlement.reportSales,paid:settlement.reportCollections,outstanding:settlement.finalDebt,
      previousBalance:settlement.previousBalance,reportSales:settlement.reportSales,reportCollections:settlement.reportCollections,paidCurrent:settlement.paidCurrent,paidPrevious:settlement.paidPrevious,finalBalance:settlement.finalDebt,
      reportSaleDate:activity.lastSale||'',reportCollectionDate:activity.lastCollection||'',invoiceDetails:activity.invoices||[],collectionDetails:activity.collectionRows||[]
    });
  }
  rows.sort((a,b)=>Number(b.hasReportActivity)-Number(a.hasReportActivity)||b.finalDebt-a.finalDebt||a.name.localeCompare(b.name,'ar'));
  crossSectorPurchases.sort((a,b)=>b.amount-a.amount||a.name.localeCompare(b.name,'ar'));
  return{customers:rows,crossSectorPurchases};
}
function summaryPage({type,rows,totals,employee,reportDate,sourceFile,logoUrl,documentRef}){
  const department=type==='block'?'البلوك':'الخرسانة',statusCounts=new Map();for(const row of rows)statusCounts.set(row.statusLabel,(statusCounts.get(row.statusLabel)||0)+1);
  const alerts=rows.flatMap(row=>(row.alertLabels||[]).map(label=>({name:row.name,code:row.code,label}))).slice(0,18),cards=[['العملاء الأساسيون',totals.customers],['عمليات لعملاء قطاع آخر',totals.crossSectorCount||0],['عملاء جدد',totals.newCustomers],['عملاء قدامى',totals.oldCustomers],['الرصيد السابق',money(totals.previousBalance)],['مبيعات التقرير',money(totals.reportSales)],['منها لعملاء قطاع آخر',money(totals.crossSectorSales||0)],['مبيعات عملاء المحفظة',money(totals.primaryReportSales??totals.reportSales)],['سداد التقرير',money(totals.reportCollections)],['المسدد من المشتريات',money(totals.paidCurrent)],['المسدد من السابق',money(totals.paidPrevious)],['الرصيد النهائي',money(totals.finalDebt)],['الدفعات المقدمة',money(totals.finalAdvance)]];
  const statuses=[...statusCounts.entries()].map(([label,count])=>`<tr><td>${esc(label)}</td><td style="text-align:center;font-weight:700">${count}</td></tr>`).join(''),alertRows=alerts.length?alerts.map((row,index)=>`<tr><td>${index+1}</td><td><b>${esc(row.name)}</b><br>${esc(row.code||'بدون رقم')}</td><td>${esc(row.label)}</td></tr>`).join(''):'<tr><td colspan="3" style="text-align:center">لا توجد تنبيهات رقابية في هذا الإصدار</td></tr>';
  return `<div class="doc"><div class="spine"><div class="seal"><img src="${esc(logoUrl)}" alt=""></div><div class="ticks"></div><div class="vref">${esc(documentRef)}</div><div class="vlabel">ملخص رقابي</div></div><div class="body" style="padding:8mm 9mm 6mm"><div style="display:flex;gap:8mm;align-items:center;border-bottom:2.2pt solid #0B2233;padding-bottom:3mm"><img src="${esc(logoUrl)}" style="width:36mm"><div><div style="font-family:'Reem Kufi',Tahoma;font-size:16pt;font-weight:700;color:#0B2233">الملخص الرقابي لإقرار محفظة ${department}</div><div style="font-size:8pt;color:#665F50">${esc(employee.name)} — ${esc(reportDate)} — ${esc(sourceFile)}</div></div></div><div style="display:grid;grid-template-columns:repeat(5,1fr);gap:2mm;margin:5mm 0">${cards.map(([label,value])=>`<div style="border:1pt solid #C6B187;background:#FAF6EE;padding:2.5mm;text-align:center"><div style="font-size:6.5pt;color:#7B725F">${label}</div><div style="font-size:10pt;font-weight:700;color:#0B2233">${value}</div></div>`).join('')}</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:4mm"><div><h3 style="margin:0 0 2mm;color:#0B2233">أعمار المديونية</h3><table style="width:100%;border-collapse:collapse;font-size:8pt"><thead><tr style="background:#0B2233;color:white"><th>الفئة</th><th>المبلغ</th></tr></thead><tbody><tr><td>غير مستحق / حتى 30 يومًا</td><td>${money(totals.aging.current+totals.aging.days1to30)}</td></tr><tr><td>31–60 يومًا</td><td>${money(totals.aging.days31to60)}</td></tr><tr><td>61–90 يومًا</td><td>${money(totals.aging.days61to90)}</td></tr><tr><td>أكثر من 90 يومًا</td><td>${money(totals.aging.days90plus)}</td></tr><tr><td>رصيد افتتاحي غير مؤرّخ</td><td>${money(totals.unagedOpening)}</td></tr></tbody></table></div><div><h3 style="margin:0 0 2mm;color:#0B2233">تصنيف حركة العملاء</h3><table style="width:100%;border-collapse:collapse;font-size:8pt"><thead><tr style="background:#0B2233;color:white"><th>الحالة</th><th>العدد</th></tr></thead><tbody>${statuses}</tbody></table></div></div><h3 style="margin:5mm 0 2mm;color:#0B2233">التنبيهات الرقابية</h3><table style="width:100%;border-collapse:collapse;font-size:7.5pt"><thead><tr style="background:#8A2D20;color:white"><th style="width:8mm">م</th><th style="width:52mm">العميل</th><th>التنبيه</th></tr></thead><tbody>${alertRows}</tbody></table><div style="margin-top:auto;border-top:1pt solid #C6B187;padding-top:2mm;font-size:7pt;color:#655F50">نسخة ثابتة مرتبطة بتاريخ التقرير والمصدر. أي إصدار لاحق لا يغيّر بيانات هذا الإصدار التاريخي.</div></div></div>`;
}
function appendSummary(document,context){return document.replace('</body>',`${summaryPage(context)}</body>`);}

export async function generateCustomerPortfolioPdfs(analysis={},sourceFile='daily-report.xlsx',requestedTypes=['block','concrete'],options={}){
  const types=[...new Set((Array.isArray(requestedTypes)?requestedTypes:[requestedTypes]).map(clean).filter(type=>VALID_TYPES.has(type)))];if(!types.length)throw Object.assign(new Error('حدد إقرار البلوك أو إقرار الخرسانة.'),{status:400,code:'PORTFOLIO_TYPE_REQUIRED'});
  const reportDate=isoDate(options?.reportDate)||await resolveReportDate(analysis,sourceFile),state=await loadAppState(),ownershipAnalytics=options?.ownershipAnalytics||await loadCustomerAnalytics({active:true,role:'admin'},{asOf:reportDate,beforeDate:reportDate}),baseUrl=`${publicBase()}/`,reports=[];
  for(const type of types){
    const rep=findRep(state.employees,type);if(!rep)throw Object.assign(new Error(`لا يوجد موظف نشط بدور ${ROLE_BY_TYPE[type]}؛ تم منع إصدار الإقرار باسم موظف غير صحيح.`),{status:409,code:`PORTFOLIO_${type.toUpperCase()}_REP_NOT_FOUND`});
    const analytics=await loadCustomerAnalytics({active:true,role:ANALYTICS_ROLE[type]},{asOf:reportDate,beforeDate:reportDate}),portfolio=customerRows(type,analysis,state,analytics,ownershipAnalytics,reportDate),rows=portfolio.customers,crossSectorPurchases=portfolio.crossSectorPurchases;if(!rows.length&&!crossSectorPurchases.length)throw Object.assign(new Error(`لا توجد مبيعات ${type==='block'?'بلوك':'خرسانة'} سابقة غير مسددة، ولا مبيعات أو سداد لهذا القسم في التقرير الحالي.`),{status:409,code:`PORTFOLIO_${type.toUpperCase()}_NO_SALES_ACTIVITY`});
    const totals=combinePortfolioTotals(aggregateSettlements(rows),crossSectorPurchases),documentRef=`BHF-${type.toUpperCase()}-${reportDate.replace(/-/g,'')}-TG`,logoUrl=`${baseUrl}assets/branding/binhamid-factory-logo.png`,rendered=renderCustomerPortfolioDeclaration({type,companyName:state.companyName,company:state.company,employee:{name:rep?.name||'',nationalId:digits(rep?.nid||rep?.national_id),role:ROLE_BY_TYPE[type],number:rep?.no||'',phone:rep?.tel||''},customers:rows,crossSectorPurchases,days:state.days,defaultCreditLimit:state.cap,declarationText:CUSTOMER_PORTFOLIO_DECLARATION,extraText:CUSTOMER_PORTFOLIO_EXTRA,ackText:DECLARATION_ACK,authorizedName:state.authorizedName,documentRef,dateGregorian:reportDate,logoUrl,baseUrl}),crossSectorTitle=`عملاء تابعون لقطاع آخر اشتروا من ${type==='block'?'البلوك':'الخرسانة'}`,renderedDocument=rendered.document.replaceAll('مبيعات لعملاء تابعين للقطاع الآخر',crossSectorTitle),enhanced=enhancePortfolioDocument(renderedDocument,{type,rows,employee:rep,reportDate,sourceFile,logoUrl,documentRef}),document=appendSummary(enhanced,{type,rows,totals,employee:rep,reportDate,sourceFile,logoUrl,documentRef}),pdf=await htmlToPdf(document,{filename:`portfolio-${type}-${reportDate}`,landscape:false}),department=type==='block'?'البلوك':'الخرسانة',snapshot={snapshotVersion:SNAPSHOT_VERSION,crossSectorSalesMarker:CROSS_SECTOR_SALES_MARKER,crossSectorSalesIncluded:true,documentType:'customer_portfolio',portfolioType:type,reportDate,sourceFile,sourceBatchId:clean(options?.sourceBatchId),documentRef,employee:{name:rep?.name||'',nationalId:digits(rep?.nid||rep?.national_id),externalId:clean(rep?.id||rep?.external_id)},customers:rows,crossSectorPurchases,totals,primaryCustomerCount:rows.length,crossSectorCount:crossSectorPurchases.length,totalEntryCount:rows.length+crossSectorPurchases.length,createdAt:new Date().toISOString()},customerCount=rows.length,totalEntryCount=rows.length+crossSectorPurchases.length;
    reports.push({type,pdf,filename:`إقرار محفظة عملاء ${department} — ${reportDate}.pdf`,caption:`${icon(type)} إقرار محفظة عملاء ${department} — ${rep.name} — ${reportDate} — ${rows.length} عميل أساسي${crossSectorPurchases.length?` — ${crossSectorPurchases.length} عملية لعملاء القطاع الآخر`:''}`,templateVersion:CUSTOMER_PORTFOLIO_TEXT_VERSION,sourceFile,reportDate,customerCount,primaryCustomerCount:rows.length,crossSectorCount:crossSectorPurchases.length,totalCustomerCount:customerCount,totalEntryCount,employeeExternalId:clean(rep?.id||rep?.external_id),employeeNationalId:digits(rep?.nid||rep?.national_id),summary:totals,snapshot});
  }
  return reports;
}

export async function persistPortfolioReportSnapshot(report={}){
  if(!report?.pdf||!report?.type||!report?.reportDate||!report?.snapshot)return null;
  const base=`portfolio-snapshots/${report.reportDate}/${report.type}`,pdfPath=`${base}.pdf`,snapshotPath=`${base}.json`,pointerPath=`portfolio-documents/latest-daily-${report.type}.json`,pointer={...report.snapshot,pdfPath,snapshotPath,filename:report.filename,customerCount:report.customerCount,crossSectorCount:report.crossSectorCount||0,contentType:'application/pdf'};
  await Promise.all([uploadObject(pdfPath,report.pdf,'application/pdf'),uploadObject(snapshotPath,Buffer.from(JSON.stringify(report.snapshot,null,2),'utf8'),'application/json')]);
  await uploadObject(pointerPath,Buffer.from(JSON.stringify(pointer,null,2),'utf8'),'application/json');
  return pointer;
}

export async function collectPortfolioRows(analysis={},sourceFile='daily-report.xlsx',requestedTypes=['block','concrete'],options={}){
  const types=[...new Set((Array.isArray(requestedTypes)?requestedTypes:[requestedTypes]).map(clean).filter(type=>VALID_TYPES.has(type)))];if(!types.length)throw Object.assign(new Error('حدد قطاع البلوك أو الخرسانة.'),{status:400,code:'PORTFOLIO_TYPE_REQUIRED'});
  const reportDate=isoDate(options?.reportDate)||await resolveReportDate(analysis,sourceFile),state=await loadAppState(),ownershipAnalytics=options?.ownershipAnalytics||await loadCustomerAnalytics({active:true,role:'admin'},{asOf:reportDate,beforeDate:reportDate});
  return Promise.all(types.map(async type=>{const rep=findRep(state.employees,type);if(!rep)throw Object.assign(new Error(`لا يوجد موظف نشط بدور ${ROLE_BY_TYPE[type]}؛ تم منع إصدار الكشف باسم موظف غير صحيح.`),{status:409,code:`PORTFOLIO_${type.toUpperCase()}_REP_NOT_FOUND`});const analytics=await loadCustomerAnalytics({active:true,role:ANALYTICS_ROLE[type]},{asOf:reportDate,beforeDate:reportDate}),portfolio=customerRows(type,analysis,state,analytics,ownershipAnalytics,reportDate),customers=portfolio.customers;return{type,reportDate,companyName:state.companyName,employee:{name:rep?.name||'',nationalId:digits(rep?.nid||rep?.national_id)},customers,crossSectorPurchases:portfolio.crossSectorPurchases,summary:combinePortfolioTotals(aggregateSettlements(customers),portfolio.crossSectorPurchases)};}));
}
