import { sendMessage, keyboard } from './telegram.js';
import { clearMaintenanceSession } from './bot-maintenance.js';
import * as legacy from './bot-procurement.js';
import { canUseProductAssistant, continueProductAssistant, handleProductTextCommand, sendProductResearch, startProductAssistant, startProductImageAssistant } from './bot-product-assistant.js';
import { continueDeepBusinessSearch, extractDirectBusinessSearchQuery, handleDeepBusinessCallback, handleDirectBusinessSearch, isDeepBusinessState, startDeepBusinessSearch } from './bot-business-directory-flow.js';

const USE_ROLES=new Set(['admin','manager','accountant','mechanic','procurement','warehouse']);
const CREATE_ROLES=new Set(['admin','manager','mechanic','procurement','warehouse']);
const canUse=identity=>Boolean(identity?.active&&USE_ROLES.has(identity.role));
const canCreate=identity=>Boolean(identity?.active&&CREATE_ROLES.has(identity.role));
const adaptedIdentity=identity=>['procurement','warehouse'].includes(identity?.role)?{...identity,role:'mechanic',actual_role:identity.role}:identity;
const NATURAL_MARKET_REQUEST=/(?:ابحث|إبحث|تبحث|دور|دوّر|عاوز|عايز|محتاج|هات|جيب|سعر|اسعار|أسعار).*(?:عمود|كردان|قطعه|قطعة|قطع غيار|فلتر|رولمان|بلي|سير|بطاري|كاوتش|كفر|اطار|إطار|خرطوم|هيدروليك|طلمب|مضخ|موتور|محرك|صمام|بلف|ترس|جربوكس|جير|كلتش|فرامل|كمبروسر|شركة|شركه|مصنع|مورد|وكيل|موزع|محل|ورشه|ورشة|سعر|اسعار|أسعار)/i;

async function deny(message,identity,create=false){
  await clearMaintenanceSession(message.chat.id,identity?.external_id||message.from?.id).catch(()=>{});
  return sendMessage(message.chat.id,create?'بحث الأسعار والقطع والموردين متاح للمشتريات والمخزن والورشة والإدارة.':'عرض الأسعار والموردين متاح للمشتريات والمخزن والورشة والإدارة والمحاسب.');
}

export function procurementMenu(){return keyboard([
  [{text:'بحث أسعار وقطع',callback_data:'proc:product'},{text:'بحث بصورة القطعة',callback_data:'proc:product_image'}],
  [{text:'بحث شامل شركات ومحلات',callback_data:'proc:search'}]
]);}

export async function showProcurementMenu(message,identity){
  if(!canUse(identity))return deny(message,identity,false);
  return sendMessage(message.chat.id,'اكتب اسم القطعة أو الصنف مباشرة، أو اختر البحث بالصورة. سيبحث النظام عن الأسعار المنشورة ثم المحلات والموردين وأرقام الاتصال. البحث الشامل يجمع الشركات والمصانع والوكلاء والأدلة التجارية مع دليل الأماكن. لا توجد روابط خارجية؛ تظهر النتائج داخل المحادثة.',procurementMenu());
}

export function directBusinessSearchRequested(text=''){return Boolean(extractDirectBusinessSearchQuery(text)||NATURAL_MARKET_REQUEST.test(String(text||'')));}
export async function handleDirectBusinessSearchCommand(message,identity,text){
  if(!directBusinessSearchRequested(text))return false;
  if(!canCreate(identity)){await deny(message,identity,true);return true;}
  return handleDirectBusinessSearch(message,identity,text);
}

export async function startProcurementAction(message,identity,action){
  if(action==='product'||action==='price'||action==='rfq'||action==='open')return startProductAssistant(message,identity);
  if(action==='product_image')return startProductImageAssistant(message,identity);
  if(action==='search')return canCreate(identity)?startDeepBusinessSearch(message,identity):deny(message,identity,true);
  if(!canCreate(identity))return deny(message,identity,true);
  return legacy.startProcurementAction(message,adaptedIdentity(identity),action);
}

export async function continueProcurementSession(message,identity,session,text){
  if(['product_market_query','supplier_search_query','product_image_waiting'].includes(session?.state)){
    if(!canUseProductAssistant(identity))return deny(message,identity,false).then(()=>true);
    return continueProductAssistant(message,identity,session,text);
  }
  if(isDeepBusinessState(session?.state)){
    if(!canCreate(identity))return deny(message,identity,true).then(()=>true);
    return continueDeepBusinessSearch(message,identity,session,text);
  }
  if(!canCreate(identity))return deny(message,identity,true).then(()=>true);
  if(session?.context?.actualRoleAtStart&&session.context.actualRoleAtStart!==identity.role)return deny(message,identity,true).then(()=>true);
  return legacy.continueProcurementSession(message,adaptedIdentity(identity),session,text);
}

export async function handleProcurementCallback(message,from,identity,action,value){
  const callbackMessage={...message,from};
  if(action==='proc'&&['product','price','rfq','open'].includes(value))return startProductAssistant(callbackMessage,identity);
  if(action==='proc'&&value==='product_image')return startProductImageAssistant(callbackMessage,identity);
  // التوسع للخليج باختيار صريح من المستخدم، فالافتراضي هو السوق السعودي وحده.
  if(action==='market_scope'){
    if(!canUseProductAssistant(identity))return deny(callbackMessage,identity,true);
    const query=decodeURIComponent(String(value||'')).trim();
    if(!query)return startProductAssistant(callbackMessage,identity);
    return sendProductResearch(callbackMessage,identity,query,'كل السعودية',{scope:'gulf'});
  }
  if(action==='proc'&&value==='search')return canCreate(identity)?startDeepBusinessSearch(callbackMessage,identity):deny(callbackMessage,identity,true);
  if(action==='supplier_city'&&!canCreate(identity))return deny(callbackMessage,identity,true);
  if(await handleDeepBusinessCallback(message,from,identity,action,value))return true;
  if(!canCreate(identity))return deny(callbackMessage,identity,true);
  return legacy.handleProcurementCallback(message,from,adaptedIdentity(identity),action,value);
}

export async function sendOpenQuoteRequests(chatId,identity){
  if(!canUse(identity))return sendMessage(chatId,'ليست لديك صلاحية استخدام بحث الأسعار والموردين.');
  return sendMessage(chatId,'اكتب اسم القطعة أو الصنف المطلوب وسأبحث عن الأسعار المنشورة والمحلات والموردين.');
}

export async function handleProcurementTextCommand(message,identity,text){
  if(await handleProductTextCommand(message,identity,text))return true;
  if(await handleDirectBusinessSearchCommand(message,identity,text))return true;
  const normalized=String(text||'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[؟?!.,،؛:]+/g,'').replace(/\s+/g,' ').trim();
  if(/^(طلب عرض سعر|طلب اسعار|طلب أسعار|طلبات الاسعار المفتوحه|طلبات الأسعار المفتوحة|بحث قطعه|بحث قطعة|بحث سعر|اسعار المنتجات|أسعار المنتجات)$/.test(normalized)){await startProductAssistant(message,identity);return true;}
  if(/^(بحث شامل|بحث شركات|بحث عن شركات|دليل الشركات|دليل المحلات|جميع الموردين|كل الشركات والمحلات|بحث مورد|بحث عن مورد|قائمه الموردين|قائمة الموردين)$/.test(normalized)){
    if(!canCreate(identity)){await deny(message,identity,true);return true;}
    await startDeepBusinessSearch(message,identity);return true;
  }
  return legacy.handleProcurementTextCommand(message,adaptedIdentity(identity),text);
}
