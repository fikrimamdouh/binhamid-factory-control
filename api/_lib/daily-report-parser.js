const round=(value,digits=2)=>{const factor=10**digits;return Math.round((Number(value)+Number.EPSILON)*factor)/factor;};
const clean=(value,max=1000)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const arabicDigits=value=>String(value??'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[٬,]/g,'').replace(/٫/g,'.');
const number=value=>{if(typeof value==='number')return Number.isFinite(value)?value:null;const text=arabicDigits(value).replace(/[^0-9.+-]/g,'');if(!text)return null;const parsed=Number(text);return Number.isFinite(parsed)?parsed:null;};
const normalized=value=>clean(value,2000).toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/ـ/g,'').replace(/\s+/g,' ');
const rowText=row=>normalized((row||[]).filter(value=>value!==null&&value!==undefined&&value!=='').join(' '));
const has=(value,...terms)=>terms.some(term=>normalized(value).includes(normalized(term)));

function locateSections(rows){
  const found={sales:-1,finished:-1,raw:-1,cash:-1};
  rows.forEach((row,index)=>{
    const text=rowText(row);
    if(found.sales<0&&text==='المبيعات')found.sales=index;
    else if(found.finished<0&&has(text,'منتجات تامه','منتجات تامة'))found.finished=index;
    else if(found.raw<0&&text==='خامات')found.raw=index;
    else if(found.cash<0&&has(text,'حركه الخزن','حركة الخزن'))found.cash=index;
  });
  return found;
}

function parseSales(rows,start,end){
  const sales=[];
  const issues=[];
  if(start<0){issues.push({section:'sales',message:'قسم المبيعات غير موجود'});return{sales,issues};}
  for(let index=start+1;index<(end<0?rows.length:end);index++){
    const row=rows[index]||[];
    const invoice=number(row[0]),quantity=number(row[1]),customerCode=clean(row[2],80),customerName=clean(row[3],500),item=clean(row[4],500);
    if(invoice===null||quantity===null||!customerName||!item)continue;
    const amountCandidates=row.slice(5,9).map(number).filter(value=>value!==null&&value>0);
    const amount=amountCandidates.length?round(amountCandidates[0],2):0;
    const terms=row.slice(5,9).map(value=>clean(value,80)).find(value=>value&&number(value)===null)||'';
    const itemKey=normalized(item);
    const salesType=has(itemKey,'خرسانه','خرسانة')?'concrete':has(itemKey,'بلك','بلوك')?'block':'other';
    const rowIssues=[];
    if(!customerCode)rowIssues.push('رقم العميل غير موجود');
    if(!amount)rowIssues.push('قيمة المديونية غير موجودة');
    if(salesType==='other')rowIssues.push('تعذر تحديد بلوك أو خرسانة');
    const record={sourceRowNo:index+1,invoiceNo:String(Math.trunc(invoice)),quantity:round(quantity,3),customerCode,customerName,item,amount,paymentTerms:terms,salesType,unit:salesType==='concrete'?'m3':salesType==='block'?'block':'unit',issues:rowIssues};
    sales.push(record);
    if(rowIssues.length)issues.push({section:'sales',sourceRowNo:index+1,invoiceNo:record.invoiceNo,messages:rowIssues});
  }
  return{sales,issues};
}

function parseInventoryRange(rows,start,end,inventoryType){
  const records=[];
  const seen=new Set();
  if(start<0)return records;
  for(let index=start+1;index<(end<0?rows.length:end);index++){
    const row=rows[index]||[];
    const itemCode=number(row[0]),itemName=clean(row[1],500),unit=clean(row[2],100);
    if(itemCode===null||!itemName)continue;
    const record={sourceRowNo:index+1,inventoryType,itemCode:String(Math.trunc(itemCode)),itemName,unit,opening:round(number(row[3])||0,5),received:round(number(row[4])||0,5),issued:round(number(row[5])||0,5),closing:round(number(row[6])||0,5)};
    const key=JSON.stringify({...record,sourceRowNo:0});if(seen.has(key))continue;seen.add(key);records.push(record);
  }
  return records;
}

