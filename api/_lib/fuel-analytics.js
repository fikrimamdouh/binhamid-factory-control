// حفظ حركات الديزل وتحليلها. مصدر الحقيقة هو جدول fuel_transactions الذي أضافته
// migration 028؛ قبله كان التقرير يُعرض ثم يضيع فلا مقارنة ولا استهلاك تراكمي.
import { insert, select } from './supabase.js';
import { plateKey as normalizeFuelPlate, fuelCategory } from './fuel-summary-parser.js';

const num=value=>{const parsed=Number(String(value??'').replace(/[^\d.-]/g,''));return Number.isFinite(parsed)?parsed:0;};
const clean=value=>String(value??'').trim();
const isoDate=value=>{const text=clean(value).slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';};

// المحلّل يُعيد التاريخ بصيغ مختلفة حسب الملف، فنوحّدها قبل الحفظ.
function toDate(value){
  const direct=isoDate(value);if(direct)return direct;
  const text=clean(value).replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  let match=text.match(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})/);
  if(match)return`${match[1]}-${String(match[2]).padStart(2,'0')}-${String(match[3]).padStart(2,'0')}`;
  match=text.match(/(\d{1,2})[./-](\d{1,2})[./-](20\d{2})/);
  if(match)return`${match[3]}-${String(match[2]).padStart(2,'0')}-${String(match[1]).padStart(2,'0')}`;
  const parsed=new Date(value);
  return Number.isNaN(parsed.getTime())?'':parsed.toISOString().slice(0,10);
}

// تقرير المحطة يكتب اسم المركبة نصًّا حرًّا («6512»، «sca»، «aymannew») فلا يصلح
// للتقارير. مطابقة اللوحة بسجل الأصول تربط التعبئة بالأصل الحقيقي وباسمه المعتمد.
async function assetsByPlate(){
  const index=new Map();
  const assets=await select('unified_assets','active=eq.true&select=external_id,asset_name,plate_no&limit=2000').catch(()=>[]);
  for(const asset of assets||[]){
    const key=normalizeFuelPlate(asset?.plate_no);
    if(key&&!index.has(key))index.set(key,{externalId:clean(asset.external_id),name:clean(asset.asset_name)});
  }
  return index;
}

// سبب فشل الحفظ يُترجَم إلى إجراء واضح. الحالة الأهم: الجدول غير موجود لأن
// migration 028 لم تُطبَّق بعد — عندها يظهر التقرير سليمًا بينما لا تُحفظ حركة،
// ويبقى القسم فارغًا إلى الأبد بلا سبب معلن.
export function storeFailureReason(error){
  const code=String(error?.data?.code||''),message=String(error?.message||'');
  // العمود الناقص يُفحص أولًا: رسالته تحتوي «does not exist» أيضًا، فلو تُرك
  // للنمط العام لظهر كأن الجدول كله مفقود والإجراء المقترح خاطئ.
  if(code==='42703'||/column\s+\S+\s+does not exist/i.test(message))
    return'أعمدة جدول حركات الوقود ناقصة. تأكد أن migration 028 طُبّقت كاملة.';
  if(code==='42P01'||code==='PGRST205'||/relation\s+\S+\s+does not exist|schema cache/i.test(message))
    return'جدول حركات الوقود غير موجود بعد. طبّق migration 028 على Supabase ثم أعد إرسال الملف.';
  if(code==='42501'||Number(error?.upstreamStatus)===401||Number(error?.upstreamStatus)===403)
    return'صلاحية الكتابة على جدول حركات الوقود مرفوضة. راجع مفتاح الخدمة وسياسات RLS.';
  if(Number(error?.upstreamStatus)===503||/غير مضبوط/.test(message))return'الاتصال بقاعدة البيانات غير مضبوط على Vercel.';
  return`تعذّر الحفظ: ${message.slice(0,140)}`;
}

