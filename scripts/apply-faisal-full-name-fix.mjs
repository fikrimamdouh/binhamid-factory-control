import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const path=join(root,'api/_lib/bot-invitations.js');
let content=readFileSync(path,'utf8');

const functionStart='async function createFaisalPreviewInvitation(message,identity){';
const functionEnd='export async function handleInvitationTextCommand';
const start=content.indexOf(functionStart);
const end=start<0?-1:content.indexOf(functionEnd,start);
if(start<0||end<0)throw new Error('Faisal invitation function anchor missing');

const fixedFunction=[
  "async function createFaisalPreviewInvitation(message,identity){",
  "  if(!canCreate(identity))return showInvitationMenu(message,identity);",
  "  const employees=await select('employees','active=eq.true&select=external_id,full_name,nickname,role&limit=500').catch(()=>[]);",
  "  const targetName='فيصل سيد احمد';",
  "  const matches=(employees||[]).filter(row=>norm(row.full_name)===targetName);",
  "  if(matches.length!==1)return sendMessage(message.chat.id,matches.length?'يوجد أكثر من موظف فعال باسم فيصل سيد أحمد. يلزم تصحيح التكرار في سجل الموظفين أولًا.':'لم أجد موظفًا فعالًا بالاسم الكامل «فيصل سيد أحمد» في سجل الموظفين.');",
  "  const employee=matches[0];",
  "  const activeUsers=await select('app_users',`employee_external_id=eq.${encodeURIComponent(employee.external_id)}&active=eq.true&select=id,role&limit=2`).catch(()=>[]);",
  "  if(activeUsers.length)return sendMessage(message.chat.id,'الموظف فيصل سيد أحمد مرتبط بالفعل بحساب نشط. لا يمكن إنشاء رابط جديد قبل إيقاف الربط الحالي.');",
  "  const openInvitations=await select('user_invitations',`employee_external_id=eq.${encodeURIComponent(employee.external_id)}&status=in.(pending,opened,accepted_pending_approval)&select=id&limit=20`).catch(()=>[]);",
  "  for(const row of openInvitations)await patch('user_invitations',`id=eq.${encodeURIComponent(row.id)}`,{status:'revoked',revoked_by:String(identity.user_id||identity.external_id),revoked_at:now()}).catch(()=>{});",
  "  const token=crypto.randomBytes(32).toString('base64url'),tokenHash=invitationTokenHash(token),expiresAt=new Date(Date.now()+72*60*60*1000).toISOString();",
  "  const syntheticPhone=`+999${String(Date.now()).slice(-11)}`;",
  "  const metadata={nickname:employee.nickname||'فيصل',source_chat_id:String(message.chat.id),source_message_id:String(message.message_id||''),created_by_role:identity.role,owner_auto_approve:true,accounting_preview:true,one_time_employee_link:true,fixed_employee_external_id:employee.external_id};",
  "  const values={phone_normalized:syntheticPhone,full_name:employee.full_name,nickname:employee.nickname||'فيصل',employee_external_id:employee.external_id,requested_role:'accountant',requested_capabilities:[],token_hash:tokenHash,token_prefix:token.slice(0,10),expires_at:expiresAt,status:'pending',created_by:String(identity.user_id||identity.external_id),metadata};",
  "  let invitation;",
  "  try{invitation=(await insert('user_invitations',[values]))?.[0];}",
  "  catch(error){if(/nickname|column.*does not exist|schema cache/i.test(String(error?.message||''))){const compatible={...values};delete compatible.nickname;invitation=(await insert('user_invitations',[compatible]))?.[0];}else throw error;}",
  "  const username=await getBotUsername(),link=`https://t.me/${username}?start=invite_${token}`;",
  "  const text=`<b>دعوة خاصة — فيصل سيد أحمد</b>\n\nهذه الدعوة مرتبطة مباشرة بسجل الموظف <b>${esc(employee.full_name)}</b>.\nأول حساب Telegram يفتح الرابط يُربط بالموظف، ثم يُغلق الرابط نهائيًا.\n\nالدور الظاهر: <b>محاسب</b>\nالمتاح فعليًا: <b>الحضور والانصراف من المكتب</b>\nالخدمات المحاسبية: <b>قيد التجهيز</b>\nتنتهي صلاحية الرابط خلال 72 ساعة.\n\nرابط الدعوة:\n${esc(link)}`;",
  "  const markup=keyboard([[{text:'إلغاء الرابط',callback_data:`ent:inv|revoke|${invitation.id}`},{text:'قائمة الدعوات',callback_data:'ent:inv|list'}]]).reply_markup;",
  "  await sendSensitiveLink(message.chat.id,text,{reply_markup:markup});",
  "  await insert('audit_log',[{actor_type:'telegram',actor_id:String(identity.user_id||identity.external_id),action:'fixed_employee_invitation_created',entity_type:'user_invitation',entity_id:invitation.id,details:{employee_external_id:employee.external_id,employee_name:employee.full_name,requested_role:'accountant',expires_at:expiresAt,one_time:true,token_prefix:values.token_prefix}}],{prefer:'return=minimal'}).catch(()=>{});",
  "  await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id).catch(()=>{});",
  "  return invitation;",
  "}",
  ""
].join('\n');
content=content.slice(0,start)+fixedFunction+content.slice(end);

