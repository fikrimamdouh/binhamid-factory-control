import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const read=path=>readFileSync(join(root,path),'utf8');
const write=(path,content)=>writeFileSync(join(root,path),content,'utf8');

function replaceOnce(content,search,replacement,label){
  if(content.includes(replacement))return content;
  if(!content.includes(search))throw new Error(`Faisal accountant preview patch anchor missing: ${label}`);
  return content.replace(search,replacement);
}

const helper=`import { select, upsert } from './supabase.js';
import { keyboard, sendMessage } from './telegram.js';

export const ACCOUNTANT_PREVIEW_CAPABILITY='accountant.preview';
const norm=value=>String(value||'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/[^a-z0-9\\u0600-\\u06ff]+/g,' ').replace(/\\s+/g,' ').trim();

export async function isAccountantPreview(identity){
  if(!identity?.active||identity.role!=='accountant'||!identity.user_id)return false;
  const rows=await select('user_capabilities',\`app_user_id=eq.\${encodeURIComponent(identity.user_id)}&capability=eq.\${encodeURIComponent(ACCOUNTANT_PREVIEW_CAPABILITY)}&allowed=eq.true&select=capability&limit=1\`).catch(()=>[]);
  return Boolean(rows?.length);
}

export function accountantPreviewKeyboard(){
  return keyboard([
    [{text:'🕒 الحضور والانصراف',callback_data:'home:attendance'}],
    [{text:'📚 القسم المحاسبي',callback_data:'preview:accounting'},{text:'📊 التقارير المالية',callback_data:'preview:reports'}],
    [{text:'👥 حسابات العملاء',callback_data:'preview:customers'},{text:'🧾 القيود اليومية',callback_data:'preview:entries'}],
    [{text:'🏦 الخزائن والبنوك',callback_data:'preview:treasury'},{text:'ℹ️ حالة التجهيز',callback_data:'preview:status'}]
  ]);
}

export async function sendAccountantPreviewHome(message,identity,name='فيصل'){
  return sendMessage(message.chat.id,\`<b>لوحة الموظف الذكي</b>\\nمرحبًا \${name} — محاسب.\\n\\nتم تفعيل الحضور والانصراف لحسابك. ويجري حاليًا إنشاء وتحديث خدمات القسم المحاسبي؛ ستظهر الخدمات تباعًا فور اعتمادها.\`,accountantPreviewKeyboard());
}

export async function sendAccountantPreviewNotice(chatId){
  return sendMessage(chatId,'<b>الخدمة قيد التجهيز</b>\\n\\nيجري حاليًا إنشاء وتحديث خدمات القسم المحاسبي وربطها بالنظام. سيتم تفعيل هذه الخدمة تلقائيًا فور اكتمالها واعتمادها.\\n\\nالحضور والانصراف متاحان الآن من القائمة الرئيسية.');
}

export function isPreviewAttendanceCallback(action,value=''){
  return action==='att'||(action==='home'&&value==='attendance');
}

export function isPreviewAttendanceText(raw,state=''){
  const value=norm(raw);
  if(String(state||'').startsWith('attendance_'))return true;
  if(/^\\/(?:start|menu|home|help|whoami|attendance)(?:@\\w+)?(?:\\s|$)/i.test(String(raw||'').trim()))return true;
  return /^(الحضور|الانصراف|الحضور والانصراف|الحضور والمواقع|تسجيل حضور|تسجيل انصراف|حضوري اليوم|قائمه الحضور|قائمة الحضور)$/.test(value);
}

function officeScore(site){
  const value=norm([site?.code,site?.name,site?.address].filter(Boolean).join(' '));
  if(/المكتب الرئيسي|المكاتب الاداريه|المكاتب الادارية|main office|head office/.test(value))return 3;
  if(/مكتب|office|اداري|اداريه|ادارية/.test(value))return 2;
  return 0;
}

export async function enableAccountantPreview(user,invitation){
  const sites=await select('work_sites','select=id,code,name,address,latitude,longitude,radius_m&limit=200');
  const office=[...(sites||[])].sort((a,b)=>officeScore(b)-officeScore(a)).find(site=>officeScore(site)>0);
  if(!office)throw Object.assign(new Error('موقع المكتب غير مسجل ضمن مواقع الحضور.'),{code:'OFFICE_WORK_SITE_NOT_FOUND'});
  await upsert('user_capabilities',[{app_user_id:user.id,capability:ACCOUNTANT_PREVIEW_CAPABILITY,allowed:true}],'app_user_id,capability');
  await upsert('employee_assignments',[{app_user_id:user.id,employee_external_id:invitation.employee_external_id||user.employee_external_id||null,work_site_id:office.id,vehicle_external_id:null,active:true}],'app_user_id');
  return office;
}
`;
write('api/_lib/bot-accountant-preview.js',helper);

