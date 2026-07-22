import { body, errorResponse, json, method } from '../http.js';
import { insert, upsert } from '../supabase.js';
import { requireCapability } from '../permissions.js';

const PRESETS=Object.freeze([
  {
    code:'FACTORY_MAIN',
    name:'مصنع بن حامد والمكتب',
    address:'المكتب على أول الشارع والمصنع في الخلف',
    mapUrl:'https://maps.app.goo.gl/HZ877vVfkm7tp9e17',
    radiusM:1000
  },
  {
    code:'STATION_MAIN',
    name:'محطة الحصينية',
    address:'محطة الحصينية',
    mapUrl:'https://maps.app.goo.gl/qSukur3khpuMS5PK9',
    radiusM:250
  }
]);

const clean=value=>String(value??'').trim();
const actorOf=identity=>identity?.fullName||identity?.appUserId||identity?.actor||'system';

function coordinatesFromText(value){
  const text=String(value||'');
  let decoded=text;
  try{decoded=decodeURIComponent(text);}catch{}
  const patterns=[
    /@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,
    /!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/,
    /[?&](?:q|query|ll|center)=(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,
    /"latitude"\s*:\s*(-?\d{1,2}(?:\.\d+)?).*?"longitude"\s*:\s*(-?\d{1,3}(?:\.\d+)?)/s
  ];
  for(const pattern of patterns){
    const match=decoded.match(pattern);
    if(!match)continue;
    const latitude=Number(match[1]),longitude=Number(match[2]);
    if(Number.isFinite(latitude)&&Number.isFinite(longitude)&&Math.abs(latitude)<=90&&Math.abs(longitude)<=180)return{latitude,longitude};
  }
  return null;
}

async function resolvePreset(preset){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),12000);
  try{
    const response=await fetch(preset.mapUrl,{
      redirect:'follow',
      signal:controller.signal,
      headers:{
        'User-Agent':'Mozilla/5.0 BinHamid-Attendance-Site-Presets/1.0',
        'Accept-Language':'ar,en;q=0.8'
      }
    });
    const html=(await response.text()).slice(0,900000);
    const coordinates=coordinatesFromText(response.url)||coordinatesFromText(html);
    if(!coordinates)throw Object.assign(new Error(`تعذر استخراج إحداثيات ${preset.name} من رابط Google Maps المختصر.`),{status:502,code:'ATTENDANCE_PRESET_COORDINATES_NOT_FOUND',siteCode:preset.code});
    return{...preset,...coordinates};
  }catch(error){
    if(error?.name==='AbortError')throw Object.assign(new Error(`انتهت مهلة قراءة رابط ${preset.name}.`),{status:504,code:'ATTENDANCE_PRESET_TIMEOUT',siteCode:preset.code});
    throw error;
  }finally{clearTimeout(timer);}
}

async function audit(identity,rows){
  await insert('audit_log',[{
    actor_type:'web',
    actor_id:actorOf(identity),
    action:'attendance_site_presets_saved',
    entity_type:'work_sites',
    entity_id:'FACTORY_MAIN,STATION_MAIN',
    details:{sites:rows.map(row=>({code:row.code,name:row.name,latitude:row.latitude,longitude:row.longitude,radiusM:row.radius_m,mapUrl:row.address}))}
  }],{prefer:'return=minimal'}).catch(()=>{});
}

export async function attendanceSitePresets(req,res){
  if(!method(req,res,['GET','POST']))return;
  try{
    await requireCapability(req,req.method==='GET'?'attendance.view':'attendance.manage');
    if(req.method==='GET')return json(res,200,{ok:true,presets:PRESETS});
    const input=await body(req),action=clean(input.action);
    if(action!=='seed')throw Object.assign(new Error('إجراء مواقع الحضور غير معروف.'),{status:400,code:'ATTENDANCE_PRESET_ACTION_UNKNOWN'});
    const resolved=await Promise.all(PRESETS.map(resolvePreset));
    const stamp=new Date().toISOString();
    const rows=resolved.map(site=>({
      code:site.code,
      name:site.name,
      address:`${site.address} — ${site.mapUrl}`,
      latitude:site.latitude,
      longitude:site.longitude,
      radius_m:site.radiusM,
      active:true,
      updated_at:stamp
    }));
    const saved=await upsert('work_sites',rows,'code');
    await audit(req.identity||null,rows);
    return json(res,200,{ok:true,sites:saved?.length?saved:rows});
  }catch(error){errorResponse(res,error);}
}
