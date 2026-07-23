import { select } from './supabase.js';
import { htmlToPdf } from './pdf-service.js';
import { loadProjectedCumulativeDailyReport } from './daily-cumulative-report-data.js';
import { renderCustomerPortfolioDeclaration } from '../../shared/customer-portfolio-declaration.js';
import {
  CUSTOMER_PORTFOLIO_DECLARATION,
  CUSTOMER_PORTFOLIO_EXTRA,
  DECLARATION_ACK,
  CUSTOMER_PORTFOLIO_TEXT_VERSION
} from '../../shared/canonical-declaration-texts.js';

const norm=value=>String(value??'').trim().toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/\s+/g,' ');
const clean=value=>String(value??'').trim();
const digits=value=>clean(value).replace(/\D/g,'');
const riyadhDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const icon=type=>type==='block'?'🧱':'🏗️';
const ROLE_BY_TYPE={block:'مسؤول مبيعات البلوك',concrete:'مسؤول مبيعات الخرسانة'};
const VALID_TYPES=new Set(['block','concrete']);
function publicBase(){let value=String(process.env.PUBLIC_APP_URL||process.env.VERCEL_PROJECT_PRODUCTION_URL||'').trim().replace(/\/$/,'');if(value&&!/^https?:\/\//i.test(value))value=`https://${value}`;return value||'https://binhamid-factory-control.vercel.app';}

function mergeEmployeeSources(legacyRows,cloudRows){
  const merged=(Array.isArray(legacyRows)?legacyRows:[]).map(row=>({...row})),byId=new Map(),byName=new Map(),byNationalId=new Map();
  const indexRow=(row,index)=>{const id=clean(row?.id||row?.external_id),name=norm(row?.name||row?.full_name),nationalId=digits(row?.nid||row?.national_id);if(id)byId.set(id,index);if(name)byName.set(name,index);if(nationalId)byNationalId.set(nationalId,index);};
  merged.forEach(indexRow);
  for(const row of cloudRows||[]){
    const id=clean(row.external_id),name=clean(row.full_name),nationalId=digits(row.national_id),candidate=byId.get(id)??byNationalId.get(nationalId)??byName.get(norm(name)),values={id:id||undefined,name:name||undefined,nid:nationalId||undefined,no:clean(row.employee_no)||undefined,tel:clean(row.phone)||undefined,role:clean(row.role)||undefined,declarationRole:clean(row.role)||undefined,_cloudSource:true};
    if(candidate!==undefined){merged[candidate]={...merged[candidate],...Object.fromEntries(Object.entries(values).filter(([,value])=>value!==undefined))};indexRow(merged[candidate],candidate);}
    else{const next=Object.fromEntries(Object.entries(values).filter(([,value])=>value!==undefined));merged.push(next);indexRow(next,merged.length-1);}
  }
  return merged;
}

async function loadAppState(){
  const[stateRows,cloudEmployees]=await Promise.all([
    select('app_state','key=eq.primary&select=payload&limit=1').catch(()=>[]),
    select('employees','active=eq.true&select=external_id,national_id,employee_no,full_name,phone,role&order=full_name.asc&limit=5000').catch(()=>[])
  ]),legacy=stateRows?.[0]?.payload?.legacy||{};
  return{
    companyName:legacy?.cfg?.name||'مصنع بن حامد للبلوك والخرسانة الجاهزة',
    days:Number(legacy?.cfg?.days||3)||3,
    cap:Number(legacy?.cfg?.cap||0)||0,
    authorizedName:[legacy?.cfg?.auth,legacy?.cfg?.authT].filter(Boolean).join(' — '),
    employees:mergeEmployeeSources(legacy?.emp,cloudEmployees),
    clients:Array.isArray(legacy?.cli)?legacy.cli:[]
  };
}
function repScore(employee,type){
  const role=norm(employee?.declarationRole||employee?.role),wanted=norm(ROLE_BY_TYPE[type]),token=type==='block'?'بلوك':'خرسان';
  let score=0;
  if(role===wanted)score+=120;
  else if(role.includes(wanted))score+=100;
  else if(role.includes(token))score+=70;
  if(digits(employee?.nid||employee?.national_id).length>=10)score+=60;
  if(clean(employee?.no||employee?.employee_no))score+=15;
  if(employee?._cloudSource)score+=25;
  if(Array.isArray(employee?.employeeAliases)&&employee.employeeAliases.length)score+=10;
  return score;
}
function findRep(employees,type){
  return(employees||[]).filter(employee=>employee?.act!==false&&repScore(employee,type)>0).sort((a,b)=>repScore(b,type)-repScore(a,type)||clean(a.name).localeCompare(clean(b.name),'ar'))[0]||null;
}
function repIds(rep){return new Set([rep?.id,rep?.external_id,...(Array.isArray(rep?.employeeAliases)?rep.employeeAliases:[])].map(clean).filter(Boolean));}
function customerKey(value){return clean(value).toLowerCase();}
function canonicalCustomers(type,projection,state,rep){
  const masterByCode=new Map(),masterByName=new Map();
  for(const client of state.clients){if(client?.code||client?.cr||client?.id)masterByCode.set(customerKey(client.code||client.cr||client.id),client);if(client?.name)masterByName.set(customerKey(client.name),client);}
  const selected=new Map(),linkedRepIds=repIds(rep);
  const add=(client,source={})=>{
    const name=clean(client?.name||source?.name||source?.customerName),code=clean(client?.code||client?.cr||source?.code||source?.customerCode),key=customerKey(client?.id||code||name);
    if(!key||selected.has(key))return;
    selected.set(key,{
      name:name||code||'عميل غير مسمى',
      segment:type==='block'?'بلوك':'خرسانة',
      registry:clean(client?.cr||client?.nationalId||client?.registry||code),
      code,
      phone:clean(client?.tel||client?.phone),
      creditLimit:Number(client?.cap??state.cap??0)||0,
      paymentDays:Number(client?.days??state.days??3)||state.days
    });
  };
  for(const client of state.clients){
    const assigned=linkedRepIds.has(clean(client?.rep))||(Array.isArray(client?.repIds)&&client.repIds.some(id=>linkedRepIds.has(clean(id))));
    const segment=norm(client?.seg||'');
    if(assigned&&(!segment||segment.includes(type==='block'?'بلوك':'خرسان')||segment.includes('الاثنين')))add(client);
  }
  const projected=projection?.departments?.[type]?.rows||[];
  for(const row of projected){const master=masterByCode.get(customerKey(row.code||row.customerCode))||masterByName.get(customerKey(row.name||row.customerName));add(master||{},row);}
  return[...selected.values()].sort((a,b)=>a.name.localeCompare(b.name,'ar'));
}

export async function generateCustomerPortfolioPdfs(analysis={},sourceFile='daily-report.xlsx',requestedTypes=['block','concrete']){
  const types=[...new Set((Array.isArray(requestedTypes)?requestedTypes:[requestedTypes]).map(clean).filter(type=>VALID_TYPES.has(type)))];
  if(!types.length)throw Object.assign(new Error('حدد إقرار البلوك أو إقرار الخرسانة.'),{status:400,code:'PORTFOLIO_TYPE_REQUIRED'});
  const reportDate=riyadhDate(),[state,projection]=await Promise.all([loadAppState(),loadProjectedCumulativeDailyReport(analysis,reportDate)]),baseUrl=`${publicBase()}/`,reports=[];
  for(const type of types){
    const rep=findRep(state.employees,type),customers=canonicalCustomers(type,projection,state,rep),documentRef=`BHF-${type.toUpperCase()}-${reportDate.replace(/-/g,'')}`;
    const rendered=renderCustomerPortfolioDeclaration({
      type,
      companyName:state.companyName,
      employee:{name:rep?.name||'',nationalId:digits(rep?.nid||rep?.national_id),role:rep?.role||ROLE_BY_TYPE[type],number:rep?.no||'',phone:rep?.tel||''},
      customers,
      days:state.days,
      defaultCreditLimit:state.cap,
      declarationText:CUSTOMER_PORTFOLIO_DECLARATION,
      extraText:CUSTOMER_PORTFOLIO_EXTRA,
      ackText:DECLARATION_ACK,
      authorizedName:state.authorizedName,
      documentRef,
      dateGregorian:reportDate,
      logoUrl:`${baseUrl}assets/branding/binhamid-factory-logo.png`,
      baseUrl
    });
    const pdf=await htmlToPdf(rendered.document,{filename:`portfolio-${type}-${reportDate}`,landscape:false});
    const department=type==='block'?'البلوك':'الخرسانة';
    reports.push({type,pdf,filename:`إقرار محفظة عملاء ${department}.pdf`,caption:`${icon(type)} إقرار محفظة عملاء ${department} — ${rep?.name||ROLE_BY_TYPE[type]} — ${reportDate}`,templateVersion:CUSTOMER_PORTFOLIO_TEXT_VERSION,sourceFile,employeeExternalId:clean(rep?.id||rep?.external_id),employeeNationalId:digits(rep?.nid||rep?.national_id)});
  }
  return reports;
}
