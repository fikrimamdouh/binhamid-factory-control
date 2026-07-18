(function(root,factory){
  const api=factory(root);
  root.BinHamidDailySummaryParser=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  const round=(value,digits=2)=>{const factor=10**digits;return Math.round((Number(value)+Number.EPSILON)*factor)/factor;};
  const clean=(value,max=1000)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
  const westernDigits=value=>String(value??'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  const number=value=>{
    if(typeof value==='number')return Number.isFinite(value)?value:null;
    const text=westernDigits(value).replace(/[٬,]/g,'').replace(/٫/g,'.').replace(/[^0-9.+-]/g,'');
    if(!text)return null;
    const parsed=Number(text);
    return Number.isFinite(parsed)?parsed:null;
  };
  const norm=value=>clean(value,3000).toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/ؤ/g,'و').replace(/ئ/g,'ي').replace(/ـ/g,'').replace(/\s+/g,' ');
  const rowText=row=>norm((row||[]).filter(v=>v!==null&&v!==undefined&&v!=='').join(' '));
  const includes=(value,...terms)=>terms.some(term=>norm(value).includes(norm(term)));
  const code=value=>westernDigits(clean(value,100)).replace(/\.0+$/,'');
  const isoDate=value=>{
    if(value instanceof Date&&!Number.isNaN(value.getTime()))return value.toISOString().slice(0,10);
    if(typeof value==='number'&&Number.isFinite(value)&&value>0&&value<100000){const date=new Date(Date.UTC(1899,11,30)+Math.round(value)*86400000);return date.toISOString().slice(0,10);}
    const text=westernDigits(clean(value,40));
    if(/^\d{4}-\d{2}-\d{2}$/.test(text))return text;
    if(/^\d{1,5}(?:\.0+)?$/.test(text)){const serial=Number(text);if(serial>0&&serial<100000){const date=new Date(Date.UTC(1899,11,30)+Math.round(serial)*86400000);return date.toISOString().slice(0,10);}}
    const match=text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if(!match)return '';
    return `${match[3]}-${match[2].padStart(2,'0')}-${match[1].padStart(2,'0')}`;
  };
  // «بلك» هو الاسم التشغيلي المعتمد. نقبل «بلوك» من الملفات القديمة فقط ثم نعيد الاسم الموحد.
  const kind=item=>includes(item,'خرسانه','خرسانة')?'خرسانة':includes(item,'بلك','بلوك')?'بلك':'غير محدد';
  const titleIndex=(rows,predicate,from=0)=>{for(let i=from;i<rows.length;i++)if(predicate(rowText(rows[i]),rows[i]||[]))return i;return -1;};
  const isSalesTitle=text=>text==='المبيعات'||text==='مبيعات'||text.startsWith('المبيعات ');
  const isSectionStop=text=>includes(text,'منتجات تامه','منتجات تامة','خامات','حركه الخزن','حركة الخزن','ما تم فرزه','ماتم فرزه','تحصيلات العملاء');
  const headerIndex=(row,aliases)=>{
    const normalized=(row||[]).map(norm),terms=aliases.map(norm);
    for(let i=0;i<normalized.length;i++)if(terms.some(term=>normalized[i]===term))return i;
    for(let i=0;i<normalized.length;i++)if(terms.some(term=>normalized[i].includes(term)))return i;
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
    const sales=[];
    let cursor=0;
    while(cursor<rows.length){
      const start=titleIndex(rows,text=>isSalesTitle(text),cursor);
      if(start<0)break;
      let end=rows.length;
      for(let i=start+1;i<rows.length;i++){if(isSectionStop(rowText(rows[i]))){end=i;break;}}
      let headerRow=-1,columns=null;
      for(let i=start+1;i<Math.min(end,start+8);i++){const detected=salesColumns(rows[i]||[]);if(detected){headerRow=i;columns=detected;break;}}
      if(!columns)columns={invoice:0,quantity:1,customerCode:2,customer:3,item:4,amount:5,terms:6};
      const dataStart=headerRow>=0?headerRow+1:start+1;
      for(let i=dataStart;i<end;i++){
        const row=rows[i]||[];if(repeatedSalesHeader(row))continue;
        const invoiceNumber=number(row[columns.invoice]),quantity=number(row[columns.quantity]),customerCode=columns.customerCode>=0?code(row[columns.customerCode]):'',customer=clean(row[columns.customer],500),item=clean(row[columns.item],500);
        if(invoiceNumber===null||quantity===null||quantity<=0||!customer||!item)continue;
        const candidates=[];
        if(columns.amount>=0)candidates.push(row[columns.amount]);
        for(let c=0;c<row.length;c++)if(c!==columns.invoice&&c!==columns.quantity&&c!==columns.customerCode&&c!==columns.customer&&c!==columns.item)candidates.push(row[c]);
        const amountValues=candidates.map(number).filter(value=>value!==null&&value>0);
        const amount=amountValues.length?round(amountValues[0],2):0;
        if(amount<=0)continue;
        const paymentTerms=columns.terms>=0?clean(row[columns.terms],80):candidates.map(value=>clean(value,80)).find(value=>value&&number(value)===null)||'';
        sales.push({sheet:sheetName,row:i+1,date:'',invoice:String(Math.trunc(invoiceNumber)),quantity:round(quantity,3),customer,customerCode,item,kind:kind(item),amount,declaredCash:0,declaredTransfer:0,declaredCredit:amount,sourceAmount:amount,paymentTerms});
      }
      cursor=Math.max(end,start+1);
    }
    return sales;
  }

  const isTreasuryRow=row=>includes(row?.[2],'الخزينه','الخزينة')&&number(row?.[3])!==null;
  const isCashHeader=row=>headerIndex(row,['مدين'])>=0&&headerIndex(row,['دائن'])>=0&&headerIndex(row,['اسم الحساب'])>=0&&headerIndex(row,['نوع الحساب','توع الحساب'])>=0;

  function parseTreasuryCollections(rows,sheetName){
    const collections=[];
    let treasuryCode='',treasuryName='',columns=null;
    for(let i=0;i<rows.length;i++){
      const row=rows[i]||[],text=rowText(row);
      if(isTreasuryRow(row)){treasuryCode=code(row[3]);treasuryName=clean(row[4],250);columns=null;continue;}
      if(!treasuryCode)continue;
      if(isCashHeader(row)){
        columns={debit:headerIndex(row,['مدين']),credit:headerIndex(row,['دائن']),client:headerIndex(row,['اسم الحساب']),accountType:headerIndex(row,['نوع الحساب','توع الحساب']),customerCode:headerIndex(row,['رقم الحساب','كود العميل','رقم العميل']),notes:headerIndex(row,['البيان','ملاحظات']),movement:headerIndex(row,['نوع الحركة']),receipt:headerIndex(row,['رقم الاذن','رقم الإذن','رقم السند']),date:headerIndex(row,['التاريخ'])};continue;
      }
      if(!columns)continue;
      if(includes(text,'المجموع','الرصيد النهائي','اول المده','أول المدة'))continue;
      const debit=number(row[columns.debit])||0,credit=number(row[columns.credit])||0,customer=clean(row[columns.client],500),accountType=clean(row[columns.accountType],150),movement=clean(row[columns.movement],180);
      if(debit<=0||credit>0||!customer||!includes(accountType,'عميل')||!includes(movement,'استلام'))continue;
      const customerCode=code(row[columns.customerCode]);if(!customerCode)continue;
      collections.push({sheet:sheetName,row:i+1,date:isoDate(row[columns.date]),customerCode,customer,amount:round(debit,2),method:treasuryCode==='104'?'نقاط بيع':treasuryCode==='101'?'نقدي':treasuryName||`خزينة ${treasuryCode}`,receipt:clean(row[columns.receipt],100),invoice:'',type:movement,notes:clean(row[columns.notes],500),isAdvance:false,treasuryCode,treasuryName});
    }
    return collections;
  }

  const saleKey=row=>[row.sheet,row.row,row.invoice,row.customerCode,norm(row.item),round(row.quantity,3),round(row.amount,2)].join('|');
  const collectionKey=row=>[row.sheet,row.row,row.treasuryCode,row.customerCode,row.receipt,round(row.amount,2)].join('|');
  const unique=(rows,keyFn)=>{const seen=new Set();return rows.filter(row=>{const key=keyFn(row);if(seen.has(key))return false;seen.add(key);return true;});};

  function parseWorkbook(workbook,xlsx){
    const lib=xlsx||root.XLSX;if(!workbook||!lib?.utils?.sheet_to_json)throw new Error('Excel parser is not available');
    const sales=[],collections=[];
    for(const sheetName of workbook.SheetNames||[]){const rows=lib.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,defval:'',raw:false,blankrows:false});sales.push(...parseDirectSales(rows,sheetName));collections.push(...parseTreasuryCollections(rows,sheetName));}
    return{sales:unique(sales,saleKey),collections:unique(collections,collectionKey)};
  }

  return{parseWorkbook,parseDirectSales,parseTreasuryCollections,number,norm,kind,isoDate,salesColumns};
});
