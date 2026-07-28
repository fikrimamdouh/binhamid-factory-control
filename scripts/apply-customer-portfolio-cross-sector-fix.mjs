import fs from 'node:fs';
import path from 'node:path';

const read=file=>fs.readFileSync(file,'utf8');
const write=(file,text)=>fs.writeFileSync(file,text,'utf8');

function replaceExact(file,oldValue,newValue,{optional=false}={}){
  const text=read(file);
  if(text.includes(newValue))return false;
  const count=text.split(oldValue).length-1;
  if(count!==1){
    if(optional&&count===0)return false;
    throw new Error(`${file}: expected one occurrence, found ${count}: ${oldValue.slice(0,120)}`);
  }
  write(file,text.replace(oldValue,newValue));
  return true;
}

function walk(dir){
  const out=[];
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    if(entry.name==='.git'||entry.name==='node_modules'||entry.name==='.vercel')continue;
    const full=path.join(dir,entry.name);
    if(entry.isDirectory())out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function replaceAcross(oldValue,newValue,extensions){
  let changed=0;
  for(const file of walk('.')){
    if(!extensions.has(path.extname(file)))continue;
    const text=read(file);
    if(!text.includes(oldValue))continue;
    write(file,text.split(oldValue).join(newValue));
    changed++;
  }
  return changed;
}

replaceAcross('portfolio-settlement-v3-cross-sector','portfolio-settlement-v4-cross-sector-sales',new Set(['.js','.mjs']));
replaceAcross('2026.07.27-primary-owner-cross-sector-v2','2026.07.28-primary-owner-cross-sector-sales-v3',new Set(['.js','.mjs']));
replaceAcross('exact-portfolio-metadata-bridge.js?v=20260727-primary-owner-1','exact-portfolio-metadata-bridge.js?v=20260728-cross-sector-count-1',new Set(['.html','.js','.mjs']));
replaceAcross('customer-portfolio-range-control.js?v=20260727-primary-owner-2','customer-portfolio-range-control.js?v=20260728-cross-sector-sales-1',new Set(['.html','.js','.mjs']));

replaceExact(
  'shared/customer-portfolio-declaration.js',
  "return sec('٢-أ','مبيعات لعملاء تابعين للقطاع الآخر',",
  "return sec('٢-أ',`عملاء تابعون لقطاع آخر اشتروا من ${model.type==='block'?'البلوك':'الخرسانة'}` ,",
  {optional:true}
);

replaceExact(
  'api/_lib/customer-portfolio-pdf.js',
  "import { portfolioSectorLabel, resolveCustomerPortfolioOwner } from '../../shared/customer-portfolio-ownership.js';\n",
  "import { portfolioSectorLabel, resolveCustomerPortfolioOwner } from '../../shared/customer-portfolio-ownership.js';\nimport { combinePortfolioTotals } from '../../shared/customer-portfolio-totals.js';\n",
  {optional:true}
);
replaceExact('api/_lib/customer-portfolio-pdf.js',"['العملاء',totals.customers]","['العملاء الأساسيون',totals.customers],['عمليات لعملاء قطاع آخر',totals.crossSectorCount||0]",{optional:true});
replaceExact('api/_lib/customer-portfolio-pdf.js',"['مبيعات التقرير',money(totals.reportSales)]","['مبيعات التقرير',money(totals.reportSales)],['منها لعملاء قطاع آخر',money(totals.crossSectorSales||0)],['مبيعات عملاء المحفظة',money(totals.primaryReportSales??totals.reportSales)]",{optional:true});
replaceExact('api/_lib/customer-portfolio-pdf.js','const totals=aggregateSettlements(rows),documentRef=','const totals=combinePortfolioTotals(aggregateSettlements(rows),crossSectorPurchases),documentRef=',{optional:true});
replaceExact('api/_lib/customer-portfolio-pdf.js','customers:rows,crossSectorPurchases,totals,createdAt:new Date().toISOString()','customers:rows,crossSectorPurchases,totals,primaryCustomerCount:rows.length,crossSectorCount:crossSectorPurchases.length,totalEntryCount:rows.length+crossSectorPurchases.length,createdAt:new Date().toISOString()',{optional:true});
replaceExact('api/_lib/customer-portfolio-pdf.js','customerCount=rows.length+crossSectorPurchases.length;','customerCount=rows.length,totalEntryCount=rows.length+crossSectorPurchases.length;',{optional:true});
replaceExact('api/_lib/customer-portfolio-pdf.js','crossSectorCount:crossSectorPurchases.length,totalCustomerCount:customerCount,','crossSectorCount:crossSectorPurchases.length,totalCustomerCount:customerCount,totalEntryCount,',{optional:true});
replaceExact('api/_lib/customer-portfolio-pdf.js','summary:aggregateSettlements(customers)','summary:combinePortfolioTotals(aggregateSettlements(customers),portfolio.crossSectorPurchases)',{optional:true});

replaceExact('api/_lib/bot-portfolio-reports.js','||Number(pointer?.customerCount||0)<=0)return null;','||(Number(pointer?.customerCount||0)<=0&&Number(pointer?.crossSectorCount||0)<=0))return null;',{optional:true});

replaceAcross('2026.07.27-exact-portfolio-metadata-primary-owner-v3','2026.07.28-exact-portfolio-metadata-cross-sector-v4',new Set(['.js']));
replaceExact('assets/exact-portfolio-metadata-bridge.js',"function customerCount(employee,segment){try{const rows=typeof window.clientPortfolioForEmployee==='function'?(window.clientPortfolioForEmployee(employee,segment)||[]):[];return rows.length+(rows.crossSectorPurchases||[]).length;}catch{return 0;}}","function portfolioCounts(employee,segment){try{const rows=typeof window.clientPortfolioForEmployee==='function'?(window.clientPortfolioForEmployee(employee,segment)||[]):[];return{customerCount:rows.length,crossSectorCount:(rows.crossSectorPurchases||[]).length};}catch{return{customerCount:0,crossSectorCount:0};}}",{optional:true});
replaceExact('assets/exact-portfolio-metadata-bridge.js',"return{documentType:'customer_portfolio',portfolioType:kind,periodMode:'daily',periodFrom:reportDate,periodTo:reportDate,reportDate,employeeId:clean(employee.id),employeeName:clean(employee.name),employeeNationalId:digits(employee.nid||employee.iqamaId||employee.nationalId||employee.no),customerCount:customerCount(employee,segment),sector:kind};","const counts=portfolioCounts(employee,segment);return{documentType:'customer_portfolio',portfolioType:kind,periodMode:'daily',periodFrom:reportDate,periodTo:reportDate,reportDate,employeeId:clean(employee.id),employeeName:clean(employee.name),employeeNationalId:digits(employee.nid||employee.iqamaId||employee.nationalId||employee.no),customerCount:counts.customerCount,crossSectorCount:counts.crossSectorCount,sector:kind};",{optional:true});

replaceAcross('2026.07.27-customer-portfolio-primary-owner-cross-sector-v3','2026.07.28-customer-portfolio-cross-sector-sales-v4',new Set(['.js']));
replaceExact('assets/customer-portfolio-range-control.js',"if(bar){const title=bar.querySelector('h1');if(title)title.textContent='مبيعات لعملاء تابعين للقطاع الآخر';body.appendChild(bar);}","if(bar){const sellingLabel=clean(document.getElementById('pcSeg')?.value)==='خرسانة'?'الخرسانة':'البلوك',title=bar.querySelector('h1');if(title)title.textContent=`عملاء تابعون لقطاع آخر اشتروا من ${sellingLabel}`;body.appendChild(bar);}",{optional:true});
replaceExact('assets/customer-portfolio-range-control.js','<span class="t">مبيعات لعملاء تابعين للقطاع الآخر</span>','<span class="t">عملاء تابعون لقطاع آخر اشتروا من ${clean(document.getElementById(\'pcSeg\')?.value)===\'خرسانة\'?\'الخرسانة\':\'البلوك\'}</span>',{optional:true});
replaceExact('assets/customer-portfolio-range-control.js','لا تنشئ هذه العمليات عميلاً جديدًا ولا تنقل العميل من محفظته الأساسية.','تُحتسب هذه العمليات ضمن مبيعات ${clean(document.getElementById(\'pcSeg\')?.value)===\'خرسانة\'?\'الخرسانة\':\'البلوك\'}، ولا تنشئ عميلاً جديدًا ولا تنقل العميل من محفظته الأساسية.',{optional:true});

replaceExact('api/_lib/routes/reports-telegram.js','customerCount=Math.max(0,Math.trunc(Number(value.customerCount||0)));','customerCount=Math.max(0,Math.trunc(Number(value.customerCount||0))),crossSectorCount=Math.max(0,Math.trunc(Number(value.crossSectorCount||0)));',{optional:true});
replaceExact('api/_lib/routes/reports-telegram.js','employeeNationalId:clean(value.employeeNationalId,30),customerCount,sector:','employeeNationalId:clean(value.employeeNationalId,30),customerCount,crossSectorCount,sector:',{optional:true});
replaceExact('api/_lib/routes/reports-telegram.js',"metadata.documentType!=='customer_portfolio'||!metadata.portfolioType||metadata.customerCount<=0","metadata.documentType!=='customer_portfolio'||!metadata.portfolioType||(metadata.customerCount<=0&&metadata.crossSectorCount<=0)",{optional:true});
replaceExact('api/_lib/routes/reports-telegram.js','customerCount:metadata.customerCount,sector:','customerCount:metadata.customerCount,crossSectorCount:metadata.crossSectorCount,sector:',{optional:true});
replaceExact('api/_lib/routes/reports-telegram.js','customerCount:archived.customerCount,pdfPath:','customerCount:archived.customerCount,crossSectorCount:archived.crossSectorCount,pdfPath:',{optional:true});

for(const file of ['shared/customer-portfolio-declaration.js','assets/customer-portfolio-range-control.js']){
  if(read(file).includes('مبيعات لعملاء تابعين للقطاع الآخر'))throw new Error(`Old cross-sector title remains in ${file}`);
}
if(!read('api/_lib/customer-portfolio-pdf.js').includes('combinePortfolioTotals'))throw new Error('Cross-sector totals were not applied.');
console.log('[BinHamid] cross-sector customer portfolio fix applied');
