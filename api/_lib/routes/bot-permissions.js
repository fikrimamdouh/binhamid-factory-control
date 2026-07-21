import { requireCapability } from '../permissions.js';
import { body, errorResponse, json, method } from '../http.js';
import { insert, remove, select, upsert } from '../supabase.js';
import { ROLES } from '../domain.js';
import { config } from '../config.js';
import { BOT_MENU_CATALOG, BOT_MENU_PREFIX, botMenuCapability, clearBotMenuPolicyCache, defaultBotModulesForRole } from '../bot-menu-permissions.js';

const clean=value=>String(value??'').trim();
const ownerId=()=>clean(config.telegramOwnerId);
async function resolveTelegramUser(externalId){
  const rows=await select('user_channels',`channel=eq.telegram&external_id=eq.${encodeURIComponent(externalId)}&select=user_id,external_id,app_users(id,full_name,role,active)&limit=1`),row=rows?.[0];
  if(!row?.user_id||!row?.app_users)throw Object.assign(new Error('مستخدم Telegram غير موجود أو لم يُعتمد بعد'),{status:404,code:'BOT_USER_NOT_FOUND'});
  return{userId:String(row.user_id),externalId:String(row.external_id),fullName:row.app_users.full_name||'',role:row.app_users.role||'pending',active:row.app_users.active!==false,isOwner:String(row.external_id)===ownerId()};
}
async function loadOverrides(userId){
  const rows=await select('user_capabilities',`app_user_id=eq.${encodeURIComponent(userId)}&select=capability,allowed&limit=500`).catch(()=>[]),result={};
  for(const row of rows||[]){const capability=clean(row.capability);if(capability.startsWith(BOT_MENU_PREFIX))result[capability.slice(BOT_MENU_PREFIX.length)]=Boolean(row.allowed);}
  return result;
}
function catalogFor(role,isOwner,overrides){
  const defaults=defaultBotModulesForRole(role);
  return BOT_MENU_CATALOG.map(item=>{
    const override=Object.prototype.hasOwnProperty.call(overrides,item.id)?Boolean(overrides[item.id]):null;
    const effective=item.ownerOnly?isOwner:(override===null?defaults.has(item.id):override);
    return{...item,defaultEnabled:item.ownerOnly?isOwner:defaults.has(item.id),override,effective,locked:Boolean(item.ownerOnly)};
  });
}
export async function botPermissions(req,res){
  if(!method(req,res,['GET','POST']))return;
  try{
    const actor=await requireCapability(req,'users.manage');
    if(req.method==='GET'){
      const externalId=clean(req.query?.externalId),previewRole=clean(req.query?.role);
      if(!externalId)throw Object.assign(new Error('Telegram ID مطلوب'),{status:400,code:'BOT_EXTERNAL_ID_REQUIRED'});
      const user=await resolveTelegramUser(externalId),role=ROLES.includes(previewRole)?previewRole:user.role,overrides=await loadOverrides(user.userId);
      return json(res,200,{ok:true,user:{...user,role},catalog:catalogFor(role,user.isOwner,overrides),overrides});
    }
    const input=await body(req),externalId=clean(input.externalId),user=await resolveTelegramUser(externalId),values=input.overrides&&typeof input.overrides==='object'?input.overrides:{},known=new Set(BOT_MENU_CATALOG.map(item=>item.id)),changed=[];
    for(const [id,raw] of Object.entries(values)){
      if(!known.has(id))continue;const item=BOT_MENU_CATALOG.find(row=>row.id===id);if(item?.ownerOnly)continue;
      const capability=botMenuCapability(id);
      if(raw===null||raw==='inherit'||raw==='default'){
        await remove('user_capabilities',`app_user_id=eq.${encodeURIComponent(user.userId)}&capability=eq.${encodeURIComponent(capability)}`).catch(()=>[]);changed.push({id,mode:'inherit'});continue;
      }
      const allowed=raw===true||raw==='allow'||raw==='enabled';
      await upsert('user_capabilities',[{app_user_id:user.userId,capability,allowed}],'app_user_id,capability');changed.push({id,mode:allowed?'allow':'deny'});
    }
    clearBotMenuPolicyCache();
    await insert('audit_log',[{actor_type:'web',actor_id:actor.appUserId||actor.actor||'admin',action:'bot_menu_permissions_update',entity_type:'app_user',entity_id:user.userId,details:{externalId,changed}}],{prefer:'return=minimal'}).catch(()=>{});
    const overrides=await loadOverrides(user.userId);return json(res,200,{ok:true,user,catalog:catalogFor(user.role,user.isOwner,overrides),overrides,changed});
  }catch(error){errorResponse(res,error);}
}
