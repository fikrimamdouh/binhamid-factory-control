import fs from 'node:fs';

const DATA_FILE = 'api/_lib/bot-customer-report-data.js';
const PORTFOLIO_FILE = 'api/_lib/customer-portfolio-pdf.js';
const VERSION = '2026.07.30-customer-balance-final-v1';

function replaceRequired(text, oldValue, newValue, label) {
  if (!text.includes(oldValue)) throw new Error(`Missing customer balance patch marker: ${label}`);
  return text.replace(oldValue, newValue);
}

function patchCustomerAnalytics() {
  let source = fs.readFileSync(DATA_FILE, 'utf8');
  if (source.includes(`CUSTOMER_BALANCE_FINALIZATION_VERSION='${VERSION}'`)) return;

  source = replaceRequired(
    source,
    'const PAGE_SIZE=1000;',
    `const PAGE_SIZE=1000;\nconst CUSTOMER_BALANCE_FINALIZATION_VERSION='${VERSION}';`,
    'analytics version'
  );

  source = replaceRequired(
    source,
    "    if(scope==='all'||rowScope==='all'||rowScope===scope)scopedKeys.add(key);",
    "    if(scope==='all'||rowScope===scope||(rowScope==='all'&&scope==='concrete')){scopedKeys.add(key);if(rowScope==='all'&&scope==='concrete')agg.segment='concrete';}",
    'unclassified opening balance ownership'
  );

  const collectionStart = source.indexOf('  for(const row of collections||[]){');
  const collectionEnd = source.indexOf('  let rows=[...aggregates.values()]', collectionStart);
  if (collectionStart < 0 || collectionEnd < 0) throw new Error('Missing customer collection loop');
  const collectionLoop = `  for(const row of collections||[]){
    if(closedStatus.has(String(row.status||'')))continue;
    const key=resolve(row.customer_external_id,row.customer_name,scope==='all'||scope==='concrete'),agg=aggregates.get(key);if(!agg)continue;
    if(scope!=='all'&&!scopedKeys.has(key)){
      const ownerScope=segmentScope(agg.segment),include=ownerScope===scope||(ownerScope==='all'&&scope==='concrete');
      if(!include)continue;
      if(ownerScope==='all'&&scope==='concrete')agg.segment='concrete';
      scopedKeys.add(key);
    }
    const collected=Math.max(0,n(row.amount)),unallocated=Math.max(0,n(row.unallocated_amount)),collectionDate=String(row.occurred_at||row.created_at||'').slice(0,10),reference=String(row.reference_no||'');agg.collections=money(agg.collections+collected);agg.unallocatedCredit=money(agg.unallocatedCredit+unallocated);agg.collectionCount+=1;agg.firstCollection=oldest(agg.firstCollection,collectionDate);agg.lastCollection=newest(agg.lastCollection,collectionDate);agg.collectionRows.push({...row,amount:collected,unallocated});
    const duplicateKey=\`${'${key}'}|${'${norm(reference)}'}|${'${money(collected)}'}|${'${collectionDate}'}\`;if(reference&&collectionKeys.has(duplicateKey))agg.controlAlerts.add('duplicate_collection');if(reference)collectionKeys.add(duplicateKey);
  }
`;
  source = source.slice(0, collectionStart) + collectionLoop + source.slice(collectionEnd);

  source = replaceRequired(
    source,
    "    const overdue=money(item.aging.days1to30+item.aging.days31to60+item.aging.days61to90+item.aging.days90plus),netBalance=money(item.balance-item.unallocatedCredit),debitBalance=Math.max(0,netBalance),creditBalance=Math.max(0,-netBalance),utilization=item.creditLimit>0?debitBalance/item.creditLimit:null;",
    "    const reconciledCollectionCredit=Math.max(0,money(item.collections-item.paidApplied)),effectiveUnallocatedCredit=Math.max(item.unallocatedCredit,reconciledCollectionCredit),overdue=money(item.aging.days1to30+item.aging.days31to60+item.aging.days61to90+item.aging.days90plus),netBalance=money(item.balance-effectiveUnallocatedCredit),debitBalance=Math.max(0,netBalance),creditBalance=Math.max(0,-netBalance),utilization=item.creditLimit>0?debitBalance/item.creditLimit:null;",
    'net balance reconciliation'
  );
  source = replaceRequired(
    source,
    "    return{...item,overdue,netBalance,debitBalance,creditBalance,utilization,decision,customerClass,customerClassLabel:customerClass==='old'?'عميل قديم':'عميل جديد',products:[...item.products].slice(0,12),salesTypes:[...item.salesTypes],controlAlerts:[...item.controlAlerts]};",
    "    return{...item,unallocatedCredit:effectiveUnallocatedCredit,reconciledCollectionCredit,overdue,netBalance,debitBalance,creditBalance,utilization,decision,customerClass,customerClassLabel:customerClass==='old'?'عميل قديم':'عميل جديد',products:[...item.products].slice(0,12),salesTypes:[...item.salesTypes],controlAlerts:[...item.controlAlerts]};",
    'reconciled customer row'
  );

  fs.writeFileSync(DATA_FILE, source, 'utf8');
}

