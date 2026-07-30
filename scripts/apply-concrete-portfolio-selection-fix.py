from pathlib import Path


def require(text: str, marker: str, label: str) -> None:
    if marker not in text:
        raise SystemExit(f"missing marker: {label}")


settlement = Path("api/_lib/customer-settlement.js")
text = settlement.read_text(encoding="utf-8")
marker = "export const customerLookupKey=(code,name)=>{const normalized=normalizeCustomerValue(code);return normalized?`code:${normalized}`:`name:${normalizeCustomerValue(name)||'unknown'}`;};\n"
addition = marker + "\nexport const CONCRETE_ADVANCE_START_DATE='2026-07-20';\nconst collectionMethodText=row=>[row?.paymentMethod,row?.payment_method,row?.method,row?.paymentType,row?.payment_type,row?.treasuryName,row?.treasury_name,row?.note].map(normalizeCustomerValue).filter(Boolean).join(' ');\nexport function isEligibleConcreteAdvanceCollection(row={},cutoff=CONCRETE_ADVANCE_START_DATE){\n  const date=String(row?.date||row?.occurred_at||row?.created_at||row?.movementDate||row?.movement_date||'').slice(0,10),amount=Math.max(0,Number(row?.amount??row?.debit??row?.credit??0)||0),method=collectionMethodText(row);\n  return amount>0&&date>=cutoff&&/(^| )(cash|bank|نقد|كاش|بنك|تحويل|حواله|حوال|ايداع|خزينه|صندوق|شبكه|مدى)( |$)/.test(method);\n}\n"
if "CONCRETE_ADVANCE_START_DATE" not in text:
    require(text, marker, "settlement insertion")
    text = text.replace(marker, addition, 1)
old_collection = "activity.collections=roundMoney(activity.collections+amount);activity.lastCollection=activity.lastCollection>date?activity.lastCollection:date;activity.collectionRows.push({reference,date,amount,treasuryCode:String(row.treasuryCode||row.treasury_code||''),treasuryName:String(row.treasuryName||row.treasury_name||'')});"
new_collection = "const paymentMethod=String(row.paymentMethod||row.payment_method||row.method||row.paymentType||row.payment_type||''),note=String(row.note||row.description||row.details||'');activity.collections=roundMoney(activity.collections+amount);activity.lastCollection=activity.lastCollection>date?activity.lastCollection:date;activity.collectionRows.push({reference,date,amount,paymentMethod,note,treasuryCode:String(row.treasuryCode||row.treasury_code||''),treasuryName:String(row.treasuryName||row.treasury_name||'')});"
require(text, old_collection, "collection row")
text = text.replace(old_collection, new_collection, 1)
old_lookup = "export function lookupCustomer(index={},code='',name=''){\n  const found=index?.byCustomerCode?.get(normalizeCustomerValue(code))||index?.byCustomerName?.get(normalizeCustomerValue(name))||null;\n  if(found)return found;\n  // Any report-day receipt that has no block/concrete history is owned by the\n  // concrete portfolio. A neutral zero-value base lets the receipt become an\n  // advance payment without inventing a sale or changing the customer's debt.\n  if(index?.scope==='concrete')return{grossSales:Number.EPSILON,paidApplied:Number.EPSILON,segment:'concrete',openingBalance:0,unallocatedCredit:0,invoiceCount:0,collectionCount:0,sales:[],aging:{}};\n  return null;\n}"
new_lookup = "export function lookupCustomer(index={},code='',name=''){return index?.byCustomerCode?.get(normalizeCustomerValue(code))||index?.byCustomerName?.get(normalizeCustomerValue(name))||null;}"
require(text, old_lookup, "synthetic concrete customer")
settlement.write_text(text.replace(old_lookup, new_lookup, 1), encoding="utf-8")

