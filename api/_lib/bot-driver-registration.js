import crypto from 'node:crypto';
import { getBotSession, clearMaintenanceSession } from './bot-maintenance.js';
import { select, uploadObject, upsert } from './supabase.js';
import { downloadTelegramFile, keyboard, sendMessage } from './telegram.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const now=()=>new Date().toISOString();
const norm=value=>String(value||'').trim().replace(/\s+/g,' ');
const SKIP=/^(لا يوجد|بدون|تخطي|تخطى|skip|none)$/i;
const ALLOWED_MIME=new Set(['image/jpeg','image/png','image/webp','application/pdf']);
const LANGUAGES={ar:'العربية',en:'English',ur:'اردو',hi:'हिन्दी',bn:'বাংলা'};

const TEXT={
  ar:{mobile:'اكتب رقم الجوال.',nationality:'اكتب الجنسية.',employeeId:'اكتب رقم الموظف الداخلي أو اكتب «لا يوجد».',iqama:'اكتب رقم الهوية أو الإقامة.',iqamaExpiry:'اكتب تاريخ انتهاء الهوية أو الإقامة بصيغة YYYY-MM-DD.',license:'اكتب رقم رخصة القيادة.',licenseExpiry:'اكتب تاريخ انتهاء الرخصة بصيغة YYYY-MM-DD.',passport:'اكتب رقم جواز السفر أو اكتب «لا يوجد».',passportExpiry:'اكتب تاريخ انتهاء الجواز بصيغة YYYY-MM-DD.',emergency:'اكتب اسم ورقم شخص للطوارئ أو اكتب «لا يوجد».',vehicle:'اختر المركبة المسندة إليك، أو اكتب رقم اللوحة للبحث.',iqamaDoc:'أرسل صورة أو PDF للهوية أو الإقامة.',licenseDoc:'أرسل صورة أو PDF لرخصة القيادة.',passportDoc:'أرسل صورة أو PDF لجواز السفر، أو اختر «لا يوجد جواز».',cancel:'تم إلغاء تسجيل السائق.'},
  en:{mobile:'Enter your mobile number.',nationality:'Enter your nationality.',employeeId:'Enter your employee number or type none.',iqama:'Enter your ID or Iqama number.',iqamaExpiry:'Enter ID or Iqama expiry as YYYY-MM-DD.',license:'Enter your driving licence number.',licenseExpiry:'Enter licence expiry as YYYY-MM-DD.',passport:'Enter passport number or type none.',passportExpiry:'Enter passport expiry as YYYY-MM-DD.',emergency:'Enter emergency contact name and phone, or type none.',vehicle:'Choose your assigned vehicle, or type the plate number.',iqamaDoc:'Send a photo or PDF of your ID or Iqama.',licenseDoc:'Send a photo or PDF of your driving licence.',passportDoc:'Send a photo or PDF of your passport, or choose no passport.',cancel:'Driver registration cancelled.'},
  ur:{mobile:'اپنا موبائل نمبر لکھیں۔',nationality:'اپنی قومیت لکھیں۔',employeeId:'ملازم نمبر لکھیں یا none لکھیں۔',iqama:'شناختی کارڈ یا اقامہ نمبر لکھیں۔',iqamaExpiry:'اقامہ کی میعاد YYYY-MM-DD میں لکھیں۔',license:'ڈرائیونگ لائسنس نمبر لکھیں۔',licenseExpiry:'لائسنس کی میعاد YYYY-MM-DD میں لکھیں۔',passport:'پاسپورٹ نمبر لکھیں یا none لکھیں۔',passportExpiry:'پاسپورٹ کی میعاد YYYY-MM-DD میں لکھیں۔',emergency:'ہنگامی رابطہ نام اور فون لکھیں یا none لکھیں۔',vehicle:'اپنی گاڑی منتخب کریں یا پلیٹ نمبر لکھیں۔',iqamaDoc:'اقامہ کی تصویر یا PDF بھیجیں۔',licenseDoc:'لائسنس کی تصویر یا PDF بھیجیں۔',passportDoc:'پاسپورٹ کی تصویر یا PDF بھیجیں یا no passport منتخب کریں۔',cancel:'ڈرائیور رجسٹریشن منسوخ ہوگئی۔'},
  hi:{mobile:'अपना मोबाइल नंबर लिखें।',nationality:'अपनी राष्ट्रीयता लिखें।',employeeId:'कर्मचारी नंबर लिखें या none लिखें।',iqama:'आईडी या इकामा नंबर लिखें।',iqamaExpiry:'समाप्ति तिथि YYYY-MM-DD में लिखें।',license:'ड्राइविंग लाइसेंस नंबर लिखें।',licenseExpiry:'लाइसेंस समाप्ति YYYY-MM-DD में लिखें।',passport:'पासपोर्ट नंबर लिखें या none लिखें।',passportExpiry:'पासपोर्ट समाप्ति YYYY-MM-DD में लिखें।',emergency:'आपातकालीन संपर्क नाम और फोन लिखें या none लिखें।',vehicle:'अपना वाहन चुनें या प्लेट नंबर लिखें।',iqamaDoc:'आईडी या इकामा की फोटो/PDF भेजें।',licenseDoc:'लाइसेंस की फोटो/PDF भेजें।',passportDoc:'पासपोर्ट की फोटो/PDF भेजें या no passport चुनें।',cancel:'ड्राइवर पंजीकरण रद्द किया गया।'},
  bn:{mobile:'মোবাইল নম্বর লিখুন।',nationality:'জাতীয়তা লিখুন।',employeeId:'কর্মচারী নম্বর লিখুন অথবা none লিখুন।',iqama:'আইডি বা ইকামা নম্বর লিখুন।',iqamaExpiry:'মেয়াদ YYYY-MM-DD লিখুন।',license:'ড্রাইভিং লাইসেন্স নম্বর লিখুন।',licenseExpiry:'লাইসেন্সের মেয়াদ YYYY-MM-DD লিখুন।',passport:'পাসপোর্ট নম্বর লিখুন অথবা none লিখুন।',passportExpiry:'পাসপোর্টের মেয়াদ YYYY-MM-DD লিখুন।',emergency:'জরুরি যোগাযোগের নাম ও ফোন লিখুন অথবা none লিখুন।',vehicle:'আপনার গাড়ি নির্বাচন করুন অথবা প্লেট নম্বর লিখুন।',iqamaDoc:'আইডি বা ইকামার ছবি/PDF পাঠান।',licenseDoc:'লাইসেন্সের ছবি/PDF পাঠান।',passportDoc:'পাসপোর্টের ছবি/PDF পাঠান অথবা no passport নির্বাচন করুন।',cancel:'ড্রাইভার নিবন্ধন বাতিল হয়েছে।'}
};

