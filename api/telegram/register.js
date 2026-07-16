import { requireAdmin } from '../_lib/auth.js';
import { config } from '../_lib/config.js';
import { json, method, body, errorResponse } from '../_lib/http.js';
import { telegram } from '../_lib/telegram.js';

const commands={
  en:[['start','Start the smart employee assistant'],['menu','Open your role-based operations menu'],['attendance','Check in, check out and driver movement'],['tasks','Show your open tasks'],['reports','Management reports'],['sales','Block and concrete sales orders'],['workshop','Workshop and mechanic menu'],['suppliers','Search suppliers and request quotations'],['gps','Fleet GPS status'],['status','System link and last synchronization'],['whoami','Show your account role and status']],
  ar:[['start','تشغيل الموظف الذكي وعرض لوحة دورك'],['menu','فتح لوحة العمليات الرئيسية'],['attendance','الحضور والانصراف وحركة السائق'],['tasks','عرض المهام المفتوحة المرتبطة بك'],['reports','عرض تقارير الإدارة المتاحة'],['sales','فتح أوامر بيع البلوك والخرسانة'],['workshop','فتح قائمة الورشة والميكانيكي'],['suppliers','بحث عن قطعة أو مورد وطلب عرض سعر'],['gps','عرض حالة الأسطول من نظام التتبع'],['status','عرض حالة الربط وآخر مزامنة'],['whoami','عرض رقم الحساب والدور والصلاحية']],
  hi:[['start','स्मार्ट कर्मचारी सहायक शुरू करें'],['menu','अपना कार्य मेनू खोलें'],['attendance','उपस्थिति, प्रस्थान और ड्राइवर गतिविधि'],['tasks','अपने खुले कार्य देखें'],['reports','प्रबंधन रिपोर्ट'],['sales','ब्लॉक और कंक्रीट बिक्री आदेश'],['workshop','वर्कशॉप और मैकेनिक मेनू'],['suppliers','आपूर्तिकर्ता खोजें और कोटेशन माँगें'],['gps','फ्लीट GPS स्थिति'],['status','सिस्टम लिंक और अंतिम सिंक'],['whoami','अपनी भूमिका और स्थिति देखें']],
  bn:[['start','স্মার্ট কর্মচারী সহকারী চালু করুন'],['menu','আপনার কাজের মেনু খুলুন'],['attendance','উপস্থিতি, প্রস্থান ও চালকের চলাচল'],['tasks','আপনার খোলা কাজ দেখুন'],['reports','ব্যবস্থাপনা রিপোর্ট'],['sales','ব্লক ও কংক্রিট বিক্রয় আদেশ'],['workshop','ওয়ার্কশপ এবং মেকানিক মেনু'],['suppliers','সরবরাহকারী খুঁজুন ও কোটেশন চান'],['gps','বহরের GPS অবস্থা'],['status','সিস্টেম সংযোগ ও সর্বশেষ সিঙ্ক'],['whoami','আপনার ভূমিকা ও অবস্থা দেখুন']],
  ur:[['start','سمارٹ ملازم معاون شروع کریں'],['menu','اپنا کام کا مینو کھولیں'],['attendance','حاضری، روانگی اور ڈرائیور حرکت'],['tasks','اپنے کھلے کام دیکھیں'],['reports','انتظامی رپورٹس'],['sales','بلاک اور کنکریٹ سیلز آرڈر'],['workshop','ورکشاپ اور مکینک مینو'],['suppliers','سپلائر تلاش کریں اور کوٹیشن مانگیں'],['gps','فلیٹ GPS حالت'],['status','سسٹم رابطہ اور آخری ہم وقت سازی'],['whoami','اپنا کردار اور حالت دیکھیں']]
};
const mapped=language=>commands[language].map(([command,description])=>({command,description}));
const statusPayload=info=>({ok:true,configured:Boolean(info?.url),url:String(info?.url||''),enterprise_v3:/\/api\/telegram\/webhook-v3$/.test(String(info?.url||'')),pending_update_count:Number(info?.pending_update_count||0),max_connections:Number(info?.max_connections||0),last_error_date:info?.last_error_date||null,last_error_message:info?.last_error_message||'',allowed_updates:info?.allowed_updates||[]});

export default async function handler(req,res){
  if(!method(req,res,['GET','POST']))return;
  try{
    requireAdmin(req);
    if(req.method==='GET')return json(res,200,statusPayload(await telegram('getWebhookInfo')));
    const input=await body(req),proto=String(req.headers['x-forwarded-proto']||'https').split(',')[0],host=String(req.headers['x-forwarded-host']||req.headers.host||''),base=String(input.baseUrl||`${proto}://${host}`).replace(/\/$/,'');
    if(!/^https:\/\//.test(base))throw Object.assign(new Error('رابط HTTPS صحيح مطلوب'),{status:400});
    const url=`${base}/api/telegram/webhook-v3`;
    await telegram('setWebhook',{url,secret_token:config.telegramSecret,allowed_updates:['message','edited_message','callback_query','my_chat_member'],drop_pending_updates:false,max_connections:20});
    await telegram('setMyCommands',{commands:mapped('en')});
    for(const language of ['ar','hi','bn','ur'])await telegram('setMyCommands',{commands:mapped(language),language_code:language});
    const info=await telegram('getWebhookInfo');
    if(String(info?.url||'')!==url)throw Object.assign(new Error('Telegram لم يثبت رابط Webhook الجديد'),{status:502});
    json(res,200,{...statusPayload(info),commandsRegistered:true,languages:['en','ar','hi','bn','ur'],enterpriseWebhook:true,version:6});
  }catch(error){errorResponse(res,error);}
}