function parseCash(rows,start){
  const movements=[];
  const treasuries=[];
  const issues=[];
  if(start<0){issues.push({section:'cash',message:'قسم حركة الخزن غير موجود'});return{movements,treasuries,issues};}
  let treasury=null;
  for(let index=start+1;index<rows.length;index++){
    const row=rows[index]||[];
    const text=rowText(row);
    const treasuryCode=number(row[3]);
    if(has(row[2],'الخزينه','الخزينة')&&treasuryCode!==null){treasury={sourceRowNo:index+1,treasuryCode:String(Math.trunc(treasuryCode)),treasuryName:clean(row[4],300),opening:0,closing:0};treasuries.push(treasury);continue;}
    if(!treasury)continue;
    if(has(row[1],'اول المده','أول المدة')||has(text,'اول المده','أول المدة')){treasury.opening=round(number(row[0])||0,2);continue;}
    if(has(row[3],'الرصيد النهائي')||has(text,'الرصيد النهائي')){treasury.closing=round(number(row[0])||0,2);continue;}
    if(has(text,'المجموع')||has(text,'مدين دائن اسم الحساب'))continue;
    const debit=round(number(row[0])||0,2),credit=round(number(row[1])||0,2),accountName=clean(row[2],500),accountType=clean(row[3],120),accountCode=clean(row[4],100);
    if((debit<=0&&credit<=0)||!accountName)continue;
    const movementType=clean(row[6],180),voucherNo=clean(row[7],100),description=clean(row[5],500),movementDate=clean(row[8],100);
    const isCustomer=has(accountType,'عميل');
    const isCustomerCollection=isCustomer&&debit>0&&has(movementType,'استلام');
    const paymentMethod=treasury.treasuryCode==='104'?'pos':treasury.treasuryCode==='101'?'cash':`treasury_${treasury.treasuryCode}`;
    const record={sourceRowNo:index+1,treasuryCode:treasury.treasuryCode,treasuryName:treasury.treasuryName,debit,credit,accountName,accountType,accountCode,description,movementType,voucherNo,movementDate,paymentMethod,isCustomerCollection};
    movements.push(record);
    if(isCustomerCollection&&!accountCode)issues.push({section:'cash',sourceRowNo:index+1,messages:['تحصيل عميل بدون كود عميل']});
  }
  return{movements,treasuries,issues};
}

export function parseDailyReportRows(rows,sheetName='Sheet1'){
  const sections=locateSections(rows);
  const salesResult=parseSales(rows,sections.sales,sections.finished);
  const finished=parseInventoryRange(rows,sections.finished,sections.raw,'finished_goods');
  const rawMaterials=parseInventoryRange(rows,sections.raw,sections.cash,'raw_material');
  const cashResult=parseCash(rows,sections.cash);
  const collections=cashResult.movements.filter(row=>row.isCustomerCollection).map(row=>({...row,amount:row.debit,customerCode:row.accountCode,customerName:row.accountName}));
  return{sheetName,sections,sales:salesResult.sales,collections,cashMovements:cashResult.movements,treasuries:cashResult.treasuries,inventory:[...finished,...rawMaterials],issues:[...salesResult.issues,...cashResult.issues]};
}

export function summarizeDailyReport(parsed){
  const sales=parsed.sales||[],block=sales.filter(row=>row.salesType==='block'),concrete=sales.filter(row=>row.salesType==='concrete'),validSales=sales.filter(row=>!row.issues.length),collections=parsed.collections||[];
  const sum=(rows,key)=>round(rows.reduce((total,row)=>total+Number(row[key]||0),0),key==='quantity'?3:2);
  return{salesLines:sales.length,uniqueInvoices:new Set(sales.map(row=>row.invoiceNo)).size,validSalesLines:validSales.length,blockedSalesLines:sales.length-validSales.length,salesTotal:sum(sales,'amount'),block:{lines:block.length,quantity:sum(block,'quantity'),amount:sum(block,'amount')},concrete:{lines:concrete.length,quantity:sum(concrete,'quantity'),amount:sum(concrete,'amount')},collections:{count:collections.length,amount:sum(collections,'amount')},cashMovements:(parsed.cashMovements||[]).length,cashDebits:sum(parsed.cashMovements||[],'debit'),cashCredits:sum(parsed.cashMovements||[],'credit'),treasuries:(parsed.treasuries||[]).length,inventorySnapshots:(parsed.inventory||[]).length,issues:(parsed.issues||[]).length};
}

export function canonicalDailyReport(parsed){
  return{sales:parsed.sales.map(({sourceRowNo,...row})=>row),cashMovements:parsed.cashMovements.map(({sourceRowNo,...row})=>row),treasuries:parsed.treasuries.map(({sourceRowNo,...row})=>row),inventory:parsed.inventory.map(({sourceRowNo,...row})=>row)};
}
