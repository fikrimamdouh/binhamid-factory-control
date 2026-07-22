import { select } from './supabase.js';
import { sendMessage, sendDocumentBuffer, keyboard } from './telegram.js';
import { esc, norm, setEnterpriseSession, getEnterpriseSession } from './bot-enterprise-store.js';
import { botModuleAllowed } from './bot-menu-permissions.js';
import { generateCustomerPortfolioPdfs } from './customer-portfolio-pdf.js';

const PAGE_SIZE=8;
const EMPLOYEE_ROLES=new Set(['admin','manager','accountant','hr']);
const VEHICLE_ROLES=new Set(['admin','manager','accountant','mechanic','fuel_operator']);
const PORTFOLIO_ROLES=new Set(['admin','manager','accountant','block_sales','concrete_sales']);
const CENTER_LABELS={general:'عام',block:'بلوك',concrete:'خرسانة'};
const RUNNING_VEHICLE_STATUSES=new Set(['in_service','spare']);
const portfolioJobs=new Map();
const clean=value=>String(value??'').replace(/\s+/g,' ').trim();
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const short=(value,max=36)=>{const text=clean(value);return text.length>max?`${text.slice(0,max-1)}…`:text;};
const identityKey=identity=>String(identity?.external_id||identity?.user_id||'').trim();
const maskId=value=>{const digits=String(value||'').replace(/\D/g,'');return digits?`••••${digits.slice(-4)}`:'غير مسجلة';};
const simpleVehicleState=status=>RUNNING_VEHICLE_STATUSES.has(clean(status)||'in_service')?'موجودة / تعمل':'واقفة';
const portfolioLabel=type=>type==='block'?'إقرار محفظة عملاء البلوك':'إقرار محفظة عملاء الخرسانة';

async function requiredRows(table,query,label){
  try{return await select(table,query)||[];}
  catch(error){console.error('[telegram master directory]',label,error);throw Object.assign(new Error(`تعذر قراءة ${label} من السجل السحابي.`),{code:'MASTER_DIRECTORY_READ_FAILED'});}
}
async function optionalRows(table,query,label){try{return await select(table,query)||[];}catch(error){console.warn('[telegram master directory optional]',label,String(error?.message||error).slice(0,240));return[];}}
async function moduleAccess(identity,kind){
  if(!identity?.active)return false;
  const role=String(identity.role||'pending'),roles=kind==='employee'?EMPLOYEE_ROLES:kind==='vehicle'?VEHICLE_ROLES:PORTFOLIO_ROLES,moduleId=kind==='employee'?'hr':kind==='vehicle'?'fuel':'customer';
  return roles.has(role)&&await botModuleAllowed(identity,moduleId);
}

function canonicalAssets(rows){
  const linkedErpIds=new Set();
  for(const row of rows||[]){if(row.diesel_expected!==true)continue;const ref=object(row.metadata).erpReference,id=clean(ref.externalId||ref.externalKey);if(id)linkedErpIds.add(id);}
  return(rows||[]).filter(row=>row.diesel_expected===true||!linkedErpIds.has(clean(row.external_id))).map(row=>{const metadata=object(row.metadata),ref=object(metadata.erpReference);return{...row,displayAssetNo:clean(ref.assetNo||row.asset_no),displayName:clean(ref.assetName||row.asset_name||row.asset_type),displayMake:clean([ref.make||row.make,ref.model||row.model].filter(Boolean).join(' / ')),displayPlate:clean(row.plate_no||ref.oldPlate||ref.newPlate),costCenter:clean(row.cost_center_code||metadata.costCenterCode),source:row.diesel_expected===true?(ref.externalId||ref.externalKey?'ديزل + ERP':'ديزل'):'أصل مستقل'};});
}

