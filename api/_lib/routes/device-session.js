import { requireAdmin } from '../auth.js';
import { body, errorResponse, json, method } from '../http.js';
import { assertSameOrigin, issueDeviceSession, readDeviceSession } from '../device-session.js';
import { insert, patch, rpc, select } from '../supabase.js';

const validDevice=value=>/^dev-[A-Za-z0-9-]{8,150}$/.test(String(value||''));
const validUser=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||''));
async function approvedBinding(deviceId){
  const enrollment=(await select('device_enrollments',`device_id=eq.${encodeURIComponent(deviceId)}&status=eq.approved&select=device_id,app_user_id,status&limit=1`).catch(()=>[]))?.[0];if(!enrollment?.app_user_id)return null;
  const user=(await select('app_users',`id=eq.${encodeURIComponent(enrollment.app_user_id)}&active=eq.true&select=id,role,active&limit=1`).catch(()=>[]))?.[0];return user?{enrollment,user}:null;
}
async function recordPending(req,deviceId){
  const existing=(await select('device_enrollments',`device_id=eq.${encodeURIComponent(deviceId)}&select=device_id,status&limit=1`).catch(()=>[]))?.[0],stamp=new Date().toISOString(),metadata={user_agent:String(req.headers['user-agent']||'').slice(0,300),forwarded_for:String(req.headers['x-forwarded-for']||'').split(',')[0].trim().slice(0,80)};
  if(existing)return patch('device_enrollments',`device_id=eq.${encodeURIComponent(deviceId)}`,{last_seen_at:stamp,updated_at:stamp,metadata}).catch(()=>[]);
  return insert('device_enrollments',[{device_id:deviceId,status:'pending',requested_at:stamp,last_seen_at:stamp,updated_at:stamp,requested_from:metadata,metadata}],{prefer:'return=minimal'}).catch(error=>{if(Number(error?.upstreamStatus||0)!==409)console.warn('[device enrollment pending]',{status:error?.upstreamStatus||0,code:error?.code||null});return[];});
}

export async function deviceSession(req,res){
  if(!method(req,res,['POST']))return;
  try{
    assertSameOrigin(req);const input=await body(req,4096),deviceId=String(input.deviceId||'');if(!validDevice(deviceId))throw Object.assign(new Error('معرف الجهاز غير صالح'),{status:400,code:'DEVICE_ID_INVALID'});
    if(input.action==='bind'){
      const admin=requireAdmin(req),appUserId=String(input.appUserId||'');if(!validUser(appUserId))throw Object.assign(new Error('معرف المستخدم المطلوب ربطه غير صالح'),{status:400,code:'DEVICE_APP_USER_INVALID'});
      await rpc('approve_device_enrollment',{p_device_id:deviceId,p_app_user_id:appUserId,p_actor:admin.actor});const session=issueDeviceSession(req,res,deviceId,appUserId);return json(res,200,{ok:true,mode:'approved-device-session',deviceId:session.deviceId,bound:true,expiresAt:new Date(session.exp*1000).toISOString()});
    }
    if(input.action==='revoke'){
      const admin=requireAdmin(req);await rpc('revoke_device_enrollment',{p_device_id:deviceId,p_actor:admin.actor});const session=issueDeviceSession(req,res,deviceId,'');return json(res,200,{ok:true,mode:'revoked-device-session',deviceId:session.deviceId,bound:false,needsApproval:true,expiresAt:new Date(session.exp*1000).toISOString()});
    }
    const binding=await approvedBinding(deviceId),current=readDeviceSession(req),existingUser=current?.deviceId===deviceId?current.appUserId:'';await recordPending(req,deviceId);const session=issueDeviceSession(req,res,deviceId,binding?.user?.id||existingUser||'');
    json(res,200,{ok:true,mode:binding?'approved-device-session':'automatic-device-session',deviceId:session.deviceId,bound:Boolean(session.appUserId),needsApproval:!session.appUserId,expiresAt:new Date(session.exp*1000).toISOString()});
  }catch(error){errorResponse(res,error);}
}
