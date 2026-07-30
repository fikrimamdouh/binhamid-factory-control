import fs from 'node:fs';

const uploadUrl=String(process.env.BINHAMID_FUEL_UPLOAD_URL||'https://binhamid-factory-control.vercel.app/api/fuel/daily-report').trim();
const kind=String(process.env.FUEL_STATUS_KIND||'daily-report').trim();
const offset=Number.parseInt(String(process.env.FUEL_STATUS_DATE_OFFSET_DAYS||'-1'),10);

function required(value,name){if(!value)throw new Error(`Missing required environment variable: ${name}`);return value;}
function riyadhDate(value=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(value);
  const get=type=>parts.find(part=>part.type===type)?.value||'';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function shiftedRiyadhDate(days){const today=riyadhDate(),date=new Date(`${today}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+(Number.isFinite(days)?days:-1));return date.toISOString().slice(0,10);}
function writeOutput(name,value){const file=process.env.GITHUB_OUTPUT;if(file)fs.appendFileSync(file,`${name}=${value}\n`);}
async function oidcToken(){
  const url=new URL(required(process.env.ACTIONS_ID_TOKEN_REQUEST_URL,'ACTIONS_ID_TOKEN_REQUEST_URL'));
  url.searchParams.set('audience','binhamid-fuel-sync');
  const response=await fetch(url,{headers:{Authorization:`Bearer ${required(process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,'ACTIONS_ID_TOKEN_REQUEST_TOKEN')}`}});
  if(!response.ok)throw new Error(`GitHub OIDC token request failed: ${response.status}`);
  const data=await response.json();return required(data.value,'GitHub OIDC token value');
}

const reportDate=shiftedRiyadhDate(offset);
try{
  const token=await oidcToken();
  const response=await fetch(uploadUrl,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','x-fuel-operation':'delivery-status'},body:JSON.stringify({kind,reportDate,periodStart:reportDate,periodEnd:reportDate})});
  const text=await response.text();let data;try{data=text?JSON.parse(text):{};}catch{data={raw:text};}
  if(!response.ok||!data?.ok)throw new Error(`Delivery status failed (${response.status}): ${String(data?.error||data?.message||text).slice(0,400)}`);
  const needed=!data.delivered;writeOutput('needed',needed?'true':'false');writeOutput('report_date',reportDate);writeOutput('delivered_at',data.deliveredAt||'');
  console.log(JSON.stringify({ok:true,kind,reportDate,needed,deliveredAt:data.deliveredAt||null},null,2));
}catch(error){
  writeOutput('needed','true');writeOutput('report_date',reportDate);writeOutput('status_check_failed','true');
  console.warn('[fuel-delivery-status] status check failed open; the report attempt will continue:',error?.message||error);
}
