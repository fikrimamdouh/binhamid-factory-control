import { config } from './config.js';
import { ROLE_LABELS } from './domain.js';
import { getBotSession, clearMaintenanceSession } from './bot-maintenance.js';
import { displayName } from './bot-profile.js';
import { patch, upsert, select } from './supabase.js';

// app_users لا يحتوي عمود external_id — الربط الصحيح: user_channels(telegram) → user_id.
async function appUserFilter(identity,telegramId=''){
  const direct=String(identity?.user_id||'').trim();
  if(direct)return`id=eq.${encodeURIComponent(direct)}`;
  const external=String(identity?.external_id||telegramId||'').trim();
  if(!external)return'';
  const channel=(await select('user_channels',`channel=eq.telegram&external_id=eq.${encodeURIComponent(external)}&select=user_id&limit=1`).catch(()=>[]))?.[0];
  return channel?.user_id?`id=eq.${encodeURIComponent(channel.user_id)}`:'';
}
import { keyboard, sendMessage } from './telegram.js';
import { jobCatalogMessage } from './bot-help.js';
import { handleInvitationStart } from './bot-invitations.js';
import { continueDriverRegistrationSession, driverRegistrationReady, driverRegistrationSummary, handleDriverRegistrationCallback, startDriverRegistration } from './bot-driver-registration.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const now=()=>new Date().toISOString();
const norm=value=>String(value||'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/[؟?!.,،؛:]+/g,' ').replace(/\s+/g,' ').trim();

export const REGISTRATION_ROLES=Object.freeze([
  {role:'employee',code:'e',label:'عامل / موظف عام'},
  {role:'driver',code:'d',label:'سائق'},
  {role:'mechanic',code:'me',label:'الورشة / ميكانيكي'},
  {role:'accountant',code:'ac',label:'محاسب'},
  {role:'block_sales',code:'bs',label:'مبيعات البلوك'},
  {role:'concrete_sales',code:'cs',label:'مبيعات الخرسانة'},
  {role:'collector',code:'co',label:'محصل'},
  {role:'warehouse',code:'wh',label:'أمين مخزن'},
  {role:'fuel_operator',code:'fu',label:'مسؤول الديزل والأسطول'},
  {role:'hr',code:'hr',label:'الموارد البشرية'},
  {role:'procurement',code:'pr',label:'المشتريات'},
  {role:'quality',code:'qu',label:'الجودة والرقابة'},
  {role:'manager',code:'mg',label:'مدير المصنع'}
]);
const CODE_TO_ROLE=Object.fromEntries(REGISTRATION_ROLES.map(item=>[item.code,item.role]));
const ROLE_TO_CODE=Object.fromEntries(REGISTRATION_ROLES.map(item=>[item.role,item.code]));

export const registrationRoleFromCode=code=>CODE_TO_ROLE[String(code||'')]||'';
export const registrationRoleCode=role=>ROLE_TO_CODE[String(role||'')]||'';
export const registrationRoleLabel=role=>REGISTRATION_ROLES.find(item=>item.role===role)?.label||ROLE_LABELS[role]||role||'غير محدد';
export function isRegistrationCommand(text=''){
  const raw=String(text||'').trim(),value=norm(raw);
  return /^\/start(?:@\w+)?\s+invite_[A-Za-z0-9_-]{30,100}$/i.test(raw)||/^\/(register|signup)(?:@\w+)?$/i.test(raw)||/^(تسجيل|تسجيل حساب|تسجيل موظف|تسجيل بياناتي|تحديث بيانات التسجيل|اكمال التسجيل|إكمال التسجيل)$/.test(value);
}

export function registrationKeyboard(){return keyboard([[{text:'بدء تسجيل الموظف',callback_data:'reg:start'}],[{text:'الوظائف والخدمات',callback_data:'reg:jobs'},{text:'حالة طلبي',callback_data:'reg:status'}]]);}
function roleKeyboard(){const rows=[];for(let index=0;index<REGISTRATION_ROLES.length;index+=2)rows.push(REGISTRATION_ROLES.slice(index,index+2).map(item=>({text:item.label,callback_data:`reg:role|${item.code}`})));rows.push([{text:'إلغاء التسجيل',callback_data:'reg:cancel'}]);return keyboard(rows);}
function employeeIdKeyboard(){return keyboard([[{text:'لا يوجد رقم موظف',callback_data:'reg:skipid'}],[{text:'إلغاء التسجيل',callback_data:'reg:cancel'}]]);}
function confirmKeyboard(){return keyboard([[{text:'إرسال طلب الاعتماد',callback_data:'reg:confirm'}],[{text:'تعديل الاسم',callback_data:'reg:editname'},{text:'تغيير الوظيفة',callback_data:'reg:editrole'}],[{text:'إلغاء التسجيل',callback_data:'reg:cancel'}]]);}

async function setSession(chatId,userId,state,context={}){const current=await getBotSession(chatId,userId),aiHistory=current?.context?.aiHistory||[];return upsert('bot_sessions',[{channel:'telegram',chat_id:String(chatId),external_user_id:String(userId),state,context:{aiHistory,...context},updated_at:now()}],'channel,chat_id,external_user_id');}
function sessionSummary(session={}){const context=session.context||{},base=`<b>مراجعة بيانات التسجيل</b>\n\nالاسم: <b>${esc(context.fullName||'غير مسجل')}</b>\nالوظيفة المطلوبة: <b>${esc(registrationRoleLabel(context.requestedRole))}</b>\nرقم الموظف: <b>${esc(context.employeeExternalId||'غير متوفر')}</b>\nرقم Telegram: <code>${esc(session.external_user_id||'—')}</code>`;return context.requestedRole==='driver'?`${base}\n\n${driverRegistrationSummary(context)}`:base;}
async function saveName(message,identity,fullName,presetRole=''){const value=String(fullName||'').replace(/\s+/g,' ').trim();if(value.length<3||value.length>120||/^\d+$/.test(value))return sendMessage(message.chat.id,'اكتب الاسم الكامل بصورة صحيحة، من 3 إلى 120 حرفًا.');const nameFilter=await appUserFilter(identity,message.from.id);if(nameFilter)await patch('app_users',nameFilter,{full_name:value}).catch(error=>console.warn('[registration full_name]',error?.message||error));const userId=identity.external_id||message.from.id;if(presetRole&&presetRole!=='driver'){await setSession(message.chat.id,userId,'registration_employee_id',{fullName:value,requestedRole:presetRole,employeeExternalId:'',startedAt:now()});return sendMessage(message.chat.id,`تم تسجيل الاسم: <b>${esc(value)}</b>\nالوظيفة المطلوبة: <b>${esc(registrationRoleLabel(presetRole))}</b>\n\nاكتب رقم الموظف أو الكود الداخلي.`,employeeIdKeyboard());}await setSession(message.chat.id,userId,'registration_role',{fullName:value,requestedRole:'',employeeExternalId:'',startedAt:now()});return sendMessage(message.chat.id,`تم تسجيل الاسم: <b>${esc(value)}</b>\n\nاختر الوظيفة الفعلية داخل المصنع:`,roleKeyboard());}

// رقم الهوية هو مفتاح الربط بين تسجيل البوت وسجل الموظفين: به يُربط الموظف
// بسجله القائم بدل الاعتماد على تطابق الاسم الذي يختلف إملاؤه كثيرًا.
async function askNationalId(message,identity,employeeExternalId=''){
  const userId=identity.external_id||message.from.id;
  const session=await getBotSession(message.chat.id,userId),context=session?.context||{};
  await setSession(message.chat.id,userId,'registration_national_id',{...context,employeeExternalId:String(employeeExternalId||'').trim().slice(0,80)});
  return sendMessage(message.chat.id,'اكتب <b>رقم الهوية أو الإقامة</b> (أرقام فقط).\n\nهذا الرقم يربط حسابك بسجلك في النظام تلقائيًا، فتظهر بياناتك في نماذج وظيفتك.\n\nإن لم يكن متاحًا الآن اكتب «لا يوجد».');
}

async function moveToConfirmation(message,identity,employeeExternalId='',nationalId=''){const session=await getBotSession(message.chat.id,identity.external_id||message.from.id),context=session?.context||{},employeeId=String(employeeExternalId||'').trim().slice(0,80),nid=String(nationalId||context.nationalId||'').replace(/[^0-9]/g,'').slice(0,15);const employeeFilter=await appUserFilter(identity,message.from.id);if(employeeFilter)await patch('app_users',employeeFilter,{employee_external_id:employeeId||null}).catch(error=>console.warn('[registration employee_id]',error?.message||error));const next={...context,employeeExternalId:employeeId,nationalId:nid};await setSession(message.chat.id,identity.external_id||message.from.id,'registration_confirm',next);return sendMessage(message.chat.id,`${sessionSummary({external_user_id:identity.external_id||message.from.id,context:next})}\n\nراجع البيانات قبل إرسالها لمدير النظام. لا تُمنح أي صلاحية قبل الاعتماد.`,confirmKeyboard());}

export async function startRegistration(message,identity,presetRole=''){if(identity?.active)return sendMessage(message.chat.id,`حسابك معتمد بالفعل.\nالدور الحالي: <b>${esc(ROLE_LABELS[identity.role]||identity.role)}</b>\nاستخدم /menu لفتح لوحة العمليات.`);const current=await getBotSession(message.chat.id,identity.external_id||message.from.id);if(current?.state==='registration_submitted')return registrationStatus(message,identity);const telegramName=displayName(identity,message.from),roleLabel=presetRole?registrationRoleLabel(presetRole):'';await setSession(message.chat.id,identity.external_id||message.from.id,'registration_name',{telegramName,presetRole,startedAt:now()});return sendMessage(message.chat.id,`<b>تسجيل موظف جديد${roleLabel?` — ${esc(roleLabel)}`:''}</b>\n\nاكتب الاسم الكامل كما يظهر في سجل الموظفين.\n\nاسم Telegram الحالي: <b>${esc(telegramName)}</b>`,keyboard([[{text:'استخدام اسم Telegram',callback_data:'reg:usename'}],[{text:'عرض الوظائف أولًا',callback_data:'reg:jobs'},{text:'إلغاء',callback_data:'reg:cancel'}]]));}
// رابط تسجيل مباشر لموظفي الورشة فقط: t.me/<bot>?start=workshop — يبدأ نفس
// فورم التسجيل العادي لكن بوظيفة "الورشة / ميكانيكي" مثبّتة مسبقًا، فيتخطى
// خطوة اختيار الوظيفة تمامًا.
export const startWorkshopRegistration=(message,identity)=>startRegistration(message,identity,'mechanic');
// رابط تسجيل مباشر لمندوب البلوك: t.me/<bot>?start=block — يبدأ نفس فورم
// التسجيل لكن بوظيفة "مندوب بلوك" مثبّتة مسبقًا، يكتب اسمه ورقمه الوظيفي
// ويرسل الطلب، وينتظر اعتماد مدير النظام كالمعتاد.
export const startBlockSalesRegistration=(message,identity)=>startRegistration(message,identity,'block_sales');
export async function registrationStatus(message,identity){if(identity?.active)return sendMessage(message.chat.id,`الحالة: <b>معتمد</b>\nالدور: <b>${esc(ROLE_LABELS[identity.role]||identity.role)}</b>\nاستخدم /menu لفتح لوحة العمليات.`);const session=await getBotSession(message.chat.id,identity.external_id||message.from.id);if(session?.state==='registration_submitted')return sendMessage(message.chat.id,`${sessionSummary(session)}\n\nالحالة: <b>مرسل وينتظر اعتماد مدير النظام</b>.`);if(session?.state?.startsWith('registration_'))return sendMessage(message.chat.id,`طلب التسجيل غير مكتمل. المرحلة الحالية: <b>${esc(session.state.replace('registration_',''))}</b>.\nاستخدم /register لاستكماله.`,registrationKeyboard());return sendMessage(message.chat.id,'لم تُرسل فورم التسجيل بعد. استخدم /register للبدء.',registrationKeyboard());}
export async function handleRegistrationTextCommand(message,identity,text){if(await handleInvitationStart(message,identity,text))return true;if(isRegistrationCommand(text)){await startRegistration(message,identity);return true;}const value=norm(text);if(/^(الوظائف|الوظائف المتاحه|الوظائف المتاحة|الخدمات|وظائف البوت)$/.test(value)){await sendMessage(message.chat.id,jobCatalogMessage(identity,message.from),registrationKeyboard());return true;}if(/^(حاله التسجيل|حالة التسجيل|حاله طلبي|حالة طلبي)$/.test(value)){await registrationStatus(message,identity);return true;}return false;}
export async function continueRegistrationSession(message,identity,session,text){if(await continueDriverRegistrationSession(message,identity,session,text))return true;const state=String(session?.state||''),value=String(text||'').trim(),userId=identity.external_id||message.from.id;if(!state.startsWith('registration_')||state==='registration_submitted')return false;if(/^(الغاء|إلغاء|تراجع|cancel)$/i.test(value)){await clearMaintenanceSession(message.chat.id,userId);await sendMessage(message.chat.id,'تم إلغاء فورم التسجيل دون إرسال طلب اعتماد.');return true;}if(state==='registration_name'){await saveName(message,identity,value,session?.context?.presetRole||'');return true;}if(state==='registration_employee_id'){if(/^(لا يوجد|بدون|تخطي|تخطى|skip)$/i.test(value)){await askNationalId(message,identity,'');return true;}if(value.length>80){await sendMessage(message.chat.id,'رقم الموظف طويل. اكتب الرقم الداخلي فقط أو اكتب «لا يوجد».');return true;}await askNationalId(message,identity,value);return true;}
  if(state==='registration_national_id'){
    const employeeId=String(session?.context?.employeeExternalId||'');
    if(/^(لا يوجد|بدون|تخطي|تخطى|skip)$/i.test(value)){await moveToConfirmation(message,identity,employeeId,'');return true;}
    const digits=value.replace(/[^0-9]/g,'');
    if(digits.length<8||digits.length>15){await sendMessage(message.chat.id,'اكتب رقم الهوية أو الإقامة بالأرقام فقط (من 8 إلى 15 رقمًا)، أو اكتب «لا يوجد».');return true;}
    await moveToConfirmation(message,identity,employeeId,digits);return true;
  }if(state==='registration_role'){await sendMessage(message.chat.id,'اختر الوظيفة من الأزرار الظاهرة، أو اكتب «إلغاء».',roleKeyboard());return true;}if(state==='registration_confirm'){await sendMessage(message.chat.id,'راجع البيانات ثم استخدم زر «إرسال طلب الاعتماد»، أو اختر التعديل.',confirmKeyboard());return true;}return false;}
export async function handleRegistrationCallback(message,from,identity,value){
  const chatId=message.chat.id,userId=identity.external_id||from.id,raw=String(value||'');
  if(raw.startsWith('drv')&&await handleDriverRegistrationCallback(message,from,identity,raw))return true;
  if(raw==='jobs'){await sendMessage(chatId,jobCatalogMessage(identity,from),registrationKeyboard());return true;}if(raw==='status'){await registrationStatus({...message,from},identity);return true;}if(raw==='start'){await startRegistration({...message,from},identity);return true;}if(raw==='cancel'){await clearMaintenanceSession(chatId,userId);await sendMessage(chatId,'تم إلغاء فورم التسجيل.');return true;}if(identity?.active){await sendMessage(chatId,'حسابك معتمد بالفعل. استخدم /menu.');return true;}
  const session=await getBotSession(chatId,userId);if(raw==='usename')return saveName({...message,from},identity,displayName(identity,from),session?.context?.presetRole||'');
  if(raw.startsWith('role|')){const role=registrationRoleFromCode(raw.split('|')[1]);if(!role){await sendMessage(chatId,'الوظيفة المختارة غير صحيحة.');return true;}const context=session?.context||{};if(!context.fullName){await startRegistration({...message,from},identity);return true;}if(role==='driver'){await startDriverRegistration({...message,from},identity,{...context,requestedRole:'driver'});return true;}await setSession(chatId,userId,'registration_employee_id',{...context,requestedRole:role});await sendMessage(chatId,`الوظيفة المطلوبة: <b>${esc(registrationRoleLabel(role))}</b>\n\nاكتب رقم الموظف أو الكود الداخلي.`,employeeIdKeyboard());return true;}
  if(raw==='skipid')return moveToConfirmation({...message,from},identity,'');if(raw==='editname'){await setSession(chatId,userId,'registration_name',{...(session?.context||{})});await sendMessage(chatId,'اكتب الاسم الكامل الصحيح:');return true;}if(raw==='editrole'){await setSession(chatId,userId,'registration_role',{...(session?.context||{})});await sendMessage(chatId,'اختر الوظيفة الصحيحة:',roleKeyboard());return true;}
  if(raw==='confirm'){
    const context=session?.context||{};if(session?.state!=='registration_confirm'||!context.fullName||!context.requestedRole){await sendMessage(chatId,'فورم التسجيل غير مكتمل. استخدم /register لإكماله.');return true;}if(context.requestedRole==='driver'&&!driverRegistrationReady(context)){await sendMessage(chatId,'فورم السائق غير مكتمل. يجب تحديد المركبة وإرفاق الهوية/الإقامة والرخصة. استخدم زر إعادة بيانات السائق.');return true;}
    const submittedAt=now(),submitted={...context,submittedAt};await setSession(chatId,userId,'registration_submitted',submitted);await sendMessage(chatId,`${sessionSummary({external_user_id:userId,context:submitted})}\n\nتم إرسال طلب التسجيل. الحالة: <b>ينتظر اعتماد مدير النظام</b>.`);
    if(config.telegramOwnerId&&String(config.telegramOwnerId)!==String(userId))await sendMessage(config.telegramOwnerId,`<b>طلب تسجيل موظف جديد</b>\n\nالاسم: <b>${esc(submitted.fullName)}</b>\nالوظيفة المطلوبة: <b>${esc(registrationRoleLabel(submitted.requestedRole))}</b>\nرقم الموظف: <b>${esc(submitted.employeeExternalId||'غير متوفر')}</b>${submitted.requestedRole==='driver'?`\n\n${driverRegistrationSummary(submitted)}`:''}\nرقم Telegram: <code>${esc(userId)}</code>`,keyboard([[{text:'مراجعة طلبات التسجيل',callback_data:'ent:er|list'}]])).catch(error=>console.warn('[telegram registration owner notice]',error?.message||error));return true;
  }
  await sendMessage(chatId,'انتهت هذه الخطوة. استخدم /register لفتح فورم التسجيل.');return true;
}