// الصفوف تُدرج على دفعات، والتكرار تمنعه بصمة السطر في قاعدة البيانات لا الكود،
// فإعادة رفع التقرير نفسه لا تُضاعف الاستهلاك.
export async function storeFuelRows(rows=[],{sourceFile='',source='station_report'}={}){
  const assets=await assetsByPlate();
  const payload=(rows||[]).map(row=>{
  const key=normalizeFuelPlate(row.plateKey||row.plate),asset=assets.get(key)||null;
  return{
    transaction_date:toDate(row.date),plate_key:key||clean(row.plateKey||row.plate),
    vehicle_external_id:asset?.externalId||null,
    // الاسم المعتمد من سجل الأصول يسبق نص المحطة الحر عند توفره.
    vehicle_name:asset?.name||clean(row.vehicleName)||null,driver_name:clean(row.driver)||null,
    station:clean(row.station)||null,fuel_type:clean(row.fuelType)||null,
    receipt_no:clean(row.receipt)||null,liters:num(row.liters),unit_price:num(row.price),
    amount:num(row.amount),tax_amount:num(row.tax),net_amount:num(row.net||row.amount),
    prev_odometer:num(row.prevOdometer)||null,curr_odometer:num(row.currOdometer)||null,
    service_km:num(row.serviceKm)||null,source,source_file:clean(sourceFile)||null
  };}).filter(row=>row.transaction_date&&row.plate_key&&(row.liters>0||row.amount>0));
  if(!payload.length)return{stored:0,skipped:(rows||[]).length,rows:0,failed:0,reason:''};
  let stored=0,failed=0,reason='';
  for(let index=0;index<payload.length;index+=200){
    const slice=payload.slice(index,index+200);
    // on_conflict يُمرَّر في الاستعلام لا في الخيارات، وإلا فإن PostgREST يقارن
    // بالمفتاح الأساسي (uuid جديد دائمًا) فيصطدم بفهرس بصمة السطر وتسقط الدفعة
    // كاملة عند أي إعادة رفع لفترة متداخلة.
    // return=representation يُعيد الصفوف المُدرجة فعلًا، فيكون العدد المعروض
    // للمستخدم هو الجديد حقًا لا عدد ما حاولنا إدراجه.
    try{
      const inserted=await insert('fuel_transactions',slice,{query:'on_conflict=line_identity',prefer:'resolution=ignore-duplicates,return=representation'});
      stored+=Array.isArray(inserted)?inserted.length:slice.length;
    }
    catch(error){
      failed+=slice.length;
      // السبب يُرفع للأعلى ليُعرض للمستخدم: بدونه يظهر التقرير كأنه نجح بينما لم
      // تُحفظ حركة واحدة، ويبقى القسم فارغًا بلا تفسير. هذا هو الفشل الصامت.
      if(!reason)reason=storeFailureReason(error);
      console.warn('[fuel store chunk]',{size:slice.length,reason,message:String(error?.message||'').slice(0,220)});
    }
  }
  // «متجاهَل» = حركة موجودة مسبقًا (إعادة رفع)، و«فاشل» = خطأ فعلي يستحق الإبلاغ.
  return{stored,skipped:payload.length-stored-failed,failed,reason,rows:payload.length};
}

function shiftDays(date,days){const value=new Date(`${date}T12:00:00Z`);value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10);}
// اليوم بتوقيت الرياض لا بتوقيت الخادم: بين منتصف الليل والثالثة فجرًا يكون
// تاريخ UTC هو أمس، فيصبح «تقرير أمس» تقرير أول أمس بلا سبب ظاهر.
export const riyadhToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const yesterday=(base=riyadhToday())=>shiftDays(base,-1);
export const monthStart=(base=riyadhToday())=>`${base.slice(0,7)}-01`;
export function periodRange(days=30,today=riyadhToday()){
  return{from:shiftDays(today,-(days-1)),to:today,previousFrom:shiftDays(today,-(days*2-1)),previousTo:shiftDays(today,-days)};
}

