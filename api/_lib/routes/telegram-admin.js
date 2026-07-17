import { requireAdmin } from '../auth.js';
import { config } from '../config.js';
import { json, method, body, errorResponse } from '../http.js';
import { telegram, sendMessage } from '../telegram.js';

const commands={
  en:[{command:'start',description:'Start the smart employee assistant'},{command:'menu',description:'Open your role-based operations menu'},{command:'attendance',description:'Check in, check out and driver movement'},{command:'tasks',description:'Show your open tasks'},{command:'reports',description:'Management reports'},{command:'sales',description:'Block and concrete sales orders'},{command:'workshop',description:'Workshop and mechanic menu'},{command:'suppliers',description:'Search suppliers and request quotations'},{command:'gps',description:'Fleet GPS status'},{command:'status',description:'System link and last synchronization'},{command:'whoami',description:'Show your account role and status'}],
  ar:[{command:'start',description:'تشغيل الموظف الذكي وعرض لوحة دورك'},{command:'menu',description:'فتح لوحة العمليات الرئيسية'},{command:'attendance',description:'الحضور والانصراف وحركة السائق'},{command:'tasks',description:'عرض المهام المفتوحة المرتبطة بك'},{command:'reports',description:'عرض تقارير الإدارة المتاحة'},{command:'sales',description:'فتح أوامر بيع البلوك والخرسانة'},{command:'workshop',description:'فتح قائمة الورشة والميكانيكي'},{command:'suppliers',description:'بحث عن قطعة أو مورد وطلب عرض سعر'},{command:'gps',description:'عرض حالة الأسطول من نظام التتبع'},{command:'status',description:'عرض حالة الربط وآخر مزامنة'},{command:'whoami',description:'عرض رقم الحساب والدور والصلاحية'}],
  hi:[{command:'start',description:'स्मार्ट कर्मचारी सहायक शुरू करें'},{command:'menu',description:'अपना कार्य मेनू खोलें'},{command:'attendance',description:'उपस्थिति, प्रस्थान और ड्राइवर गतिविधि'},{command:'tasks',description:'अपने खुले कार्य देखें'},{command:'reports',description:'प्रबंधन रिपोर्ट'},{command:'sales',description:'ब्लॉक और कंक्रीट बिक्री आदेश'},{command:'workshop',description:'वर्कशॉप और मैकेनिक मेनू'},{command:'suppliers',description:'आपूर्तिकर्ता खोजें और कोटेशन माँगें'},{command:'gps',description:'फ्लीट GPS स्थिति'},{command:'status',description:'सिस्टम लिंक और अंतिम सिंक'},{command:'whoami',description:'अपनी भूमिका और स्थिति देखें'}],
  bn:[{command:'start',description:'স্মার্ট কর্মচারী সহকারী চালু করুন'},{command:'menu',description:'আপনার কাজের মেনু খুলুন'},{command:'attendance',description:'উপস্থিতি, প্রস্থান ও চালকের চলাচল'},{command:'tasks',description:'আপনার খোলা কাজ দেখুন'},{command:'reports',description:'ব্যবস্থাপনা রিপোর্ট'},{command:'sales',description:'ব্লক ও কংক্রিট বিক্রয় আদেশ'},{command:'workshop',description:'ওয়ার্কশপ এবং মেকানিক মেনু'},{command:'suppliers',description:'সরবরাহকারী খুঁজুন ও কোটেশন চান'},{command:'gps',description:'বহরের GPS অবস্থা'},{command:'status',description:'সিস্টেম সংযোগ ও সর্বশেষ সিঙ্ক'},{command:'whoami',description:'আপনার ভূমিকা ও অবস্থা দেখুন'}],
  ur:[{command:'start',description:'سمارٹ ملازم معاون شروع کریں'},{command:'menu',description:'اپنا کام کا مینو کھولیں'},{command:'attendance',description:'حاضری، روانگی اور ڈرائیور حرکت'},{command:'tasks',description:'اپنے کھلے کام دیکھیں'},{command:'reports',description:'انتظامی رپورٹس'},{command:'sales',description:'بلاک اور کنکریٹ سیلز آرڈر'},{command:'workshop',description:'ورکشاپ اور مکینک مینو'},{command:'suppliers',description:'سپلائر تلاش کریں اور کوٹیشن مانگیں'},{command:'gps',description:'فلیٹ GPS حالت'},{command:'status',description:'سسٹم رابطہ اور آخری ہم وقت سازی'},{command:'whoami',description:'اپنا کردار اور حالت دیکھیں'}]
};
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const number=value=>Number(value||0).toLocaleString('en-US',{maximumFractionDigits:2});

