import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const path=join(root,'api/_lib/bot-invitations.js');
let content=readFileSync(path,'utf8');

function replaceOnce(search,replacement,label){
  if(content.includes(replacement))return;
  if(!content.includes(search))throw new Error(`Driver plate invitation patch anchor missing: ${label}`);
  content=content.replace(search,replacement);
}

replaceOnce(
  "function invitationMenu(){return keyboard([[{text:'دعوة فيصل سيد أحمد — رابط واحد',callback_data:'ent:inv|faisal'}],[{text:'دعوة مستخدم جديد',callback_data:'ent:inv|new'},{text:'قائمة الدعوات',callback_data:'ent:inv|list'}],[{text:'القائمة الرئيسية',callback_data:'ent:help'}]]);}",
  "function invitationMenu(){return keyboard([[{text:'دعوة فيصل سيد أحمد — رابط واحد',callback_data:'ent:inv|faisal'}],[{text:'دعوات السائقين واللوحات',callback_data:'ent:inv|drivers'}],[{text:'دعوة مستخدم جديد',callback_data:'ent:inv|new'},{text:'قائمة الدعوات',callback_data:'ent:inv|list'}],[{text:'القائمة الرئيسية',callback_data:'ent:help'}]]);}",
  'driver invitation menu'
);

const helpers = [
"function driverRole(value){return /سائق|driver/i.test(norm(value));}",
"function driverPlateLabel(option){const name=String(option.fullName||'سائق').slice(0,30),plate=String(option.plateNo||'بدون لوحة').slice(0,18);return `${name} — ${plate}`;}",
"async function loadDriverPlateOptions(){",
"  const employees=await select('employees','active=eq.true&select=external_id,full_name,nickname,role&order=full_name.asc&limit=1000').catch(()=>[]);",
"  const drivers=(employees||[]).filter(row=>driverRole(row.role));",
"  const driverIds=new Set(drivers.map(row=>String(row.external_id)));",
"  let assets=await select('unified_assets','active=eq.true&assigned_employee_external_id=not.is.null&select=external_id,assigned_employee_external_id,plate_no,asset_no,asset_name,asset_type,make,model&order=plate_no.asc.nullslast&limit=2000').catch(()=>[]);",
"  const vehicles=await select('vehicles','active=eq.true&driver_external_id=not.is.null&select=external_id,driver_external_id,plate_no,asset_no,vehicle_type,make,model,status&order=plate_no.asc.nullslast&limit=2000').catch(()=>[]);",
"  const assetMap=new Map();",
"  for(const row of assets||[]){const employeeExternalId=String(row.assigned_employee_external_id||'');if(!driverIds.has(employeeExternalId)||!String(row.plate_no||'').trim())continue;assetMap.set(String(row.external_id),{vehicleExternalId:String(row.external_id),employeeExternalId,plateNo:String(row.plate_no).trim(),assetNo:String(row.asset_no||''),vehicleName:String(row.asset_name||row.asset_type||'مركبة')});}",
"  for(const row of vehicles||[]){const employeeExternalId=String(row.driver_external_id||'');if(!driverIds.has(employeeExternalId)||!String(row.plate_no||'').trim())continue;const key=String(row.external_id);if(!assetMap.has(key))assetMap.set(key,{vehicleExternalId:key,employeeExternalId,plateNo:String(row.plate_no).trim(),assetNo:String(row.asset_no||''),vehicleName:String(row.vehicle_type||'مركبة')});}",
"  const users=await select('app_users','active=eq.true&employee_external_id=not.is.null&select=employee_external_id&limit=2000').catch(()=>[]);",
"  const linkedEmployees=new Set((users||[]).map(row=>String(row.employee_external_id||'')).filter(Boolean));",
"  const employeeMap=new Map(drivers.map(row=>[String(row.external_id),row]));",
"  return [...assetMap.values()].filter(asset=>!linkedEmployees.has(asset.employeeExternalId)).map(asset=>{const employee=employeeMap.get(asset.employeeExternalId)||{};return {...asset,fullName:employee.full_name||'سائق',nickname:employee.nickname||''};}).sort((a,b)=>String(a.fullName).localeCompare(String(b.fullName),'ar')||String(a.plateNo).localeCompare(String(b.plateNo),'ar'));",
"}",
"async function showDriverPlateInvitations(message,identity){",
"  if(!canCreate(identity))return showInvitationMenu(message,identity);",
"  const options=await loadDriverPlateOptions();",
"  if(!options.length)return sendMessage(message.chat.id,'لا توجد حاليًا دعوات سائقين جاهزة. يلزم أن يكون الموظف فعالًا بوظيفة سائق، وله لوحة مسندة، وألا يكون مرتبطًا بحساب نشط.');",
"  const limited=options.slice(0,60);",
"  await setSession(message.chat.id,identity.external_id||message.from.id,'enterprise_invite_driver_plate',{options:limited,startedAt:now()});",
"  const rows=limited.map((option,index)=>[{text:driverPlateLabel(option),callback_data:`ent:inv|driver|${index}`}]);",
"  rows.push([{text:'إلغاء',callback_data:'ent:inv|cancel'}]);",
"  const extra=options.length>limited.length?`\n\nتم عرض أول ${limited.length} نتيجة فقط.`:'';",
"  return sendMessage(message.chat.id,`<b>دعوات السائقين واللوحات</b>\n\nاختر السائق واللوحة الصحيحة. سيُنشأ رابط واحد يُربط تلقائيًا بالاسم واللوحة، ثم يُغلق بعد أول استخدام.${extra}`,keyboard(rows));",
"}",
"async function currentDriverAsset(option){",
"  const employeeId=encodeURIComponent(String(option.employeeExternalId||'')),assetId=encodeURIComponent(String(option.vehicleExternalId||''));",
"  const unified=(await select('unified_assets',`external_id=eq.${assetId}&assigned_employee_external_id=eq.${employeeId}&active=eq.true&select=external_id,assigned_employee_external_id,plate_no,asset_no,asset_name,asset_type&limit=2`).catch(()=>[]))||[];",
"  if(unified.length===1)return{vehicleExternalId:String(unified[0].external_id),employeeExternalId:String(unified[0].assigned_employee_external_id),plateNo:String(unified[0].plate_no||'').trim(),vehicleName:String(unified[0].asset_name||unified[0].asset_type||'مركبة')};",
"  const vehicles=(await select('vehicles',`external_id=eq.${assetId}&driver_external_id=eq.${employeeId}&active=eq.true&select=external_id,driver_external_id,plate_no,asset_no,vehicle_type&limit=2`).catch(()=>[]))||[];",
"  if(vehicles.length===1)return{vehicleExternalId:String(vehicles[0].external_id),employeeExternalId:String(vehicles[0].driver_external_id),plateNo:String(vehicles[0].plate_no||'').trim(),vehicleName:String(vehicles[0].vehicle_type||'مركبة')};",
"  return null;",
"}",
"async function createDriverPlateInvitation(message,identity,index){",
"  if(!canCreate(identity))return showInvitationMenu(message,identity);",
"  const userId=identity.external_id||message.from.id,session=await getBotSession(message.chat.id,userId);",
"  if(session?.state!=='enterprise_invite_driver_plate')return sendMessage(message.chat.id,'انتهت قائمة السائقين. افتح دعوات السائقين واللوحات من جديد.');",
"  const option=(session.context?.options||[])[Number(index)];",
"  if(!option)return sendMessage(message.chat.id,'اختيار السائق غير صالح. افتح القائمة من جديد.');",
"  const employees=await select('employees',`external_id=eq.${encodeURIComponent(String(option.employeeExternalId))}&active=eq.true&select=external_id,full_name,nickname,role&limit=2`).catch(()=>[]);",
"  if(employees.length!==1||!driverRole(employees[0].role))return sendMessage(message.chat.id,'السائق غير موجود أو لم تعد وظيفته سائقًا.');",
"  const employee=employees[0],asset=await currentDriverAsset(option);",
"  if(!asset||!asset.plateNo)return sendMessage(message.chat.id,'اللوحة لم تعد مسندة لهذا السائق. صحح إسناد المركبة ثم أعد المحاولة.');",
"  const activeUsers=await select('app_users',`employee_external_id=eq.${encodeURIComponent(String(employee.external_id))}&active=eq.true&select=id&limit=2`).catch(()=>[]);",
"  if(activeUsers.length)return sendMessage(message.chat.id,'هذا السائق مرتبط بالفعل بحساب نشط. لا يمكن إنشاء رابط آخر له.');",
"  const conflictingAssignments=await select('employee_assignments',`vehicle_external_id=eq.${encodeURIComponent(asset.vehicleExternalId)}&active=eq.true&select=employee_external_id,app_user_id&limit=10`).catch(()=>[]);",
"  if((conflictingAssignments||[]).some(row=>String(row.employee_external_id||'')&&String(row.employee_external_id)!==String(employee.external_id)))return sendMessage(message.chat.id,'هذه اللوحة مرتبطة حاليًا بسائق آخر داخل حسابات التطبيق. صحح الربط قبل إنشاء الدعوة.');",
"  const openInvitations=await select('user_invitations',`employee_external_id=eq.${encodeURIComponent(String(employee.external_id))}&status=in.(pending,opened,accepted_pending_approval)&select=id&limit=20`).catch(()=>[]);",
"  for(const row of openInvitations||[])await patch('user_invitations',`id=eq.${encodeURIComponent(row.id)}`,{status:'revoked',revoked_by:String(identity.user_id||identity.external_id),revoked_at:now()}).catch(()=>{});",
"  const token=crypto.randomBytes(32).toString('base64url'),tokenHash=invitationTokenHash(token),expiresAt=new Date(Date.now()+72*60*60*1000).toISOString(),syntheticPhone='+997'+String(Date.now()).slice(-11);",
"  const metadata={nickname:employee.nickname||'',source_chat_id:String(message.chat.id),source_message_id:String(message.message_id||''),created_by_role:identity.role,owner_auto_approve:true,one_time_driver_link:true,fixed_employee_external_id:employee.external_id,fixed_vehicle_external_id:asset.vehicleExternalId,fixed_plate_no:asset.plateNo};",
"  const values={phone_normalized:syntheticPhone,full_name:employee.full_name,nickname:employee.nickname||null,employee_external_id:employee.external_id,requested_role:'driver',requested_capabilities:[],token_hash:tokenHash,token_prefix:token.slice(0,10),expires_at:expiresAt,status:'pending',created_by:String(identity.user_id||identity.external_id),metadata};",
"  let invitation;",
"  try{invitation=(await insert('user_invitations',[values]))?.[0];}",
"  catch(error){if(/nickname|column.*does not exist|schema cache/i.test(String(error?.message||''))){const compatible={...values};delete compatible.nickname;invitation=(await insert('user_invitations',[compatible]))?.[0];}else throw error;}",
"  const username=await getBotUsername(),link=`https://t.me/${username}?start=invite_${token}`;",
"  const text=[`<b>دعوة سائق — مصنع بن حامد</b>`,'',`السائق: <b>${esc(employee.full_name)}</b>`,`اللوحة: <b>${esc(asset.plateNo)}</b>`,`المركبة: <b>${esc(asset.vehicleName)}</b>`,'',`أول حساب Telegram يفتح الرابط سيُربط تلقائيًا بالسائق واللوحة، ثم يُغلق الرابط نهائيًا.`,`تنتهي صلاحية الرابط خلال 72 ساعة.`,'',`رابط الدعوة:`,esc(link)].join('\n');",
"  const markup=keyboard([[{text:'إلغاء الرابط',callback_data:`ent:inv|revoke|${invitation.id}`},{text:'دعوات السائقين',callback_data:'ent:inv|drivers'}]]).reply_markup;",
"  await sendSensitiveLink(message.chat.id,text,{reply_markup:markup});",
"  await insert('audit_log',[{actor_type:'telegram',actor_id:String(identity.user_id||identity.external_id),action:'driver_plate_invitation_created',entity_type:'user_invitation',entity_id:invitation.id,details:{employee_external_id:employee.external_id,vehicle_external_id:asset.vehicleExternalId,plate_no:asset.plateNo,expires_at:expiresAt,one_time:true,token_prefix:values.token_prefix}}],{prefer:'return=minimal'}).catch(()=>{});",
"  await clearMaintenanceSession(message.chat.id,userId).catch(()=>{});",
"  return invitation;",
"}",
""
].join('\n');