let invitations=read('api/_lib/bot-invitations.js');
invitations=replaceOnce(invitations,
  "import { employeeAssetsSummary,maskNationalId,normalizeNationalId,resolveEmployeeIdentity } from './employee-identity-link.js';",
  "import { employeeAssetsSummary,maskNationalId,normalizeNationalId,resolveEmployeeIdentity } from './employee-identity-link.js';\nimport { enableAccountantPreview } from './bot-accountant-preview.js';",
  'invitation preview import');
invitations=replaceOnce(invitations,
  "function invitationMenu(){return keyboard([[{text:'دعوة مستخدم جديد',callback_data:'ent:inv|new'},{text:'قائمة الدعوات',callback_data:'ent:inv|list'}],[{text:'القائمة الرئيسية',callback_data:'ent:help'}]]);}",
  "function invitationMenu(){return keyboard([[{text:'دعوة فيصل — المحاسبة',callback_data:'ent:inv|faisal'}],[{text:'دعوة مستخدم جديد',callback_data:'ent:inv|new'},{text:'قائمة الدعوات',callback_data:'ent:inv|list'}],[{text:'القائمة الرئيسية',callback_data:'ent:help'}]]);}",
  'Faisal invitation button');
invitations=replaceOnce(invitations,
  "if(!user)throw Object.assign(new Error('تعذر العثور على مستخدم الدعوة'),{code:'INVITATION_USER_NOT_FOUND'});\n  await patch('user_invitations'",
  "if(!user)throw Object.assign(new Error('تعذر العثور على مستخدم الدعوة'),{code:'INVITATION_USER_NOT_FOUND'});\n  if(invitation?.metadata?.accounting_preview)await enableAccountantPreview(user,invitation);\n  await patch('user_invitations'",
  'enable preview on activation');
invitations=replaceOnce(invitations,
  "const linked={...invitation,full_name:match.employee.full_name,employee_external_id:match.employee.external_id,requested_role:match.role,accepted_by_telegram_id:telegramId,metadata};",
  "const effectiveRole=invitation?.metadata?.accounting_preview?'accountant':match.role;\n  const linked={...invitation,full_name:match.employee.full_name,employee_external_id:match.employee.external_id,requested_role:effectiveRole,accepted_by_telegram_id:telegramId,metadata};",
  'preserve preview accountant role');
invitations=replaceOnce(invitations,
  "الوظيفة: <b>${esc(ROLE_LABELS[match.role]||match.role)}</b>",
  "الوظيفة: <b>${esc(ROLE_LABELS[linked.requested_role]||linked.requested_role)}</b>",
  'preview activation role label');
invitations=replaceOnce(invitations,
  "الدور: <b>${esc(ROLE_LABELS[match.role]||match.role)}</b>",
  "الدور: <b>${esc(ROLE_LABELS[linked.requested_role]||linked.requested_role)}</b>",
  'preview owner notification role label');
invitations=replaceOnce(invitations,
  "metadata:{nickname:context.nickname||'',source_chat_id:String(message.chat.id),source_message_id:String(message.message_id||''),created_by_role:identity.role,owner_auto_approve:isOwner}",
  "metadata:{nickname:context.nickname||'',source_chat_id:String(message.chat.id),source_message_id:String(message.message_id||''),created_by_role:identity.role,owner_auto_approve:isOwner,accounting_preview:Boolean(context.accountingPreview)}",
  'preview invitation metadata');
const faisalFunction=`async function createFaisalPreviewInvitation(message,identity){
  if(!canCreate(identity))return showInvitationMenu(message,identity);
  const employees=await select('employees','active=eq.true&select=external_id,full_name,nickname,phone,role&limit=500').catch(()=>[]);
  const named=(employees||[]).filter(row=>norm(row.full_name).includes('فيصل'));
  const accountants=named.filter(row=>/محاسب|حسابات|accountant|accounting/i.test(String(row.role||'')));
  const exact=accountants.filter(row=>norm(row.full_name)==='فيصل');
  const matches=exact.length?exact:accountants;
  if(matches.length!==1)return sendMessage(message.chat.id,matches.length?'يوجد أكثر من موظف باسم فيصل في سجل الموظفين. يلزم تمييز الاسم أو الرقم الوظيفي أولًا.':'لم أجد موظفًا فعالًا باسم فيصل ووظيفته محاسب في سجل الموظفين.');
  const employee=matches[0];
  if(!employee.phone)return sendMessage(message.chat.id,'الموظف فيصل موجود، لكن رقم الجوال غير مسجل في ملفه. أضف الرقم ثم أعد إنشاء الدعوة.');
  let phone;try{phone=normalizeInvitationPhone(employee.phone);}catch{return sendMessage(message.chat.id,'رقم جوال فيصل المسجل غير صالح لإنشاء الدعوة. صحح الرقم في سجل الموظفين.');}
  return createInvitation(message,identity,{phone,fullName:employee.full_name,nickname:employee.nickname||'فيصل',employeeExternalId:employee.external_id,requestedRole:'accountant',accountingPreview:true});
}
`;
invitations=replaceOnce(invitations,
  "export async function handleInvitationTextCommand(message,identity,text){",
  `${faisalFunction}export async function handleInvitationTextCommand(message,identity,text){`,
  'Faisal invitation function');
