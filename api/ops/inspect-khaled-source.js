import crypto from 'node:crypto';
import * as XLSX from 'xlsx';
import { errorResponse, json, method } from '../_lib/http.js';
import { downloadObject } from '../_lib/supabase.js';
import { parseDailyWorkbook } from '../_lib/daily-summary-parser.js';

const REPOSITORY='fikrimamdouh/binhamid-factory-control';
const OIDC_ISSUER='https://token.actions.githubusercontent.com';
const OIDC_AUDIENCE='binhamid-khaled-source-inspect';
const WORKFLOW_PATH='/.github/workflows/inspect-khaled-source-via-production-once.yml@refs/heads/main';
const SOURCE_FILES=[
  {date:'2026-07-23',name:'تحديث تقرير الحركة من 19 إلى 23',path:'erp-folder/2026-07-23/6a4f45fd74c6e3d1-19_23_1_.xlsx'},
  {date:'2026-07-25',name:'تقرير الحركة يوم 25',path:'erp-folder/2026-07-25/92138a95ac74596b-25_5_.xlsx'}
];
const TARGETS=[538.75,595,1450,270,450,1440];
let jwksCache={expires:0,keys:[]};

const clean=(value,max=2000)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const audiences=value=>Array.isArray(value)?value:[value];
const norm=value=>clean(value,4000).toLowerCase().replace(/[أإآٱ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ً-ْـ]/g,'').replace(/\s+/g,' ');
const western=value=>String(value??'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
const money=value=>Math.round((Number(value||0)+Number.EPSILON)*100)/100;
const number=value=>{
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  const text=western(value).replace(/[٬,]/g,'').replace(/٫/g,'.').replace(/[^0-9.+-]/g,'');
  if(!text)return null;
  const parsed=Number(text);return Number.isFinite(parsed)?parsed:null;
};
const safeCell=value=>{
  if(value instanceof Date&&!Number.isNaN(value.getTime()))return value.toISOString();
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  if(typeof value==='boolean')return value;
  return clean(value,600);
};
const safeSale=row=>({sheet:clean(row.sheet,120),row:Number(row.row||0),reportDate:clean(row.reportDate,20),invoice:clean(row.invoice,120),customerCode:clean(row.customerCode,120),customer:clean(row.customer,500),item:clean(row.item,500),kind:clean(row.kind,50),quantity:Number(row.quantity||0),amount:money(row.amount)});
const safeCash=row=>({sheet:clean(row.sheet,120),row:Number(row.row||0),reportDate:clean(row.reportDate,20),movementDate:clean(row.movementDate,20),treasuryCode:clean(row.treasuryCode,40),treasuryName:clean(row.treasuryName,200),debit:money(row.debit),credit:money(row.credit),accountName:clean(row.accountName,500),accountType:clean(row.accountType,150),accountCode:clean(row.accountCode,120),description:clean(row.description,1000),movementType:clean(row.movementType,180),voucherNo:clean(row.voucherNo,120),paymentMethod:clean(row.paymentMethod,80),isCustomerCollection:Boolean(row.isCustomerCollection)});

function base64Json(value){try{return JSON.parse(Buffer.from(value,'base64url').toString('utf8'));}catch{return null;}}
async function jwks(){
  if(jwksCache.expires>Date.now()&&jwksCache.keys.length)return jwksCache.keys;
  const response=await fetch(`${OIDC_ISSUER}/.well-known/jwks`,{headers:{Accept:'application/json'}});
  if(!response.ok)throw Object.assign(new Error('تعذر التحقق من هوية GitHub Actions'),{status:502,code:'GITHUB_OIDC_JWKS_FAILED'});
  const data=await response.json();
  jwksCache={expires:Date.now()+3600000,keys:Array.isArray(data.keys)?data.keys:[]};
  return jwksCache.keys;
}
async function requireGithubIdentity(req){
  const auth=clean(req.headers?.authorization,4000);
  if(!auth.startsWith('Bearer '))throw Object.assign(new Error('هوية GitHub Actions مطلوبة'),{status:401,code:'SOURCE_INSPECT_AUTH_REQUIRED'});
  const token=auth.slice(7),parts=token.split('.');
  if(parts.length!==3)throw Object.assign(new Error('رمز GitHub Actions غير صالح'),{status:401,code:'SOURCE_INSPECT_AUTH_INVALID'});
  const header=base64Json(parts[0]),claims=base64Json(parts[1]);
  if(!header||!claims||header.alg!=='RS256'||!header.kid)throw Object.assign(new Error('بنية رمز GitHub Actions غير صالحة'),{status:401,code:'SOURCE_INSPECT_AUTH_INVALID'});
  const key=(await jwks()).find(item=>item.kid===header.kid);
  if(!key)throw Object.assign(new Error('مفتاح GitHub Actions غير معروف'),{status:401,code:'SOURCE_INSPECT_AUTH_KEY_UNKNOWN'});
  const signatureValid=crypto.verify('RSA-SHA256',Buffer.from(`${parts[0]}.${parts[1]}`),crypto.createPublicKey({key,format:'jwk'}),Buffer.from(parts[2],'base64url'));
  const now=Math.floor(Date.now()/1000),workflowRef=String(claims.workflow_ref||'');
  if(!signatureValid||claims.iss!==OIDC_ISSUER||!audiences(claims.aud).includes(OIDC_AUDIENCE)||claims.repository!==REPOSITORY||claims.ref!=='refs/heads/main'||!workflowRef.includes(WORKFLOW_PATH)||Number(claims.exp||0)<=now||Number(claims.nbf||0)>now+30){
    throw Object.assign(new Error('هوية التشغيل لا تخص فحص ملفات تسويات خالد'),{status:403,code:'SOURCE_INSPECT_AUTH_FORBIDDEN'});
  }
  return claims;
}

function customerSubsetMatches(sales=[]){
  const groups=new Map();
  for(const sale of sales){
    const key=clean(sale.customerCode,120)||`name:${norm(sale.customer)}`;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(sale);
  }
  const matches=[];
  for(const [customerKey,rows] of groups){
    const candidates=rows.filter(row=>money(row.amount)>0).sort((a,b)=>money(b.amount)-money(a.amount));
    for(const target of TARGETS){
      const found=[];
      const walk=(index,total,picked)=>{
        if(found.length>=8)return;
        const rounded=money(total);
        if(Math.abs(rounded-target)<0.01&&picked.length){found.push([...picked]);return;}
        if(index>=candidates.length||rounded>target+0.01)return;
        for(let cursor=index;cursor<candidates.length;cursor++){
          const next=money(total+candidates[cursor].amount);
          if(next>target+0.01)continue;
          picked.push(candidates[cursor]);
          walk(cursor+1,next,picked);
          picked.pop();
        }
      };
      walk(0,0,[]);
      for(const subset of found){
        matches.push({target,customerKey,customerCode:clean(rows[0]?.customerCode,120),customer:clean(rows[0]?.customer,500),sum:money(subset.reduce((sum,row)=>sum+money(row.amount),0)),lines:subset.map(safeSale)});
      }
    }
  }
  return matches;
}

function workbookEvidence(buffer,file){
  const workbook=XLSX.read(buffer,{type:'buffer',cellDates:true}),analysis=parseDailyWorkbook(workbook,XLSX),evidence=[];
  for(const sheetName of workbook.SheetNames){
    const rows=XLSX.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,defval:'',raw:false,cellDates:true,blankrows:false});
    const matchingIndexes=[];
    for(let index=0;index<rows.length;index++){
      const row=rows[index]||[],values=row.map(safeCell),numbers=row.map(number).filter(value=>value!==null),text=norm(row.join(' | '));
      const targetHits=TARGETS.filter(target=>numbers.some(value=>Math.abs(value-target)<0.01));
      const keywordHit=text.includes('خالد احمد عبدالحكم')||text.includes('اشعار دائن عميل')||text.includes('تصفية حساب العميل بعهده خالد');
      if(targetHits.length||keywordHit)matchingIndexes.push({index,targetHits,keywordHit,values});
    }
    const included=new Set();
    for(const match of matchingIndexes)for(let index=Math.max(0,match.index-5);index<=Math.min(rows.length-1,match.index+5);index++)included.add(index);
    const context=[...included].sort((a,b)=>a-b).map(index=>({row:index+1,values:(rows[index]||[]).map(safeCell)}));
    if(context.length)evidence.push({sheet:clean(sheetName,200),rowCount:rows.length,matches:matchingIndexes.map(match=>({row:match.index+1,targetHits:match.targetHits,keywordHit:match.keywordHit,values:match.values})),context});
  }
  const sales=(analysis.sales||[]).map(safeSale),cash=(analysis.cashMovements||[]).map(safeCash);
  return{
    date:file.date,name:file.name,path:file.path,sheets:workbook.SheetNames.map(name=>clean(name,200)),evidence,
    parsed:{sales,cashMovements:cash,blockSales:sales.filter(row=>row.kind==='بلوك'),customerCash:cash.filter(row=>norm(row.accountType).includes('عميل')||row.accountCode==='1100048'),subsetMatches:customerSubsetMatches(analysis.sales||[])}
  };
}

export default async function handler(req,res){
  if(!method(req,res,['POST']))return;
  try{
    await requireGithubIdentity(req);
    const files=[];
    for(const file of SOURCE_FILES){
      const downloaded=await downloadObject(file.path);
      files.push(workbookEvidence(downloaded.buffer,file));
    }
    return json(res,200,{ok:true,targets:TARGETS,files});
  }catch(error){errorResponse(res,error);}
}