if(!content.includes('async function showDriverPlateInvitations(message,identity){')){
  const marker='export async function handleInvitationTextCommand(message,identity,text){';
  if(!content.includes(marker))throw new Error('Driver helper insertion anchor missing');
  content=content.replace(marker,helpers+marker);
}

const activationMarker="    await patchInvitedUser(message.from.id,{full_name:invitation.full_name,employee_external_id:invitation.employee_external_id||null,role:'pending',active:false},nicknameOf(invitation));";
const driverActivation=[
"    if(invitation?.metadata?.one_time_driver_link){",
"      const employeeExternalId=String(invitation.employee_external_id||invitation.metadata.fixed_employee_external_id||''),vehicleExternalId=String(invitation.metadata.fixed_vehicle_external_id||''),telegramId=String(message.from.id);",
"      const employees=await select('employees',`external_id=eq.${encodeURIComponent(employeeExternalId)}&active=eq.true&select=external_id,full_name,nickname,role&limit=2`).catch(()=>[]);",
"      if(employees.length!==1||!/سائق|driver/i.test(norm(employees[0].role)))throw new Error('DRIVER_NOT_FOUND');",
"      const option={employeeExternalId,vehicleExternalId,plateNo:String(invitation.metadata.fixed_plate_no||'')},asset=await currentDriverAsset(option);",
"      if(!asset||!asset.plateNo)throw new Error('DRIVER_PLATE_MISMATCH');",
"      const activeLinks=await select('app_users',`employee_external_id=eq.${encodeURIComponent(employeeExternalId)}&active=eq.true&select=id&limit=2`).catch(()=>[]);",
"      if(activeLinks.length)throw new Error('DRIVER_ALREADY_LINKED');",
"      const employee=employees[0],linked={...invitation,full_name:employee.full_name,employee_external_id:employee.external_id,requested_role:'driver',accepted_by_telegram_id:telegramId,metadata:{...(invitation.metadata||{}),one_time_driver_link:true,fixed_plate_no:asset.plateNo}};",
"      const user=await activateInvitation(linked,telegramId,'driver-plate-one-time');",
"      await upsert('employee_assignments',[{app_user_id:user.id,employee_external_id:employee.external_id,vehicle_external_id:asset.vehicleExternalId,active:true}],'app_user_id');",
"      await clearMaintenanceSession(message.chat.id,telegramId).catch(()=>{});",
"      await sendMessage(message.chat.id,[`تم ربط حسابك بالسائق <b>${esc(employee.full_name)}</b> بنجاح.`,`اللوحة: <b>${esc(asset.plateNo)}</b>`,'',`استخدم /menu لفتح قائمة السائق.`].join('\n'));",
"      if(config.telegramOwnerId&&String(config.telegramOwnerId)!==telegramId)await sendMessage(config.telegramOwnerId,[`تم استخدام رابط السائق وربط الحساب بالموظف <b>${esc(employee.full_name)}</b>.`,`اللوحة: <b>${esc(asset.plateNo)}</b>`,`Telegram ID: <code>${esc(telegramId)}</code>`,`الرابط أصبح غير صالح لإعادة الاستخدام.`].join('\n')).catch(()=>{});",
"      return true;",
"    }",
activationMarker
].join('\n');

if(!content.includes("invitation?.metadata?.one_time_driver_link")){
  if(!content.includes(activationMarker))throw new Error('Driver activation anchor missing');
  content=content.replace(activationMarker,driverActivation);
}

const textPrefix="export async function handleInvitationTextCommand(message,identity,text){const raw=String(text||'').trim(),value=norm(raw);";
const textReplacement=textPrefix+"if(/^(دعوات السائقين|دعوه سائق|دعوة سائق|دعوات السواقين|دعوه سواق|دعوة سواق)$/.test(value)){await showDriverPlateInvitations(message,identity);return true;}";
replaceOnce(textPrefix,textReplacement,'driver text command');

const callbackAnchor="if(action==='new'){await startInvitation({...message,from},identity);return true;}";
const callbackReplacement="if(action==='drivers'){await showDriverPlateInvitations({...message,from},identity);return true;}if(action==='driver'){await createDriverPlateInvitation({...message,from},identity,id);return true;}"+callbackAnchor;
replaceOnce(callbackAnchor,callbackReplacement,'driver callbacks');

writeFileSync(path,content,'utf8');
console.log('Applied one-time driver invitations bound to employee names and assigned plate numbers.');