content=content.replace("{text:'دعوة فيصل — المحاسبة',callback_data:'ent:inv|faisal'}","{text:'دعوة فيصل سيد أحمد — رابط واحد',callback_data:'ent:inv|faisal'}");
content=content.replace("{text:'دعوة فيصل سيد أحمد — المحاسبة',callback_data:'ent:inv|faisal'}","{text:'دعوة فيصل سيد أحمد — رابط واحد',callback_data:'ent:inv|faisal'}");

const activationMarker="    await patchInvitedUser(message.from.id,{full_name:invitation.full_name,employee_external_id:invitation.employee_external_id||null,role:'pending',active:false},nicknameOf(invitation));";
const fixedActivation=[
  "    if(invitation?.metadata?.one_time_employee_link){",
  "      const fixedEmployeeExternalId=String(invitation.employee_external_id||invitation.metadata.fixed_employee_external_id||'');",
  "      const employees=await select('employees',`external_id=eq.${encodeURIComponent(fixedEmployeeExternalId)}&active=eq.true&select=external_id,full_name,nickname&limit=2`).catch(()=>[]);",
  "      if(employees.length!==1)throw Object.assign(new Error('FIXED_EMPLOYEE_NOT_FOUND'),{code:'FIXED_EMPLOYEE_NOT_FOUND'});",
  "      const activeLinks=await select('app_users',`employee_external_id=eq.${encodeURIComponent(fixedEmployeeExternalId)}&active=eq.true&select=id&limit=2`).catch(()=>[]);",
  "      if(activeLinks.length)throw Object.assign(new Error('EMPLOYEE_ALREADY_LINKED'),{code:'EMPLOYEE_ALREADY_LINKED'});",
  "      const employee=employees[0],telegramId=String(message.from.id);",
  "      const linked={...invitation,full_name:employee.full_name,employee_external_id:employee.external_id,requested_role:'accountant',accepted_by_telegram_id:telegramId,metadata:{...(invitation.metadata||{}),accounting_preview:true,one_time_employee_link:true}};",
  "      await activateInvitation(linked,telegramId,'fixed-one-time');",
  "      await clearMaintenanceSession(message.chat.id,telegramId).catch(()=>{});",
  "      await sendMessage(message.chat.id,`تم ربط حسابك بالموظف <b>${esc(employee.full_name)}</b> وتفعيله بنجاح.\n\nتم تفعيل الحضور والانصراف من المكتب. خدمات القسم المحاسبي قيد الإنشاء والتحديث وستظهر تباعًا بعد اعتمادها.\n\nاستخدم /menu لفتح القائمة.`);",
  "      if(config.telegramOwnerId&&String(config.telegramOwnerId)!==telegramId)await sendMessage(config.telegramOwnerId,`تم استخدام رابط فيصل وربط Telegram ID <code>${esc(telegramId)}</code> بالموظف <b>${esc(employee.full_name)}</b>. الرابط أصبح غير صالح لإعادة الاستخدام.`).catch(()=>{});",
  "      return true;",
  "    }",
  activationMarker
].join('\n');
if(!content.includes("invitation?.metadata?.one_time_employee_link")){
  if(!content.includes(activationMarker))throw new Error('Fixed invitation activation anchor missing');
  content=content.replace(activationMarker,fixedActivation);
}

const oldError="    }catch(error){const code=String(error?.message||'');const messageText=/EXPIRED/.test(code)?'انتهت صلاحية رابط الدعوة.':/ALREADY_ACCEPTED/.test(code)?'تم استخدام رابط الدعوة بالفعل. افتح /menu أو راجع الإدارة.':/NOT_USABLE/.test(code)?'رابط الدعوة مستخدم أو ملغى.':'رابط الدعوة غير صالح.';await sendMessage(message.chat.id,messageText);}";
const newError="    }catch(error){const code=String(error?.code||error?.message||'');const messageText=/EMPLOYEE_ALREADY_LINKED/.test(code)?'تم ربط الموظف فيصل بحساب آخر بالفعل. أوقف الربط السابق قبل إنشاء دعوة جديدة.':/FIXED_EMPLOYEE_NOT_FOUND/.test(code)?'تعذر العثور على سجل فيصل المرتبط بهذه الدعوة. ألغِ الرابط وأنشئ رابطًا جديدًا.':/EXPIRED/.test(code)?'انتهت صلاحية رابط الدعوة.':/ALREADY_ACCEPTED/.test(code)?'تم استخدام رابط الدعوة بالفعل، ولا يمكن استخدامه مرة ثانية.':/NOT_USABLE/.test(code)?'رابط الدعوة مستخدم أو ملغى.':'رابط الدعوة غير صالح.';await sendMessage(message.chat.id,messageText);}";
if(content.includes(oldError))content=content.replace(oldError,newError);
else if(!content.includes("تم استخدام رابط الدعوة بالفعل، ولا يمكن استخدامه مرة ثانية"))throw new Error('Invitation error mapping anchor missing');

writeFileSync(path,content,'utf8');
console.log('Applied one-time Telegram invitation bound to Faisal Sayed Ahmed with office attendance and accountant preview.');
