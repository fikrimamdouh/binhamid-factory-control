import { requireAdmin } from '../_lib/auth.js';
import { config } from '../_lib/config.js';
import { json, method, body, errorResponse } from '../_lib/http.js';
import { telegram } from '../_lib/telegram.js';
export default async function handler(req,res){
  if(!method(req,res,['POST']))return;
  try{
    requireAdmin(req);
    const input=await body(req),proto=String(req.headers['x-forwarded-proto']||'https').split(',')[0],host=String(req.headers['x-forwarded-host']||req.headers.host||''),base=String(input.baseUrl||`${proto}://${host}`).replace(/\/$/,'');
    if(!/^https:\/\//.test(base))throw Object.assign(new Error('رابط HTTPS صحيح مطلوب'),{status:400});
    const url=`${base}/api/telegram/webhook`;
    await telegram('setWebhook',{url,secret_token:config.telegramSecret,allowed_updates:['message','edited_message','callback_query','my_chat_member'],drop_pending_updates:false,max_connections:20});
    await telegram('setMyCommands',{commands:[
      {command:'start',description:'تشغيل الموظف الذكي وعرض جميع الإمكانات'},
      {command:'help',description:'عرض المساعدة وقائمة الأوامر'},
      {command:'reports',description:'عرض تقارير الإدارة المتاحة'},
      {command:'status',description:'عرض حالة الربط وآخر مزامنة'},
      {command:'whoami',description:'عرض رقم الحساب والدور والصلاحية'}
    ],language_code:'ar'});
    json(res,200,{ok:true,url,commandsRegistered:true});
  }catch(error){errorResponse(res,error);}
}