// الخطأ لا يُبتلع إلى مصفوفة فارغة: «الجدول غير موجود» و«لا توجد حركات» شيئان
// مختلفان، وعرض الأول كالثاني يجعل القسم يكذب على المستخدم إلى الأبد.
async function fetchRange(from,to){
  const query=`transaction_date=gte.${from}&transaction_date=lte.${to}&select=transaction_date,plate_key,vehicle_name,vehicle_external_id,driver_name,station,fuel_type,liters,amount,curr_odometer,prev_odometer&order=transaction_date.desc&limit=5000`;
  try{return{rows:await select('fuel_transactions',query)||[],error:''};}
  catch(error){console.warn('[fuel fetch]',String(error?.message||'').slice(0,220));return{rows:[],error:storeFailureReason(error)};}
}
// التصفية تتم في الكود لا في الاستعلام: نوع الوقود نص حر من المحطة، وتصنيفه
// موحَّد بالفعل في المحلّل، فنستخدم التصنيف نفسه بدل تكرار أنماط ilike هشّة.
const inCategory=(row,category)=>category==='all'||fuelCategory(row?.fuel_type)===category;

function summarize(rows=[]){
  const totals={fills:rows.length,liters:0,amount:0,plates:new Set()};
  const byPlate=new Map();
  for(const row of rows){
    const liters=num(row.liters),amount=num(row.amount),plate=clean(row.plate_key)||'—';
    totals.liters+=liters;totals.amount+=amount;totals.plates.add(plate);
    const entry=byPlate.get(plate)||{plate,name:clean(row.vehicle_name)||plate,liters:0,amount:0,fills:0,km:0};
    entry.liters+=liters;entry.amount+=amount;entry.fills+=1;
    const prev=num(row.prev_odometer),curr=num(row.curr_odometer);
    if(curr>prev&&prev>0)entry.km+=curr-prev;
    byPlate.set(plate,entry);
  }
  const vehicles=[...byPlate.values()].map(row=>({...row,
    // لتر/100كم: المؤشر الحقيقي للكفاءة. يُحسب فقط عند توفر عدّاد سليم.
    per100:row.km>0?Number((row.liters/row.km*100).toFixed(1)):null
  })).sort((a,b)=>b.liters-a.liters);
  return{totals:{...totals,plates:totals.plates.size},vehicles};
}

// تعبئة مشبوهة: تكرار في اليوم نفسه للوحة، أو كمية شاذة مقابل معتاد المركبة،
// أو عدّاد راجع للخلف. كلها إشارات تحقيق لا اتهام، لذلك تُعرض كمراجعة.
function suspicious(rows=[],vehicles=[]){
  const flags=[],perDay=new Map(),average=new Map();
  for(const row of vehicles)if(row.fills>0)average.set(row.plate,row.liters/row.fills);
  for(const row of rows){
    const plate=clean(row.plate_key),key=`${plate}|${row.transaction_date}`;
    perDay.set(key,(perDay.get(key)||0)+1);
    const liters=num(row.liters),mean=average.get(plate)||0;
    if(mean>0&&liters>mean*2.5&&liters>50)flags.push({plate,name:clean(row.vehicle_name)||plate,date:row.transaction_date,text:`كمية ${liters.toFixed(0)} لتر ضعف المعتاد (${mean.toFixed(0)})`});
    const prev=num(row.prev_odometer),curr=num(row.curr_odometer);
    if(prev>0&&curr>0&&curr<prev)flags.push({plate,name:clean(row.vehicle_name)||plate,date:row.transaction_date,text:'عدّاد الكيلومترات راجع للخلف'});
  }
  for(const[key,count]of perDay)if(count>=3){const[plate,date]=key.split('|');flags.push({plate,name:plate,date,text:`${count} تعبئات في يوم واحد`});}
  return flags.slice(0,8);
}

// المدى يُصحَّح مرة واحدة هنا: مدى مقلوب يعيد صفرًا صامتًا فيبدو كأن لا حركات.
export function statementRange({from,to}={}){
  const start=isoDate(from)||monthStart(),end=isoDate(to)||yesterday();
  return start<=end?{from:start,to:end}:{from:end,to:start};
}

