from pathlib import Path


def replace_exact(path, old, new, expected=1):
    file = Path(path)
    text = file.read_text(encoding='utf-8')
    count = text.count(old)
    if count != expected:
        raise SystemExit(f'{path}: expected {expected} occurrence(s), found {count}: {old[:100]}')
    file.write_text(text.replace(old, new), encoding='utf-8')


def replace_token_across(old, new, suffixes):
    hits = 0
    for file in Path('.').rglob('*'):
        if not file.is_file() or file.suffix not in suffixes or '.git' in file.parts:
            continue
        text = file.read_text(encoding='utf-8')
        count = text.count(old)
        if count:
            file.write_text(text.replace(old, new), encoding='utf-8')
            hits += count
    if hits == 0:
        raise SystemExit(f'No occurrences found for token: {old}')
    print(f'Replaced {hits} occurrence(s): {old} -> {new}')


replace_token_across('portfolio-settlement-v3-cross-sector', 'portfolio-settlement-v4-cross-sector-sales', {'.js', '.mjs'})
replace_token_across('2026.07.27-primary-owner-cross-sector-v2', '2026.07.28-primary-owner-cross-sector-sales-v3', {'.js', '.mjs'})
replace_token_across('exact-portfolio-metadata-bridge.js?v=20260727-primary-owner-1', 'exact-portfolio-metadata-bridge.js?v=20260728-cross-sector-count-1', {'.html', '.mjs', '.js'})
replace_token_across('customer-portfolio-range-control.js?v=20260727-primary-owner-2', 'customer-portfolio-range-control.js?v=20260728-cross-sector-sales-1', {'.html', '.mjs', '.js'})

replace_exact(
    'shared/customer-portfolio-declaration.js',
    "return sec('٢-أ','مبيعات لعملاء تابعين للقطاع الآخر',",
    "return sec('٢-أ',`عملاء تابعون لقطاع آخر اشتروا من ${model.type==='block'?'البلوك':'الخرسانة'}` ,"
)

Path('shared/customer-portfolio-totals.js').write_text("""const amount=value=>{const number=Number(value||0);return Number.isFinite(number)?number:0;};

export const CUSTOMER_PORTFOLIO_TOTALS_VERSION='2026.07.28-cross-sector-sales-v1';

export function combinePortfolioTotals(primaryTotals={},crossSectorPurchases=[]){
  const primaryReportSales=amount(primaryTotals.reportSales),crossSectorSales=(Array.isArray(crossSectorPurchases)?crossSectorPurchases:[]).reduce((sum,row)=>sum+amount(row?.amount??row?.sales??row?.reportSales),0);
  return{...primaryTotals,primaryReportSales,crossSectorSales,crossSectorCount:Array.isArray(crossSectorPurchases)?crossSectorPurchases.length:0,reportSales:primaryReportSales+crossSectorSales};
}
""", encoding='utf-8')

replace_exact(
    'api/_lib/customer-portfolio-pdf.js',
    "import { portfolioSectorLabel, resolveCustomerPortfolioOwner } from '../../shared/customer-portfolio-ownership.js';\n",
    "import { portfolioSectorLabel, resolveCustomerPortfolioOwner } from '../../shared/customer-portfolio-ownership.js';\nimport { combinePortfolioTotals } from '../../shared/customer-portfolio-totals.js';\n"
)
replace_exact('api/_lib/customer-portfolio-pdf.js', "['العملاء',totals.customers]", "['العملاء الأساسيون',totals.customers],['عمليات لعملاء قطاع آخر',totals.crossSectorCount||0]")
replace_exact('api/_lib/customer-portfolio-pdf.js', "['مبيعات التقرير',money(totals.reportSales)]", "['مبيعات التقرير',money(totals.reportSales)],['منها لعملاء قطاع آخر',money(totals.crossSectorSales||0)],['مبيعات عملاء المحفظة',money(totals.primaryReportSales??totals.reportSales)]")
replace_exact('api/_lib/customer-portfolio-pdf.js', 'const totals=aggregateSettlements(rows),documentRef=', 'const totals=combinePortfolioTotals(aggregateSettlements(rows),crossSectorPurchases),documentRef=')
replace_exact('api/_lib/customer-portfolio-pdf.js', 'customers:rows,crossSectorPurchases,totals,createdAt:new Date().toISOString()', 'customers:rows,crossSectorPurchases,totals,primaryCustomerCount:rows.length,crossSectorCount:crossSectorPurchases.length,totalEntryCount:rows.length+crossSectorPurchases.length,createdAt:new Date().toISOString()')
replace_exact('api/_lib/customer-portfolio-pdf.js', 'customerCount=rows.length+crossSectorPurchases.length;', 'customerCount=rows.length,totalEntryCount=rows.length+crossSectorPurchases.length;')
replace_exact('api/_lib/customer-portfolio-pdf.js', 'crossSectorCount:crossSectorPurchases.length,totalCustomerCount:customerCount,', 'crossSectorCount:crossSectorPurchases.length,totalCustomerCount:customerCount,totalEntryCount,')
replace_exact('api/_lib/customer-portfolio-pdf.js', 'summary:aggregateSettlements(customers)', 'summary:combinePortfolioTotals(aggregateSettlements(customers),portfolio.crossSectorPurchases)')