ownership = Path("shared/customer-portfolio-ownership.js")
text = ownership.read_text(encoding="utf-8")
text = text.replace("export const CUSTOMER_PORTFOLIO_OWNERSHIP_VERSION='2026.07.30-unclassified-to-concrete-v3';", "export const CUSTOMER_PORTFOLIO_OWNERSHIP_VERSION='2026.07.30-concrete-cash-bank-cutoff-v4';", 1)
old_fallback = "  const fallback=portfolioSector(fallbackSector);\n  // Any account with no reliable block/concrete ownership is carried by the\n  // concrete portfolio so its receipt is preserved as an advance payment.\n  return{sector:'concrete',source:fallback==='concrete'?'current_sale_fallback':'unclassified_to_concrete',employee:null};"
new_fallback = "  const fallback=portfolioSector(fallbackSector);\n  if(fallback)return{sector:fallback,source:'current_sale_fallback',employee:null};\n  return{sector:'',source:'unclassified',employee:null};"
require(text, old_fallback, "ownership fallback")
ownership.write_text(text.replace(old_fallback, new_fallback, 1), encoding="utf-8")

pdf = Path("api/_lib/customer-portfolio-pdf.js")
text = pdf.read_text(encoding="utf-8")
text = text.replace("  lookupCustomer,\n  normalizeCustomerValue,\n  settleCustomerAccount", "  lookupCustomer,\n  normalizeCustomerValue,\n  isEligibleConcreteAdvanceCollection,\n  settleCustomerAccount", 1)
text = text.replace("const SNAPSHOT_VERSION='portfolio-settlement-v3-cross-sector';", "const SNAPSHOT_VERSION='portfolio-settlement-v4-concrete-cash-bank-cutoff';", 1)
helper_marker = "const VALID_TYPES=new Set(['block','concrete']);\n"
helpers = helper_marker + "const emptyAging=()=>({current:0,days1to30:0,days31to60:0,days61to90:0,days90plus:0});\nconst eligibleAdvanceRows=rows=>(Array.isArray(rows)?rows:[]).filter(row=>isEligibleConcreteAdvanceCollection(row));\nconst rowsTotal=rows=>Math.round((rows.reduce((sum,row)=>sum+Math.max(0,Number(row?.amount||0)),0)+Number.EPSILON)*100)/100;\nfunction concreteAdvanceBase(source={},rows=[]){const dates=rows.map(row=>String(row?.date||row?.occurred_at||row?.created_at||'').slice(0,10)).filter(Boolean).sort();return{code:source.code||source.externalId||'',externalId:source.externalId||source.code||'',name:source.name||'عميل غير مسمى',phone:source.phone||'',segment:source.segment||'',creditLimit:Number(source.creditLimit||0),paymentDays:Number(source.paymentDays||0),openingBalance:0,openingCount:0,grossSales:0,paidApplied:0,unallocatedCredit:rowsTotal(rows),collectionCount:rows.length,firstCollection:dates[0]||'',lastCollection:dates[dates.length-1]||'',sales:[],collectionRows:rows,products:[],salesTypes:[],aging:emptyAging()};}\nfunction concreteAdvanceActivity(activity={}){const rows=eligibleAdvanceRows(activity.collectionRows);return{...activity,sales:0,collections:rowsTotal(rows),lastSale:'',lastCollection:rows.map(row=>String(row?.date||'')).filter(Boolean).sort().at(-1)||'',items:new Set(),invoices:[],collectionRows:rows};}\n"
if "function concreteAdvanceBase" not in text:
    require(text, helper_marker, "pdf helpers")
    text = text.replace(helper_marker, helpers, 1)