export async function register(req,res){
  if(!method(req,res,['POST']))return;
  try{
    requireAdmin(req);
    const input=await body(req),proto=String(req.headers['x-forwarded-proto']||'https').split(',')[0],host=String(req.headers['x-forwarded-host']||req.headers.host||''),base=String(input.baseUrl||`${proto}://${host}`).replace(/\/$/,'');
    if(!/^https:\/\//.test(base))throw Object.assign(new Error('رابط HTTPS صحيح مطلوب'),{status:400});
    const url=`${base}/api/telegram/webhook-v3`;
    await telegram('setWebhook',{url,secret_token:config.telegramSecret,allowed_updates:['message','edited_message','callback_query','my_chat_member'],drop_pending_updates:false,max_connections:20});
    await telegram('setMyCommands',{commands:commands.en});
    for(const language of ['ar','hi','bn','ur'])await telegram('setMyCommands',{commands:commands[language],language_code:language});
    const webhook=await telegram('getWebhookInfo');
    if(String(webhook?.url||'')!==url)throw Object.assign(new Error('Telegram لم يثبت رابط Webhook الجديد'),{status:502});
    json(res,200,{ok:true,url,commandsRegistered:true,languages:['en','ar','hi','bn','ur'],enterpriseWebhook:true,version:5,webhook:{url:webhook.url,pending_update_count:webhook.pending_update_count||0,last_error_message:webhook.last_error_message||''}});
  }catch(error){errorResponse(res,error);}
}

export async function status(req,res){
  if(!method(req,res,['GET']))return;
  try{
    requireAdmin(req);
    const info=await telegram('getWebhookInfo'),url=String(info?.url||'');
    json(res,200,{ok:true,configured:Boolean(url),url,enterprise_v3:/\/api\/telegram\/webhook-v3$/.test(url),pending_update_count:Number(info?.pending_update_count||0),max_connections:Number(info?.max_connections||0),last_error_date:info?.last_error_date||null,last_error_message:info?.last_error_message||'',allowed_updates:info?.allowed_updates||[]});
  }catch(error){errorResponse(res,error);}
}

export async function test(req,res){
  if(!method(req,res,['POST']))return;
  try{
    requireAdmin(req);
    const input=await body(req);
    if(!input.chatId)throw Object.assign(new Error('Chat ID مطلوب'),{status:400});
    const result=await sendMessage(String(input.chatId),'تم ربط <b>مساعد مصنع بن حامد</b> بالخادم بنجاح.\n\nأرسل /whoami لعرض رقم حسابك، أو اكتب <b>تقارير</b> لفتح قائمة التقارير.');
    json(res,200,{ok:true,messageId:result.message_id});
  }catch(error){errorResponse(res,error);}
}

export async function notify(req,res){
  if(!method(req,res,['POST']))return;
  try{
    requireAdmin(req);
    const input=await body(req);
    if(input.event!=='daily_report_approved')throw Object.assign(new Error('نوع الإشعار غير صحيح'),{status:400});
    if(!config.telegramOwnerId)throw Object.assign(new Error('TELEGRAM_OWNER_ID غير مضبوط'),{status:503});
    const preview=input.preview&&typeof input.preview==='object'?input.preview:{},reportDate=String(input.reportDate||'').slice(0,10),originalName=String(input.originalName||'daily-report.xlsx').slice(0,240),importId=String(input.importId||'').slice(0,120);
    const text=`تم اعتماد <b>التقرير اليومي</b> من الموقع.\n\nالتاريخ: <b>${esc(reportDate||'—')}</b>\nالملف: ${esc(originalName)}\nعدد الفواتير: <b>${number(preview.invoiceCount)}</b>\nإجمالي المبيعات: <b>${number(preview.salesTotal)} ر.س</b>\nالبلوك: <b>${number(preview.blockSales)} ر.س</b>\nالخرسانة: <b>${number(preview.concreteSales)} ر.س</b>\nالتحصيلات: <b>${number(preview.collectionTotal)} ر.س</b>${importId?`\nمرجع الاعتماد: <code>${esc(importId)}</code>`:''}`;
    const result=await sendMessage(config.telegramOwnerId,text,{action_name:'daily_report_approved',action_payload:{reportDate,importId}});
    json(res,200,{ok:true,messageId:result.message_id});
  }catch(error){errorResponse(res,error);}
}