// التجميع منفصل عن الجلب ليُختبر على صفوف حقيقية بلا قاعدة بيانات.
export function buildStatement(all=[],{from,to,category='diesel'}={}){
  const rows=all.filter(row=>inCategory(row,category));
  const{totals,vehicles}=summarize(rows);
  const other=summarize(all.filter(row=>!inCategory(row,category)));
  // توزيع يومي يكشف القفزات: يوم واحد يبتلع نصف الفترة يظهر فورًا.
  const byDay=new Map();
  for(const row of rows){
    const day=clean(row.transaction_date).slice(0,10),entry=byDay.get(day)||{date:day,liters:0,amount:0,fills:0};
    entry.liters+=num(row.liters);entry.amount+=num(row.amount);entry.fills+=1;byDay.set(day,entry);
  }
  const days=[...byDay.values()].sort((a,b)=>b.date.localeCompare(a.date));
  const perLiter=totals.liters>0?totals.amount/totals.liters:0;
  return{from,to,category,rows,totals,vehicles,days,perLiter,otherTotals:other.totals,hasData:rows.length>0,hasAnyData:all.length>0};
}

// كشف حساب المركبات لفترة محددة: كم سحبت كل سيارة، بكم، وفي كم تعبئة. هذا هو
// المستند الذي يُراجَع عليه السائق والمحطة، فيُبنى على المدى المطلوب لا على
// «آخر N يومًا» فقط.
export async function loadFuelStatement({from,to,category='diesel'}={}){
  const range=statementRange({from,to});
  const fetched=await fetchRange(range.from,range.to);
  return{...buildStatement(fetched.rows,{...range,category}),error:fetched.error};
}

// كشف حساب سيارة واحدة: كل تعبئة بتاريخها ومحطتها وسائقها، لأن الإجمالي وحده
// لا يُراجَع عليه أحد.
export async function loadVehicleStatement(plate,{from,to,category='diesel'}={}){
  const statement=await loadFuelStatement({from,to,category});
  const key=normalizeFuelPlate(plate);
  const fills=statement.rows.filter(row=>normalizeFuelPlate(row.plate_key)===key)
    .map(row=>({date:clean(row.transaction_date).slice(0,10),liters:num(row.liters),amount:num(row.amount),station:clean(row.station),driver:clean(row.driver_name),price:num(row.liters)>0?num(row.amount)/num(row.liters):0}))
    .sort((a,b)=>b.date.localeCompare(a.date));
  const vehicle=statement.vehicles.find(row=>normalizeFuelPlate(row.plate)===key)||null;
  const liters=fills.reduce((sum,row)=>sum+row.liters,0),amount=fills.reduce((sum,row)=>sum+row.amount,0);
  return{...statement,plate:key,vehicle,fills,vehicleTotals:{fills:fills.length,liters,amount,perLiter:liters>0?amount/liters:0},
    share:statement.totals.liters>0?liters/statement.totals.liters*100:0};
}

export async function loadFuelAnalytics(days=30,{category='diesel'}={}){
  const range=periodRange(days);
  const[currentFetch,previousFetch]=await Promise.all([fetchRange(range.from,range.to),fetchRange(range.previousFrom,range.previousTo)]);
  const currentAll=currentFetch.rows,previousAll=previousFetch.rows;
  const current=currentAll.filter(row=>inCategory(row,category)),previous=previousAll.filter(row=>inCategory(row,category));
  const now=summarize(current),before=summarize(previous);
  // ملخص الأصناف الأخرى يظل ظاهرًا حتى لا يختفي البنزين من الصورة الكلية.
  const other=summarize(currentAll.filter(row=>!inCategory(row,category)));
  return{range,category,rows:current,...now,previousTotals:before.totals,otherTotals:other.totals,flags:suspicious(current,now.vehicles),hasData:current.length>0,hasAnyData:currentAll.length>0,error:currentFetch.error};
}