invitations=replaceOnce(invitations,
  "if(/^\\/invite(?:@\\w+)?$/i.test(raw)||/^(دعوه مستخدم|دعوة مستخدم|دعوه موظف|دعوة موظف|اداره الدعوات|إدارة الدعوات)$/.test(value)){await showInvitationMenu(message,identity);return true;}return false;",
  "if(/^(دعوه فيصل|دعوة فيصل|دعوه فيصل المحاسب|دعوة فيصل المحاسب)$/.test(value)){await createFaisalPreviewInvitation(message,identity);return true;}if(/^\\/invite(?:@\\w+)?$/i.test(raw)||/^(دعوه مستخدم|دعوة مستخدم|دعوه موظف|دعوة موظف|اداره الدعوات|إدارة الدعوات)$/.test(value)){await showInvitationMenu(message,identity);return true;}return false;",
  'Faisal invitation text command');
invitations=replaceOnce(invitations,
  "if(action==='new'){await startInvitation({...message,from},identity);return true;}if(action==='list')",
  "if(action==='faisal'){await createFaisalPreviewInvitation({...message,from},identity);return true;}if(action==='new'){await startInvitation({...message,from},identity);return true;}if(action==='list')",
  'Faisal invitation callback');
write('api/_lib/bot-invitations.js',invitations);

let enterprise=read('api/_lib/bot-enterprise.js');
enterprise=replaceOnce(enterprise,
  "import { botModuleAllowed, filterBotKeyboard, loadBotMenuPolicy, moduleForCallback, moduleForText } from './bot-menu-permissions.js';",
  "import { botModuleAllowed, filterBotKeyboard, loadBotMenuPolicy, moduleForCallback, moduleForText } from './bot-menu-permissions.js';\nimport { isAccountantPreview, sendAccountantPreviewHome } from './bot-accountant-preview.js';",
  'enterprise preview import');
enterprise=replaceOnce(enterprise,
  "const markup=roleHomeKeyboard(role),rows=markup.reply_markup.inline_keyboard;",
  "if(await isAccountantPreview(identity))return sendAccountantPreviewHome(message,identity,name);\n  const markup=roleHomeKeyboard(role),rows=markup.reply_markup.inline_keyboard;",
  'preview home menu');
write('api/_lib/bot-enterprise.js',enterprise);

let gateway=read('api/_lib/telegram-webhook-gateway.js');
gateway=replaceOnce(gateway,
  "import enterpriseHandler from './telegram-webhook-handler.js';",
  "import enterpriseHandler from './telegram-webhook-handler.js';\nimport { isAccountantPreview, isPreviewAttendanceCallback, isPreviewAttendanceText, sendAccountantPreviewNotice } from './bot-accountant-preview.js';",
  'gateway preview import');
gateway=replaceOnce(gateway,
  "const handled=handledHome||procurementActions.has(action)||action==='gps'||action==='sales'||guidedSalesActions.has(action)||['sales_confirm','sales_cancel','mech','parts_confirm','att','fuelconfirm','fuelcancel'].includes(action);",
  "const handled=handledHome||action==='preview'||procurementActions.has(action)||action==='gps'||action==='sales'||guidedSalesActions.has(action)||['sales_confirm','sales_cancel','mech','parts_confirm','att','fuelconfirm','fuelcancel'].includes(action);",
  'gateway preview callback routing');
gateway=replaceOnce(gateway,
  "const identity=await ensureTelegramIdentity(query.from),role=identity.role||'pending';await answerCallback(query.id);\n  if(!identity.active)",
  "const identity=await ensureTelegramIdentity(query.from),role=identity.role||'pending';await answerCallback(query.id);\n  if(await isAccountantPreview(identity)&&!isPreviewAttendanceCallback(action,value)){await sendAccountantPreviewNotice(message.chat.id);return true;}\n  if(!identity.active)",
  'gateway preview callback guard');
gateway=replaceOnce(gateway,
  "if(message.voice||message.document||message.photo?.length)return false;\n\n  const raw=String(message.text||message.caption||'').trim(),normalized=norm(raw),switchDecision=shouldSwitchSession(state,raw);",
  "if(await isAccountantPreview(identity)&&(message.document||message.photo?.length)){if(!await logIntercepted(update,message,identity))return true;await sendAccountantPreviewNotice(message.chat.id);return true;}\n  if(message.voice||message.document||message.photo?.length)return false;\n\n  const raw=String(message.text||message.caption||'').trim(),normalized=norm(raw);\n  if(await isAccountantPreview(identity)&&!isPreviewAttendanceText(raw,state)){if(!await logIntercepted(update,message,identity))return true;await sendAccountantPreviewNotice(message.chat.id);return true;}\n  const switchDecision=shouldSwitchSession(state,raw);",
  'gateway preview message guard');
write('api/_lib/telegram-webhook-gateway.js',gateway);

console.log('Applied Faisal accountant preview, office attendance and protected invitation flow.');