async function employeeDirectoryRows(){
  const employees=await requiredRows('employees','active=eq.true&select=external_id,employee_no,national_id,full_name,phone,role,site,metadata&order=full_name.asc&limit=5000','الموظفين'),[assignments,sites,assets]=await Promise.all([
    optionalRows('employee_assignments','active=eq.true&select=employee_external_id,site_id,vehicle_external_id,job_title,shift_name,updated_at&order=updated_at.desc&limit=5000','روابط الموظفين'),
    optionalRows('work_sites','active=eq.true&select=id,name&limit=500','مواقع العمل'),
    optionalRows('unified_assets','active=eq.true&select=external_id,asset_type,asset_name,plate_no,asset_no,assigned_employee_external_id,operational_status,diesel_expected,make,model,cost_center_code,metadata&limit=5000','المركبات المرتبطة')
  ]),assignmentByEmployee=new Map(),siteById=new Map((sites||[]).map(row=>[clean(row.id),row])),assetRows=canonicalAssets(assets);
  for(const row of assignments||[]){const id=clean(row.employee_external_id);if(id&&!assignmentByEmployee.has(id))assignmentByEmployee.set(id,row);}
  return employees.map(row=>{const id=clean(row.external_id),metadata=object(row.metadata),assignment=assignmentByEmployee.get(id),vehicles=assetRows.filter(asset=>clean(asset.assigned_employee_external_id)===id),site=siteById.get(clean(assignment?.site_id));return{id,name:clean(row.full_name)||id,employeeNo:clean(row.employee_no),nationalId:clean(row.national_id),phone:clean(row.phone),role:clean(row.role),jobTitle:clean(assignment?.job_title),shiftName:clean(assignment?.shift_name),site:clean(site?.name||row.site),workStatus:clean(metadata.manualWorkStatus||metadata.workStatus||'working'),costCenter:clean(metadata.costCenterCode),vehicles};});
}

async function vehicleDirectoryRows(identity){
  const [assets,employees]=await Promise.all([
    requiredRows('unified_assets','active=eq.true&select=external_id,asset_type,asset_name,plate_no,asset_no,assigned_employee_external_id,operational_status,diesel_expected,make,model,cost_center_code,metadata&order=diesel_expected.desc,plate_no.asc.nullslast&limit=5000','المركبات والمعدات'),
    optionalRows('employees','active=eq.true&select=external_id,full_name&limit=5000','أسماء الموظفين')
  ]),employeeById=new Map((employees||[]).map(row=>[clean(row.external_id),clean(row.full_name)])),rows=canonicalAssets(assets).map(row=>({id:clean(row.external_id),plate:row.displayPlate,assetNo:row.displayAssetNo,name:row.displayName,makeModel:row.displayMake,status:clean(row.operational_status||'in_service'),type:clean(row.asset_type),costCenter:row.costCenter,driverId:clean(row.assigned_employee_external_id),driver:employeeById.get(clean(row.assigned_employee_external_id))||'',source:row.source}));
  if(identity.role==='driver'){const own=clean(identity.employee_external_id);return rows.filter(row=>own&&row.driverId===own);}
  return rows;
}

function searchRows(rows,query,kind){
  const value=norm(query);if(!value)return rows;
  return rows.filter(row=>norm(kind==='employee'?[row.name,row.employeeNo,row.nationalId,row.phone,row.role,row.jobTitle,row.site,row.costCenter,row.vehicles.map(vehicle=>vehicle.displayPlate).join(' ')].join(' '):[row.plate,row.assetNo,row.name,row.makeModel,row.driver,row.status,row.costCenter,simpleVehicleState(row.status)].join(' ')).includes(value));
}
function employeeButton(row){const vehicle=row.vehicles[0],link=vehicle?(vehicle.displayPlate||vehicle.displayAssetNo||'مرتبط بسيارة'):'بدون سيارة';return `${short(row.name,25)} — ${short(link,20)}`;}
function vehicleButton(row){return `${short(row.plate||row.assetNo||'بدون رقم',18)} — ${simpleVehicleState(row.status)}`;}
function directoryCallbacks(kind){return kind==='employee'?{pick:'hr_employee_pick',page:'hr_employee_page',search:'hr_employee_search',back:'hr_employee_back'}:{pick:'fuel_vehicle_pick',page:'fuel_vehicle_page',search:'fuel_vehicle_search',back:'fuel_vehicle_back'};}

