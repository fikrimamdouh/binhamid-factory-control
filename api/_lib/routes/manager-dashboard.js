import { errorResponse, json, method } from '../http.js';
import { requireAdminOrDevice } from '../auth.js';
import { requireCapability } from '../permissions.js';
import { buildManagerSnapshot } from '../manager-metrics.js';
import { select } from '../supabase.js';

function params(req){return new URL(req.url||'/api/router',`https://${String(req.headers.host||'localhost')}`).searchParams;}
const safeSelect=async(table,query)=>{try{return await select(table,query)||[];}catch(error){console.warn(`[dashboard ${table}]`,error?.message||error);return[];}};
const importsQuery='select=id,source,department,report_type,status,original_name,mime_type,file_path,file_hash,row_count,error_count,warning_count,summary,submitted_by,source_chat_id,source_message_id,created_at,updated_at&order=created_at.desc&limit=250';
const messagePreview=row=>String(row.transcription||row.text||row.file_name||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,500);
function botActivity(rows=[],users=[]){
  const since=new Date(Date.now()-30*24*36e5).toISOString(),byExternal=new Map(users.map(user=>[String(user.external_id||''),user])),people=new Map(),actions=new Map();let incoming=0,outgoing=0,today=0;
  for(const row of rows){const direction=String(row.direction||'incoming');if(direction==='outgoing')outgoing++;else incoming++;if(String(row.created_at||'')>=new Date().toISOString().slice(0,10)+'T00:00:00Z')today++;
    if(direction!=='outgoing'&&row.sender_external_id&&row.sender_external_id!=='bot'){const key=String(row.sender_external_id),known=byExternal.get(key)||{},current=people.get(key)||{externalId:key,name:known.full_name||row.sender_name||key,role:known.role||row.sender_role||'pending',count:0,lastAt:null};current.count++;if(!current.lastAt||String(row.created_at)>current.lastAt)current.lastAt=row.created_at;people.set(key,current);}
    const action=String(row.action_name||'').trim();if(action){const current=actions.get(action)||0;actions.set(action,current+1);}
  }
  return{
    windowStart:since,incoming,outgoing,total:rows.length,today,activeUsers:people.size,
    topUsers:[...people.values()].sort((a,b)=>b.count-a.count).slice(0,15),
    topActions:[...actions.entries()].map(([action,count])=>({action,count})).sort((a,b)=>b.count-a.count).slice(0,15),
    recentActions:rows.filter(row=>row.action_name).slice(0,30).map(row=>({action:row.action_name,at:row.created_at,direction:row.direction||'incoming',senderName:row.sender_name||'',senderExternalId:row.sender_external_id||'',messageType:row.message_type||'text'})),
    recentMessages:rows.slice(0,100).map(row=>({at:row.created_at,direction:row.direction||'incoming',senderName:row.sender_name||'',senderExternalId:row.sender_external_id||'',senderRole:row.sender_role||'',messageType:row.message_type||'text',preview:messagePreview(row),fileName:row.file_name||'',deliveryStatus:row.delivery_status||''}))
  };
}

async function dashboardAccess(req){
  try{return{identity:await requireCapability(req,'dashboard.manager'),deviceInboxOnly:false};}
  catch(error){
    if(error?.code!=='APP_USER_REQUIRED')throw error;
    const identity=requireAdminOrDevice(req,'imports.read');
    if(identity.kind!=='device')throw error;
    return{identity,deviceInboxOnly:true};
  }
}

// ملاحظة: جدول app_users لا يحتوي عمود external_id، وtelegram_messages لا يحتوي
// sender_role. كان استدعاؤهما يُفشل الاستعلامين بالكامل عبر safeSelect فيرجعان
// فارغين بصمت، فتظهر كل الأدوار pending ويظهر سجل البوت فاضيًا رغم صحة البيانات.
export async function dashboard(req,res){
  if(!method(req,res,['GET']))return;
  try{
    const access=await dashboardAccess(req);
    if(access.deviceInboxOnly){
      const imports=await safeSelect('imports',importsQuery);
      return json(res,200,{ok:true,restricted:true,lastUpdated:new Date().toISOString(),imports,groups:[],users:[],snapshot:null,botActivity:null,automation:{twoWay:true,pollSeconds:15,approvalRequired:true,browserAssist:true,serverPosting:true}});
    }
    const p=params(req),day=String(p.get('day')||new Date().toISOString().slice(0,10)).slice(0,10),persist=p.get('persistAlerts')!=='false';
    const [snapshot,imports,groups,channels,appUsers,messages]=await Promise.all([
      buildManagerSnapshot(day,{persistAlerts:persist}),
      safeSelect('imports',importsQuery),
      safeSelect('telegram_groups','select=id,chat_id,title,department,active,status,last_seen_at,updated_at&order=last_seen_at.desc&limit=250'),
      safeSelect('user_channels','select=*&order=created_at.desc&limit=1000'),
      safeSelect('app_users','select=id,employee_external_id,full_name,nickname,role,active,created_at,updated_at&order=created_at.desc&limit=1000'),
      safeSelect('telegram_messages',`created_at=gte.${encodeURIComponent(new Date(Date.now()-30*24*36e5).toISOString())}&select=direction,sender_external_id,sender_name,message_type,text,transcription,file_name,delivery_status,action_name,created_at&order=created_at.desc&limit=10000`)
    ]);
    const appById=new Map(appUsers.map(row=>[String(row.id),row]));
    const users=channels.map(channel=>{
      const user=appById.get(String(channel.app_user_id||channel.user_id||''))||{};
      return{id:user.id||channel.app_user_id||null,full_name:user.full_name||channel.full_name||channel.external_username||'',external_username:channel.external_username||channel.username||'',external_id:String(channel.external_id||channel.channel_user_id||user.external_id||''),employee_external_id:user.employee_external_id||null,role:user.role||channel.role||'pending',active:user.active!==false&&channel.active!==false,created_at:channel.created_at||user.created_at||null};
    });
    for(const user of appUsers)if(!users.some(row=>String(row.id)===String(user.id)))users.push({...user,external_username:'',external_id:String(user.external_id||'')});
    json(res,200,{ok:true,restricted:false,snapshot,lastUpdated:snapshot.generatedAt,imports,groups,users,botActivity:botActivity(messages,users),automation:{twoWay:true,pollSeconds:15,approvalRequired:true,browserAssist:true,serverPosting:true}});
  }catch(error){errorResponse(res,error);}
}