replace_exact('api/_lib/bot-portfolio-reports.js', '||Number(pointer?.customerCount||0)<=0)return null;', '||(Number(pointer?.customerCount||0)<=0&&Number(pointer?.crossSectorCount||0)<=0))return null;')

replace_token_across('2026.07.27-exact-portfolio-metadata-primary-owner-v3', '2026.07.28-exact-portfolio-metadata-cross-sector-v4', {'.js'})
replace_exact('assets/exact-portfolio-metadata-bridge.js', "function customerCount(employee,segment){try{const rows=typeof window.clientPortfolioForEmployee==='function'?(window.clientPortfolioForEmployee(employee,segment)||[]):[];return rows.length+(rows.crossSectorPurchases||[]).length;}catch{return 0;}}", "function portfolioCounts(employee,segment){try{const rows=typeof window.clientPortfolioForEmployee==='function'?(window.clientPortfolioForEmployee(employee,segment)||[]):[];return{customerCount:rows.length,crossSectorCount:(rows.crossSectorPurchases||[]).length};}catch{return{customerCount:0,crossSectorCount:0};}}")
replace_exact('assets/exact-portfolio-metadata-bridge.js', "return{documentType:'customer_portfolio',portfolioType:kind,periodMode:'daily',periodFrom:reportDate,periodTo:reportDate,reportDate,employeeId:clean(employee.id),employeeName:clean(employee.name),employeeNationalId:digits(employee.nid||employee.iqamaId||employee.nationalId||employee.no),customerCount:customerCount(employee,segment),sector:kind};", "const counts=portfolioCounts(employee,segment);return{documentType:'customer_portfolio',portfolioType:kind,periodMode:'daily',periodFrom:reportDate,periodTo:reportDate,reportDate,employeeId:clean(employee.id),employeeName:clean(employee.name),employeeNationalId:digits(employee.nid||employee.iqamaId||employee.nationalId||employee.no),customerCount:counts.customerCount,crossSectorCount:counts.crossSectorCount,sector:kind};")

replace_token_across('2026.07.27-customer-portfolio-primary-owner-cross-sector-v3', '2026.07.28-customer-portfolio-cross-sector-sales-v4', {'.js'})
replace_exact('assets/customer-portfolio-range-control.js', "if(bar){const title=bar.querySelector('h1');if(title)title.textContent='مبيعات لعملاء تابعين للقطاع الآخر';body.appendChild(bar);}", "if(bar){const sellingLabel=clean(document.getElementById('pcSeg')?.value)==='خرسانة'?'الخرسانة':'البلوك',title=bar.querySelector('h1');if(title)title.textContent=`عملاء تابعون لقطاع آخر اشتروا من ${sellingLabel}`;body.appendChild(bar);}")
replace_exact('assets/customer-portfolio-range-control.js', '<span class="t">مبيعات لعملاء تابعين للقطاع الآخر</span>', '<span class="t">عملاء تابعون لقطاع آخر اشتروا من ${clean(document.getElementById(\'pcSeg\')?.value)===\'خرسانة\'?\'الخرسانة\':\'البلوك\'}</span>')
replace_exact('assets/customer-portfolio-range-control.js', 'لا تنشئ هذه العمليات عميلاً جديدًا ولا تنقل العميل من محفظته الأساسية.', 'تُحتسب هذه العمليات ضمن مبيعات ${clean(document.getElementById(\'pcSeg\')?.value)===\'خرسانة\'?\'الخرسانة\':\'البلوك\'}، ولا تنشئ عميلاً جديدًا ولا تنقل العميل من محفظته الأساسية.')

