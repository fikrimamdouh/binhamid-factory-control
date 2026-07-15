import { requireAdmin } from '../_lib/auth.js';
import { json, method, body, errorResponse } from '../_lib/http.js';
import { sendMessage } from '../_lib/telegram.js';
export default async function handler(req,res){if(!method(req,res,['POST']))return;try{requireAdmin(req);const input=await body(req);if(!input.chatId)throw Object.assign(new Error('Chat ID مطلوب'),{status:400});const result=await sendMessage(String(input.chatId),'تم ربط <b>مساعد مصنع بن حامد</b> بالخادم بنجاح.\n\nأرسل /whoami لعرض رقم حسابك، أو اكتب <b>تقارير</b> لفتح قائمة التقارير.');json(res,200,{ok:true,messageId:result.message_id});}catch(error){errorResponse(res,error);}}
