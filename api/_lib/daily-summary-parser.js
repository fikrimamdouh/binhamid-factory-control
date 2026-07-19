const round=(value,digits=2)=>{const factor=10**digits;return Math.round((Number(value)+Number.EPSILON)*factor)/factor;};
const clean=(value,max=1000)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const westernDigits=value=>String(value??'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d));
const number=value=>{
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  const text=westernDigits(value).replace(/[٬,]/g,'').replace(/٫/g,'.').replace(/[^0-9.+-]/g,'');
  if(!text)return null;
  const parsed=Number(text);return Number.isFinite(parsed)?parsed:null;
};
const norm=value=>clean(value,3000).toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/ؤ/g,'و').replace(/ئ/g,'ي').replace(/ـ/g,'').replace(/\s+/g,' ');
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
    for(let index=start+1;index<Math.min(end,start+8);index++){const detected=salesColumns(rows[index]||[]);if(detected){headerRow=index;columns=detected;break;}}
    if(!columns)columns={invoice:0,quantity:1,customerCode:2,customer:3,item:4,amount:5,terms:6};
    const dataStart=headerRow>=0?headerRow+1:start+1;
    for(let index=dataStart;index<end;index++){
      const row=rows[index]||[];if(repeatedSalesHeader(row))continue;
      const invoiceNumber=number(row[columns.invoice]),quantity=number(row[columns.quantity]),customerCode=columns.customerCode>=0?code(row[columns.customerCode]):'',customer=clean(row[columns.customer],500),item=clean(row[columns.item],500);
      if(invoiceNumber===null||quantity===null||quantity<=0||!customer||!item)continue;
      const candidates=[];if(columns.amount>=0)candidates.push(row[columns.amount]);
      for(let column=0;column<row.length;column++)if(column!==columns.invoice&&column!==columns.quantity&&column!==columns.customerCode&&column!==columns.customer&&column!==columns.item)candidates.push(row[column]);
      const amountValues=candidates.map(number).filter(value=>value!==null&&value>0),amount=amountValues.length?round(amountValues[0],2):0;if(amount<=0)continue;
      sales.push({sheet:sheetName,row:index+1,invoice:String(Math.trunc(invoiceNumber)),quantity:round(quantity,3),customer,customerCode,item,kind:kind(item),amount});
    }
    cursor=Math.max(end,start+1);
  }
  return sales;
}
const isTreasuryRow=row=>includes(row?.[2],'الخزينه','الخزينة')&&number(row?.[3])!==null;
const isCashHeader=row=>headerIndex(row,['مدين'])>=0&&headerIndex(row,['دائن'])>=0&&headerIndex(row,['اسم الحساب'])>=0&&headerIndex(row,['نوع الحساب','توع الحساب'])>=0;
function parseTreasuryCollections(rows,sheetName){
  const collections=[];let treasuryCode='',treasuryName='',columns=null;
  for(let index=0;index<rows.length;index++){
    const row=rows[index]||[],text=rowText(row);
    if(isTreasuryRow(row)){treasuryCode=code(row[3]);treasuryName=clean(row[4],250);columns=null;continue;}
    if(!treasuryCode)continue;
    if(isCashHeader(row)){columns={debit:headerIndex(row,['مدين']),credit:headerIndex(row,['دائن']),client:headerIndex(row,['اسم الحساب']),accountType:headerIndex(row,['نوع الحساب','توع الحساب']),customerCode:headerIndex(row,['رقم الحساب','كود العميل','رقم العميل']),movement:headerIndex(row,['نوع الحركة'])};continue;}
    if(!columns||includes(text,'المجموع','الرصيد النهائي','اول المده','أول المدة'))continue;
    const debit=number(row[columns.debit])||0,credit=number(row[columns.credit])||0,customer=clean(row[columns.client],500),accountType=clean(row[columns.accountType],150),movement=clean(row[columns.movement],180);
    if(debit<=0||credit>0||!customer||!includes(accountType,'عميل')||!includes(movement,'استلام'))continue;
    const customerCode=code(row[columns.customerCode]);if(!customerCode)continue;
    collections.push({sheet:sheetName,row:index+1,customerCode,customer,amount:round(debit,2),treasuryCode,treasuryName});
  }
  return collections;
}
// أقسام المخزون (منتجات تامة/خامات): نفس هيكل الأعمدة — كود الصنف، الصنف،
// الوحدة، الرصيد الافتتاحي، وارد، منصرف، رصيد — لكل من "منتجات تامة" (تحرّك
// البلوك والخرسانة الجاهزة) و"خامات" (أسمنت/بحص/بطحاء...).
const INVENTORY_ALIASES={itemCode:['كود الصنف'],itemName:['الصنف'],unit:['الوحدة','الوحده'],opening:['الرصيد الافتتاحي','الرصيد الأفتتاحي','الرصيد'],received:['وارد'],issued:['منصرف'],closing:['رصيد الصنف','رصيد']};
const isFinishedGoodsTitle=text=>text==='منتجات تامه'||text.startsWith('منتجات تامه');
const isRawMaterialsTitle=text=>text==='خامات'||text.startsWith('خامات ');
function inventoryColumns(row){
  const columns=Object.fromEntries(Object.entries(INVENTORY_ALIASES).map(([key,aliases])=>[key,headerIndex(row,aliases)]));
  return columns.itemCode>=0&&columns.itemName>=0?columns:null;
}
function parseInventorySection(rows,sheetName,titleTest){
  const items=[];let cursor=0;
  while(cursor<rows.length){
    const start=titleIndex(rows,titleTest,cursor);if(start<0)break;
    let end=rows.length;for(let index=start+1;index<rows.length;index++){if(isSectionStop(rowText(rows[index]))){end=index;break;}}
    let headerRow=-1,columns=null;
    for(let index=start+1;index<Math.min(end,start+5);index++){const detected=inventoryColumns(rows[index]||[]);if(detected){headerRow=index;columns=detected;break;}}
    if(columns){
      for(let index=headerRow+1;index<end;index++){
        const row=rows[index]||[];if(inventoryColumns(row))continue;
        const itemCode=code(row[columns.itemCode]),itemName=clean(row[columns.itemName],500);
        if(!itemName)continue;
        const opening=number(row[columns.opening])||0,received=number(row[columns.received])||0,issued=number(row[columns.issued])||0,closingRaw=columns.closing>=0?number(row[columns.closing]):null,closing=closingRaw!==null?closingRaw:round(opening+received-issued,3);
        items.push({sheet:sheetName,row:index+1,itemCode,itemName,unit:clean(row[columns.unit],50),opening:round(opening,3),received:round(received,3),issued:round(issued,3),closing:round(closing,3)});
      }
    }
    cursor=Math.max(end,start+1);
  }
  return items;
}
const unique=(rows,keyFn)=>{const seen=new Set();return rows.filter(row=>{const key=keyFn(row);if(seen.has(key))return false;seen.add(key);return true;});};
export function parseDailyWorkbook(workbook,xlsx){
  const sales=[],collections=[],finishedGoods=[],rawMaterials=[],samples=[];let rowCount=0;
  for(const sheetName of workbook?.SheetNames||[]){
    const rows=xlsx.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,defval:'',raw:false,blankrows:false});rowCount+=rows.length;samples.push(...rows.slice(0,250));sales.push(...parseDirectSales(rows,sheetName));collections.push(...parseTreasuryCollections(rows,sheetName));finishedGoods.push(...parseInventorySection(rows,sheetName,isFinishedGoodsTitle));rawMaterials.push(...parseInventorySection(rows,sheetName,isRawMaterialsTitle));
  }
  const cleanSales=unique(sales,row=>[row.sheet,row.row,row.invoice,row.customerCode,norm(row.item),row.quantity,row.amount].join('|'));
  const cleanCollections=unique(collections,row=>[row.sheet,row.row,row.treasuryCode,row.customerCode,row.amount].join('|'));
  const cleanFinishedGoods=unique(finishedGoods,row=>[row.sheet,row.row,row.itemCode,norm(row.itemName)].join('|'));
  const cleanRawMaterials=unique(rawMaterials,row=>[row.sheet,row.row,row.itemCode,norm(row.itemName)].join('|'));
  const block=cleanSales.filter(row=>row.kind==='بلوك'),concrete=cleanSales.filter(row=>row.kind==='خرسانة');
  return{sales:cleanSales,collections:cleanCollections,finishedGoods:cleanFinishedGoods,rawMaterials:cleanRawMaterials,rowCount,contentText:samples.map(row=>(row||[]).join(' ')).join(' ').slice(0,60000),summary:{invoiceCount:cleanSales.length,salesTotal:round(cleanSales.reduce((sum,row)=>sum+row.amount,0),2),blockSales:round(block.reduce((sum,row)=>sum+row.amount,0),2),concreteSales:round(concrete.reduce((sum,row)=>sum+row.amount,0),2),blockQuantity:round(block.reduce((sum,row)=>sum+row.quantity,0),3),concreteQuantity:round(concrete.reduce((sum,row)=>sum+row.quantity,0),3),collectionCount:cleanCollections.length,collectionTotal:round(cleanCollections.reduce((sum,row)=>sum+row.amount,0),2),finishedGoodsCount:cleanFinishedGoods.length,finishedGoodsIssued:round(cleanFinishedGoods.reduce((sum,row)=>sum+row.issued,0),3),rawMaterialsCount:cleanRawMaterials.length,rawMaterialsReceived:round(cleanRawMaterials.reduce((sum,row)=>sum+row.received,0),3)}};
}
