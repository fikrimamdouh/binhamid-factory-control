import { json, method, body, errorResponse } from '../http.js';
import { upsert, select, remove } from '../supabase.js';
import { requireAdminOrDevice } from '../auth.js';

// الأرصدة الافتتاحية للعملاء — جدول مستقل يُرفع على دفعات صغيرة بدل تضمينها
// في سجل الحالة الموحد الذي تجاوز حجمه مهلة قاعدة البيانات وأفشل كل مزامنة.

const num=value=>{const parsed=Number(value);return Number.isFinite(parsed)?parsed:0;};
const text=(value,max=200)=>String(value??'').trim().slice(0,max);

function cleanRow(row){
  const customerCode=text(row?.customerCode||row?.customer_code,60);
  if(!customerCode)return null;
  return{
    customer_code:customerCode,
    customer_name:text(row?.customerName||row?.customer_name,200),
    client_id:text(row?.clientId||row?.client_id,80)||null,
    balance:num(row?.amount??row?.balance),
    previous:num(row?.previous),
    debit:num(row?.debit),
    credit:num(row?.credit),
    cheques:num(row?.cheques),
    difference:num(row?.difference),
    balance_date:text(row?.date||row?.balance_date,20)||null,
    source_file:text(row?.sourceFile||row?.source_file,200)||null,
    updated_at:new Date().toISOString()
  };
}

export async function openingBalances(req,res){
  if(!method(req,res,['GET','POST']))return;
  try{
    if(req.method==='GET'){
      requireAdminOrDevice(req,'state.read');
      const p=new URL(req.url,'http://x').searchParams;
      if(p.get('summary')==='1'){
        const rows=await select('customer_opening_balances','select=customer_code&limit=10000').catch(()=>null);
        if(rows===null)return json(res,200,{ok:true,tableReady:false,count:0});
        return json(res,200,{ok:true,tableReady:true,count:rows.length});
      }
      const rows=await select('customer_opening_balances','select=*&order=balance.desc&limit=10000');
      return json(res,200,{ok:true,rows:rows||[],count:(rows||[]).length});
    }
    requireAdminOrDevice(req,'state.write');
    const input=await body(req,2_000_000);
    // مسح متعمد وصريح فقط (قبل استيراد ملف ميزان جديد كامل).
    if(input.action==='clear'){
      if(input.confirm!=='مسح الأرصدة الافتتاحية')throw Object.assign(new Error('تأكيد المسح غير صحيح'),{status:400});
      await remove('customer_opening_balances','customer_code=neq.__none__');
      return json(res,200,{ok:true,cleared:true});
    }
    const rows=(Array.isArray(input.rows)?input.rows:[]).map(cleanRow).filter(Boolean);
    if(!rows.length)throw Object.assign(new Error('لا توجد صفوف أرصدة في الدفعة'),{status:400});
    if(rows.length>400)throw Object.assign(new Error('الدفعة كبيرة — الحد 400 صفًا لكل دفعة'),{status:400});
    try{
      await upsert('customer_opening_balances',rows,'customer_code');
    }catch(error){
      if(/does not exist|schema cache/i.test(String(error?.message||'')))
        throw Object.assign(new Error('جدول الأرصدة الافتتاحية غير مجهز بعد. شغّل migration رقم 025 في Supabase ثم أعد الرفع.'),{status:503,code:'OPENING_TABLE_MISSING'});
      throw error;
    }
    return json(res,200,{ok:true,upserted:rows.length});
  }catch(error){errorResponse(res,error);}
}
