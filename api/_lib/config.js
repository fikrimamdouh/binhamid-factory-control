const integer=(value,fallback,min=0,max=Number.MAX_SAFE_INTEGER)=>{const parsed=Number.parseInt(String(value??''),10);return Number.isFinite(parsed)?Math.max(min,Math.min(max,parsed)):fallback;};
const text=name=>String(process.env[name]||'').trim();

export const envSpec=Object.freeze({
  SUPABASE_URL:{requiredFor:['runtime','database'],description:'رابط مشروع Supabase'},
  SUPABASE_SERVICE_ROLE_KEY:{requiredFor:['runtime','database'],secret:true,description:'مفتاح الخادم فقط للوصول إلى Supabase'},
  SUPABASE_STORAGE_BUCKET:{requiredFor:['runtime'],description:'حاوية الملفات الخاصة'},
  PUBLIC_APP_URL:{requiredFor:['telegram'],description:'الرابط العام للإنتاج'},
  BINHAMID_ADMIN_TOKEN:{requiredFor:['runtime'],secret:true,description:'رمز بوابة الإدارة'},
  TELEGRAM_BOT_TOKEN:{requiredFor:['telegram'],secret:true,description:'Token البوت'},
  TELEGRAM_WEBHOOK_SECRET:{requiredFor:['telegram'],secret:true,description:'سر التحقق من Webhook'},
  TELEGRAM_OWNER_ID:{requiredFor:['telegram'],description:'معرف مالك البوت'},
  OPENAI_API_KEY:{requiredFor:[],secret:true,description:'اختياري للصوت والذكاء الاصطناعي وبحث أسعار المنتجات'},
  GOOGLE_PLACES_API_KEY:{requiredFor:[],secret:true,description:'اختياري لبحث الموردين ودليل الأعمال'},
  GPS_PROVIDER:{requiredFor:[],description:'مزود GPS؛ الافتراضي traccar'},
  GPS_API_BASE_URL:{requiredFor:['gps'],description:'رابط مزود GPS'},
  GPS_API_TOKEN:{requiredFor:[],secret:true,description:'Token مزود GPS'},
  GPS_API_USER:{requiredFor:[],description:'مستخدم مزود GPS'},
  GPS_API_PASSWORD:{requiredFor:[],secret:true,description:'كلمة مرور مزود GPS'},
  CRON_SECRET:{requiredFor:['cron'],secret:true,description:'سر تشغيل المهام المجدولة'},
  PDF_PROVIDER:{requiredFor:[],description:'نوع خدمة PDF: gotenberg أو json'},
  PDF_API_URL:{requiredFor:[],description:'رابط خدمة تحويل HTML إلى PDF'},
  PDF_API_KEY:{requiredFor:[],secret:true,description:'مفتاح خدمة PDF إن كانت محمية'},
  SUPABASE_DB_URL:{requiredFor:['backup'],secret:true,description:'اتصال PostgreSQL للنسخ الاحتياطي'},
  RESTORE_DATABASE_URL:{requiredFor:['restore'],secret:true,description:'قاعدة غير إنتاجية لاختبار الاستعادة'},
  BACKUP_ENCRYPTION_KEY:{requiredFor:[],secret:true,description:'مفتاح تشفير النسخ الاحتياطية'},
  BACKUP_RETENTION_DAYS:{requiredFor:[],description:'مدة الاحتفاظ بالنسخ'},
  BACKUP_STORAGE_PREFIX:{requiredFor:[],description:'بادئة مسار النسخ'},
  MAX_IMPORT_FILE_BYTES:{requiredFor:[],description:'الحد الأقصى لملف الاستيراد'},
  TELEGRAM_WEBAPP_MAX_AGE_SECONDS:{requiredFor:[],description:'عمر جلسة WebApp'}
});