const language=context=>LANGUAGES[context?.preferredLanguage]?context.preferredLanguage:'ar';
const tr=(context,key)=>TEXT[language(context)]?.[key]||TEXT.ar[key]||key;

async function setSession(chatId,userId,state,context={}){
  const current=await getBotSession(chatId,userId),aiHistory=current?.context?.aiHistory||[];
  return upsert('bot_sessions',[{channel:'telegram',chat_id:String(chatId),external_user_id:String(userId),state,context:{aiHistory,...context},updated_at:now()}],'channel,chat_id,external_user_id');
}

function dateValue(value){
  const text=norm(value);
  let match=text.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
  if(!match){const reversed=text.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);if(reversed)match=[reversed[0],reversed[3],reversed[2],reversed[1]];}
  if(!match)return'';
  const result=`${match[1]}-${String(match[2]).padStart(2,'0')}-${String(match[3]).padStart(2,'0')}`;
  const parsed=Date.parse(`${result}T00:00:00Z`);return Number.isFinite(parsed)&&new Date(parsed).toISOString().slice(0,10)===result?result:'';
}

function languageKeyboard(){return keyboard([[{text:'العربية',callback_data:'reg:drvlang|ar'},{text:'English',callback_data:'reg:drvlang|en'}],[{text:'اردو',callback_data:'reg:drvlang|ur'},{text:'हिन्दी',callback_data:'reg:drvlang|hi'}],[{text:'বাংলা',callback_data:'reg:drvlang|bn'}],[{text:'إلغاء',callback_data:'reg:cancel'}]]);}
function skipKeyboard(value,label){return keyboard([[{text:label,callback_data:`reg:${value}`}],[{text:'إلغاء',callback_data:'reg:cancel'}]]);}
function confirmKeyboard(){return keyboard([[{text:'إرسال طلب اعتماد السائق',callback_data:'reg:confirm'}],[{text:'إعادة بيانات السائق',callback_data:'reg:drvreset'},{text:'تغيير الوظيفة',callback_data:'reg:editrole'}],[{text:'إلغاء التسجيل',callback_data:'reg:cancel'}]]);}

