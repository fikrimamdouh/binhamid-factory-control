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

const norm=value=>String(value??'').trim().toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/\s+/g,' ');
const clean=value=>String(value??'').trim();
const riyadhDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const icon=type=>type==='block'?'🧱':'🏗️';
const ROLE_BY_TYPE={block:'مسؤول مبيعات البلوك',concrete:'مسؤول مبيعات الخرسانة'};
function publicBase(){let value=String(process.env.PUBLIC_APP_URL||process.env.VERCEL_PROJECT_PRODUCTION_URL||'').trim().replace(/\/$/,'');if(value&&!/^https?:\/\//i.test(value))value=`https://${value}`;return value||'https://binhamid-factory-control.vercel.app';}

async function loadAppState(){
  const rows=await select('app_state','key=eq.primary&select=payload&limit=1').catch(()=>[]),legacy=rows?.[0]?.payload?.legacy||{};
  return{
    companyName:legacy?.cfg?.name||'مصنع بن حامد للبلوك والخرسانة الجاهزة',
    days:Number(legacy?.cfg?.days||3)||3,
    cap:Number(legacy?.cfg?.cap||0)||0,
    authorizedName:[legacy?.cfg?.auth,legacy?.cfg?.authT].filter(Boolean).join(' — '),
    employees:Array.isArray(legacy?.emp)?legacy.emp:[],
    clients:Array.isArray(legacy?.cli)?legacy.cli:[]
  };
}
function findRep(employees,type){
  const wanted=norm(ROLE_BY_TYPE[type]);
  return employees.find(employee=>norm(employee?.role||'').includes(wanted))||employees.find(employee=>norm(employee?.role||'').includes(type==='block'?'بلوك':'خرسان'))||null;
}
function customerKey(value){return clean(value).toLowerCase();}
function canonicalCustomers(type,projection,state,rep){
  const masterByCode=new Map(),masterByName=new Map();
  for(const client of state.clients){if(client?.code||client?.cr||client?.id)masterByCode.set(customerKey(client.code||client.cr||client.id),client);if(client?.name)masterByName.set(customerKey(client.name),client);}
  const selected=new Map();
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
    const assigned=rep&&(clean(client?.rep)===clean(rep.id)||(Array.isArray(client?.repIds)&&client.repIds.map(clean).includes(clean(rep.id))));
    const segment=norm(client?.seg||'');
    if(assigned&&(!segment||segment.includes(type==='block'?'بلوك':'خرسان')||segment.includes('الاثنين')))add(client);
  }
  const projected=projection?.departments?.[type]?.rows||[];
  for(const row of projected){const master=masterByCode.get(customerKey(row.code||row.customerCode))||masterByName.get(customerKey(row.name||row.customerName));add(master||{},row);}
  return[...selected.values()].sort((a,b)=>a.name.localeCompare(b.name,'ar'));
}

export async function generateCustomerPortfolioPdfs(analysis={},sourceFile='daily-report.xlsx'){
  const reportDate=riyadhDate(),[state,projection]=await Promise.all([loadAppState(),loadProjectedCumulativeDailyReport(analysis,reportDate)]),baseUrl=`${publicBase()}/`;
  return Promise.all(['block','concrete'].map(async type=>{
    const rep=findRep(state.employees,type),customers=canonicalCustomers(type,projection,state,rep),documentRef=`BHF-${type.toUpperCase()}-${reportDate.replace(/-/g,'')}`;
    const rendered=renderCustomerPortfolioDeclaration({
      type,
      companyName:state.companyName,
      employee:{name:rep?.name||'',nationalId:rep?.nid||'',role:rep?.role||ROLE_BY_TYPE[type],number:rep?.no||'',phone:rep?.tel||''},
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
    return{type,pdf,filename:`portfolio-${type}-${reportDate}.pdf`,caption:`${icon(type)} إقرار محفظة عملاء — ${rep?.name||ROLE_BY_TYPE[type]} — ${reportDate}`,templateVersion:CUSTOMER_PORTFOLIO_TEXT_VERSION,sourceFile};
  }));
}