start = text.index("function reportCustomerCandidates(")
end = text.index("function customerRows(", start)
text = text[:start] + """function reportCustomerCandidates(type,analyticsRows,ownershipRows,activityRows){
  const candidates=new Map(),add=(code,name,source)=>{const key=normalizeCustomerValue(code)||`name:${normalizeCustomerValue(name)}`;if(!key)return;const current=candidates.get(key)||{code:clean(code),name:clean(name),sources:[]};current.sources.push(source);if(!current.code&&code)current.code=clean(code);if(!current.name&&name)current.name=clean(name);candidates.set(key,current);};
  for(const row of analyticsRows||[])if(Number(row.grossSales||0)>0)add(row.code||row.externalId,row.name,'history');
  if(type==='concrete')for(const row of ownershipRows||[])if(eligibleAdvanceRows(row.collectionRows).length)add(row.code||row.externalId,row.name,'advance-history');
  for(const row of activityRows||[]){if(Number(row.sales||0)>0)add(row.code,row.name,'report-sale');else if(type==='concrete'&&eligibleAdvanceRows(row.collectionRows).length)add(row.code,row.name,'advance-report');}
  return[...candidates.values()];
}
""" + text[end:]
start = text.index("function customerRows(")
end = text.index("function summaryPage(", start)
text = text[:start] + """function customerRows(type,analysis,state,analytics,ownershipAnalytics,reportDate){
  const analyticsIndex=indexCustomerAnalytics(analytics?.rows||[]),ownershipIndex=indexCustomerAnalytics(ownershipAnalytics?.rows||[]),activityIndex=buildReportActivityIndex(analysis,type,reportDate),masters=masterIndexes(state.clients),rows=[],crossSectorPurchases=[];
  for(const candidate of reportCustomerCandidates(type,analytics?.rows||[],ownershipAnalytics?.rows||[],activityIndex.rows)){
    const scopedBase=lookupCustomer(analyticsIndex,candidate.code,candidate.name),rawActivity=lookupActivity(activityIndex,candidate.code,candidate.name),master=lookupMaster(masters,candidate.code,candidate.name),seedOwnership=lookupCustomer(ownershipIndex,candidate.code,candidate.name)||{},code=clean(master?.code||master?.cr||candidate.code||scopedBase?.code||scopedBase?.externalId||seedOwnership.code||seedOwnership.externalId),name=clean(master?.name||candidate.name||scopedBase?.name||seedOwnership.name)||code||'عميل غير مسمى',ownershipBase=lookupCustomer(ownershipIndex,code,name)||seedOwnership||{};
    const hasSectionSales=Number(scopedBase?.grossSales||0)+Number(rawActivity.sales||0)>0,historyAdvanceRows=type==='concrete'?eligibleAdvanceRows(ownershipBase.collectionRows):[],reportAdvanceRows=type==='concrete'?eligibleAdvanceRows(rawActivity.collectionRows):[],advanceOnly=type==='concrete'&&!hasSectionSales&&(historyAdvanceRows.length>0||reportAdvanceRows.length>0),owner=resolveCustomerPortfolioOwner({customer:{segment:ownershipBase.segment,...master},employees:state.employees,historySales:ownershipHistory(analysis,ownershipBase,code,name),fallbackSector:Number(rawActivity.sales||0)>0?type:''});
    if(owner.sector!==type&&!(advanceOnly&&owner.sector==='')){
      if(Number(rawActivity.sales||0)>0)crossSectorPurchases.push({name,code,phone:clean(master?.tel||master?.phone||scopedBase?.phone||ownershipBase.phone),ownerSector:owner.sector,ownerSectorLabel:portfolioSectorLabel(owner.sector),ownerEmployeeName:clean(owner.employee?.name||owner.employee?.full_name),ownerSource:owner.source,sellingSector:type,amount:Number(rawActivity.sales||0),quantity:(rawActivity.invoices||[]).reduce((sum,row)=>sum+Number(row.quantity||0),0),item:[...(rawActivity.items||[])].join('، '),invoices:rawActivity.invoices||[]});
      continue;
    }
    if(!hasSectionSales&&!advanceOnly)continue;
    const base=advanceOnly?concreteAdvanceBase(ownershipBase,historyAdvanceRows):(scopedBase||{}),activity=advanceOnly?concreteAdvanceActivity(rawActivity):rawActivity,settlement=settleCustomerAccount(base,activity,{reportDate});
    if(!advanceOnly&&(!(settlement.remainingPriorSales>0||settlement.remainingCurrent>0)&&!settlement.hasReportActivity))continue;
    if(advanceOnly&&Number(settlement.finalAdvance||0)<=0)continue;
    const items=[...new Set([...(activity.items||[]),...(Array.isArray(base.products)?base.products:[])])];
    rows.push({...settlement,name,code,registry:clean(master?.cr||master?.nationalId||master?.registry||code),phone:clean(master?.tel||master?.phone||base.phone),segment:type==='block'?'بلوك':'خرسانة',creditLimit:Number(master?.cap??base.creditLimit??state.cap??0)||0,item:advanceOnly?'دفعة مقدمة — سداد كاش/بنك':items.slice(0,2).join('، '),quantity:(activity.invoices||[]).reduce((sum,row)=>sum+Number(row.quantity||0),0),sales:settlement.grossDue,paid:settlement.reportCollections,outstanding:settlement.finalDebt,previousBalance:settlement.previousBalance,previousCredit:settlement.previousCredit,previousNetBalance:settlement.previousNetBalance,grossDue:settlement.grossDue,reportSales:settlement.reportSales,reportCollections:settlement.reportCollections,paidCurrent:settlement.paidCurrent,paidPrevious:settlement.paidPrevious,finalBalance:settlement.finalDebt,reportSaleDate:activity.lastSale||'',reportCollectionDate:activity.lastCollection||'',invoiceDetails:activity.invoices||[],collectionDetails:activity.collectionRows||[],advanceOnly});
  }
  rows.sort((a,b)=>Number(b.hasReportActivity)-Number(a.hasReportActivity)||b.finalDebt-a.finalDebt||a.name.localeCompare(b.name,'ar'));
  crossSectorPurchases.sort((a,b)=>b.amount-a.amount||a.name.localeCompare(b.name,'ar'));
  return{customers:rows,crossSectorPurchases};
}
""" + text[end:]
text = text.replace("if(!rows.length&&!crossSectorPurchases.length)", "if(!allRows.length&&!crossSectorPurchases.length)", 1)
text = text.replace("const totals=combinePortfolioTotals(aggregateSettlements(rows),crossSectorPurchases)", "const totals=combinePortfolioTotals(aggregateSettlements(allRows),crossSectorPurchases)", 1)
text = text.replace("document=appendSummary(enhanced,{type,rows,totals", "document=appendSummary(enhanced,{type,rows:allRows,totals", 1)
text = text.replace("totalEntryCount:rows.length+crossSectorPurchases.length", "totalEntryCount:allRows.length+crossSectorPurchases.length", 1)
text = text.replace("totalEntryCount=rows.length+crossSectorPurchases.length", "totalEntryCount=allRows.length+crossSectorPurchases.length", 1)
pdf.write_text(text, encoding="utf-8")

document = Path("api/_lib/customer-portfolio-document.js")
text = document.read_text(encoding="utf-8")
old_note = "السداد غير المصنف بلوك أو خرسانة يثبت في محفظة الخرسانة كدفعة مقدمة."
new_note = "السداد غير المصنف بلوك أو خرسانة لا يدخل محفظة الخرسانة إلا إذا كان كاشًا أو بنكًا بتاريخ 20/07/2026 أو بعده، ويثبت حينها كدفعة مقدمة."
require(text, old_note, "portfolio document note")
document.write_text(text.replace(old_note, new_note, 1), encoding="utf-8")

for path in ["shared/canonical-declaration-texts.js", "shared/customer-portfolio-declaration.js"]:
    p = Path(path)
    t = p.read_text(encoding="utf-8")
    p.write_text(t.replace("2026.07.30-accounting-columns-signature-v4", "2026.07.30-concrete-cash-bank-cutoff-v5"), encoding="utf-8")
