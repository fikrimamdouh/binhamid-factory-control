import fs from 'node:fs';

const DATA_FILE = 'api/_lib/bot-customer-report-data.js';
const PORTFOLIO_FILE = 'api/_lib/customer-portfolio-pdf.js';
const VERSION = '2026.07.30-customer-balance-final-v2';

function replaceRequired(text, oldValue, newValue, label) {
  if (!text.includes(oldValue)) throw new Error(`Missing customer balance patch marker: ${label}`);
  return text.replace(oldValue, newValue);
}

function patchCustomerAnalytics() {
  let source = fs.readFileSync(DATA_FILE, 'utf8');
  if (source.includes(`CUSTOMER_BALANCE_FINALIZATION_VERSION='${VERSION}'`)) return;

  const previousVersion = /const CUSTOMER_BALANCE_FINALIZATION_VERSION='[^']+';\n?/;
  if (previousVersion.test(source)) {
    source = source.replace(previousVersion, `const CUSTOMER_BALANCE_FINALIZATION_VERSION='${VERSION}';\n`);
    fs.writeFileSync(DATA_FILE, source, 'utf8');
    return;
  }

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
  const requiredSnapshot = "const SNAPSHOT_VERSION='portfolio-settlement-v4-concrete-cash-bank-cutoff';";
  const requiredRule = 'isEligibleConcreteAdvanceCollection';
  if (!source.includes(requiredSnapshot) || !source.includes(requiredRule)) {
    throw new Error('Concrete portfolio cash/bank cutoff fix is missing; build stopped to prevent publishing the old customer-selection logic.');
  }

  const marker = "const CROSS_SECTOR_SALES_MARKER='2026.07.28-cross-sector-sales-v1';";
  const versionPattern = /const CUSTOMER_BALANCE_FINALIZATION_VERSION='[^']+';\n?/;
  if (versionPattern.test(source)) {
    source = source.replace(versionPattern, `const CUSTOMER_BALANCE_FINALIZATION_VERSION='${VERSION}';\n`);
  } else {
    source = replaceRequired(
      source,
      marker,
      `${marker}\nconst CUSTOMER_BALANCE_FINALIZATION_VERSION='${VERSION}';`,
      'portfolio version'
    );
  }

  fs.writeFileSync(PORTFOLIO_FILE, source, 'utf8');
}

patchCustomerAnalytics();
patchPortfolioGeneration();
console.log(`Customer balance finalization applied without replacing concrete portfolio selection: ${VERSION}`);
