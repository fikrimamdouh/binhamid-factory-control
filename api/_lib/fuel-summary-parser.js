const round=(value,digits=2)=>{const factor=10**digits;return Math.round((Number(value)+Number.EPSILON)*factor)/factor;};
const clean=(value,max=250)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const westernDigits=value=>String(value??'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d));
const number=value=>{
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  const text=westernDigits(value).replace(/[٬,]/g,'').replace(/٫/g,'.').replace(/SAR/gi,'').replace(/[^0-9.+-]/g,'');
  if(!text)return null;
  const parsed=Number(text);return Number.isFinite(parsed)?parsed:null;
};
const norm=value=>clean(value,300).toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/\s+/g,' ');
const headerIndex=(row,aliases)=>{
  const normalized=(row||[]).map(norm),terms=aliases.map(norm);
  for(let index=0;index<normalized.length;index++)if(terms.some(term=>normalized[index]===term))return index;
  for(let index=0;index<normalized.length;index++)if(terms.some(term=>normalized[index].includes(term)))return index;
  return -1;
};
// رقم اللوحة بأشكاله (عربي/إنجليزي/أرقام) يُطبَّع لحرف مقارنة واحد لمطابقته
// مع سجل الأصول بغض النظر عن الفراغات أو الشرطات أو اختلاف ترتيب الكتابة.
const plateKey=value=>westernDigits(String(value||'')).toUpperCase().replace(/[^A-Z0-9\u0600-\u06FF]/g,'');
const FUEL_ALIASES={
  receipt:['رقم الإيصال','رقم الايصال'],driver:['السائق'],station:['المحطة'],vehicleName:['المركبة'],
  plate:['رقم اللوحة','رقم اللوح','اللوحة'],amount:['المبلغ'],fuelType:['نوع الوقود'],date:['التاريخ'],
  price:['سعر اللتر بالمحطة','سعر اللتر'],liters:['الكمية'],beforeTax:['المبلغ قبل الضريبة'],tax:['الضريبة'],
  net:['الصافي شامل الضريبة'],prevOdometer:['قراءة العداد السابقة'],currOdometer:['قراءة العداد الحالية'],serviceKm:['عدد كيلوات الخدمة','عدد كيلومترات الخدمة']
};
function fuelColumns(row){
  const columns=Object.fromEntries(Object.entries(FUEL_ALIASES).map(([key,aliases])=>[key,headerIndex(row,aliases)]));
  return columns.plate>=0&&columns.amount>=0&&(columns.liters>=0||columns.price>=0)?columns:null;
}
function parseDate(value){
  if(value instanceof Date&&!Number.isNaN(value.getTime()))return value.toISOString();
  const text=clean(value,40);if(!text)return '';
  const iso=new Date(text.replace(' ','T'));if(!Number.isNaN(iso.getTime()))return iso.toISOString();
  return text;
}
export function parseFuelWorkbook(workbook,xlsx){
  const rows=[];
  for(const sheetName of workbook?.SheetNames||[]){
    const sheetRows=xlsx.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,defval:'',raw:false,blankrows:false});
    let columns=null;
    for(let index=0;index<Math.min(sheetRows.length,10);index++){const detected=fuelColumns(sheetRows[index]||[]);if(detected){columns=detected;sheetRows.splice(0,index+1);break;}}
    if(!columns)continue;
    for(let index=0;index<sheetRows.length;index++){
      const row=sheetRows[index]||[];if(fuelColumns(row))continue;
      const plate=clean(row[columns.plate],40);if(!plate)continue;
      const liters=number(row[columns.liters])||0,amount=number(row[columns.amount])||0;
      if(liters<=0&&amount<=0)continue;
      rows.push({
        sheet:sheetName,row:index+1,receipt:clean(row[columns.receipt],80),driver:clean(row[columns.driver],150),
        station:clean(row[columns.station],200),vehicleName:clean(row[columns.vehicleName],150),plate,plateKey:plateKey(plate),
        amount:round(amount,2),fuelType:clean(row[columns.fuelType],40)||'Diesel',date:parseDate(row[columns.date]),
        price:round(number(row[columns.price])||(liters>0?amount/liters:0),3),liters:round(liters,3),
        beforeTax:round(number(row[columns.beforeTax])||0,2),tax:round(number(row[columns.tax])||0,2),
        net:round(number(row[columns.net])||amount,2),prevOdometer:round(number(row[columns.prevOdometer])||0,1),
        currOdometer:round(number(row[columns.currOdometer])||0,1),serviceKm:round(number(row[columns.serviceKm])||0,1)
      });
    }
  }
  const seen=new Set();
  const cleanRows=rows.filter(row=>{const key=[row.sheet,row.row,row.receipt,row.plate,row.amount].join('|');if(seen.has(key))return false;seen.add(key);return true;});
  return{rows:cleanRows,rowCount:cleanRows.length};
}
const median=values=>{const list=(values||[]).filter(v=>Number.isFinite(v)&&v>0).sort((a,b)=>a-b);if(!list.length)return 0;const mid=Math.floor(list.length/2);return list.length%2?list[mid]:(list[mid-1]+list[mid])/2;};
const PRICE_VARIANCE_PCT=10,VOLUME_VARIANCE_PCT=50,RAPID_REFILL_HOURS=6;
// يبني ملخصًا لكل لوحة (عدد التعبئات، اللترات، المبلغ) بالإضافة إلى قائمة
// تحذيرات (إيصال مكرر، عداد غير منطقي، سعر/كمية شاذة، تعبئة متقاربة) — نفس
// منطق الرقابة الداخلية المستخدم في الموقع لكن بصيغة مختصرة تلائم تليجرام.
export function buildFuelControlReport(rows){
  const byReceipt=new Map(),byPlate=new Map();
  for(const row of rows){
    if(row.receipt){if(!byReceipt.has(row.receipt))byReceipt.set(row.receipt,[]);byReceipt.get(row.receipt).push(row);}
    if(!byPlate.has(row.plateKey))byPlate.set(row.plateKey,[]);byPlate.get(row.plateKey).push(row);
  }
  const prices=rows.map(r=>r.price).filter(v=>v>0),medianPrice=median(prices);
  const alerts=[];
  const add=(row,level,check,detail)=>alerts.push({level,check,detail,date:row.date,plate:row.plate,receipt:row.receipt||'—',driver:row.driver||'—'});
  for(const[,plateRows]of byPlate){
    const ordered=plateRows.slice().sort((a,b)=>String(a.date).localeCompare(String(b.date)));
    const liters=ordered.map(r=>r.liters),medianLiters=median(liters);
    let previous=null;
    for(const row of ordered){
      if(row.receipt&&(byReceipt.get(row.receipt)?.length||0)>1)add(row,'danger','إيصال مكرر',`رقم الإيصال مستخدم في ${byReceipt.get(row.receipt).length} تعبئات`);
      if(!row.receipt)add(row,'warn','إيصال غير مسجل','لا يوجد رقم إيصال');
      if(!row.driver)add(row,'info','السائق غير مسجل','استكمال اسم السائق');
      if(row.currOdometer>0&&row.prevOdometer>0&&row.currOdometer<=row.prevOdometer)add(row,'danger','قراءة عداد غير منطقية',`السابق ${row.prevOdometer} والحالي ${row.currOdometer}`);
      if(previous){const hours=(new Date(row.date).getTime()-new Date(previous.date).getTime())/3600000;if(Number.isFinite(hours)&&hours>=0&&hours<=RAPID_REFILL_HOURS)add(row,'warn','تعبئة متقاربة',`الفاصل عن التعبئة السابقة ${hours.toFixed(1)} ساعة`);}
      if(ordered.length>=3&&medianLiters>0&&row.liters>medianLiters*(1+VOLUME_VARIANCE_PCT/100))add(row,'warn','كمية أعلى من المعتاد',`${row.liters} لتر مقابل وسيط ${round(medianLiters,1)} لتر لنفس اللوحة`);
      if(prices.length>=3&&medianPrice>0&&row.price>0&&Math.abs(row.price-medianPrice)/medianPrice*100>PRICE_VARIANCE_PCT)add(row,'warn','سعر لتر مختلف',`${row.price} ر.س مقابل وسيط ${round(medianPrice,3)} ر.س`);
      if(row.liters<=0||row.amount<=0)add(row,'danger','قيمة تعبئة غير صالحة',`اللترات ${row.liters} والمبلغ ${row.amount}`);
      previous=row;
    }
  }
  const rank={danger:0,warn:1,info:2};alerts.sort((a,b)=>(rank[a.level]-rank[b.level])||String(a.date).localeCompare(String(b.date)));
  const totalLiters=rows.reduce((sum,r)=>sum+r.liters,0);
  const vehicles=[...byPlate.entries()].map(([key,plateRows])=>{
    const liters=plateRows.reduce((sum,r)=>sum+r.liters,0),amount=plateRows.reduce((sum,r)=>sum+r.amount,0),driverNames=[...new Set(plateRows.map(r=>r.driver).filter(Boolean))];
    return{plateKey:key,plate:plateRows[0].plate,vehicleName:plateRows[0].vehicleName,drivers:driverNames.join('، ')||'—',fills:plateRows.length,liters:round(liters,2),amount:round(amount,2),avgPrice:round(liters?amount/liters:0,3),share:totalLiters?round(liters/totalLiters*100,1):0,alertCount:alerts.filter(a=>a.plate===plateRows[0].plate).length};
  }).sort((a,b)=>b.liters-a.liters);
  return{
    vehicles,alerts,medianPrice:round(medianPrice,3),
    totals:{plateCount:vehicles.length,fillCount:rows.length,liters:round(totalLiters,2),amount:round(rows.reduce((sum,r)=>sum+r.amount,0),2),danger:alerts.filter(a=>a.level==='danger').length,warn:alerts.filter(a=>a.level==='warn').length,info:alerts.filter(a=>a.level==='info').length}
  };
}
