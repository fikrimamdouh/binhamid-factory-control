const amount=value=>{const number=Number(value||0);return Number.isFinite(number)?number:0;};

export const CUSTOMER_PORTFOLIO_TOTALS_VERSION='2026.07.28-cross-sector-sales-v1';

export function combinePortfolioTotals(primaryTotals={},crossSectorPurchases=[]){
  const rows=Array.isArray(crossSectorPurchases)?crossSectorPurchases:[];
  const primaryReportSales=amount(primaryTotals.reportSales);
  const crossSectorSales=rows.reduce((sum,row)=>sum+amount(row?.amount??row?.sales??row?.reportSales),0);
  return{
    ...primaryTotals,
    primaryReportSales,
    crossSectorSales,
    crossSectorCount:rows.length,
    reportSales:primaryReportSales+crossSectorSales
  };
}