export function isDriverRegistrationState(state=''){return String(state).startsWith('registration_driver_');}
export function driverRegistrationReady(context={}){
  const docs=context.driverDocuments||{};
  return Boolean(context.requestedRole==='driver'&&context.mobile&&context.nationality&&context.iqamaNumber&&context.iqamaExpiry&&context.licenseNumber&&context.licenseExpiry&&context.vehicleExternalId&&docs.iqama&&docs.license);
}
export function driverRegistrationSummary(context={}){
  const docs=context.driverDocuments||{};
  return `<b>بيانات السائق</b>\nاللغة: <b>${esc(LANGUAGES[context.preferredLanguage]||'العربية')}</b>\nالجوال: <b>${esc(context.mobile||'—')}</b>\nالجنسية: <b>${esc(context.nationality||'—')}</b>\nرقم الموظف: <b>${esc(context.employeeExternalId||'غير متوفر')}</b>\nالهوية/الإقامة: <b>${esc(context.iqamaNumber||'—')}</b> — ${esc(context.iqamaExpiry||'—')}\nالرخصة: <b>${esc(context.licenseNumber||'—')}</b> — ${esc(context.licenseExpiry||'—')}\nالجواز: <b>${esc(context.passportNumber||'غير متوفر')}</b>${context.passportExpiry?` — ${esc(context.passportExpiry)}`:''}\nاتصال الطوارئ: <b>${esc(context.emergencyContact||'غير متوفر')}</b>\nالمركبة: <b>${esc(context.vehicleLabel||context.vehicleExternalId||'غير محددة')}</b>\nالمستندات: الإقامة ${docs.iqama?'✓':'✗'} — الرخصة ${docs.license?'✓':'✗'} — الجواز ${docs.passport?'✓':'اختياري'}`;
}

export async function startDriverRegistration(message,identity,context={}){
  const userId=identity.external_id||message.from.id,next={...context,requestedRole:'driver',preferredLanguage:'',driverDocuments:{},vehicleExternalId:'',vehicleLabel:''};
  await setSession(message.chat.id,userId,'registration_driver_language',next);
  return sendMessage(message.chat.id,'<b>تسجيل السائق</b>\n\nاختر لغة فورم السائق:',languageKeyboard());
}

async function showVehicles(message,identity,context){
  const rows=await select('vehicles','active=eq.true&select=external_id,plate_no,asset_no,vehicle_type,make,model,status&order=plate_no.asc.nullslast&limit=1000').catch(()=>[]);
  const candidates=(rows||[]).filter(row=>row.external_id).slice(0,40).map(row=>({id:String(row.external_id),label:[row.plate_no||row.asset_no,row.vehicle_type||row.make,row.model].filter(Boolean).join(' — ')}));
  await setSession(message.chat.id,identity.external_id||message.from.id,'registration_driver_vehicle',{...context,vehicleCandidates:candidates});
  const buttons=[];for(let i=0;i<candidates.length;i+=2)buttons.push(candidates.slice(i,i+2).map((item,index)=>({text:item.label.slice(0,28),callback_data:`reg:drvveh|${i+index}`})));
  buttons.push([{text:'تحديث المركبات',callback_data:'reg:drvvehicles'}],[{text:'إلغاء',callback_data:'reg:cancel'}]);
  return sendMessage(message.chat.id,`${tr(context,'vehicle')}\n\nالمركبات المتاحة: <b>${candidates.length}</b>`,keyboard(buttons));
}

async function requestIqamaDocument(message,identity,context){await setSession(message.chat.id,identity.external_id||message.from.id,'registration_driver_iqama_doc',context);return sendMessage(message.chat.id,tr(context,'iqamaDoc'));}
async function complete(message,identity,context){
  const userId=identity.external_id||message.from.id;
  await setSession(message.chat.id,userId,'registration_confirm',context);
  return sendMessage(message.chat.id,`<b>مراجعة تسجيل السائق</b>\n\nالاسم: <b>${esc(context.fullName||'—')}</b>\n${driverRegistrationSummary(context)}\n\nراجع البيانات قبل إرسالها لمدير النظام. لا تُمنح أي صلاحية قبل الاعتماد.`,confirmKeyboard());
}

