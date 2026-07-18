import crypto from 'node:crypto';
import { config } from './config.js';
import { ROLE_LABELS } from './domain.js';
import { getBotSession, clearMaintenanceSession } from './bot-maintenance.js';
import { insert, patch, rpc, select, upsert } from './supabase.js';
import { keyboard, sendMessage, telegram } from './telegram.js';

const now=()=>new Date().toISOString();
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const norm=value=>String(value||'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/[؟?!.,،؛:]+/g,' ').replace(/\s+/g,' ').trim();
const OWNER_ONLY_ROLES=new Set(['admin']);
const MANAGER_ROLES=new Set(['employee','driver','mechanic','block_sales','concrete_sales','collector','warehouse','fuel_operator','procurement','quality']);
export const INVITATION_ROLES=Object.freeze([
  {role:'employee',code:'e',label:'عامل / موظف'},
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
  {role:'manager',code:'mg',label:'مدير المصنع'},
  {role:'admin',code:'ad',label:'مدير النظام — المالك فقط'}
]);
const CODE_ROLE=Object.fromEntries(INVITATION_ROLES.map(item=>[item.code,item.role]));
let botUsername='';

export function normalizeInvitationPhone(value){
  let raw=String(value||'').trim().replace(/[\s()\-.]/g,'');
  if(raw.startsWith('00'))raw=`+${raw.slice(2)}`;
  if(/^05\d{8}$/.test(raw))raw=`+966${raw.slice(1)}`;
  else if(/^01\d{9}$/.test(raw))raw=`+20${raw.slice(1)}`;
  else if(/^\d{8,15}$/.test(raw))raw=`+${raw}`;
  if(!/^\+[1-9]\d{7,14}$/.test(raw))throw Object.assign(new Error('اكتب رقم الجوال بصيغة صحيحة مع كود الدولة، مثل +9665XXXXXXXX'),{code:'INVITATION_PHONE_INVALID'});
  return raw;
}
export const maskInvitationPhone=phone=>{const value=String(phone||'');return value.length<8?'***':`${value.slice(0,4)}****${value.slice(-3)}`;};
export function normalizeInvitationNickname(value){
  const nickname=String(value||'').replace(/\s+/g,' ').trim();
  if(/^(لا يوجد|بدون|skip)$/i.test(nickname))return'';
  if(nickname.length<2||nickname.length>80||/^\d+$/.test(nickname))throw Object.assign(new Error('الكنية يجب أن تكون من حرفين إلى 80 حرفًا، أو اكتب «لا يوجد».'),{code:'INVITATION_NICKNAME_INVALID'});
  return nickname;
}
export const invitationTokenHash=token=>crypto.createHash('sha256').update(String(token||'')).digest('hex');
export function invitationRoleAllowed(identity,role){
  if(!identity?.active)return false;
  const owner=String(identity.external_id||'')===String(config.telegramOwnerId||'');
  if(OWNER_ONLY_ROLES.has(role))return owner;
  if(owner||identity.role==='admin')return INVITATION_ROLES.some(item=>item.role===role);
  return identity.role==='manager'&&MANAGER_ROLES.has(role);
}
function canCreate(identity){return Boolean(identity?.active&&(['admin','manager'].includes(identity.role)||String(identity.external_id||'')===String(config.telegramOwnerId||'')));}
function canApprove(identity,invitation){
  const owner=String(identity?.external_id||'')===String(config.telegramOwnerId||'');
  if(!identity?.active||(!owner&&identity.role!=='admin'))return false;
  if(invitation?.requested_role==='admin'&&!owner)return false;
  return String(identity.external_id||'')!==String(invitation?.accepted_by_telegram_id||'');
}
async function setSession(chatId,userId,state,context={}){return upsert('bot_sessions',[{channel:'telegram',chat_id:String(chatId),external_user_id:String(userId),state,context,updated_at:now()}],'channel,chat_id,external_user_id');}
function roleKeyboard(identity,prefix='role'){
  const allowed=INVITATION_ROLES.filter(item=>invitationRoleAllowed(identity,item.role)),rows=[];
  for(let i=0;i<allowed.length;i+=2)rows.push(allowed.slice(i,i+2).map(item=>({text:item.label,callback_data:`ent:inv|${prefix}|${item.code}`})));
  rows.push([{text:'إلغاء',callback_data:'ent:inv|cancel'}]);return keyboard(rows);
}
function invitationMenu(){return keyboard([[{text:'دعوة مستخدم جديد',callback_data:'ent:inv|new'},{text:'قائمة الدعوات',callback_data:'ent:inv|list'}],[{text:'القائمة الرئيسية',callback_data:'ent:help'}]]);}
async function getBotUsername(){if(botUsername)return botUsername;const me=await telegram('getMe');botUsername=String(me?.username||'').replace(/^@/,'');if(!botUsername)throw Object.assign(new Error('اسم مستخدم البوت غير متاح'),{code:'BOT_USERNAME_MISSING'});return botUsername;}
async function sendSensitiveLink(chatId,text,markup){
  return telegram('sendMessage',{chat_id:String(chatId),text,parse_mode:'HTML',disable_web_page_preview:true,...(markup||{})});
}
function nicknameOf(invitation){return String(invitation?.nickname||invitation?.metadata?.nickname||'').trim().slice(0,80);}
async function patchInvitedUser(telegramId,data,nickname=''){
  const preferred=String(nickname||'').trim().slice(0,80);
  try{return await patch('app_users',`external_id=eq.${encodeURIComponent(String(telegramId))}`,{...data,nickname:preferred||null});}
  catch(error){if(!/nickname|column.*does not exist|schema cache/i.test(String(error?.message||'')))throw error;return patch('app_users',`external_id=eq.${encodeURIComponent(String(telegramId))}`,data);}
}
async function linkedTelegramId(phone){
  const employees=await select('employees',`phone=eq.${encodeURIComponent(phone)}&active=eq.true&select=external_id,full_name,phone&limit=2`).catch(()=>[]),employee=employees?.[0];
  if(!employee?.external_id)return'';
  const user=(await select('app_users',`employee_external_id=eq.${encodeURIComponent(employee.external_id)}&select=external_id,active,role&limit=1`).catch(()=>[]))?.[0];
  return String(user?.external_id||'');
}
export async function showInvitationMenu(message,identity){
  if(!canCreate(identity))return sendMessage(message.chat.id,'إنشاء الدعوات متاح للمالك ومدير النظام ومدير المصنع ضمن الأدوار المسموحة.');
  return sendMessage(message.chat.id,'<b>إدارة دعوات المستخدمين</b>\n\nالدعوة لا تفعّل الحساب تلقائيًا. الموظف يفتح الرابط ثم ينتظر اعتماد الإدارة.',invitationMenu());
}
export async function startInvitation(message,identity){
  if(!canCreate(identity))return showInvitationMenu(message,identity);
  await setSession(message.chat.id,identity.external_id||message.from.id,'enterprise_invite_phone',{startedAt:now(),sourceMessageId:message.message_id||null});
  return sendMessage(message.chat.id,'اكتب رقم جوال الموظف مع كود الدولة. مثال: <code>+9665XXXXXXXX</code>');
}
async function createInvitation(message,identity,context){
  if(!invitationRoleAllowed(identity,context.requestedRole))return sendMessage(message.chat.id,'لا تملك صلاحية إنشاء دعوة بهذا الدور.');
  const token=crypto.randomBytes(32).toString('base64url'),tokenHash=invitationTokenHash(token),expiresAt=new Date(Date.now()+72*60*60*1000).toISOString();
  const values={phone_normalized:context.phone,full_name:context.fullName,nickname:context.nickname||null,employee_external_id:context.employeeExternalId||null,requested_role:context.requestedRole,requested_capabilities:[],token_hash:tokenHash,token_prefix:token.slice(0,10),expires_at:expiresAt,status:'pending',created_by:String(identity.user_id||identity.external_id),metadata:{nickname:context.nickname||'',source_chat_id:String(message.chat.id),source_message_id:String(message.message_id||''),created_by_role:identity.role}};
  let invitation;try{invitation=(await insert('user_invitations',[values]))?.[0];}catch(error){
    if(/nickname|column.*does not exist|schema cache/i.test(String(error?.message||''))){const compatible={...values};delete compatible.nickname;invitation=(await insert('user_invitations',[compatible]))?.[0];}
    else if(/duplicate|unique|user_invitations_open_phone/i.test(String(error?.message||'')))return sendMessage(message.chat.id,'توجد دعوة مفتوحة بالفعل لهذا الرقم. ألغِ الدعوة السابقة أو استخدمها.');
    else throw error;
  }
  const username=await getBotUsername(),link=`https://t.me/${username}?start=invite_${token}`,masked=maskInvitationPhone(context.phone),text=`<b>دعوة مستخدم — مصنع بن حامد</b>\n\nالاسم: <b>${esc(context.fullName)}</b>\nالكنية: <b>${esc(context.nickname||'لا توجد')}</b>\nالجوال: <b>${esc(masked)}</b>\nالدور المطلوب: <b>${esc(ROLE_LABELS[context.requestedRole]||context.requestedRole)}</b>\nتنتهي خلال 72 ساعة.\n\nرابط الدعوة:\n${esc(link)}`;
  const markup=keyboard([[{text:'إلغاء الدعوة',callback_data:`ent:inv|revoke|${invitation.id}`},{text:'قائمة الدعوات',callback_data:'ent:inv|list'}]]).reply_markup;
  await sendSensitiveLink(message.chat.id,text,{reply_markup:markup});
  const directId=await linkedTelegramId(context.phone);
  let directSent=false;
  if(directId&&directId!==String(message.chat.id)){try{await sendSensitiveLink(directId,`لديك دعوة للانضمام إلى نظام مصنع بن حامد.\n\n${esc(link)}`);directSent=true;}catch(error){console.warn('[invitation direct send]',{status:error?.status||0,code:error?.code||null});}}
  await insert('audit_log',[{actor_type:'telegram',actor_id:String(identity.user_id||identity.external_id),action:'user_invitation_created',entity_type:'user_invitation',entity_id:invitation.id,details:{phone:masked,nickname:context.nickname||'',requested_role:context.requestedRole,expires_at:expiresAt,direct_sent:directSent,token_prefix:values.token_prefix}}],{prefer:'return=minimal'}).catch(()=>{});
  await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id).catch(()=>{});
  return invitation;
}
export async function continueInvitationSession(message,identity,session,text){
  const state=String(session?.state||'');if(!state.startsWith('enterprise_invite_'))return false;
  const value=String(text||'').trim(),userId=identity.external_id||message.from.id,context=session.context||{};
  if(/^(الغاء|إلغاء|cancel)$/i.test(value)){await clearMaintenanceSession(message.chat.id,userId);await sendMessage(message.chat.id,'تم إلغاء إنشاء الدعوة.');return true;}
  if(state==='enterprise_invite_phone'){
    let phone;try{phone=normalizeInvitationPhone(value);}catch(error){await sendMessage(message.chat.id,error.message);return true;}
    const activeEmployee=(await select('employees',`phone=eq.${encodeURIComponent(phone)}&active=eq.true&select=external_id,full_name&limit=1`).catch(()=>[]))?.[0],activeUser=activeEmployee?(await select('app_users',`employee_external_id=eq.${encodeURIComponent(activeEmployee.external_id)}&active=eq.true&select=id,role&limit=1`).catch(()=>[]))?.[0]:null;
    if(activeUser){await sendMessage(message.chat.id,'هذا الرقم مرتبط بالفعل بمستخدم نشط. لا تُنشأ دعوة جديدة لمستخدم نشط.');return true;}
    await setSession(message.chat.id,userId,'enterprise_invite_name',{...context,phone});await sendMessage(message.chat.id,'اكتب الاسم الكامل للموظف:');return true;
  }
  if(state==='enterprise_invite_name'){
    const fullName=value.replace(/\s+/g,' ').trim();if(fullName.length<3||fullName.length>160||/^\d+$/.test(fullName)){await sendMessage(message.chat.id,'الاسم غير صحيح. اكتب اسمًا من 3 إلى 160 حرفًا.');return true;}
    await setSession(message.chat.id,userId,'enterprise_invite_nickname',{...context,fullName});await sendMessage(message.chat.id,'اكتب كنية الموظف أو الاسم الذي يحب أن نناديه به، أو اكتب «لا يوجد».');return true;
  }
  if(state==='enterprise_invite_nickname'){
    let nickname;try{nickname=normalizeInvitationNickname(value);}catch(error){await sendMessage(message.chat.id,error.message);return true;}
    await setSession(message.chat.id,userId,'enterprise_invite_employee',{...context,nickname});await sendMessage(message.chat.id,'اكتب رقم الموظف الداخلي، أو اكتب «لا يوجد».');return true;
  }
  if(state==='enterprise_invite_employee'){
    const employeeExternalId=/^(لا يوجد|بدون|skip)$/i.test(value)?'':value.slice(0,100);await setSession(message.chat.id,userId,'enterprise_invite_role',{...context,employeeExternalId});await sendMessage(message.chat.id,'اختر صلاحية الموظف:',roleKeyboard(identity));return true;
  }
  if(state==='enterprise_invite_role'){await sendMessage(message.chat.id,'اختر الدور من الأزرار الظاهرة.',roleKeyboard(identity));return true;}
  if(state==='enterprise_invite_confirm'){await sendMessage(message.chat.id,'استخدم زر تأكيد إنشاء الدعوة أو الإلغاء.',keyboard([[{text:'تأكيد إنشاء الدعوة',callback_data:'ent:inv|confirm'},{text:'إلغاء',callback_data:'ent:inv|cancel'}]]));return true;}
  return false;
}
export async function handleInvitationStart(message,identity,text){
  const match=String(text||'').trim().match(/^\/start(?:@\w+)?\s+invite_([A-Za-z0-9_-]{30,100})$/i);if(!match)return false;
  if(message.chat.type!=='private'){await sendMessage(message.chat.id,'افتح رابط الدعوة في المحادثة الخاصة مع البوت.');return true;}
  if(identity?.active){await sendMessage(message.chat.id,'حسابك نشط بالفعل؛ لا يمكن استخدام دعوة جديدة لتغيير الدور.');return true;}
  const hash=invitationTokenHash(match[1]);
  try{
    const result=await rpc('accept_user_invitation',{p_token_hash:hash,p_telegram_id:String(message.from.id)}),invitation=Array.isArray(result)?result[0]:result;
    await patchInvitedUser(message.from.id,{full_name:invitation.full_name,employee_external_id:invitation.employee_external_id||null,role:'pending',active:false},nicknameOf(invitation));
    await sendMessage(message.chat.id,`تم قبول الدعوة باسم <b>${esc(invitation.full_name)}</b>${nicknameOf(invitation)?` — الكنية: <b>${esc(nicknameOf(invitation))}</b>`:''}.\nالدور المطلوب: <b>${esc(ROLE_LABELS[invitation.requested_role]||invitation.requested_role)}</b>.\n\nالحساب ما زال غير نشط وينتظر اعتماد الإدارة.`);
    if(config.telegramOwnerId)await sendMessage(config.telegramOwnerId,`<b>تم فتح دعوة مستخدم</b>\n\nالاسم: <b>${esc(invitation.full_name)}</b>${nicknameOf(invitation)?`\nالكنية: <b>${esc(nicknameOf(invitation))}</b>`:''}\nالجوال: <b>${esc(maskInvitationPhone(invitation.phone_normalized))}</b>\nالدور المطلوب: <b>${esc(ROLE_LABELS[invitation.requested_role]||invitation.requested_role)}</b>\nTelegram ID: <code>${esc(message.from.id)}</code>`,keyboard([[{text:'اعتماد وتفعيل',callback_data:`ent:inv|approve|${invitation.id}`},{text:'تعديل الدور',callback_data:`ent:inv|edit|${invitation.id}`}],[{text:'رفض',callback_data:`ent:inv|reject|${invitation.id}`}]]));
  }catch(error){
    const code=String(error?.message||'');const messageText=/EXPIRED/.test(code)?'انتهت صلاحية رابط الدعوة.':/ALREADY_ACCEPTED/.test(code)?'تم استخدام رابط الدعوة بواسطة حساب آخر.':/NOT_USABLE/.test(code)?'رابط الدعوة مستخدم أو ملغى.':'رابط الدعوة غير صالح.';await sendMessage(message.chat.id,messageText);
  }
  return true;
}
async function listInvitations(message,identity){
  if(!canCreate(identity))return showInvitationMenu(message,identity);
  let rows;try{rows=await select('user_invitations','select=id,phone_normalized,full_name,nickname,metadata,requested_role,status,expires_at,accepted_by_telegram_id,created_at&order=created_at.desc&limit=20');}catch{rows=await select('user_invitations','select=id,phone_normalized,full_name,metadata,requested_role,status,expires_at,accepted_by_telegram_id,created_at&order=created_at.desc&limit=20').catch(()=>[]);}
  if(!rows.length)return sendMessage(message.chat.id,'لا توجد دعوات مسجلة.');
  const text=rows.map((row,index)=>`${index+1}. <b>${esc(row.full_name)}</b>${nicknameOf(row)?` (${esc(nicknameOf(row))})`:''} — ${esc(ROLE_LABELS[row.requested_role]||row.requested_role)}\n${esc(maskInvitationPhone(row.phone_normalized))} | ${esc(row.status)} | ${String(row.expires_at||'').slice(0,16).replace('T',' ')}`).join('\n\n');
  const buttons=rows.filter(row=>['pending','opened','accepted_pending_approval'].includes(row.status)).slice(0,8).map(row=>[{text:`إلغاء: ${row.full_name.slice(0,18)}`,callback_data:`ent:inv|revoke|${row.id}`}]);buttons.push([{text:'دعوة جديدة',callback_data:'ent:inv|new'}]);return sendMessage(message.chat.id,`<b>آخر الدعوات</b>\n\n${text}`,keyboard(buttons));
}
async function decideInvitation(message,identity,id,decision){
  const invitation=(await select('user_invitations',`id=eq.${encodeURIComponent(id)}&select=*&limit=1`))?.[0];if(!invitation)return sendMessage(message.chat.id,'الدعوة غير موجودة.');
  if(!canApprove(identity,invitation))return sendMessage(message.chat.id,'لا تملك صلاحية اعتماد هذه الدعوة، أو لا يجوز اعتماد حسابك بنفسك.');
  if(invitation.status!=='accepted_pending_approval')return sendMessage(message.chat.id,'الدعوة ليست في حالة انتظار الاعتماد.');
  const actor=String(identity.user_id||identity.external_id),approved=decision==='approve';
  if(approved){
    const users=await patchInvitedUser(invitation.accepted_by_telegram_id,{full_name:invitation.full_name,employee_external_id:invitation.employee_external_id||null,role:invitation.requested_role,active:true},nicknameOf(invitation)),user=users?.[0];if(!user)throw Object.assign(new Error('تعذر العثور على مستخدم الدعوة'),{code:'INVITATION_USER_NOT_FOUND'});
    await patch('user_invitations',`id=eq.${encodeURIComponent(id)}`,{status:'approved',approved_by:actor,approved_at:now()});
    await insert('audit_log',[{actor_type:'telegram',actor_id:actor,action:'user_invitation_approved',entity_type:'app_user',entity_id:user.id,details:{invitation_id:id,nickname:nicknameOf(invitation),new_role:invitation.requested_role,target_telegram_id:invitation.accepted_by_telegram_id}}],{prefer:'return=minimal'}).catch(()=>{});
    if(invitation.employee_external_id)await patch('employees',`external_id=eq.${encodeURIComponent(invitation.employee_external_id)}`,{nickname:nicknameOf(invitation)||null}).catch(()=>{});
    await sendMessage(invitation.accepted_by_telegram_id,`تم اعتماد حسابك وتفعيله.${nicknameOf(invitation)?`\nالكنية: <b>${esc(nicknameOf(invitation))}</b>`:''}\nالدور: <b>${esc(ROLE_LABELS[invitation.requested_role]||invitation.requested_role)}</b>.\nاستخدم /menu لفتح العمليات.`).catch(()=>{});return sendMessage(message.chat.id,'تم اعتماد المستخدم وتفعيل صلاحياته.');
  }
  await patch('user_invitations',`id=eq.${encodeURIComponent(id)}`,{status:'rejected',revoked_by:actor,revoked_at:now()});await sendMessage(invitation.accepted_by_telegram_id,'تم رفض طلب تفعيل الحساب. راجع الإدارة.').catch(()=>{});return sendMessage(message.chat.id,'تم رفض الدعوة دون تفعيل المستخدم.');
}
export async function handleInvitationTextCommand(message,identity,text){
  const raw=String(text||'').trim(),value=norm(raw);if(/^\/invite(?:@\w+)?$/i.test(raw)||/^(دعوه مستخدم|دعوة مستخدم|دعوه موظف|دعوة موظف|اداره الدعوات|إدارة الدعوات)$/.test(value)){await showInvitationMenu(message,identity);return true;}return false;
}
export async function handleInvitationCallback(message,from,identity,value){
  const parts=String(value||'').split('|');if(parts[0]!=='inv')return false;const action=parts[1],id=parts[2],userId=identity.external_id||from.id;
  if(action==='new'){await startInvitation({...message,from},identity);return true;}if(action==='list'){await listInvitations({...message,from},identity);return true;}if(action==='cancel'){await clearMaintenanceSession(message.chat.id,userId);await sendMessage(message.chat.id,'تم إلغاء العملية.');return true;}
  if(action==='role'||action==='editrole'){
    const role=CODE_ROLE[parts[2]]||'',session=await getBotSession(message.chat.id,userId),context=session?.context||{};if(!invitationRoleAllowed(identity,role)){await sendMessage(message.chat.id,'الدور غير مسموح لك.');return true;}
    if(context.editInvitationId){await patch('user_invitations',`id=eq.${encodeURIComponent(context.editInvitationId)}&status=eq.accepted_pending_approval`,{requested_role:role});await clearMaintenanceSession(message.chat.id,userId);await sendMessage(message.chat.id,`تم تعديل الدور المطلوب إلى <b>${esc(ROLE_LABELS[role]||role)}</b>.`);return true;}
    if(session?.state!=='enterprise_invite_role'){await sendMessage(message.chat.id,'انتهت جلسة الدعوة. ابدأ من جديد.');return true;}const next={...context,requestedRole:role};await setSession(message.chat.id,userId,'enterprise_invite_confirm',next);await sendMessage(message.chat.id,`<b>مراجعة الدعوة</b>\n\nالاسم: ${esc(next.fullName)}\nالكنية: <b>${esc(next.nickname||'لا توجد')}</b>\nالجوال: ${esc(maskInvitationPhone(next.phone))}\nرقم الموظف: ${esc(next.employeeExternalId||'غير متوفر')}\nالدور: <b>${esc(ROLE_LABELS[role]||role)}</b>\n\nلن يتفعل الحساب إلا بعد قبول الرابط واعتماد الإدارة.`,keyboard([[{text:'تأكيد إنشاء الدعوة',callback_data:'ent:inv|confirm'},{text:'إلغاء',callback_data:'ent:inv|cancel'}]]));return true;
  }
  if(action==='confirm'){const session=await getBotSession(message.chat.id,userId);if(session?.state!=='enterprise_invite_confirm')return sendMessage(message.chat.id,'انتهت جلسة الدعوة. ابدأ من جديد.');await createInvitation({...message,from},identity,session.context||{});return true;}
  if(action==='approve'||action==='reject'){await decideInvitation({...message,from},identity,id,action);return true;}
  if(action==='edit'){
    const invitation=(await select('user_invitations',`id=eq.${encodeURIComponent(id)}&status=eq.accepted_pending_approval&select=id,requested_role&limit=1`))?.[0];if(!invitation||!canApprove(identity,invitation))return sendMessage(message.chat.id,'لا يمكن تعديل هذه الدعوة.');await setSession(message.chat.id,userId,'enterprise_invite_edit_role',{editInvitationId:id});await sendMessage(message.chat.id,'اختر الدور الجديد:',roleKeyboard(identity,'editrole'));return true;
  }
  if(action==='revoke'){
    if(!canCreate(identity))return sendMessage(message.chat.id,'لا تملك صلاحية إلغاء الدعوات.');const actor=String(identity.user_id||identity.external_id),rows=await patch('user_invitations',`id=eq.${encodeURIComponent(id)}&status=in.(pending,opened,accepted_pending_approval)`,{status:'revoked',revoked_by:actor,revoked_at:now()});return sendMessage(message.chat.id,rows?.length?'تم إلغاء الدعوة.':'الدعوة غير موجودة أو انتهت بالفعل.');
  }
  return false;
}
