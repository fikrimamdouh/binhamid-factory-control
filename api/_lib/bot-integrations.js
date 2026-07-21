import { config, readiness } from './config.js';
import { sendMessage } from './telegram.js';

const yes=value=>value?'مضبوط':'ناقص';
const mark=value=>value?'✅':'❌';
const line=(name,ready,vars,note='')=>`${mark(ready)} <b>${name}</b>: ${yes(ready)}${vars.length?`\n<code>${vars.join(' + ')}</code>`:''}${note?`\n${note}`:''}`;

export function integrationCatalog(){
  const state=readiness();
  return[
    {group:'التشغيل الأساسي',items:[
      {name:'Supabase وقاعدة البيانات',ready:state.supabaseConfigured,vars:['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY']},
      {name:'مخزن الملفات الخاص',ready:state.storageConfigured,vars:['SUPABASE_STORAGE_BUCKET'],note:'الاسم الافتراضي factory-documents، والحاوية تبقى خاصة.'},
      {name:'الرابط العام والإدارة',ready:Boolean(config.publicAppUrl&&config.adminToken),vars:['PUBLIC_APP_URL','BINHAMID_ADMIN_TOKEN']}
    ]},
    {group:'Telegram والحضور',items:[
      {name:'بوت Telegram',ready:state.telegramConfigured,vars:['TELEGRAM_BOT_TOKEN','TELEGRAM_WEBHOOK_SECRET','TELEGRAM_OWNER_ID']},
      {name:'الحضور والانصراف',ready:state.telegramConfigured&&state.supabaseConfigured,vars:[],note:'لا يحتاج API Key إضافيًا؛ يستخدم Telegram وSupabase وموقع الهاتف بعد موافقة المستخدم.'},
      {name:'حالة الأسطول من حضور السائقين',ready:state.telegramConfigured&&state.supabaseConfigured,vars:[],note:'حالة تشغيلية مبنية على الحضور وربط السائق بالمركبة، وليست تتبع GPS أو Traccar.'}
    ]},
    {group:'الذكاء والبحث',items:[
      {name:'OpenAI للصوت والمساعد وبحث الأسعار',ready:state.openaiConfigured,vars:['OPENAI_API_KEY'],note:'الموديلات اختيارية عبر OPENAI_TEXT_MODEL وOPENAI_TRANSCRIBE_MODEL.'},
      {name:'Google Places لبحث الموردين',ready:state.placesConfigured,vars:['GOOGLE_PLACES_API_KEY']}
    ]},
    {group:'التقارير والاستمرارية',items:[
      {name:`PDF — ${config.pdfProvider||'auto'}`,ready:state.pdfConfigured,vars:['PDF_PROVIDER','PDF_API_URL','PDF_API_KEY (اختياري)'],note:'Gotenberg لا يحتاج مفتاحًا إذا كان على خادم خاص.'},
      {name:'المهام المجدولة',ready:state.cronConfigured,vars:['CRON_SECRET']},
      {name:'النسخ المشفر',ready:state.backupConfigured,vars:['SUPABASE_DB_URL','BACKUP_ENCRYPTION_KEY']},
      {name:'اختبار الاستعادة',ready:state.restoreConfigured,vars:['RESTORE_DATABASE_URL']}
    ]}
  ];
}

export function integrationCatalogText(){
  const groups=integrationCatalog();
  const missing=groups.flatMap(group=>group.items).filter(item=>!item.ready).length;
  return `<b>التكاملات والمفاتيح المطلوبة</b>\nلا تُعرض أي قيمة سرية هنا؛ تظهر حالة الضبط وأسماء متغيرات Vercel فقط.\n\n${groups.map(group=>`<b>${group.group}</b>\n${group.items.map(item=>line(item.name,item.ready,item.vars,item.note)).join('\n\n')}`).join('\n\n')}\n\nالحالة: <b>${missing?`${missing} تكاملات ناقصة`:'جميع التكاملات الأساسية مضبوطة'}</b>\nتُحفظ القيم في Vercel Environment Variables فقط، ولا تُكتب في GitHub أو Telegram.`;
}

export async function sendIntegrationCatalog(message,identity){
  if(identity?.role!=='admin')return sendMessage(message.chat.id,'عرض قائمة مفاتيح التكامل متاح لمدير النظام فقط.');
  return sendMessage(message.chat.id,integrationCatalogText());
}
