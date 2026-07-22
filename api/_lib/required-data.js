import { select } from './supabase.js';

function dataReadError(table,label,code,error){
  const message=`تعذر قراءة ${label}. لم يتم إصدار نتيجة ناقصة أو افتراض أرقام صفرية.`;
  return Object.assign(new Error(message),{
    status:503,
    code:code||'REQUIRED_DATA_READ_FAILED',
    retryable:true,
    sourceTable:table,
    cause:error
  });
}

export async function requiredSelect(table,query,label=table,code='REQUIRED_DATA_READ_FAILED'){
  try{
    const rows=await select(table,query);
    return Array.isArray(rows)?rows:[];
  }catch(error){
    throw dataReadError(table,label,code,error);
  }
}

export async function requiredSingle(table,query,label=table,code='REQUIRED_DATA_READ_FAILED'){
  const rows=await requiredSelect(table,query,label,code);
  return rows[0]||null;
}