export const config=Object.freeze({
  supabaseUrl:text('SUPABASE_URL').replace(/\/$/,''),
  supabaseKey:text('SUPABASE_SERVICE_ROLE_KEY'),
  storageBucket:text('SUPABASE_STORAGE_BUCKET')||'factory-documents',
  publicAppUrl:text('PUBLIC_APP_URL'),
  adminToken:text('BINHAMID_ADMIN_TOKEN'),
  telegramToken:text('TELEGRAM_BOT_TOKEN'),
  telegramSecret:text('TELEGRAM_WEBHOOK_SECRET'),
  telegramOwnerId:text('TELEGRAM_OWNER_ID'),
  telegramWebAppMaxAgeSeconds:integer(process.env.TELEGRAM_WEBAPP_MAX_AGE_SECONDS,600,60,3600),
  openaiKey:text('OPENAI_API_KEY'),
  transcribeModel:text('OPENAI_TRANSCRIBE_MODEL')||'gpt-4o-mini-transcribe',
  textModel:text('OPENAI_TEXT_MODEL')||'gpt-5.4-mini',
  ttsModel:text('OPENAI_TTS_MODEL')||'gpt-4o-mini-tts',
  ttsVoice:text('OPENAI_TTS_VOICE')||'coral',
  placesKey:text('GOOGLE_PLACES_API_KEY')||text('PLACES_DIRECTORY_KEY'),
  gpsProvider:text('GPS_PROVIDER')||'traccar',
  gpsApiBaseUrl:text('GPS_API_BASE_URL').replace(/\/$/,''),
  gpsApiToken:text('GPS_API_TOKEN'),
  gpsApiUser:text('GPS_API_USER'),
  gpsApiPassword:text('GPS_API_PASSWORD'),
  cronSecret:text('CRON_SECRET'),
  pdfProvider:text('PDF_PROVIDER')||'auto',
  pdfApiUrl:text('PDF_API_URL')||text('PDF_SERVICE_URL'),
  pdfApiKey:text('PDF_API_KEY')||text('PDF_SERVICE_API_KEY'),
  supabaseDbUrl:text('SUPABASE_DB_URL'),
  restoreDatabaseUrl:text('RESTORE_DATABASE_URL'),
  backupEncryptionKey:text('BACKUP_ENCRYPTION_KEY'),
  backupRetentionDays:integer(process.env.BACKUP_RETENTION_DAYS,30,1,3650),
  backupStoragePrefix:text('BACKUP_STORAGE_PREFIX')||'backups',
  maxImportFileBytes:integer(process.env.MAX_IMPORT_FILE_BYTES,25*1024*1024,1024,100*1024*1024)
});

export function validateEnvironment(scope='runtime'){
  const checks=Object.entries(envSpec).map(([name,definition])=>{
    const configured=Boolean(text(name)||(name==='SUPABASE_STORAGE_BUCKET'&&config.storageBucket));
    const required=definition.requiredFor.includes(scope);
    return{name,configured,required,secret:Boolean(definition.secret),description:definition.description};
  });
  const missingRequired=checks.filter(item=>item.required&&!item.configured).map(item=>item.name);
  const missingOptional=checks.filter(item=>!item.required&&!item.configured).map(item=>item.name);
  return{scope,ready:missingRequired.length===0,missingRequired,missingOptional,checks};
}

export function assertEnvironment(scope='runtime'){
  const result=validateEnvironment(scope);
  if(!result.ready)throw Object.assign(new Error(`متغيرات الخادم الناقصة: ${result.missingRequired.join(', ')}`),{status:503,code:'ENVIRONMENT_NOT_READY',missing:result.missingRequired});
  return result;
}

export const readiness=()=>({
  supabaseConfigured:Boolean(config.supabaseUrl&&config.supabaseKey),
  storageConfigured:Boolean(config.supabaseUrl&&config.supabaseKey&&config.storageBucket),
  adminTokenConfigured:Boolean(config.adminToken),
  cloudConfigured:Boolean(config.supabaseUrl&&config.supabaseKey&&config.adminToken),
  telegramConfigured:Boolean(config.telegramToken&&config.telegramSecret&&config.telegramOwnerId),
  openaiConfigured:Boolean(config.openaiKey),
  placesConfigured:Boolean(config.placesKey),
  gpsConfigured:Boolean(config.gpsApiBaseUrl&&(config.gpsApiToken||(config.gpsApiUser&&config.gpsApiPassword))),
  pdfConfigured:Boolean(config.pdfApiUrl),
  cronConfigured:Boolean(config.cronSecret),
  backupConfigured:Boolean(config.supabaseDbUrl&&config.backupEncryptionKey),
  restoreConfigured:Boolean(config.restoreDatabaseUrl)
});
