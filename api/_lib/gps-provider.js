import { config } from './config.js';
import { upsert } from './supabase.js';

const numberOrNull=value=>{const parsed=Number(value);return Number.isFinite(parsed)?parsed:null;};
export function normalizeGpsEvent(input={},provider='unknown'){
  const occurredAt=new Date(input.occurredAt||input.deviceTime||input.fixTime||input.serverTime||input.timestamp||0);
  if(!input.vehicleExternalId&&!input.deviceId&&!input.uniqueId)throw Object.assign(new Error('معرف المركبة مفقود من حدث GPS'),{status:422});
  if(!Number.isFinite(occurredAt.getTime()))throw Object.assign(new Error('وقت حدث GPS غير صحيح'),{status:422});
  return{
    provider:String(provider||'unknown'),
    providerEventId:String(input.providerEventId||input.id||`${input.deviceId||input.uniqueId}:${occurredAt.toISOString()}`),
    vehicleExternalId:String(input.vehicleExternalId||input.uniqueId||input.deviceId),
    occurredAt:occurredAt.toISOString(),
    latitude:numberOrNull(input.latitude),longitude:numberOrNull(input.longitude),
    distanceKm:numberOrNull(input.distanceKm??input.distance),engineOn:input.engineOn??input.ignition??null,
    fuelLevel:numberOrNull(input.fuelLevel??input.attributes?.fuel),raw:input
  };
}

export class UnavailableGpsAdapter{
  constructor(reason='GPS غير مضبوط'){this.reason=reason;this.configured=false;this.provider='none';}
  async fetchEvents(){return[];}
}

export class TraccarGpsAdapter{
  constructor(options={}){this.provider='traccar';this.configured=Boolean(options.baseUrl);this.baseUrl=String(options.baseUrl||'').replace(/\/$/,'');this.token=String(options.token||'');this.user=String(options.user||'');this.password=String(options.password||'');}
  headers(){if(this.token)return{Authorization:`Bearer ${this.token}`,Accept:'application/json'};if(this.user||this.password)return{Authorization:`Basic ${Buffer.from(`${this.user}:${this.password}`).toString('base64')}`,Accept:'application/json'};return{Accept:'application/json'};}
  async fetchEvents({from,to}={}){
    if(!this.configured)throw Object.assign(new Error('رابط Traccar غير مضبوط'),{status:503});
    const query=new URLSearchParams();if(from)query.set('from',new Date(from).toISOString());if(to)query.set('to',new Date(to).toISOString());
    const response=await fetch(`${this.baseUrl}/api/positions${query.size?`?${query}`:''}`,{headers:this.headers()});
    if(!response.ok)throw Object.assign(new Error(`تعذر قراءة GPS: ${response.status}`),{status:502});
    const rows=await response.json();return(rows||[]).map(row=>normalizeGpsEvent({...row,vehicleExternalId:row.deviceId},this.provider));
  }
}

export class MockGpsAdapter{
  constructor(events=[]){if(process.env.NODE_ENV!=='test')throw new Error('Mock GPS مسموح في الاختبارات فقط');this.provider='mock';this.configured=true;this.events=events.map(row=>normalizeGpsEvent(row,'mock'));}
  async fetchEvents({from,to}={}){const start=from?new Date(from).getTime():-Infinity,end=to?new Date(to).getTime():Infinity;return this.events.filter(row=>{const time=new Date(row.occurredAt).getTime();return time>=start&&time<=end;});}
}

export function createGpsAdapter(){
  if(config.gpsProvider==='traccar'&&config.gpsApiBaseUrl)return new TraccarGpsAdapter({baseUrl:config.gpsApiBaseUrl,token:config.gpsApiToken,user:config.gpsApiUser,password:config.gpsApiPassword});
  return new UnavailableGpsAdapter();
}

export async function persistGpsEvents(events=[]){
  if(!events.length)return{stored:0};
  const rows=events.map(event=>({provider:event.provider,provider_event_id:event.providerEventId,vehicle_external_id:event.vehicleExternalId,occurred_at:event.occurredAt,latitude:event.latitude,longitude:event.longitude,distance_km:event.distanceKm,engine_on:event.engineOn,fuel_level:event.fuelLevel,raw:event.raw||{}}));
  for(let index=0;index<rows.length;index+=200)await upsert('gps_provider_events',rows.slice(index,index+200),'provider,provider_event_id');
  return{stored:rows.length};
}

export function compareFuelToGps(fuelEvents=[],gpsEvents=[]){
  const byVehicle=new Map();
  for(const gps of gpsEvents){const key=String(gps.vehicleExternalId||gps.vehicle_external_id||'');if(!key)continue;const current=byVehicle.get(key)||{distanceKm:0,engineOnEvents:0,locations:[]};current.distanceKm+=Number(gps.distanceKm??gps.distance_km??0)||0;if(gps.engineOn??gps.engine_on)current.engineOnEvents++;if(gps.latitude!=null&&gps.longitude!=null)current.locations.push([Number(gps.latitude),Number(gps.longitude)]);byVehicle.set(key,current);}
  return fuelEvents.map(fuel=>{const vehicle=String(fuel.vehicleExternalId||fuel.vehicle_external_id||''),gps=byVehicle.get(vehicle)||{distanceKm:0,engineOnEvents:0,locations:[]},liters=Number(fuel.liters??fuel.fuel_liters??0)||0;return{vehicleExternalId:vehicle,liters,distanceKm:Number(gps.distanceKm.toFixed(3)),litersPer100Km:gps.distanceKm>0?Number((liters/gps.distanceKm*100).toFixed(3)):null,noMovement:gps.distanceKm===0&&gps.engineOnEvents===0,locationCount:gps.locations.length};});
}
