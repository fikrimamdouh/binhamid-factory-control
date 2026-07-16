(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.BinHamidDailySummaryParser=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
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
    const text=westernDigits(clean(value,40));
    if(/^\d{4}-\d{2}-\d{2}$/.test(text))return text;
    const match=text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if(!match)return '';
    return `${match[3]}-${match[2].padStart(2,'0')}-${match[1].padStart(2,'0')}`;
  };
  const kind=item=>includes(item,'خرسانه','خرسانة')?'خرسانة':includes(item,'بلك','بلوك')?'بلوك':'غير محدد';
  const titleIndex=(rows,predicate,from=0)=>{for(let i=from;i<rows.length;i++)if(predicate(rowText(rows[i]),rows[i]||[]))return i;return -1;};
  const isSalesTitle=text=>text==='المبيعات'||text==='مبيعات';
  const isSectionStop=text=>includes(text,'منتجات تامه','منتجات تامة','خامات','حركه الخزن','حركة الخزن','ما تم فرزه','ماتم فرزه');

  function parseDirectSales(rows,sheetName){
    const sales=[];
    let cursor=0;
    while(cursor<rows.length){
      const start=titleIndex(rows,text=>isSalesTitle(text),cursor);
      if(start<0)break;
      let end=rows.length;
      for(let i=start+1;i<rows.length;i++){if(isSectionStop(rowText(rows[i]))){end=i;break;}}
      for(let i=start+1;i<end;i++){
        const row=rows[i]||[];
        const invoiceNumber=number(row[0]),quantity=number(row[1]),customerCode=code(row[2]),customer=clean(row[3],500),item=clean(row[4],500);
        if(invoiceNumber===null||quantity===null||quantity<=0||!customer||!item)continue;
        const amountValues=row.slice(5,9).map(number).filter(value=>value!==null&&value>0);
        const amount=amountValues.length?round(amountValues[0],2):0;
        if(amount<=0)continue;
        const paymentTerms=row.slice(5,9).map(value=>clean(value,80)).find(value=>value&&number(value)===null)||'';
        sales.push({
          sheet:sheetName,row:i+1,date:'',invoice:String(Math.trunc(invoiceNumber)),quantity:round(quantity,3),customer,customerCode,item,
          kind:kind(item),amount,declaredCash:0,declaredTransfer:0,declaredCredit:amount,sourceAmount:amount,paymentTerms
        });
      }
      cursor=Math.max(end,start+1);
    }
    return sales;
  }

  const headerIndex=(row,aliases)=>{
    const normalized=(row||[]).map(norm);
    for(let i=0;i<normalized.length;i++)if(aliases.some(alias=>normalized[i]===norm(alias)||normalized[i].includes(norm(alias))))return i;
    return -1;
  };
  const isTreasuryRow=row=>includes(row?.[2],'الخزينه','الخزينة')&&number(row?.[3])!==null;
  const isCashHeader=row=>headerIndex(row,['مدين'])>=0&&headerIndex(row,['دائن'])>=0&&headerIndex(row,['اسم الحساب'])>=0&&headerIndex(row,['نوع الحساب','توع الحساب'])>=0;

  function parseTreasuryCollections(rows,sheetName){
    const collections=[];
    let treasuryCode='',treasuryName='',columns=null;
    for(let i=0;i<rows.length;i++){
      const row=rows[i]||[],text=rowText(row);
      if(isTreasuryRow(row)){
        treasuryCode=code(row[3]);treasuryName=clean(row[4],250);columns=null;continue;
      }
      if(!treasuryCode)continue;
      if(isCashHeader(row)){
        columns={
          debit:headerIndex(row,['مدين']),credit:headerIndex(row,['دائن']),client:headerIndex(row,['اسم الحساب']),
          accountType:headerIndex(row,['نوع الحساب','توع الحساب']),customerCode:headerIndex(row,['رقم الحساب','كود العميل','رقم العميل']),
          notes:headerIndex(row,['البيان','ملاحظات']),movement:headerIndex(row,['نوع الحركة']),receipt:headerIndex(row,['رقم الاذن','رقم الإذن','رقم السند']),date:headerIndex(row,['التاريخ'])
        };
        continue;
      }
      if(!columns)continue;
      if(includes(text,'المجموع','الرصيد النهائي','اول المده','أول المدة'))continue;
      const debit=number(row[columns.debit])||0,credit=number(row[columns.credit])||0;
      const customer=clean(row[columns.client],500),accountType=clean(row[columns.accountType],150),movement=clean(row[columns.movement],180);
      if(debit<=0||credit>0||!customer||!includes(accountType,'عميل')||!includes(movement,'استلام'))continue;
      const customerCode=code(row[columns.customerCode]);
      if(!customerCode)continue;
      collections.push({
        sheet:sheetName,row:i+1,date:isoDate(row[columns.date]),customerCode,customer,amount:round(debit,2),
        method:treasuryCode==='104'?'نقاط بيع':treasuryCode==='101'?'نقدي':treasuryName||`خزينة ${treasuryCode}`,
        receipt:clean(row[columns.receipt],100),invoice:'',type:movement,notes:clean(row[columns.notes],500),isAdvance:false,treasuryCode,treasuryName
      });
    }
    return collections;
  }

  const saleKey=row=>[row.sheet,row.row,row.invoice,row.customerCode,norm(row.item),round(row.quantity,3),round(row.amount,2)].join('|');
  const collectionKey=row=>[row.sheet,row.row,row.treasuryCode,row.customerCode,row.receipt,round(row.amount,2)].join('|');
  const unique=(rows,keyFn)=>{const seen=new Set();return rows.filter(row=>{const key=keyFn(row);if(seen.has(key))return false;seen.add(key);return true;});};

  function parseWorkbook(workbook,xlsx){
    const lib=xlsx||root.XLSX;
    if(!workbook||!lib?.utils?.sheet_to_json)throw new Error('Excel parser is not available');
    const sales=[],collections=[];
    for(const sheetName of workbook.SheetNames||[]){
      const rows=lib.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,defval:'',raw:false,blankrows:false});
      sales.push(...parseDirectSales(rows,sheetName));
      collections.push(...parseTreasuryCollections(rows,sheetName));
    }
    return{sales:unique(sales,saleKey),collections:unique(collections,collectionKey)};
  }

  return{parseWorkbook,parseDirectSales,parseTreasuryCollections,number,norm,kind};
});