async function renderDirectory(message,identity,kind,{query='',page=0}={}){
  if(!await moduleAccess(identity,kind)){await sendMessage(message.chat.id,kind==='employee'?'ليست لديك صلاحية عرض دليل الموظفين.':'ليست لديك صلاحية عرض دليل المركبات والمعدات.');return true;}
  const source=kind==='employee'?await employeeDirectoryRows():await vehicleDirectoryRows(identity),matches=searchRows(source,query,kind),pages=Math.max(1,Math.ceil(matches.length/PAGE_SIZE)),safePage=Math.max(0,Math.min(Number(page)||0,pages-1)),start=safePage*PAGE_SIZE,items=matches.slice(start,start+PAGE_SIZE),callbacks=directoryCallbacks(kind),choices=items.map(row=>row.id);
  await setEnterpriseSession(message.chat.id,identityKey(identity),'enterprise_master_directory',{kind,query,page:safePage,choices,startedAt:new Date().toISOString()});
  const rows=items.map((row,index)=>[{text:kind==='employee'?employeeButton(row):vehicleButton(row),callback_data:`ent:${callbacks.pick}|${index}`}]),navigation=[];
  if(safePage>0)navigation.push({text:'السابق',callback_data:`ent:${callbacks.page}|${safePage-1}`});
  if(safePage<pages-1)navigation.push({text:'التالي',callback_data:`ent:${callbacks.page}|${safePage+1}`});
  if(navigation.length)rows.push(navigation);
  rows.push([{text:'بحث بالاسم أو الرقم',callback_data:`ent:${callbacks.search}`}]);
  const title=kind==='employee'?'دليل الموظفين — سيارة أو بدون سيارة':'دليل المركبات — موجودة أو واقفة',suffix=query?`\nالبحث: <b>${esc(query)}</b>`:'';
  await sendMessage(message.chat.id,`<b>${title}</b>${suffix}\nالإجمالي المطابق: <b>${matches.length}</b>\nالصفحة: <b>${safePage+1} / ${pages}</b>${items.length?'':'\n\nلا توجد نتائج مطابقة.'}`,keyboard(rows));return true;
}

function employeeDetails(row){
  const vehicle=row.vehicles[0],vehicleName=vehicle?(vehicle.displayPlate||vehicle.displayAssetNo||vehicle.displayName||'سيارة مرتبطة'):'غير مرتبط بسيارة';
  return `<b>بيانات الموظف</b>\n━━━━━━━━━━━━━━\nالاسم: <b>${esc(row.name)}</b>\nالرقم الوظيفي: <code>${esc(row.employeeNo||row.id)}</code>\nالهوية: <b>${esc(maskId(row.nationalId))}</b>\nالجوال: <b>${esc(row.phone||'غير مسجل')}</b>\nالوظيفة: <b>${esc(row.jobTitle||row.role||'غير محددة')}</b>\nالموقع: <b>${esc(row.site||'غير محدد')}</b>\nالسيارة: <b>${esc(vehicleName)}</b>\nمركز التكلفة: <b>${esc(CENTER_LABELS[row.costCenter]||row.costCenter||'غير مصنف')}</b>`;
}
function vehicleDetails(row){return `<b>بيانات المركبة أو المعدة</b>\n━━━━━━━━━━━━━━\nاللوحة: <b>${esc(row.plate||'غير مسجلة')}</b>\nرقم الأصل: <code>${esc(row.assetNo||row.id)}</code>\nالوصف: <b>${esc(row.name||'غير محدد')}</b>\nالماركة / الموديل: <b>${esc(row.makeModel||'غير محدد')}</b>\nالحالة: <b>${esc(simpleVehicleState(row.status))}</b>\nالموظف: <b>${esc(row.driver||'غير مرتبطة بموظف')}</b>\nمركز التكلفة: <b>${esc(CENTER_LABELS[row.costCenter]||row.costCenter||'غير مصنف')}</b>\nالسجل: <b>أصل واحد موحد</b>`;}