export async function continueDriverRegistrationSession(message,identity,session,text){
  const state=String(session?.state||''),value=norm(text),context=session?.context||{},userId=identity.external_id||message.from.id;
  if(!isDriverRegistrationState(state))return false;
  if(/^(الغاء|إلغاء|تراجع|cancel)$/i.test(value)){await clearMaintenanceSession(message.chat.id,userId);await sendMessage(message.chat.id,tr(context,'cancel'));return true;}
  const next=(stateName,patch,prompt,extra={})=>setSession(message.chat.id,userId,stateName,{...context,...patch}).then(()=>sendMessage(message.chat.id,prompt,extra));
  if(state==='registration_driver_phone'){if(!/^[+\d][\d\s-]{7,20}$/.test(value))return sendMessage(message.chat.id,tr(context,'mobile')).then(()=>true);await next('registration_driver_nationality',{mobile:value},tr(context,'nationality'));return true;}
  if(state==='registration_driver_nationality'){if(value.length<2)return sendMessage(message.chat.id,tr(context,'nationality')).then(()=>true);await next('registration_driver_employee_id',{nationality:value},tr(context,'employeeId'),skipKeyboard('drvskipemployee','لا يوجد رقم موظف'));return true;}
  if(state==='registration_driver_employee_id'){const employeeExternalId=SKIP.test(value)?'':value.slice(0,80);await next('registration_driver_iqama',{employeeExternalId},tr(context,'iqama'));return true;}
  if(state==='registration_driver_iqama'){if(value.length<4)return sendMessage(message.chat.id,tr(context,'iqama')).then(()=>true);await next('registration_driver_iqama_expiry',{iqamaNumber:value},tr(context,'iqamaExpiry'));return true;}
  if(state==='registration_driver_iqama_expiry'){const date=dateValue(value);if(!date)return sendMessage(message.chat.id,tr(context,'iqamaExpiry')).then(()=>true);await next('registration_driver_license',{iqamaExpiry:date},tr(context,'license'));return true;}
  if(state==='registration_driver_license'){if(value.length<3)return sendMessage(message.chat.id,tr(context,'license')).then(()=>true);await next('registration_driver_license_expiry',{licenseNumber:value},tr(context,'licenseExpiry'));return true;}
  if(state==='registration_driver_license_expiry'){const date=dateValue(value);if(!date)return sendMessage(message.chat.id,tr(context,'licenseExpiry')).then(()=>true);await next('registration_driver_passport',{licenseExpiry:date},tr(context,'passport'),skipKeyboard('drvskippassportnumber','لا يوجد جواز'));return true;}
  if(state==='registration_driver_passport'){if(SKIP.test(value)){await next('registration_driver_emergency',{passportNumber:'',passportExpiry:''},tr(context,'emergency'),skipKeyboard('drvskipemergency','لا يوجد اتصال طوارئ'));return true;}await next('registration_driver_passport_expiry',{passportNumber:value.slice(0,80)},tr(context,'passportExpiry'));return true;}
  if(state==='registration_driver_passport_expiry'){const date=dateValue(value);if(!date)return sendMessage(message.chat.id,tr(context,'passportExpiry')).then(()=>true);await next('registration_driver_emergency',{passportExpiry:date},tr(context,'emergency'),skipKeyboard('drvskipemergency','لا يوجد اتصال طوارئ'));return true;}
  if(state==='registration_driver_emergency'){await showVehicles(message,identity,{...context,emergencyContact:SKIP.test(value)?'':value.slice(0,180)});return true;}
  if(state==='registration_driver_vehicle'){
    const compact=value.replace(/\s+/g,'').toLowerCase(),match=(context.vehicleCandidates||[]).find(item=>item.label.replace(/\s+/g,'').toLowerCase().includes(compact));
    if(!match){await sendMessage(message.chat.id,'المركبة غير موجودة في القائمة. اختر من الأزرار أو اكتب رقم لوحة مطابق.');return true;}
    await requestIqamaDocument(message,identity,{...context,vehicleExternalId:match.id,vehicleLabel:match.label,vehicleCandidates:undefined});return true;
  }
  if(state.endsWith('_doc')){await sendMessage(message.chat.id,'أرسل صورة أو ملف PDF للمستند المطلوب، أو استخدم زر التخطي للمستند الاختياري.');return true;}
  return false;
}

