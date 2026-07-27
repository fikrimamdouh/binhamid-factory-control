const round=(value,digits=2)=>{const factor=10**digits;return Math.round((Number(value)+Number.EPSILON)*factor)/factor;};
const clean=(value,max=1000)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const westernDigits=value=>String(value??'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
const number=value=>{
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  const text=westernDigits(value).replace(/[٬,]/g,'').replace(/٫/g,'.').replace(/[^0-9.+-]/g,'');
  if(!text)return null;
  const parsed=Number(text);return Number.isFinite(parsed)?parsed:null;
};
const norm=value=>clean(value,3000).toLowerCase().replace(/[أإآٱ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/ؤ/g,'و').replace(/ئ/g,'ي').replace(/[ً-ْـ]/g,'').replace(/\s+/g,' ');
const rowText=row=>norm((row||[]).filter(value=>value!==null&&value!==undefined&&value!=='').join(' '));
const includes=(value,...terms)=>terms.some(term=>norm(value).includes(norm(term)));
const code=value=>westernDigits(clean(value,100)).replace(/\.0+$/,'');
const kind=item=>includes(item,'خرسانه','خرسانة')?'خرسانة':includes(item,'بلك','بلوك')?'بلوك':'غير محدد';
const titleIndex=(rows,predicate,from=0)=>{for(let index=from;index<rows.length;index++)if(predicate(rowText(rows[index]),rows[index]||[]))return index;return -1;};
const isSalesTitle=text=>text==='المبيعات'||text==='مبيعات'||text.startsWith('المبيعات ');
const isSectionStop=text=>includes(text,'منتجات تامه','منتجات تامة','خامات','حركه الخزن','حركة الخزن','ما تم فرزه','ماتم فرزه','تحصيلات العملاء');
const headerIndex=(row,aliases)=>{
  const normalized=(row||[]).map(norm),terms=aliases.map(norm);
  for(let index=0;index<normalized.length;index++)if(terms.some(term=>normalized[index]===term))return index;
  for(let index=0;index<normalized.length;index++)if(terms.some(term=>normalized[index].includes(term)))return index;
  return -1;
};
const dateValue=(value,allowSerial=false)=>{
  if(value instanceof Date&&!Number.isNaN(value.getTime()))return value.toISOString().slice(0,10);
  const numeric=typeof value==='number'?value:Number(westernDigits(clean(value,80)));
  if(allowSerial&&Number.isFinite(numeric)&&numeric>=30000&&numeric<=80000){
    const parsed=new Date(Date.UTC(1899,11,30)+Math.round(numeric)*86400000);
    if(!Number.isNaN(parsed.getTime()))return parsed.toISOString().slice(0,10);
  }
  const text=westernDigits(clean(value,80));if(!text)return'';
  let match=text.match(/(20\d{2})[.\/_-](\d{1,2})[.\/_-](\d{1,2})/);
  if(match)return`${match[1]}-${String(match[2]).padStart(2,'0')}-${String(match[3]).padStart(2,'0')}`;
  match=text.match(/(\d{1,2})[.\/_-](\d{1,2})[.\/_-](20\d{2})/);
  if(match)return`${match[3]}-${String(match[2]).padStart(2,'0')}-${String(match[1]).padStart(2,'0')}`;
  match=text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if(match){
    const first=Number(match[1]),second=Number(match[2]),month=first>12?second:first,day=first>12?first:second;
    if(month>=1&&month<=12&&day>=1&&day<=31)return`20${match[3]}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  return'';
};
const dateInRow=row=>{for(const value of row||[]){const parsed=dateValue(value);if(parsed)return parsed;}return'';};
const nearestDate=(rows,index,sheetName='')=>{
  for(let cursor=index;cursor>=Math.max(0,index-8);cursor--){const found=dateInRow(rows[cursor]);if(found)return found;}
  return dateValue(sheetName);
};
const SALES_ALIASES={
  invoice:['رقم الفاتورة','رقم فاتورة','الفاتورة','فاتورة'],quantity:['الكمية','كميه'],customerCode:['كود العميل','رقم العميل','رقم الحساب','كود الزبون'],customer:['اسم العميل','العميل','اسم الحساب','الزبون'],item:['الصنف','اسم الصنف','المنتج','نوع المنتج'],amount:['قيمة المبيعات','قيمه المبيعات','المديونية','المديونيه','المبلغ','الاجمالي','الإجمالي','الصافي'],terms:['نوع البيع','طريقة السداد','طريقه السداد','السداد','آجل']
};
function salesColumns(row){
  const columns=Object.fromEntries(Object.entries(SALES_ALIASES).map(([key,aliases])=>[key,headerIndex(row,aliases)]));
  return columns.invoice>=0&&columns.quantity>=0&&columns.customer>=0&&columns.item>=0?columns:null;
}
const repeatedSalesHeader=row=>Boolean(salesColumns(row));
function parseDirectSales(rows,sheetName){
  const sales=[];let cursor=0;
  while(cursor<rows.length){
    const start=titleIndex(rows,text=>isSalesTitle(text),cursor);if(start<0)break;
    let end=rows.length;for(let index=start+1;index<rows.length;index++){if(isSectionStop(rowText(rows[index]))){end=index;break;}}
    let headerRow=-1,columns=null;
    for(let index=start+1;index<Math.min(end,start+10);index++){const detected=salesColumns(rows[index]||[]);if(detected){headerRow=index;columns=detected;break;}}
    if(!columns)columns={invoice:0,quantity:1,customerCode:2,customer:3,item:4,amount:-1,terms:-1};
    const dataStart=headerRow>=0?headerRow+1:start+1,sectionDate=nearestDate(rows,start,sheetName);
    for(let index=dataStart;index<end;index++){
      const row=rows[index]||[];if(repeatedSalesHeader(row))continue;
      const invoiceNumber=number(row[columns.invoice]),quantity=number(row[columns.quantity]),customerCode=columns.customerCode>=0?code(row[columns.customerCode]):'',customer=clean(row[columns.customer],500),item=clean(row[columns.item],500);
      if(invoiceNumber===null||quantity===null||quantity<=0||!customer||!item)continue;
      const candidates=[];if(columns.amount>=0)candidates.push(row[columns.amount]);
      for(let column=0;column<row.length;column++)if(column!==columns.invoice&&column!==columns.quantity&&column!==columns.customerCode&&column!==columns.customer&&column!==columns.item&&column!==columns.terms)candidates.push(row[column]);
      const amountValues=candidates.map(number).filter(value=>value!==null&&value>0),amount=amountValues.length?round(amountValues[0],2):0;if(amount<=0)continue;
      const trailing=row.slice(5),paymentTerms=columns.terms>=0?clean(row[columns.terms],100):trailing.map(value=>clean(value,100)).find(value=>value&&number(value)===null)||'';
      sales.push({sheet:sheetName,row:index+1,reportDate:dateInRow(row)||sectionDate,invoice:String(Math.trunc(invoiceNumber)),quantity:round(quantity,3),customer,customerCode,item,kind:kind(item),amount,paymentTerms});
    }
    cursor=Math.max(end,start+1);
  }
  return sales;
}
const INVENTORY_ALIASES={itemCode:['كود الصنف'],itemName:['الصنف'],unit:['الوحدة','الوحده'],opening:['الرصيد الافتتاحي','الرصيد الأفتتاحي','الرصيد'],received:['وارد'],issued:['منصرف'],closing:['رصيد الصنف','رصيد']};
const isFinishedGoodsTitle=text=>text==='منتجات تامه'||text==='منتجات تامة'||text.startsWith('منتجات تامه')||text.startsWith('منتجات تامة');
const isRawMaterialsTitle=text=>text==='خامات'||text.startsWith('خامات ');
function inventoryColumns(row){
  const columns=Object.fromEntries(Object.entries(INVENTORY_ALIASES).map(([key,aliases])=>[key,headerIndex(row,aliases)]));
  return columns.itemCode>=0&&columns.itemName>=0?columns:null;
}
function parseInventorySection(rows,sheetName,titleTest){
  const items=[];let cursor=0;
  while(cursor<rows.length){
    const start=titleIndex(rows,titleTest,cursor);if(start<0)break;
    let end=rows.length;for(let index=start+1;index<rows.length;index++){const text=rowText(rows[index]);if(index>start+1&&(isFinishedGoodsTitle(text)||isRawMaterialsTitle(text)||includes(text,'حركه الخزن','حركة الخزن'))){end=index;break;}}
    let headerRow=-1,columns=null;
    for(let index=start+1;index<Math.min(end,start+8);index++){const detected=inventoryColumns(rows[index]||[]);if(detected){headerRow=index;columns=detected;break;}}
    const sectionDate=nearestDate(rows,start,sheetName);
    if(columns){
      for(let index=headerRow+1;index<end;index++){
        const row=rows[index]||[];if(inventoryColumns(row))continue;
        const itemCode=code(row[columns.itemCode]),itemName=clean(row[columns.itemName],500);
        if(!itemCode||!itemName)continue;
        const opening=number(row[columns.opening])||0,received=number(row[columns.received])||0,issued=number(row[columns.issued])||0,closingRaw=columns.closing>=0?number(row[columns.closing]):null,closing=closingRaw!==null?closingRaw:round(opening+received-issued,3);
        items.push({sheet:sheetName,row:index+1,reportDate:dateInRow(row)||sectionDate,itemCode,itemName,unit:clean(row[columns.unit],50),opening:round(opening,3),received:round(received,3),issued:round(issued,3),closing:round(closing,3)});
      }
    }
    cursor=Math.max(end,start+1);
  }
  return items;
}
const isTreasuryRow=row=>includes(row?.[2],'الخزينه','الخزينة')&&number(row?.[3])!==null;
const isCashHeader=row=>headerIndex(row,['مدين'])>=0&&headerIndex(row,['دائن'])>=0&&headerIndex(row,['اسم الحساب'])>=0&&headerIndex(row,['نوع الحساب','توع الحساب'])>=0;
const cashColumns=row=>isCashHeader(row)?{
  debit:headerIndex(row,['مدين']),credit:headerIndex(row,['دائن']),accountName:headerIndex(row,['اسم الحساب']),accountType:headerIndex(row,['نوع الحساب','توع الحساب']),accountCode:headerIndex(row,['رقم الحساب','كود العميل','رقم العميل']),description:headerIndex(row,['البيان']),movementType:headerIndex(row,['نوع الحركة']),voucherNo:headerIndex(row,['رقم الاذن','رقم الإذن','رقم السند']),movementDate:headerIndex(row,['التاريخ','تاريخ الحركة'])
}:null;
function parseTreasurySection(rows,sheetName){
  const movements=[],treasuries=[];let treasuryCode='',treasuryName='',opening=null,columns=null,currentBankCode='',currentBankName='';
  const saveTreasury=closing=>{
    if(!treasuryCode)return;
    const key=[treasuryCode,opening,closing].join('|');
    if(!treasuries.some(row=>[row.treasuryCode,row.opening,row.closing].join('|')===key))treasuries.push({sheet:sheetName,row:0,reportDate:'',treasuryCode,treasuryName,opening:round(opening||0,2),closing:round(closing||0,2)});
  };
  for(let index=0;index<rows.length;index++){
    const row=rows[index]||[],text=rowText(row);
    if(isTreasuryRow(row)){if(treasuryCode&&opening!==null)saveTreasury(opening);treasuryCode=code(row[3]);treasuryName=clean(row[4],250);opening=null;columns=null;continue;}
    if(treasuryCode&&includes(row?.[1],'اول المده','أول المدة','اول المدة')){opening=number(row[0])||0;continue;}
    const detected=cashColumns(row);if(detected){columns=detected;continue;}
    if(!columns)continue;
    if(includes(row?.[3],'الرصيد النهائي')){const closing=number(row[0])||0;saveTreasury(closing);opening=null;continue;}
    if(includes(text,'المجموع')||inventoryColumns(row)||includes(text,'ماتم فرزه','ما تم فرزه'))continue;
    const debit=number(row[columns.debit])||0,credit=number(row[columns.credit])||0;if(debit<=0&&credit<=0)continue;
    const accountName=clean(row[columns.accountName],500),accountType=clean(row[columns.accountType],150),accountCode=code(row[columns.accountCode]),description=clean(row[columns.description],1000),movementType=clean(row[columns.movementType],180),voucherNo=code(row[columns.voucherNo]),movementDate=dateValue(row[columns.movementDate],true)||dateInRow(row),isBank=includes(movementType,'بنك')||includes(accountType,'بنك');
    if(!accountName&&!movementType)continue;
    if(isBank&&includes(accountType,'بنك')&&accountCode){currentBankCode=accountCode;currentBankName=accountName;}
    const effectiveCode=isBank?(currentBankCode||accountCode||'BANK'):treasuryCode,effectiveName=isBank?(currentBankName||'حركات بنكية'):treasuryName;
    const isCustomer=includes(accountType,'عميل'),isCustomerCollection=isCustomer&&debit>0&&credit===0&&includes(movementType,'استلام','مدين','بنك');
    movements.push({sheet:sheetName,row:index+1,reportDate:movementDate,treasuryCode:effectiveCode,treasuryName:effectiveName,debit:round(debit,2),credit:round(credit,2),accountName,accountType,accountCode,description,movementType,voucherNo,movementDate,paymentMethod:isBank?'bank':effectiveCode==='104'?'pos':'cash',isBank,isCustomerCollection});
  }
  return{movements,treasuries};
}
const unique=(rows,keyFn)=>{const seen=new Set();return rows.filter(row=>{const key=keyFn(row);if(seen.has(key))return false;seen.add(key);return true;});};
const fillSingleDate=(rows,dates)=>{if(dates.length!==1)return rows;return rows.map(row=>row.reportDate?row:{...row,reportDate:dates[0]});};
export function parseDailyWorkbook(workbook,xlsx){
  let sales=[],cashMovements=[],treasuries=[],finishedGoods=[],rawMaterials=[];const samples=[];let rowCount=0;
  for(const sheetName of workbook?.SheetNames||[]){
    const rows=xlsx.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,defval:'',raw:false,cellDates:true,blankrows:false});rowCount+=rows.length;samples.push(...rows.slice(0,300));sales.push(...parseDirectSales(rows,sheetName));finishedGoods.push(...parseInventorySection(rows,sheetName,isFinishedGoodsTitle));rawMaterials.push(...parseInventorySection(rows,sheetName,isRawMaterialsTitle));const treasury=parseTreasurySection(rows,sheetName);cashMovements.push(...treasury.movements);treasuries.push(...treasury.treasuries);
  }
  const explicitDates=[...new Set([...sales,...cashMovements,...finishedGoods,...rawMaterials].map(row=>row.reportDate).filter(Boolean))].sort();
  sales=fillSingleDate(sales,explicitDates);cashMovements=fillSingleDate(cashMovements,explicitDates);finishedGoods=fillSingleDate(finishedGoods,explicitDates);rawMaterials=fillSingleDate(rawMaterials,explicitDates);treasuries=fillSingleDate(treasuries,explicitDates);
  const cleanSales=unique(sales,row=>[row.reportDate,row.invoice,row.customerCode,norm(row.item),row.quantity,row.amount].join('|'));
  const cleanCash=unique(cashMovements,row=>[row.movementDate||row.reportDate,row.treasuryCode,row.accountCode,row.voucherNo,norm(row.movementType),row.debit,row.credit].join('|'));
  const cleanTreasuries=unique(treasuries,row=>[row.reportDate,row.treasuryCode,row.opening,row.closing].join('|'));
  const cleanFinishedGoods=unique(finishedGoods,row=>[row.reportDate,row.itemCode,norm(row.itemName),row.opening,row.received,row.issued,row.closing].join('|'));
  const cleanRawMaterials=unique(rawMaterials,row=>[row.reportDate,row.itemCode,norm(row.itemName),row.opening,row.received,row.issued,row.closing].join('|'));
  const collections=cleanCash.filter(row=>row.isCustomerCollection),block=cleanSales.filter(row=>row.kind==='بلوك'),concrete=cleanSales.filter(row=>row.kind==='خرسانة'),reportDates=[...new Set([...explicitDates,...cleanSales.map(row=>row.reportDate),...cleanCash.map(row=>row.movementDate||row.reportDate)].filter(Boolean))].sort();
  return{sales:cleanSales,collections,cashMovements:cleanCash,treasuries:cleanTreasuries,finishedGoods:cleanFinishedGoods,rawMaterials:cleanRawMaterials,reportDates,rowCount,contentText:samples.map(row=>(row||[]).join(' ')).join(' ').slice(0,60000),summary:{invoiceCount:cleanSales.length,salesTotal:round(cleanSales.reduce((sum,row)=>sum+row.amount,0),2),blockSales:round(block.reduce((sum,row)=>sum+row.amount,0),2),concreteSales:round(concrete.reduce((sum,row)=>sum+row.amount,0),2),blockQuantity:round(block.reduce((sum,row)=>sum+row.quantity,0),3),concreteQuantity:round(concrete.reduce((sum,row)=>sum+row.quantity,0),3),collectionCount:collections.length,collectionTotal:round(collections.reduce((sum,row)=>sum+row.debit,0),2),cashMovementCount:cleanCash.length,cashDebitTotal:round(cleanCash.reduce((sum,row)=>sum+row.debit,0),2),cashCreditTotal:round(cleanCash.reduce((sum,row)=>sum+row.credit,0),2),bankMovementCount:cleanCash.filter(row=>row.isBank).length,treasuryCount:cleanTreasuries.length,finishedGoodsCount:cleanFinishedGoods.length,finishedGoodsIssued:round(cleanFinishedGoods.reduce((sum,row)=>sum+row.issued,0),3),rawMaterialsCount:cleanRawMaterials.length,rawMaterialsReceived:round(cleanRawMaterials.reduce((sum,row)=>sum+row.received,0),3)}};
}