async function showChoice(message,from,identity,kind,index){
  if(!await moduleAccess(identity,kind)){await sendMessage(message.chat.id,'هذه القائمة غير متاحة لحسابك.');return true;}
  const session=await getEnterpriseSession(message.chat.id,identityKey(identity)||from.id),context=session?.state==='enterprise_master_directory'?session.context:null,id=context?.choices?.[Number(index)];
  if(!id){await sendMessage(message.chat.id,'انتهت نتائج القائمة. افتح الدليل من جديد.');return true;}
  const rows=kind==='employee'?await employeeDirectoryRows():await vehicleDirectoryRows(identity),row=rows.find(item=>item.id===id),callbacks=directoryCallbacks(kind);
  if(!row){await sendMessage(message.chat.id,'السجل لم يعد موجودًا أو أصبح غير نشط.');return true;}
  await sendMessage(message.chat.id,kind==='employee'?employeeDetails(row):vehicleDetails(row),keyboard([[{text:'بحث جديد',callback_data:`ent:${callbacks.search}`},{text:'الرجوع للقائمة',callback_data:`ent:${callbacks.back}`}]]));return true;
}
async function startLookup(message,identity,kind){
  if(!await moduleAccess(identity,kind)){await sendMessage(message.chat.id,'هذه القائمة غير متاحة لحسابك.');return true;}
  await setEnterpriseSession(message.chat.id,identityKey(identity),kind==='employee'?'enterprise_employee_lookup':'enterprise_vehicle_lookup',{startedAt:new Date().toISOString()});
  await sendMessage(message.chat.id,kind==='employee'?'اكتب اسم الموظف أو رقمه الوظيفي أو آخر أرقام الهوية.':'اكتب رقم اللوحة أو رقم الأصل أو اسم الموظف.');return true;
}

function portfolioTypesForRole(role){if(role==='block_sales')return['block'];if(role==='concrete_sales')return['concrete'];return['block','concrete'];}
async function showPortfolioMenu(message,identity){
  if(!await moduleAccess(identity,'portfolio')){await sendMessage(message.chat.id,'ليست لديك صلاحية إصدار إقرارات محفظة العملاء.');return true;}
  const types=portfolioTypesForRole(String(identity.role||'')),buttons=[];
  if(types.includes('block'))buttons.push({text:'🧱 إقرار البلوك',callback_data:'ent:portfolio_block'});
  if(types.includes('concrete'))buttons.push({text:'🏗️ إقرار الخرسانة',callback_data:'ent:portfolio_concrete'});
  await sendMessage(message.chat.id,'<b>إقرارات محفظة العملاء</b>\nاختر القطاع المطلوب. كل إقرار يُنشأ ويرسل منفصلًا.',keyboard(buttons.map(button=>[button])));return true;
}

export async function sendCurrentPortfolioPdfs(message,identity,requestedType=''){
  if(!requestedType)return showPortfolioMenu(message,identity);
  if(!await moduleAccess(identity,'portfolio')){await sendMessage(message.chat.id,'ليست لديك صلاحية إصدار إقرارات محفظة العملاء.');return true;}
  const allowed=portfolioTypesForRole(String(identity.role||''));
  if(!allowed.includes(requestedType)){await sendMessage(message.chat.id,'هذا الإقرار غير متاح لدورك الحالي.');return true;}
  const key=`${message.chat.id}:${identityKey(identity)||message.from?.id||'user'}`;
  if(portfolioJobs.has(key)){await sendMessage(message.chat.id,'يوجد إقرار قيد الإنشاء لحسابك. لن يتم إنشاء طلب مكرر.');return true;}
  const job=(async()=>{
    await sendMessage(message.chat.id,`جارٍ إنشاء ${portfolioLabel(requestedType)} من البيانات السحابية الحالية.`);
    try{
      const reports=await generateCustomerPortfolioPdfs({},'telegram-current-portfolio',[requestedType]),report=reports[0];
      if(!report)throw new Error('لم يتم إنشاء ملف الإقرار المطلوب.');
      await sendDocumentBuffer(message.chat.id,report.pdf,report.filename,'application/pdf',report.caption);
      await sendMessage(message.chat.id,`تم إرسال ${portfolioLabel(requestedType)} من الأرصدة والربط الحاليين.`);
    }catch(error){
      console.error('[telegram current portfolio]',error);
      const reason=error?.code==='PDF_RATE_LIMITED'?'خدمة PDF ظلت مشغولة بعد الانتظار وإعادة المحاولة تلقائيًا.':String(error?.message||'تعذر إنشاء PDF');
      await sendMessage(message.chat.id,`تعذر إنشاء الإقرار.\nالسبب: ${esc(reason.slice(0,280))}`);
    }
  })().finally(()=>portfolioJobs.delete(key));
  portfolioJobs.set(key,job);await job;return true;
}