function extension(contentType,fileName=''){
  if(contentType==='application/pdf')return'pdf';if(contentType==='image/png')return'png';if(contentType==='image/webp')return'webp';if(contentType==='image/jpeg')return'jpg';
  const ext=String(fileName).split('.').pop().toLowerCase();return['pdf','png','webp','jpg','jpeg'].includes(ext)?(ext==='jpeg'?'jpg':ext):'bin';
}
async function storeDocument(message,identity,type){
  const item=message.document||message.photo?.at(-1),fileId=item?.file_id;if(!fileId)throw new Error('DOCUMENT_MISSING');
  const downloaded=await downloadTelegramFile(fileId),mime=message.document?.mime_type||downloaded.contentType||'image/jpeg';
  if(!ALLOWED_MIME.has(mime))throw new Error('DOCUMENT_TYPE');if(!downloaded.buffer?.length||downloaded.buffer.length>8*1024*1024)throw new Error('DOCUMENT_SIZE');
  const hash=crypto.createHash('sha256').update(downloaded.buffer).digest('hex').slice(0,24),ext=extension(mime,message.document?.file_name),path=`telegram/registration/driver/${identity.external_id||message.from.id}/${type}-${hash}.${ext}`;
  await uploadObject(path,downloaded.buffer,mime);return{path,mime,fileName:message.document?.file_name||`${type}.${ext}`,sizeBytes:downloaded.buffer.length};
}

export async function handleDriverRegistrationMedia(message,identity,session){
  const state=String(session?.state||'');if(!['registration_driver_iqama_doc','registration_driver_license_doc','registration_driver_passport_doc'].includes(state))return false;
  const context=session.context||{},type=state.includes('iqama')?'iqama':state.includes('license')?'license':'passport';
  try{
    const file=await storeDocument(message,identity,type),documents={...(context.driverDocuments||{}),[type]:file},next={...context,driverDocuments:documents};
    if(type==='iqama'){await setSession(message.chat.id,identity.external_id||message.from.id,'registration_driver_license_doc',next);await sendMessage(message.chat.id,`تم حفظ مستند الهوية/الإقامة.\n\n${tr(next,'licenseDoc')}`);return true;}
    if(type==='license'){await setSession(message.chat.id,identity.external_id||message.from.id,'registration_driver_passport_doc',next);await sendMessage(message.chat.id,`تم حفظ مستند الرخصة.\n\n${tr(next,'passportDoc')}`,skipKeyboard('drvskippassportdoc','لا يوجد جواز / تخطي'));return true;}
    await complete(message,identity,next);return true;
  }catch(error){const text=error.message==='DOCUMENT_SIZE'?'حجم المستند يتجاوز 8 ميجابايت.':error.message==='DOCUMENT_TYPE'?'المسموح صورة JPG/PNG/WebP أو ملف PDF.':'تعذر تنزيل المستند أو حفظه. أعد الإرسال.';await sendMessage(message.chat.id,text);return true;}
}

export async function handleDriverRegistrationCallback(message,from,identity,value){
  const raw=String(value||''),chatId=message.chat.id,userId=identity.external_id||from.id,session=await getBotSession(chatId,userId),context=session?.context||{};
  if(raw.startsWith('drvlang|')){const preferredLanguage=raw.split('|')[1];if(!LANGUAGES[preferredLanguage])return false;await setSession(chatId,userId,'registration_driver_phone',{...context,preferredLanguage});await sendMessage(chatId,tr({preferredLanguage},'mobile'));return true;}
  if(raw==='drvskipemployee'){await setSession(chatId,userId,'registration_driver_iqama',{...context,employeeExternalId:''});await sendMessage(chatId,tr(context,'iqama'));return true;}
  if(raw==='drvskippassportnumber'){await setSession(chatId,userId,'registration_driver_emergency',{...context,passportNumber:'',passportExpiry:''});await sendMessage(chatId,tr(context,'emergency'),skipKeyboard('drvskipemergency','لا يوجد اتصال طوارئ'));return true;}
  if(raw==='drvskipemergency'){await showVehicles({...message,from},identity,{...context,emergencyContact:''});return true;}
  if(raw==='drvvehicles'){await showVehicles({...message,from},identity,context);return true;}
  if(raw.startsWith('drvveh|')){const index=Number(raw.split('|')[1]),item=context.vehicleCandidates?.[index];if(!item){await showVehicles({...message,from},identity,context);return true;}await requestIqamaDocument({...message,from},identity,{...context,vehicleExternalId:item.id,vehicleLabel:item.label,vehicleCandidates:undefined});return true;}
  if(raw==='drvskippassportdoc'){await complete({...message,from},identity,{...context,driverDocuments:{...(context.driverDocuments||{}),passport:null}});return true;}
  if(raw==='drvreset'){await startDriverRegistration({...message,from},identity,{fullName:context.fullName,requestedRole:'driver',startedAt:context.startedAt});return true;}
  return false;
}
