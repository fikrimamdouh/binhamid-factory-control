import { requireAdmin } from '../_lib/auth.js';
import { json, method, errorResponse } from '../_lib/http.js';
import { select } from '../_lib/supabase.js';

const REQUIRED=[
  'app_users','user_channels','telegram_groups','telegram_messages','employees','vehicles','customers','bot_sessions',
  'maintenance_orders','approvals','audit_log','work_sites','employee_assignments','attendance_events','driver_events',
  'operational_records','sales_orders','sales_order_updates','inventory_items','inventory_movements','purchase_requests',
  'supplier_quotes','collection_events','quality_cases','operational_tasks','notification_outbox'
];

export default async function handler(req,res){
  if(!method(req,res,['GET']))return;
  try{
    requireAdmin(req);
    const results=await Promise.all(REQUIRED.map(async table=>{
      try{await select(table,'select=*&limit=1');return{table,ready:true};}
      catch(error){return{table,ready:false,error:error.message};}
    }));
    const missing=results.filter(x=>!x.ready);
    json(res,200,{ok:missing.length===0,ready:missing.length===0,total:results.length,available:results.filter(x=>x.ready).map(x=>x.table),missing});
  }catch(error){errorResponse(res,error);}
}