export async function handleMasterDirectoryTextCommand(message,identity,text){
  const raw=clean(text),value=norm(raw);
  if(/^\/(employees|staff)(?:@\w+)?$/i.test(raw)||/^(الموظفون|الموظفين|دليل الموظفين|قائمه الموظفين|قائمة الموظفين)$/.test(value))return renderDirectory(message,identity,'employee');
  let match=raw.match(/^(?:بحث موظف|ابحث عن موظف|بيانات موظف)\s+(.{2,})$/i);if(match)return renderDirectory(message,identity,'employee',{query:match[1]});
  if(/^\/(vehicles|fleet)(?:@\w+)?$/i.test(raw)||/^(المركبات|السيارات|المعدات|دليل المركبات|دليل السيارات|قائمه المركبات|قائمة المركبات)$/.test(value))return renderDirectory(message,identity,'vehicle');
  match=raw.match(/^(?:بحث مركبه|بحث مركبة|ابحث عن مركبه|ابحث عن مركبة|بحث سياره|بحث سيارة|بيانات مركبه|بيانات مركبة)\s+(.{2,})$/i);if(match)return renderDirectory(message,identity,'vehicle',{query:match[1]});
  if(/^(اقرار البلوك|إقرار البلوك)$/.test(value))return sendCurrentPortfolioPdfs(message,identity,'block');
  if(/^(اقرار الخرسانه|إقرار الخرسانة)$/.test(value))return sendCurrentPortfolioPdfs(message,identity,'concrete');
  if(/^\/(portfolio|portfolios)(?:@\w+)?$/i.test(raw)||/^(اقرار محفظه العملاء|إقرار محفظة العملاء|اقرارات المحافظ|إقرارات المحافظ)$/.test(value))return showPortfolioMenu(message,identity);
  return false;
}

export async function continueMasterDirectorySession(message,identity,session,text){
  if(session?.state==='enterprise_employee_lookup'){const query=clean(text);if(query.length<2){await sendMessage(message.chat.id,'اكتب حرفين على الأقل أو رقمًا أوضح.');return true;}return renderDirectory(message,identity,'employee',{query});}
  if(session?.state==='enterprise_vehicle_lookup'){const query=clean(text);if(query.length<2){await sendMessage(message.chat.id,'اكتب حرفين على الأقل أو رقم لوحة أو أصل أوضح.');return true;}return renderDirectory(message,identity,'vehicle',{query});}
  return false;
}

export async function handleMasterDirectoryCallback(message,from,identity,value){
  const text=String(value||'');
  if(text==='portfolio_current')return showPortfolioMenu(message,identity);
  if(text==='portfolio_block')return sendCurrentPortfolioPdfs(message,identity,'block');
  if(text==='portfolio_concrete')return sendCurrentPortfolioPdfs(message,identity,'concrete');
  if(text==='hr_employee_directory')return renderDirectory(message,identity,'employee');
  if(text==='fuel_vehicle_directory')return renderDirectory(message,identity,'vehicle');
  if(text==='hr_employee_search')return startLookup(message,identity,'employee');
  if(text==='fuel_vehicle_search')return startLookup(message,identity,'vehicle');
  if(text==='hr_employee_back'||text==='fuel_vehicle_back'){const kind=text.startsWith('hr_')?'employee':'vehicle',session=await getEnterpriseSession(message.chat.id,identityKey(identity)||from.id),context=session?.context||{};return renderDirectory(message,identity,kind,{query:context.query||'',page:context.page||0});}
  let match=text.match(/^hr_employee_page\|(\d+)$/);if(match){const session=await getEnterpriseSession(message.chat.id,identityKey(identity)||from.id);return renderDirectory(message,identity,'employee',{query:session?.context?.query||'',page:Number(match[1])});}
  match=text.match(/^fuel_vehicle_page\|(\d+)$/);if(match){const session=await getEnterpriseSession(message.chat.id,identityKey(identity)||from.id);return renderDirectory(message,identity,'vehicle',{query:session?.context?.query||'',page:Number(match[1])});}
  match=text.match(/^hr_employee_pick\|(\d+)$/);if(match)return showChoice(message,from,identity,'employee',match[1]);
  match=text.match(/^fuel_vehicle_pick\|(\d+)$/);if(match)return showChoice(message,from,identity,'vehicle',match[1]);
  return false;
}