function patchPortfolioGeneration() {
  let source = fs.readFileSync(PORTFOLIO_FILE, 'utf8');
  if (source.includes(`CUSTOMER_BALANCE_FINALIZATION_VERSION='${VERSION}'`)) return;

  source = replaceRequired(
    source,
    "const CROSS_SECTOR_SALES_MARKER='2026.07.28-cross-sector-sales-v1';",
    `const CROSS_SECTOR_SALES_MARKER='2026.07.28-cross-sector-sales-v1';\nconst CUSTOMER_BALANCE_FINALIZATION_VERSION='${VERSION}';`,
    'portfolio version'
  );

  const start = source.indexOf('function reportCustomerCandidates(');
  const end = source.indexOf('function summaryPage(', start);
  if (start < 0 || end < 0) throw new Error('Missing portfolio customer builder');

  const replacement = `function reportCustomerCandidates(type,analyticsRows,activityRows){
  const candidates=new Map(),add=(code,name,source)=>{const key=normalizeCustomerValue(code)||\`name:${'${normalizeCustomerValue(name)}'}\`;if(!key)return;const current=candidates.get(key)||{code:clean(code),name:clean(name),sources:[]};current.sources.push(source);if(!current.code&&code)current.code=clean(code);if(!current.name&&name)current.name=clean(name);candidates.set(key,current);};
  for(const row of analyticsRows||[])if(Number(row.grossSales||0)>0||Number(row.collections||0)>0||Number(row.openingCount||0)>0||Math.abs(Number(row.netBalance||row.openingBalance||0))>0.004||Number(row.unallocatedCredit||0)>0)add(row.code||row.externalId,row.name,'history');
  for(const row of activityRows||[])if(Number(row.sales||0)>0||Number(row.collections||0)>0)add(row.code,row.name,'report');
  return[...candidates.values()];
}
function customerRows(type,analysis,state,analytics,ownershipAnalytics,reportDate){
  const ownershipIndex=indexCustomerAnalytics(ownershipAnalytics?.rows||[]),sectorActivityIndex=buildReportActivityIndex(analysis,type,reportDate),allActivityIndex=buildReportActivityIndex(analysis,'',reportDate),masters=masterIndexes(state.clients),rows=[],crossSectorPurchases=[];
  for(const candidate of reportCustomerCandidates(type,ownershipAnalytics?.rows||[],allActivityIndex.rows)){
    const initialBase=lookupCustomer(ownershipIndex,candidate.code,candidate.name)||{},initialMaster=lookupMaster(masters,candidate.code||initialBase.code||initialBase.externalId,candidate.name||initialBase.name),code=clean(initialMaster?.code||initialMaster?.cr||candidate.code||initialBase.code||initialBase.externalId),name=clean(initialMaster?.name||candidate.name||initialBase.name)||code||'عميل غير مسمى',base=lookupCustomer(ownershipIndex,code,name)||initialBase,master=lookupMaster(masters,code,name),owner=resolveCustomerPortfolioOwner({customer:{segment:base.segment,...master},employees:state.employees,historySales:ownershipHistory(analysis,base,code,name),fallbackSector:'concrete'}),sectorActivity=lookupActivity(sectorActivityIndex,code,name);
    if(owner.sector!==type){
      if(Number(sectorActivity.sales||0)>0)crossSectorPurchases.push({name,code,phone:clean(master?.tel||master?.phone||base.phone),ownerSector:owner.sector,ownerSectorLabel:portfolioSectorLabel(owner.sector),ownerEmployeeName:clean(owner.employee?.name||owner.employee?.full_name),ownerSource:owner.source,sellingSector:type,amount:Number(sectorActivity.sales||0),quantity:(sectorActivity.invoices||[]).reduce((sum,row)=>sum+Number(row.quantity||0),0),item:[...(sectorActivity.items||[])].join('، '),invoices:sectorActivity.invoices||[]});
      continue;
    }
    const activity=lookupActivity(allActivityIndex,code,name),settlement=settleCustomerAccount(base,activity,{reportDate}),hasAccountMovement=Number(base.grossSales||0)>0||Number(base.collections||0)>0||Number(base.openingCount||0)>0||Math.abs(Number(base.openingBalance||base.netBalance||0))>0.004||Number(base.unallocatedCredit||0)>0||Number(activity.sales||0)>0||Number(activity.collections||0)>0;
    if(!hasAccountMovement||(!(settlement.finalDebt>0.004||settlement.finalAdvance>0.004)&&!settlement.hasReportActivity))continue;
    const items=[...new Set([...(activity.items||[]),...(Array.isArray(base.products)?base.products:[])])];
    rows.push({...settlement,name,code,registry:clean(master?.cr||master?.nationalId||master?.registry||code),phone:clean(master?.tel||master?.phone||base.phone),segment:type==='block'?'بلوك':'خرسانة',creditLimit:Number(master?.cap??base.creditLimit??state.cap??0)||0,item:items.slice(0,2).join('، '),quantity:(activity.invoices||[]).reduce((sum,row)=>sum+Number(row.quantity||0),0),sales:settlement.grossDue,paid:settlement.reportCollections,outstanding:settlement.finalDebt,previousBalance:settlement.previousBalance,previousCredit:settlement.previousCredit,previousNetBalance:settlement.previousNetBalance,grossDue:settlement.grossDue,reportSales:settlement.reportSales,reportCollections:settlement.reportCollections,paidCurrent:settlement.paidCurrent,paidPrevious:settlement.paidPrevious,finalBalance:settlement.finalDebt,reportSaleDate:activity.lastSale||'',reportCollectionDate:activity.lastCollection||'',invoiceDetails:activity.invoices||[],collectionDetails:activity.collectionRows||[]});
  }
  rows.sort((a,b)=>Number(b.hasReportActivity)-Number(a.hasReportActivity)||b.finalDebt-a.finalDebt||a.name.localeCompare(b.name,'ar'));
  crossSectorPurchases.sort((a,b)=>b.amount-a.amount||a.name.localeCompare(b.name,'ar'));
  return{customers:rows,crossSectorPurchases};
}
`;
  source = source.slice(0, start) + replacement + source.slice(end);

  source = replaceRequired(
    source,
    "allRows=portfolio.customers,rows=allRows.filter(row=>Number(row.finalDebt||0)>=0.5),crossSectorPurchases=portfolio.crossSectorPurchases;if(!rows.length&&!crossSectorPurchases.length)",
    "allRows=portfolio.customers,rows=allRows.filter(row=>Number(row.finalDebt||0)>=0.5),advanceRows=allRows.filter(row=>Number(row.finalAdvance||0)>=0.5),crossSectorPurchases=portfolio.crossSectorPurchases;if(!rows.length&&!advanceRows.length&&!crossSectorPurchases.length)",
    'advance-only portfolio generation'
  );
  source = replaceRequired(
    source,
    'const totals=combinePortfolioTotals(aggregateSettlements(rows),crossSectorPurchases)',
    'const totals=combinePortfolioTotals(aggregateSettlements(allRows),crossSectorPurchases)',
    'all customer totals'
  );

  const collectStart = source.indexOf('export async function collectPortfolioRows(');
  if (collectStart < 0) throw new Error('Missing collectPortfolioRows');
  const collect = `export async function collectPortfolioRows(analysis={},sourceFile='daily-report.xlsx',requestedTypes=['block','concrete'],options={}){
  const types=[...new Set((Array.isArray(requestedTypes)?requestedTypes:[requestedTypes]).map(clean).filter(type=>VALID_TYPES.has(type)))];if(!types.length)throw Object.assign(new Error('حدد قطاع البلوك أو الخرسانة.'),{status:400,code:'PORTFOLIO_TYPE_REQUIRED'});
  const reportDate=isoDate(options?.reportDate)||await resolveReportDate(analysis,sourceFile),state=await loadAppState(),ownershipAnalytics=options?.ownershipAnalytics||await loadCustomerAnalytics({active:true,role:'admin'},{asOf:reportDate,beforeDate:reportDate});
  return Promise.all(types.map(async type=>{const rep=findRep(state.employees,type);if(!rep)throw Object.assign(new Error(\`لا يوجد موظف نشط بدور ${'${ROLE_BY_TYPE[type]}'}؛ تم منع إصدار الكشف باسم موظف غير صحيح.\`),{status:409,code:\`PORTFOLIO_${'${type.toUpperCase()}'}_REP_NOT_FOUND\`});const analytics=await loadCustomerAnalytics({active:true,role:ANALYTICS_ROLE[type]},{asOf:reportDate,beforeDate:reportDate}),portfolio=customerRows(type,analysis,state,analytics,ownershipAnalytics,reportDate),allCustomers=portfolio.customers,customers=allCustomers.filter(row=>Number(row.finalDebt||0)>=0.5);return{type,reportDate,companyName:state.companyName,employee:{name:rep?.name||'',nationalId:digits(rep?.nid||rep?.national_id)},customers,allCustomers,crossSectorPurchases:portfolio.crossSectorPurchases,summary:combinePortfolioTotals(aggregateSettlements(allCustomers),portfolio.crossSectorPurchases)};}));
}
`;
  source = source.slice(0, collectStart) + collect;
  fs.writeFileSync(PORTFOLIO_FILE, source, 'utf8');
}

patchCustomerAnalytics();
patchPortfolioGeneration();
console.log(`Customer balance finalization applied: ${VERSION}`);
