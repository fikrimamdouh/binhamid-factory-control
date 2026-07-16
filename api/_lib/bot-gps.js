import { select } from './supabase.js';
import { sendMessage } from './telegram.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const GPS_ROLES=new Set(['admin','manager','mechanic','driver','fuel_operator']);
function settings(){return{base:String(process.env.GPS_API_BASE_URL||'').replace(/\/$/,''),token:String(process.env.GPS_API_TOKEN||''),user:String(process.env.GPS_API_USER||''),password:String(process.env.GPS_API_PASSWORD||''),provider:String(process.env.GPS_PROVIDER||'traccar').toLowerCase()};}
function headers(config){const result={'Accept':'application/json'};if(config.token)result.Authorization=`Bearer ${config.token}`;else if(config.user)result.Authorization=`Basic ${Buffer.from(`${config.user}:${config.password}`).toString('base64')}`;return result;}
async function request(path){const config=settings();if(!config.base)throw new Error('ربط GPS غير مفعّل. أضف عنوان مزود التتبع وبيانات الدخول في Vercel.');const response=await fetch(`${config.base}${path}`,{headers:headers(config)});if(!response.ok)throw new Error(`تعذر قراءة GPS: ${response.status}`);return response.json();}
async function traccarStatus(){
  const [devices,positions]=await Promise.all([request('/api/devices'),request('/api/positions')]);
  const positionMap=new Map((positions||[]).map(item=>[String(item.deviceId),item]));
  return(devices||[]).map(device=>{const position=positionMap.get(String(device.id));return{id:device.id,uniqueId:device.uniqueId||'',name:device.name||device.uniqueId,status:device.status||'unknown',lastUpdate:device.lastUpdate,latitude:position?.latitude,longitude:position?.longitude,speed:Number(position?.speed||0),course:position?.course,address:position?.address||'',attributes:position?.attributes||{}};});
}
async function assignedVehicle(identity){if(!identity?.user_id)return'';const row=(await select('employee_assignments',`app_user_id=eq.${encodeURIComponent(identity.user_id)}&active=eq.true&select=vehicle_external_id&order=created_at.desc&limit=1`))?.[0];return String(row?.vehicle_external_id||'').trim();}
export async function getGpsFleet(identity=null){
  if(!identity?.active||!GPS_ROLES.has(identity.role))throw Object.assign(new Error('ليست لديك صلاحية عرض GPS.'),{status:403});
  const config=settings();if(config.provider!=='traccar')throw new Error(`مزود GPS ${config.provider} يحتاج محولًا خاصًا. النسخة الحالية تدعم Traccar مباشرة.`);
  let rows=await traccarStatus();
  if(identity.role==='driver'){
    const assigned=await assignedVehicle(identity);if(!assigned)throw Object.assign(new Error('لا توجد مركبة مرتبطة بحساب السائق.'),{status:403});
    const key=assigned.toLowerCase();rows=rows.filter(item=>`${item.id} ${item.uniqueId} ${item.name}`.toLowerCase().includes(key));
    if(!rows.length)throw Object.assign(new Error('المركبة المرتبطة بك غير مطابقة لأجهزة GPS. راجع مسؤول النظام.'),{status:404});
  }
  return rows;
}
export async function sendGpsFleetStatus(chatId,query='',identity=null){
  let rows;try{rows=await getGpsFleet(identity);}catch(error){return sendMessage(chatId,esc(error.message));}
  const search=String(query||'').toLowerCase().trim();if(search)rows=rows.filter(item=>JSON.stringify(item).toLowerCase().includes(search));
  if(!rows.length)return sendMessage(chatId,search?'لم أجد مركبة مطابقة في نظام التتبع.':'لا توجد مركبات ظاهرة من مزود GPS.');
  const active=rows.filter(item=>item.status==='online'),moving=rows.filter(item=>item.speed>1),offline=rows.filter(item=>item.status==='offline');
  let text=`<b>حالة الأسطول عبر GPS</b>\n\nإجمالي الأجهزة: <b>${rows.length}</b>\nمتصلة: <b>${active.length}</b>\nتتحرك الآن: <b>${moving.length}</b>\nغير متصلة: <b>${offline.length}</b>`;
  text+=`\n\n${rows.slice(0,15).map(item=>`• <b>${esc(item.name)}</b> — ${esc(item.status)}${item.speed?` — سرعة ${item.speed.toFixed(1)}`:''}${item.address?`\n  ${esc(item.address)}`:''}${item.latitude?`\n  https://maps.google.com/?q=${item.latitude},${item.longitude}`:''}`).join('\n\n')}`;
  return sendMessage(chatId,text.slice(0,3900));
}
