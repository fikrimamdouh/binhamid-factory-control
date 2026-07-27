(function(root,factory){
  const api=factory(root);
  root.BinHamidDailySummaryParser=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  const round=(value,digits=2)=>{const factor=10**digits;return Math.round((Number(value)+Number.EPSILON)*factor)/factor;};
  const clean=(value,max=1000)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
  const westernDigits=value=>String(value??'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
  const number=value=>{
    if(typeof value==='number')return Number.isFinite(value)?value:null;
    const text=westernDigits(value).replace(/[٬,]/g,'').replace(/٫/g,'.').replace(/[^0-9.+-]/g,'');
    if(!text)return null;
    const parsed=Number(text);
    return Number.isFinite(parsed)?parsed:null;
  };
  const norm=value=>clean(value,3000).toLowerCase().replace(/[أإآٱ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/ؤ/g,'و').replace(/ئ/g,'ي').replace(/[ً-ْـ]/g,'').replace(/\s+/g,' ');
  const rowText=row=>norm((row||[]).filter(v=>v!==null&&v!==undefined&&v!=='').join(' '));
  const includes=(value,...terms)=>terms.some(term=>norm(value).includes(norm(term)));
  const code=value=>westernDigits(clean(value,100)).replace(/\.0+$/,'');
  const isoDate=value=>{
    if(value instanceof Date&&!Number.isNaN(value.getTime()))return value.toISOString().slice(0,10);
    if(typeof value==='number'&&Number.isFinite(value)&&value>=30000&&value<=80000){const date=new Date(Date.UTC(1899,11,30)+Math.round(value)*86400000);return date.toISOString().slice(0,10);}
    const text=westernDigits(clean(value,40));
    if(/^\d{4}-\d{2}-\d{2}$/.test(text))return text;
    if(/^\d{1,5}(?:\.0+)?$/.test(text)){const serial=Number(text);if(serial>=30000&&serial<=80000){const date=new Date(Date.UTC(1899,11,30)+Math.round(serial)*86400000);return date.toISOString().slice(0,10);}}
    let match=text.match(/^(20\d{2})[.\/_-](\d{1,2})[.\/_-](\d{1,2})$/);
    if(match)return`${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`;
    match=text.match(/^(\d{1,2})[.\/_-](\d{1,2})[.\/_-](\d{4})$/);
    if(match)return `${match[3]}-${match[2].padStart(2,'0')}-${match[1].padStart(2,'0')}`;
    match=text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
    if(match){
      const first=Number(match[1]),second=Number(match[2]),month=first>12?second:first,day=first>12?first:second;
      if(month>=1&&month<=12&&day>=1&&day<=31)return`20${match[3]}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }
    return '';
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
      if(!columns)columns={invoice:0,quantity:1,customerCode:2,customer:3,item:4,amount:-1,terms:-1};
      const dataStart=headerRow>=0?headerRow+1:start+1;
      for(let i=dataStart;i<end;i++){
        const row=rows[i]||[];if(repeatedSalesHeader(row))continue;
        const invoiceNumber=number(row[columns.invoice]),quantity=number(row[columns.quantity]),customerCode=columns.customerCode>=0?code(row[columns.customerCode]):'',customer=clean(row[columns.customer],500),item=clean(row[columns.item],500);
        if(invoiceNumber===null||quantity===null||quantity<=0||!customer||!item)continue;
        const candidates=[];
        if(columns.amount>=0)candidates.push(row[columns.amount]);
        for(let c=0;c<row.length;c++)if(c!==columns.invoice&&c!==columns.quantity&&c!==columns.customerCode&&c!==columns.customer&&c!==columns.item&&c!==columns.terms)candidates.push(row[c]);
        const amountValues=candidates.map(number).filter(value=>value!==null&&value>0);
        const amount=amountValues.length?round(amountValues[0],2):0;
        if(amount<=0)continue;
        const paymentTerms=columns.terms>=0?clean(row[columns.terms],80):row.slice(5).map(value=>clean(value,80)).find(value=>value&&number(value)===null)||'';
        sales.push({sheet:sheetName,row:i+1,date:'',invoice:String(Math.trunc(invoiceNumber)),quantity:round(quantity,3),customer,customerCode,item,kind:kind(item),amount,declaredCash:0,declaredTransfer:0,declaredCredit:amount,sourceAmount:amount,paymentTerms});
      }
      cursor=Math.max(end,start+1);
    }
    return sales;
  }

  const isTreasuryRow=row=>includes(row?.[2],'الخزينه','الخزينة')&&number(row?.[3])!==null;
  const isCashHeader=row=>headerIndex(row,['مدين'])>=0&&headerIndex(row,['دائن'])>=0&&headerIndex(row,['اسم الحساب'])>=0&&headerIndex(row,['نوع الحساب','توع الحساب'])>=0;
  const cashColumns=row=>isCashHeader(row)?{
    debit:headerIndex(row,['مدين']),credit:headerIndex(row,['دائن']),accountName:headerIndex(row,['اسم الحساب']),accountType:headerIndex(row,['نوع الحساب','توع الحساب']),accountCode:headerIndex(row,['رقم الحساب','كود العميل','رقم العميل']),description:headerIndex(row,['البيان','ملاحظات']),movementType:headerIndex(row,['نوع الحركة']),voucherNo:headerIndex(row,['رقم الاذن','رقم الإذن','رقم السند']),movementDate:headerIndex(row,['التاريخ','تاريخ الحركة'])
  }:null;

  function parseTreasurySection(rows,sheetName){
    const cashMovements=[],treasuries=[];
    let treasuryCode='',treasuryName='',opening=null,columns=null,currentBankCode='',currentBankName='';
    const saveTreasury=closing=>{
      if(!treasuryCode)return;
      const key=[treasuryCode,opening,closing].join('|');
      if(!treasuries.some(row=>[row.treasuryCode,row.opening,row.closing].join('|')===key))treasuries.push({sheet:sheetName,row:0,date:'',treasuryCode,treasuryName,opening:round(opening||0,2),closing:round(closing||0,2)});
    };
    for(let i=0;i<rows.length;i++){
      const row=rows[i]||[],text=rowText(row);
      if(isTreasuryRow(row)){if(treasuryCode&&opening!==null)saveTreasury(opening);treasuryCode=code(row[3]);treasuryName=clean(row[4],250);opening=null;columns=null;continue;}
      if(treasuryCode&&includes(row?.[1],'اول المده','أول المدة','اول المدة')){opening=number(row[0])||0;continue;}
      const detected=cashColumns(row);if(detected){columns=detected;continue;}
      if(!columns)continue;
      if(includes(row?.[3],'الرصيد النهائي')){const closing=number(row[0])||0;saveTreasury(closing);opening=null;continue;}
      if(includes(text,'المجموع')||inventoryColumns(row)||includes(text,'ماتم فرزه','ما تم فرزه'))continue;
      const debit=number(row[columns.debit])||0,credit=number(row[columns.credit])||0;if(debit<=0&&credit<=0)continue;
      const accountName=clean(row[columns.accountName],500),accountType=clean(row[columns.accountType],150),accountCode=code(row[columns.accountCode]),description=clean(row[columns.description],1000),movementType=clean(row[columns.movementType],180),voucherNo=code(row[columns.voucherNo]),movementDate=isoDate(row[columns.movementDate]),isBank=includes(movementType,'بنك')||includes(accountType,'بنك');
      if(!accountName&&!movementType)continue;
      if(isBank&&includes(accountType,'بنك')&&accountCode){currentBankCode=accountCode;currentBankName=accountName;}
      const effectiveCode=isBank?(currentBankCode||accountCode||'BANK'):treasuryCode,effectiveName=isBank?(currentBankName||'حركات بنكية'):treasuryName;
      const isCustomer=includes(accountType,'عميل'),isCustomerCollection=isCustomer&&debit>0&&credit===0&&includes(movementType,'استلام','مدين','بنك');
      cashMovements.push({sheet:sheetName,row:i+1,date:movementDate,reportDate:movementDate,treasuryCode:effectiveCode,treasuryName:effectiveName,debit:round(debit,2),credit:round(credit,2),accountName,accountType,accountCode,description,movementType,voucherNo,movementDate,paymentMethod:isBank?'bank':effectiveCode==='104'?'pos':'cash',isBank,isCustomerCollection});
    }
    const collections=cashMovements.filter(row=>row.isCustomerCollection).map(row=>({sheet:row.sheet,row:row.row,date:row.movementDate,customerCode:row.accountCode,customer:row.accountName,amount:row.debit,method:row.paymentMethod==='bank'?'تحويل بنكي':row.paymentMethod==='pos'?'نقاط بيع':'نقدي',receipt:row.voucherNo,invoice:'',type:row.movementType,notes:row.description,isAdvance:false,treasuryCode:row.treasuryCode,treasuryName:row.treasuryName}));
    return{cashMovements,treasuries,collections};
  }
  const parseTreasuryCollections=(rows,sheetName)=>parseTreasurySection(rows,sheetName).collections;

  const saleKey=row=>[row.sheet,row.row,row.invoice,row.customerCode,norm(row.item),round(row.quantity,3),round(row.amount,2)].join('|');
  const collectionKey=row=>[row.date,row.treasuryCode,row.customerCode,row.receipt,round(row.amount,2)].join('|');
  const cashKey=row=>[row.movementDate,row.treasuryCode,row.accountCode,row.voucherNo,norm(row.movementType),row.debit,row.credit].join('|');
  const unique=(rows,keyFn)=>{const seen=new Set();return rows.filter(row=>{const key=keyFn(row);if(seen.has(key))return false;seen.add(key);return true;});};

  // أقسام المخزون (منتجات تامة/خامات): كود الصنف، الصنف، الوحدة، الرصيد
  // الافتتاحي، وارد، منصرف، رصيد — نفس بنية الأعمدة في القسمين.
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
      let end=rows.length;for(let i=start+1;i<rows.length;i++){const text=rowText(rows[i]);if(i>start+1&&(isFinishedGoodsTitle(text)||isRawMaterialsTitle(text)||includes(text,'حركه الخزن','حركة الخزن'))){end=i;break;}}
      let headerRow=-1,columns=null;
      for(let i=start+1;i<Math.min(end,start+8);i++){const detected=inventoryColumns(rows[i]||[]);if(detected){headerRow=i;columns=detected;break;}}
      if(columns){
        for(let i=headerRow+1;i<end;i++){
          const row=rows[i]||[];if(inventoryColumns(row))continue;
          const itemCode=code(row[columns.itemCode]),itemName=clean(row[columns.itemName],500);
          if(!itemCode||!itemName)continue;
          const opening=number(row[columns.opening])||0,received=number(row[columns.received])||0,issued=number(row[columns.issued])||0,closingRaw=columns.closing>=0?number(row[columns.closing]):null,closing=closingRaw!==null?closingRaw:round(opening+received-issued,3);
          items.push({sheet:sheetName,row:i+1,itemCode,itemName,unit:clean(row[columns.unit],50),opening:round(opening,3),received:round(received,3),issued:round(issued,3),closing:round(closing,3)});
        }
      }
      cursor=Math.max(end,start+1);
    }
    return items;
  }
  const inventoryKey=row=>[row.itemCode,norm(row.itemName),row.opening,row.received,row.issued,row.closing].join('|');

  function parseWorkbook(workbook,xlsx){
    const lib=xlsx||root.XLSX;if(!workbook||!lib?.utils?.sheet_to_json)throw new Error('Excel parser is not available');
    const sales=[],collections=[],cashMovements=[],treasuries=[],finishedGoods=[],rawMaterials=[];
    for(const sheetName of workbook.SheetNames||[]){const rows=lib.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,defval:'',raw:false,cellDates:true,blankrows:false});sales.push(...parseDirectSales(rows,sheetName));finishedGoods.push(...parseInventorySection(rows,sheetName,isFinishedGoodsTitle));rawMaterials.push(...parseInventorySection(rows,sheetName,isRawMaterialsTitle));const treasury=parseTreasurySection(rows,sheetName);collections.push(...treasury.collections);cashMovements.push(...treasury.cashMovements);treasuries.push(...treasury.treasuries);}
    const cleanCash=unique(cashMovements,cashKey),reportDates=[...new Set(cleanCash.map(row=>row.movementDate).filter(Boolean))].sort();
    return{sales:unique(sales,saleKey),collections:unique(collections,collectionKey),cashMovements:cleanCash,treasuries:unique(treasuries,row=>[row.treasuryCode,row.opening,row.closing].join('|')),finishedGoods:unique(finishedGoods,inventoryKey),rawMaterials:unique(rawMaterials,inventoryKey),reportDates};
  }

  return{parseWorkbook,parseDirectSales,parseTreasuryCollections,parseTreasurySection,parseInventorySection,number,norm,kind,isoDate,salesColumns};
});
