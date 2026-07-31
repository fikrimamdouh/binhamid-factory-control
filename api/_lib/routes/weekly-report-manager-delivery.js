import crypto from 'node:crypto';
import { errorResponse, json, method } from '../http.js';
import { config } from '../config.js';
import { select } from '../supabase.js';
import { sendMessage } from '../telegram.js';

const REPOSITORY='fikrimamdouh/binhamid-factory-control';
const ISSUER='https://token.actions.githubusercontent.com';
const AUDIENCE='binhamid-weekly-manager-delivery';
const WORKFLOW='/.github/workflows/deliver-weekly-report-to-managers.yml@refs/heads/main';
let cache={expires:0,keys:[]};
const clean=(value,max=4000)=>String(value??'').trim().slice(0,max);
const decode=value=>{try{return JSON.parse(Buffer.from(value,'base64url').toString('utf8'));}catch{return null;}};
const audiences=value=>Array.isArray(value)?value:[value];

async function keys(){
  if(cache.expires>Date.now()&&cache.keys.length)return cache.keys;
  const response=await fetch(`${ISSUER}/.well-known/jwks`);
  if(!response.ok)throw Object.assign(new Error('تعذر التحقق من هوية التشغيل'),{status:502});
  const data=await response.json();cache={expires:Date.now()+3600000,keys:data.keys||[]};return cache.keys;
}
async function authorize(req){
  const auth=clean(req.headers?.authorization,3000);if(!auth.startsWith('Bearer '))throw Object.assign(new Error('الهوية مطلوبة'),{status:401});
  const parts=auth.slice(7).split('.'),header=decode(parts[0]),claims=decode(parts[1]);if(parts.length!==3||!header||!claims)throw Object.assign(new Error('هوية غير صالحة'),{status:401});
  const key=(await keys()).find(item=>item.kid===header.kid),now=Math.floor(Date.now()/1000);if(!key)throw Object.assign(new Error('مفتاح غير معروف'),{status:401});
  const valid=crypto.verify('RSA-SHA256',Buffer.from(`${parts[0]}.${parts[1]}`),crypto.createPublicKey({key,format:'jwk'}),Buffer.from(parts[2],'base64url'));
  if(!valid||claims.iss!==ISSUER||!audiences(claims.aud).includes(AUDIENCE)||claims.repository!==REPOSITORY||claims.ref!=='refs/heads/main'||!String(claims.workflow_ref||'').includes(WORKFLOW)||Number(claims.exp||0)<=now)throw Object.assign(new Error('هوية التشغيل غير معتمدة'),{status:403});
}

export async function deliverWeeklyReportToManagers(req,res){
  if(!method(req,res,['POST']))return;
  try{
    await authorize(req);
    const source=(await select('telegram_messages','direction=eq.outgoing&delivery_status=eq.sent&action_name=eq.weekly_executive_report&select=text,action_payload,created_at&order=created_at.desc&limit=1'))?.[0];
    if(!source?.text)throw Object.assign(new Error('لا يوجد تقرير أسبوعي مرسل'),{status:404});
    const users=await select('app_users','active=eq.true&role=eq.manager&select=id,full_name&limit=100')||[];
    if(!users.length)throw Object.assign(new Error('لا يوجد مدير مصنع معتمد'),{status:404});
    const ids=users.map(item=>item.id).join(','),channels=await select('user_channels',`active=eq.true&channel=eq.telegram&user_id=in.(${ids})&select=user_id,external_id&limit=200`)||[],names=new Map(users.map(item=>[String(item.id),String(item.full_name||'مدير المصنع')]));
    const recipients=channels.filter(item=>item.external_id&&String(item.external_id)!==String(config.telegramOwnerId));
    if(!recipients.length)throw Object.assign(new Error('لا يوجد حساب تيليجرام فعال لمدير المصنع بخلاف المالك'),{status:404});
    const results=[];
    for(const item of recipients){const sent=await sendMessage(String(item.external_id),String(source.text),{disable_voice_reply:true,action_name:'weekly_executive_report_manager_delivery',action_payload:{source_created_at:source.created_at,period:source.action_payload||null,target_user_id:item.user_id}});results.push({userId:String(item.user_id),name:names.get(String(item.user_id)),messageId:sent?.message_id||null});}
    return json(res,200,{ok:true,sent:results.length,recipients:results});
  }catch(error){return errorResponse(res,error);}
}