replace_exact('api/_lib/routes/reports-telegram.js', 'customerCount=Math.max(0,Math.trunc(Number(value.customerCount||0)));', 'customerCount=Math.max(0,Math.trunc(Number(value.customerCount||0))),crossSectorCount=Math.max(0,Math.trunc(Number(value.crossSectorCount||0)));')
replace_exact('api/_lib/routes/reports-telegram.js', 'employeeNationalId:clean(value.employeeNationalId,30),customerCount,sector:', 'employeeNationalId:clean(value.employeeNationalId,30),customerCount,crossSectorCount,sector:')
replace_exact('api/_lib/routes/reports-telegram.js', "metadata.documentType!=='customer_portfolio'||!metadata.portfolioType||metadata.customerCount<=0", "metadata.documentType!=='customer_portfolio'||!metadata.portfolioType||(metadata.customerCount<=0&&metadata.crossSectorCount<=0)")
replace_exact('api/_lib/routes/reports-telegram.js', 'customerCount:metadata.customerCount,sector:', 'customerCount:metadata.customerCount,crossSectorCount:metadata.crossSectorCount,sector:')
replace_exact('api/_lib/routes/reports-telegram.js', 'customerCount:archived.customerCount,pdfPath:', 'customerCount:archived.customerCount,crossSectorCount:archived.crossSectorCount,pdfPath:')

replace_exact('tests/customer-portfolio-ownership.test.mjs', 'assert.match(rendered.document,/مبيعات لعملاء تابعين للقطاع الآخر/);', 'assert.match(rendered.document,/عملاء تابعون لقطاع آخر اشتروا من البلوك/);\n  assert.doesNotMatch(rendered.document,/مبيعات لعملاء تابعين للقطاع الآخر/);')

Path('tests/customer-portfolio-cross-sector-sales.test.mjs').write_text("""import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { combinePortfolioTotals } from '../shared/customer-portfolio-totals.js';
import { renderCustomerPortfolioDeclaration } from '../shared/customer-portfolio-declaration.js';

const read=path=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('cross-sector invoice increases sector sales without changing primary customer count or debt',()=>{
  const primary={customers:1,reportSales:100,finalDebt:60,reportCollections:40};
  const totals=combinePortfolioTotals(primary,[{amount:900}]);
  assert.equal(totals.customers,1);
  assert.equal(totals.primaryReportSales,100);
  assert.equal(totals.crossSectorSales,900);
  assert.equal(totals.reportSales,1000);
  assert.equal(totals.finalDebt,60);
  assert.equal(totals.reportCollections,40);
});

test('cross-sector heading follows the selling sector in both directions',()=>{
  const block=renderCustomerPortfolioDeclaration({type:'block',customers:[],crossSectorPurchases:[{name:'عميل خرسانة',amount:900}],dateGregorian:'2026-07-26'}).document;
  const concrete=renderCustomerPortfolioDeclaration({type:'concrete',customers:[],crossSectorPurchases:[{name:'عميل بلوك',amount:1200}],dateGregorian:'2026-07-26'}).document;
  assert.match(block,/عملاء تابعون لقطاع آخر اشتروا من البلوك/);
  assert.match(concrete,/عملاء تابعون لقطاع آخر اشتروا من الخرسانة/);
});

test('server snapshot keeps customers and cross-sector operations as separate counts',()=>{
  const source=read('api/_lib/customer-portfolio-pdf.js');
  const bot=read('api/_lib/bot-portfolio-reports.js');
  const archive=read('api/_lib/routes/reports-telegram.js');
  assert.match(source,/customerCount=rows\.length,totalEntryCount=rows\.length\+crossSectorPurchases\.length/);
  assert.match(source,/crossSectorCount:crossSectorPurchases\.length,totalCustomerCount:customerCount,totalEntryCount/);
  assert.match(bot,/customerCount\|\|0\)<=0&&Number\(pointer\?\.crossSectorCount\|\|0\)<=0/);
  assert.match(archive,/metadata\.customerCount<=0&&metadata\.crossSectorCount<=0/);
});
""", encoding='utf-8')

for path in ['shared/customer-portfolio-declaration.js', 'assets/customer-portfolio-range-control.js', 'api/_lib/customer-portfolio-pdf.js']:
    if 'مبيعات لعملاء تابعين للقطاع الآخر' in Path(path).read_text(encoding='utf-8'):
        raise SystemExit(f'Old generic cross-sector title remains in {path}')
