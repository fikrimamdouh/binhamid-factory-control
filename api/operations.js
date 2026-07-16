import { requireAdmin } from './_lib/auth.js';
import { json, method, errorResponse } from './_lib/http.js';
import { select } from './_lib/supabase.js';

const clamp=(value,min,max,fallback)=>{const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.trunc(n))):fallback;};
function params(req){return new URL(req.url||'/api/operations',`https://${String(req.headers.host||'localhost')}`).searchParams;}

export default async function handler(req,res){
  if(!method(req,res,['GET']))return;
  try{
    requireAdmin(req);
    const p=params(req),department=String(p.get('department')||''),status=String(p.get('status')||''),entityType=String(p.get('entityType')||''),limit=clamp(p.get('limit'),1,500,100);
    const filters=[];
    if(department)filters.push(`department=eq.${encodeURIComponent(department)}`);
    if(status)filters.push(`status=eq.${encodeURIComponent(status)}`);
    if(entityType)filters.push(`entity_type=eq.${encodeURIComponent(entityType)}`);
    const query=[...filters,'select=id,reference_no,entity_type,department,status,title,summary,amount,payload,created_by,assigned_to,source_channel,source_chat_id,source_message_id,created_at,updated_at,closed_at','order=updated_at.desc',`limit=${limit}`].join('&');
    const records=await select('operational_records',query);
    const [sales,purchases,tasks,quality,collections]=await Promise.all([
      select('sales_orders','select=id,status,sales_type,total_amount,delivery_date&limit=2000'),
      select('purchase_requests','select=id,status,urgency&limit=2000'),
      select('operational_tasks','select=id,status,priority,due_at&limit=2000'),
      select('quality_cases','select=id,status,severity&limit=2000'),
      select('collection_events','select=id,status,amount,occurred_at&limit=2000')
    ]);
    const open=value=>!['closed','completed','cancelled','collected','rejected'].includes(String(value||''));
    json(res,200,{ok:true,counts:{
      sales_open:(sales||[]).filter(x=>open(x.status)).length,
      sales_overdue:(sales||[]).filter(x=>open(x.status)&&x.delivery_date&&x.delivery_date<new Date().toISOString().slice(0,10)).length,
      purchase_open:(purchases||[]).filter(x=>open(x.status)).length,
      purchase_urgent:(purchases||[]).filter(x=>open(x.status)&&['urgent','critical'].includes(x.urgency)).length,
      tasks_open:(tasks||[]).filter(x=>open(x.status)).length,
      tasks_overdue:(tasks||[]).filter(x=>open(x.status)&&x.due_at&&new Date(x.due_at)<new Date()).length,
      quality_open:(quality||[]).filter(x=>open(x.status)).length,
      collections_total:(collections||[]).reduce((sum,x)=>sum+Number(x.amount||0),0)
    },records:records||[]});
  }catch(error){errorResponse(res,error);}
}
