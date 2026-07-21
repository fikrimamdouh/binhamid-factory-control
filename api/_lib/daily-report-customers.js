const cleanText=(value,max=500)=>String(value??'').trim().replace(/\s+/g,' ').slice(0,max);
const nameKey=value=>cleanText(value).toLocaleLowerCase('ar');

// مهلة السداد الافتراضية المعتمدة في المصنع لكل عميل جديد.
const DEFAULT_PAYMENT_DAYS=3;

export function buildDailyReportCustomerContext(payload={},customers=[]){
  const errors=[],warnings=[],customerMap=new Map(),keyOwners=new Map();
  for(const customer of customers||[]){
    for(const key of [customer.external_id,customer.customer_code].map(value=>cleanText(value,120)).filter(Boolean)){
      const previous=keyOwners.get(key);
      if(previous&&previous.id!==customer.id){
        errors.push({code:'CUSTOMER_CODE_AMBIGUOUS',path:`customer:${key}`,message:`كود العميل مرتبط بأكثر من سجل: ${key}`});
        continue;
      }
      keyOwners.set(key,customer);customerMap.set(key,customer);
    }
  }

  const candidates=new Map();
  const addCandidate=(code,name,path)=>{
    const cleanCode=cleanText(code,120),cleanName=cleanText(name,500);
    if(!cleanCode)return;
    const item=candidates.get(cleanCode)||{code:cleanCode,names:new Map(),paths:[]};
    item.paths.push(path);
    if(cleanName)item.names.set(nameKey(cleanName),cleanName);
    candidates.set(cleanCode,item);
  };
  for(const [index,row] of (payload.sales||[]).entries())addCandidate(row.customerCode,row.customerName,`sales[${index}]`);
  for(const [index,row] of (payload.cashMovements||[]).entries())if(row.isCustomerCollection)addCandidate(row.accountCode,row.accountName,`cashMovements[${index}]`);

  const pending=[];
  for(const candidate of candidates.values()){
    const existing=customerMap.get(candidate.code);
    const names=[...candidate.names.values()];
    if(existing){
      if(existing.active===false){
        errors.push({code:'CUSTOMER_INACTIVE',path:`customer:${candidate.code}`,message:`العميل غير نشط: ${candidate.code}`});
        continue;
      }
      const expected=cleanText(existing.customer_name,500),expectedKey=nameKey(expected);
      for(const name of names)if(expected&&nameKey(name)!==expectedKey)warnings.push({code:'CUSTOMER_NAME_MISMATCH',path:`customer:${candidate.code}`,message:`اسم العميل في التقرير لا يطابق الاسم المسجل للكود ${candidate.code}`,expected,actual:name});
      continue;
    }
    if(names.length===0){
      errors.push({code:'CUSTOMER_NAME_REQUIRED',path:`customer:${candidate.code}`,message:`اسم العميل مطلوب لإنشاء الكود الجديد ${candidate.code}`});
      continue;
    }
    if(names.length>1){
      errors.push({code:'CUSTOMER_NAME_CONFLICT',path:`customer:${candidate.code}`,message:`يوجد أكثر من اسم لنفس كود العميل ${candidate.code}`,names});
      continue;
    }
    // العميل الجديد يرث مهلة السداد المعتمدة للمصنع (3 أيام) مثل بقية العملاء،
    // بدل صفر يوم الذي كان يجعله مستحقًا فورًا ويظهر خطأً ضمن المتأخرات.
    const virtual={id:null,external_id:candidate.code,customer_code:candidate.code,customer_name:names[0],credit_limit:0,payment_days:DEFAULT_PAYMENT_DAYS,active:true,pendingCreation:true};
    customerMap.set(candidate.code,virtual);pending.push(virtual);
    warnings.push({code:'CUSTOMER_WILL_BE_CREATED',path:`customer:${candidate.code}`,message:`سيتم إنشاء العميل ${candidate.code} عند اعتماد التقرير`,customerCode:candidate.code,customerName:names[0]});
  }

  return{customerMap,errors,warnings,pendingCustomers:pending};
}
