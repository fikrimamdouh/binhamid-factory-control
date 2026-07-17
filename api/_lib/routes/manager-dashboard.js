import { errorResponse, json, method } from '../http.js';
import { requireCapability } from '../permissions.js';
import { buildManagerSnapshot } from '../manager-metrics.js';
import { select } from '../supabase.js';

function params(req){return new URL(req.url||'/api/router',`https://${String(req.headers.host||'localhost')}`).searchParams;}
const safeSelect=async(table,query)=>{try{return await select(table,query)||[];}catch(error){console.warn(`[dashboard ${table}]`,error?.message||error);return[];}};

export async function dashboard(req,res){
  if(!method(req,res,['GET']))return;
  try{
    await requireCapability(req,'dashboard.manager');
    const p=params(req),day=String(p.get('day')||new Date().toISOString().slice(0,10)).slice(0,10),persist=p.get('persistAlerts')!=='false';
    const [snapshot,imports,groups,channels,appUsers]=await Promise.all([
      buildManagerSnapshot(day,{persistAlerts:persist}),
      safeSelect('imports','select=id,source,department,report_type,status,original_name,mime_type,file_path,file_hash,row_count,error_count,warning_count,summary,submitted_by,source_chat_id,source_message_id,created_at,updated_at&order=created_at.desc&limit=250'),
      safeSelect('telegram_groups','select=id,chat_id,title,department,active,status,last_seen_at,updated_at&order=last_seen_at.desc&limit=250'),
      safeSelect('user_channels','select=*&order=created_at.desc&limit=1000'),
      safeSelect('app_users','select=id,external_id,employee_external_id,full_name,role,active,created_at,updated_at&order=created_at.desc&limit=1000')
    ]);
    const appById=new Map(appUsers.map(row=>[String(row.id),row]));
    const users=channels.map(channel=>{
      const user=appById.get(String(channel.app_user_id||channel.user_id||''))||{};
      return{id:user.id||channel.app_user_id||null,full_name:user.full_name||channel.full_name||channel.external_username||'',external_username:channel.external_username||channel.username||'',external_id:String(channel.external_id||channel.channel_user_id||user.external_id||''),employee_external_id:user.employee_external_id||null,role:user.role||channel.role||'pending',active:user.active!==false&&channel.active!==false,created_at:channel.created_at||user.created_at||null};
    });
    for(const user of appUsers)if(!users.some(row=>String(row.id)===String(user.id)))users.push({...user,external_username:'',external_id:String(user.external_id||'')});
    json(res,200,{ok:true,snapshot,lastUpdated:snapshot.generatedAt,imports,groups,users,automation:{twoWay:true,pollSeconds:15,approvalRequired:true}});
  }catch(error){errorResponse(res,error);}
}
