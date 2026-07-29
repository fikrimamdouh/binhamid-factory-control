import crypto from 'node:crypto';
import { config } from './config.js';
import { getBotSession, clearMaintenanceSession } from './bot-maintenance.js';
import { insert, patch, select, upsert } from './supabase.js';
import { keyboard, sendMessage, telegram } from './telegram.js';

const now=()=>new Date().toISOString();
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const norm=value=>String(value||'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/[^a-z0-9\u0600-\u06ff]+/g,' ').replace(/\s+/g,' ').trim();
const westernDigits=value=>String(value??'').replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
const normalizePlate=value=>westernDigits(value).toUpperCase().replace(/[^A-Z0-9]/g,'');
const driverRole=value=>/سائق|driver/.test(norm(value));
const tokenHash=token=>crypto.createHash('sha256').update(String(token||'')).digest('hex');
const canCreate=identity=>Boolean(identity?.active&&(['admin','manager'].includes(identity.role)||String(identity.external_id||'')===String(config.telegramOwnerId||'')));
const PAGE_SIZE=10;
let botUsername='';

async function getBotUsername(){
  if(botUsername)return botUsername;
  const me=await telegram('getMe');
  botUsername=String(me?.username||'').replace(/^@/,'');
  if(!botUsername)throw new Error('BOT_USERNAME_MISSING');
  return botUsername;
}

async function setSession(chatId,userId,state,context={}){
  return upsert('bot_sessions',[{channel:'telegram',chat_id:String(chatId),external_user_id:String(userId),state,context,updated_at:now()}],'channel,chat_id,external_user_id');
}

async function patchInvitedUser(telegramId,data,nickname=''){
  const channel=(await select('user_channels','channel=eq.telegram&external_id=eq.'+encodeURIComponent(String(telegramId))+'&select=user_id&limit=1').catch(()=>[]))?.[0];
  if(!channel?.user_id)return null;
  const filter='id=eq.'+encodeURIComponent(channel.user_id),preferred=String(nickname||'').trim().slice(0,80);
  try{return await patch('app_users',filter,{...data,nickname:preferred||null});}
  catch(error){if(!/nickname|column.*does not exist|schema cache/i.test(String(error?.message||'')))throw error;return patch('app_users',filter,data);}
}

async function activePoolInvitation(token){
  const rows=await select('user_invitations','token_hash=eq.'+encodeURIComponent(tokenHash(token))+'&status=eq.pending&select=*&limit=2').catch(()=>[]),row=rows?.[0];
  if(!row||!row.metadata?.driver_pool_link)return null;
  if(!row.expires_at||Date.parse(row.expires_at)<=Date.now())return null;
  return row;
}

async function linkedEmployeeIds(){
  const users=await select('app_users','employee_external_id=not.is.null&select=id,employee_external_id,active&limit=3000').catch(()=>[]);
  return new Set((users||[]).map(row=>String(row.employee_external_id||'')).filter(Boolean));
}

async function availableDrivers(){
  const [employees,linked]=await Promise.all([
    select('employees','active=eq.true&select=external_id,employee_no,full_name,nickname,role&order=full_name.asc&limit=2000').catch(()=>[]),
    linkedEmployeeIds()
  ]);
  return (employees||[]).filter(row=>driverRole(row.role)&&!linked.has(String(row.external_id))).map(row=>({
    externalId:String(row.external_id),
    employeeNo:String(row.employee_no||''),
    fullName:String(row.full_name||'سائق'),
    nickname:String(row.nickname||''),
    role:String(row.role||'')
  }));
}

async function usedVehicleIds(){
  const rows=await select('employee_assignments','active=eq.true&vehicle_external_id=not.is.null&select=vehicle_external_id,employee_external_id,app_user_id&limit=3000').catch(()=>[]);
  return new Map((rows||[]).map(row=>[String(row.vehicle_external_id||''),row]));
}

function vehicleLabel(row){
  const plate=String(row.plateNo||'بدون لوحة'),name=String(row.vehicleName||'مركبة');
  return (plate+' — '+name).slice(0,55);
}

async function loadVehicles(employeeExternalId,{includeUnavailable=false}={}){
  const [used,assets,vehicles]=await Promise.all([
    usedVehicleIds(),
    select('unified_assets','active=eq.true&select=external_id,assigned_employee_external_id,plate_no,asset_no,asset_name,asset_type,make,model&order=plate_no.asc.nullslast&limit=3000').catch(()=>[]),
    select('vehicles','active=eq.true&select=external_id,driver_external_id,plate_no,asset_no,vehicle_type,make,model,status&order=plate_no.asc.nullslast&limit=3000').catch(()=>[])
  ]);
  const byPlate=new Map(),selected=String(employeeExternalId||'');
  const add=(source,row,ownerField,nameField)=>{
    const externalId=String(row.external_id||''),plateNo=String(row.plate_no||'').trim(),plateKey=normalizePlate(plateNo),owner=String(row[ownerField]||'');
    if(!externalId||!plateKey)return;
    const assignment=used.get(externalId),assignedElsewhere=Boolean(assignment&&String(assignment.employee_external_id||'')!==selected),ownedElsewhere=Boolean(owner&&owner!==selected);
    const available=!assignedElsewhere&&!ownedElsewhere;
    if(!includeUnavailable&&!available)return;
    const option={source,externalId,plateNo,plateKey,vehicleName:String(row[nameField]||row.asset_type||'مركبة'),ownerEmployeeExternalId:owner,available,assignmentEmployeeExternalId:String(assignment?.employee_external_id||'')};
    const current=byPlate.get(plateKey);
    if(!current||source==='unified_assets')byPlate.set(plateKey,option);
  };
  for(const row of assets||[])add('unified_assets',row,'assigned_employee_external_id','asset_name');
  for(const row of vehicles||[])add('vehicles',row,'driver_external_id','vehicle_type');
  return [...byPlate.values()].sort((a,b)=>String(a.plateNo).localeCompare(String(b.plateNo),'ar'));
}

async function employeeStillAvailable(externalId,currentUserId=''){
  const employees=await select('employees','external_id=eq.'+encodeURIComponent(String(externalId))+'&active=eq.true&select=external_id,employee_no,full_name,nickname,role&limit=2').catch(()=>[]);
  if(employees.length!==1||!driverRole(employees[0].role))return null;
  const users=await select('app_users','employee_external_id=eq.'+encodeURIComponent(String(externalId))+'&select=id,active&limit=10').catch(()=>[]);
  if((users||[]).some(row=>String(row.id)!==String(currentUserId||'')))return null;
  const row=employees[0];
  return {externalId:String(row.external_id),employeeNo:String(row.employee_no||''),fullName:String(row.full_name||'سائق'),nickname:String(row.nickname||''),role:String(row.role||'')};
}

async function vehicleStillAvailable(option,employeeExternalId){
  if(!option?.externalId)return null;
  const used=await select('employee_assignments','vehicle_external_id=eq.'+encodeURIComponent(String(option.externalId))+'&active=eq.true&select=employee_external_id,app_user_id&limit=10').catch(()=>[]);
  if((used||[]).some(row=>String(row.employee_external_id||'')!==String(employeeExternalId)))return null;
  if(option.source==='unified_assets'){
    const rows=await select('unified_assets','external_id=eq.'+encodeURIComponent(String(option.externalId))+'&active=eq.true&select=external_id,assigned_employee_external_id,plate_no,asset_name,asset_type&limit=2').catch(()=>[]),row=rows?.[0];
    if(!row||!normalizePlate(row.plate_no))return null;
    const owner=String(row.assigned_employee_external_id||'');if(owner&&owner!==String(employeeExternalId))return null;
    return {source:'unified_assets',externalId:String(row.external_id),plateNo:String(row.plate_no),plateKey:normalizePlate(row.plate_no),vehicleName:String(row.asset_name||row.asset_type||'مركبة')};
  }
  const rows=await select('vehicles','external_id=eq.'+encodeURIComponent(String(option.externalId))+'&active=eq.true&select=external_id,driver_external_id,plate_no,vehicle_type&limit=2').catch(()=>[]),row=rows?.[0];
  if(!row||!normalizePlate(row.plate_no))return null;
  const owner=String(row.driver_external_id||'');if(owner&&owner!==String(employeeExternalId))return null;
  return {source:'vehicles',externalId:String(row.external_id),plateNo:String(row.plate_no),plateKey:normalizePlate(row.plate_no),vehicleName:String(row.vehicle_type||'مركبة')};
}

function pagedRows(items,page,kind,labelFn){
  const maxPage=Math.max(0,Math.ceil(items.length/PAGE_SIZE)-1),safePage=Math.min(Math.max(0,Number(page)||0),maxPage),start=safePage*PAGE_SIZE,rows=[];
  items.slice(start,start+PAGE_SIZE).forEach((item,index)=>rows.push([{text:labelFn(item),callback_data:'drvreg:'+kind+'|'+(start+index)}]));
  const nav=[];
  if(safePage>0)nav.push({text:'السابق',callback_data:'drvreg:'+(kind==='name'?'names':'vehicles')+'|'+(safePage-1)});
  if(safePage<maxPage)nav.push({text:'التالي',callback_data:'drvreg:'+(kind==='name'?'names':'vehicles')+'|'+(safePage+1)});
  if(nav.length)rows.push(nav);
  return {rows,page:safePage,maxPage};
}

async function showDriverNames(message,session,page=0){
  const options=session?.context?.drivers||[];
  if(!options.length)return sendMessage(message.chat.id,'لا توجد أسماء سائقين متاحة الآن؛ كل السائقين المسجلين مرتبطون بحسابات أو وظائفهم غير مسجلة كسائق.');
  const paged=pagedRows(options,page,'name',row=>(row.fullName+(row.employeeNo?' — '+row.employeeNo:'')).slice(0,55));
  paged.rows.push([{text:'إلغاء التسجيل',callback_data:'drvreg:cancel'}]);
  return sendMessage(message.chat.id,'<b>اختر اسمك</b>\n\nتظهر هنا أسماء السائقين الفعالين الذين لا توجد لهم حسابات مرتبطة على Telegram.\nالصفحة '+(paged.page+1)+' من '+(paged.maxPage+1)+'.',keyboard(paged.rows));
}

async function showVehicleChoices(message,session,page=0){
  const options=session?.context?.vehicles||[];
  const paged=pagedRows(options,page,'vehicle',vehicleLabel);
  paged.rows.push([{text:'لوحتي غير موجودة في القائمة',callback_data:'drvreg:manual'}]);
  paged.rows.push([{text:'الرجوع لاختيار الاسم',callback_data:'drvreg:backnames'},{text:'إلغاء',callback_data:'drvreg:cancel'}]);
  const info=options.length?'اختر السيارة التي تعمل عليها من السيارات غير المرتبطة بأي حساب.':'لا توجد سيارات متاحة في القائمة؛ استخدم إدخال اللوحة يدويًا.';
  return sendMessage(message.chat.id,'<b>اختيار السيارة</b>\n\n'+info+(options.length?'\nالصفحة '+(paged.page+1)+' من '+(paged.maxPage+1)+'.':''),keyboard(paged.rows));
}

export async function createDriverPoolLink(message,identity){
  if(!canCreate(identity))return sendMessage(message.chat.id,'إنشاء رابط تسجيل السائقين متاح للإدارة فقط.');
  const existing=await select('user_invitations','requested_role=eq.driver&status=eq.pending&select=id,metadata&limit=100').catch(()=>[]);
  for(const row of existing||[])if(row.metadata?.driver_pool_link)await patch('user_invitations','id=eq.'+encodeURIComponent(row.id),{status:'revoked',revoked_by:String(identity.user_id||identity.external_id),revoked_at:now()}).catch(()=>{});
  const token=crypto.randomBytes(32).toString('base64url'),expiresAt=new Date(Date.now()+7*24*60*60*1000).toISOString(),values={
    phone_normalized:'+995'+String(Date.now()).slice(-11),
    full_name:'رابط تسجيل السائقين',
    employee_external_id:null,
    requested_role:'driver',
    requested_capabilities:[],
    token_hash:tokenHash(token),
    token_prefix:token.slice(0,10),
    expires_at:expiresAt,
    status:'pending',
    created_by:String(identity.user_id||identity.external_id),
    metadata:{driver_pool_link:true,source_chat_id:String(message.chat.id),created_by_role:identity.role,multi_use:true}
  };
  const invitation=(await insert('user_invitations',[values]))?.[0],username=await getBotUsername(),link='https://t.me/'+username+'?start=driverpool_'+token;
  const text=['<b>رابط تسجيل السائقين</b>','','السائق يفتح الرابط ثم:','1. يختار اسمه من السائقين غير المرتبطين.','2. يختار سيارة غير مرتبطة.','3. إذا لم يجد اللوحة يكتب حروفها الإنجليزية وأرقامها.','','الرابط متعدد الاستخدامات وينتهي خلال 7 أيام.','','الرابط:',esc(link)].join('\n');
  const markup=keyboard([[{text:'إلغاء الرابط',callback_data:'ent:inv|revoke|'+invitation.id},{text:'قائمة الدعوات',callback_data:'ent:inv|list'}]]).reply_markup;
  await telegram('sendMessage',{chat_id:String(message.chat.id),text,parse_mode:'HTML',disable_web_page_preview:true,reply_markup:markup});
  await insert('audit_log',[{actor_type:'telegram',actor_id:String(identity.user_id||identity.external_id),action:'driver_pool_link_created',entity_type:'user_invitation',entity_id:invitation.id,details:{expires_at:expiresAt,multi_use:true,token_prefix:values.token_prefix}}],{prefer:'return=minimal'}).catch(()=>{});
  return invitation;
}

export async function handleDriverPoolStart(message,identity,token){
  if(message.chat.type!=='private'){await sendMessage(message.chat.id,'تسجيل السائق يتم في المحادثة الخاصة مع البوت.');return true;}
  if(identity?.active){await sendMessage(message.chat.id,'حسابك نشط بالفعل ولا يمكن تسجيل اسم أو سيارة جديدة من هذا الرابط.');return true;}
  const pool=await activePoolInvitation(token);
  if(!pool){await sendMessage(message.chat.id,'رابط تسجيل السائقين غير صالح أو انتهت صلاحيته أو تم إلغاؤه.');return true;}
  const drivers=await availableDrivers();
  await setSession(message.chat.id,message.from.id,'driver_pool_name',{poolInvitationId:pool.id,drivers,startedAt:now()});
  const session=await getBotSession(message.chat.id,message.from.id);
  await showDriverNames(message,session,0);
  return true;
}

async function chooseDriverName(message,from,identity,index){
  const session=await getBotSession(message.chat.id,from.id),option=(session?.context?.drivers||[])[Number(index)];
  if(session?.state!=='driver_pool_name'||!option)return sendMessage(message.chat.id,'انتهت قائمة الأسماء. افتح رابط التسجيل من جديد.');
  const employee=await employeeStillAvailable(option.externalId,identity?.user_id);
  if(!employee){const drivers=await availableDrivers();await setSession(message.chat.id,from.id,'driver_pool_name',{...session.context,drivers});return sendMessage(message.chat.id,'هذا الاسم تم ربطه بحساب آخر أو لم يعد متاحًا. اختر اسمًا آخر.',keyboard([[{text:'تحديث الأسماء',callback_data:'drvreg:names|0'}]]));}
  const vehicles=await loadVehicles(employee.externalId);
  await setSession(message.chat.id,from.id,'driver_pool_vehicle',{poolInvitationId:session.context.poolInvitationId,selectedEmployee:employee,vehicles,selectedAt:now()});
  const next=await getBotSession(message.chat.id,from.id);
  return showVehicleChoices(message,next,0);
}

async function createManualVehicle(plateKey){
  const externalId='TG-'+plateKey+'-'+Date.now().toString(36).toUpperCase()+'-'+crypto.randomBytes(3).toString('hex').toUpperCase();
  const row={external_id:externalId,plate_no:plateKey,vehicle_type:'مركبة مسجلة من السائق',driver_external_id:null,status:'active',active:true,source_updated_at:now()};
  const created=(await insert('vehicles',[row]))?.[0]||row;
  return {source:'vehicles',externalId:String(created.external_id||externalId),plateNo:String(created.plate_no||plateKey),plateKey,vehicleName:String(created.vehicle_type||'مركبة مسجلة من السائق')};
}

async function vehicleFromManualPlate(plateKey,employeeExternalId){
  const all=await loadVehicles(employeeExternalId,{includeUnavailable:true}),matches=all.filter(row=>row.plateKey===plateKey);
  const available=[];
  for(const row of matches){const current=await vehicleStillAvailable(row,employeeExternalId);if(current)available.push(current);}
  if(available.length===1)return {ok:true,vehicle:available[0],created:false};
  if(available.length>1)return {ok:false,code:'DUPLICATE'};
  if(matches.length)return {ok:false,code:'USED'};
  return {ok:true,vehicle:await createManualVehicle(plateKey),created:true};
}

async function finishRegistration(message,from,identity,employeeOption,vehicleOption){
  if(identity?.active)return sendMessage(message.chat.id,'حسابك نشط بالفعل ولا يمكن تغيير الربط من رابط التسجيل.');
  const employee=await employeeStillAvailable(employeeOption.externalId,identity?.user_id);
  if(!employee)return sendMessage(message.chat.id,'الاسم لم يعد متاحًا؛ تم ربطه بحساب آخر. افتح الرابط واختر اسمك من جديد.');
  const vehicle=await vehicleStillAvailable(vehicleOption,employee.externalId);
  if(!vehicle)return sendMessage(message.chat.id,'السيارة لم تعد متاحة؛ تم ربطها بسائق آخر. ارجع واختر سيارة أخرى.');
  const pendingUsers=await patchInvitedUser(from.id,{full_name:employee.fullName,employee_external_id:employee.externalId,role:'driver',active:false},employee.nickname),user=pendingUsers?.[0];
  if(!user)throw new Error('DRIVER_USER_NOT_FOUND');
  await upsert('employee_assignments',[{app_user_id:user.id,employee_external_id:employee.externalId,vehicle_external_id:vehicle.externalId,active:true}],'app_user_id');
  if(vehicle.source==='vehicles')await patch('vehicles','external_id=eq.'+encodeURIComponent(vehicle.externalId),{driver_external_id:employee.externalId,active:true,status:'active',source_updated_at:now()}).catch(()=>{});
  else await patch('unified_assets','external_id=eq.'+encodeURIComponent(vehicle.externalId),{assigned_employee_external_id:employee.externalId}).catch(()=>{});
  await patch('app_users','id=eq.'+encodeURIComponent(user.id),{full_name:employee.fullName,employee_external_id:employee.externalId,role:'driver',active:true});
  await insert('audit_log',[{actor_type:'telegram',actor_id:String(from.id),action:'driver_self_registered',entity_type:'app_user',entity_id:user.id,details:{employee_external_id:employee.externalId,employee_name:employee.fullName,vehicle_external_id:vehicle.externalId,plate_no:vehicle.plateNo}}],{prefer:'return=minimal'}).catch(()=>{});
  await clearMaintenanceSession(message.chat.id,from.id).catch(()=>{});
  await sendMessage(message.chat.id,['<b>تم تفعيل حساب السائق</b>','','الاسم: <b>'+esc(employee.fullName)+'</b>','اللوحة: <b>'+esc(vehicle.plateNo)+'</b>','','تم حفظ ربط حسابك بالاسم والسيارة. استخدم /menu لفتح قائمة السائق.'].join('\n'));
  if(config.telegramOwnerId&&String(config.telegramOwnerId)!==String(from.id))await sendMessage(config.telegramOwnerId,['تم تسجيل سائق من الرابط العام.','الاسم: <b>'+esc(employee.fullName)+'</b>','اللوحة: <b>'+esc(vehicle.plateNo)+'</b>','Telegram ID: <code>'+esc(from.id)+'</code>'].join('\n')).catch(()=>{});
  return true;
}

async function chooseVehicle(message,from,identity,index){
  const session=await getBotSession(message.chat.id,from.id),option=(session?.context?.vehicles||[])[Number(index)],employee=session?.context?.selectedEmployee;
  if(session?.state!=='driver_pool_vehicle'||!option||!employee)return sendMessage(message.chat.id,'انتهت قائمة السيارات. افتح رابط التسجيل من جديد.');
  return finishRegistration(message,from,identity,employee,option);
}

export async function handleDriverPoolCallback(message,from,identity,value){
  if(message.chat.type!=='private')return sendMessage(message.chat.id,'تسجيل السائق يتم في المحادثة الخاصة مع البوت.');
  const [action,arg='']=String(value||'').split('|'),session=await getBotSession(message.chat.id,from.id);
  if(action==='cancel'){await clearMaintenanceSession(message.chat.id,from.id).catch(()=>{});return sendMessage(message.chat.id,'تم إلغاء تسجيل السائق.');}
  if(identity?.active)return sendMessage(message.chat.id,'حسابك نشط بالفعل ولا يمكن استخدام تسجيل السائق مرة أخرى.');
  if(action==='names')return showDriverNames(message,session,Number(arg));
  if(action==='name')return chooseDriverName(message,from,identity,arg);
  if(action==='vehicles')return showVehicleChoices(message,session,Number(arg));
  if(action==='vehicle')return chooseVehicle(message,from,identity,arg);
  if(action==='backnames'){
    const drivers=await availableDrivers();await setSession(message.chat.id,from.id,'driver_pool_name',{poolInvitationId:session?.context?.poolInvitationId,drivers});
    return showDriverNames(message,await getBotSession(message.chat.id,from.id),0);
  }
  if(action==='manual'){
    if(session?.state!=='driver_pool_vehicle'||!session.context?.selectedEmployee)return sendMessage(message.chat.id,'اختر اسمك أولًا.');
    await setSession(message.chat.id,from.id,'driver_pool_manual_plate',{...session.context});
    return sendMessage(message.chat.id,'اكتب رقم اللوحة باستخدام <b>حروف إنجليزية وأرقام فقط</b>.\nمثال: <code>ABC1234</code>\nيمكن كتابة مسافات أو شرطات وسيقوم النظام بحذفها تلقائيًا.');
  }
  return sendMessage(message.chat.id,'انتهت خطوة التسجيل. افتح رابط السائقين من جديد.');
}

export async function continueDriverPoolSession(message,identity,session,text){
  const state=String(session?.state||''),value=String(text||'').trim();
  if(!state.startsWith('driver_pool_'))return false;
  if(/^(الغاء|إلغاء|cancel)$/i.test(value)){await clearMaintenanceSession(message.chat.id,message.from.id).catch(()=>{});await sendMessage(message.chat.id,'تم إلغاء تسجيل السائق.');return true;}
  if(state!=='driver_pool_manual_plate'){await sendMessage(message.chat.id,'استخدم الأزرار الظاهرة لاختيار الاسم والسيارة، أو اكتب «إلغاء».');return true;}
  if(/^(رجوع|الرجوع|back)$/i.test(value)){await setSession(message.chat.id,message.from.id,'driver_pool_vehicle',{...session.context});await showVehicleChoices(message,await getBotSession(message.chat.id,message.from.id),0);return true;}
  const plateKey=normalizePlate(value);
  if(plateKey.length<4||plateKey.length>12||!/[A-Z]/.test(plateKey)||!/\d/.test(plateKey)){await sendMessage(message.chat.id,'اللوحة غير صحيحة. اكتب حروفًا إنجليزية وأرقامًا فقط، من 4 إلى 12 خانة، مثل <code>ABC1234</code>.');return true;}
  const employee=session.context?.selectedEmployee;
  if(!employee){await clearMaintenanceSession(message.chat.id,message.from.id).catch(()=>{});await sendMessage(message.chat.id,'انتهت جلسة التسجيل. افتح الرابط من جديد.');return true;}
  const resolved=await vehicleFromManualPlate(plateKey,employee.externalId);
  if(!resolved.ok&&resolved.code==='USED'){await sendMessage(message.chat.id,'هذه اللوحة موجودة لكنها مرتبطة بسائق أو حساب آخر. راجع الإدارة أو اكتب لوحة أخرى.');return true;}
  if(!resolved.ok){await sendMessage(message.chat.id,'يوجد أكثر من سجل بنفس اللوحة. يلزم تصحيح تكرار اللوحة في سجل السيارات أولًا.');return true;}
  return finishRegistration(message,message.from,identity,employee,resolved.vehicle);
}
