import { verifyTelegram } from './auth.js';
import { json, method, body, errorResponse } from './http.js';
import { sendMessage, answerCallback } from './telegram.js';
import { ensureTelegramGroup, ensureTelegramIdentity, storeTelegramMessage } from './bot-webhook-core.js';
import { getBotSession } from './bot-maintenance.js';
import { showProcurementMenu, continueProcurementSession, handleProcurementCallback, handleProcurementTextCommand } from './bot-procurement-secure.js';
import { sendGpsFleetStatus } from './bot-gps.js';
import enterpriseHandler from './telegram-webhook-handler.js';

const GPS_ROLES=new Set(['admin','manager','mechanic','driver','fuel_operator']);
const norm=value=>String(value||'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/[؟?!.,،؛:]+/g,'').replace(/\s+/g,' ').trim();
const procurementActions=new Set(['proc','supplier_city','supplier_rfq','rfq_qty','rfq_urgency']);
const procurementText=/^(بحث مورد|بحث عن مورد|بحث عن قطعه|بحث عن قطعة|ابحث عن قطعه|ابحث عن قطعة|قائمه الموردين|قائمة الموردين|طلب عرض سعر|طلب اسعار|طلب أسعار|طلبات الاسعار المفتوحه|طلبات الأسعار المفتوحة)$/;
const gpsText=/^(حاله gps|حالة gps|حاله الاسطول|حالة الأسطول|موقع السيارات|السيارات الان|السيارات الآن)$/;

async function interceptCallback(update){
  const query=update.callback_query,message=query?.message;
  if(!query||!message)return false;
  const [action,value]=String(query.data||'').split(':');
  const procurementHome=action==='home'&&value==='suppliers';
  if(!procurementHome&&!procurementActions.has(action)&&action!=='gps')return false;
  const identity=await ensureTelegramIdentity(query.from),role=identity.role||'pending';
  await answerCallback(query.id);
  if(!identity.active){await sendMessage(message.chat.id,'حسابك غير معتمد لتنفيذ هذا الإجراء.');return true;}
  if(procurementHome){await showProcurementMenu({...message,from:query.from},identity);return true;}
  if(procurementActions.has(action)){await handleProcurementCallback(message,query.from,identity,action,value);return true;}
  if(!GPS_ROLES.has(role)){await sendMessage(message.chat.id,'ليست لديك صلاحية عرض GPS.');return true;}
  await sendGpsFleetStatus(message.chat.id,value==='fleet'?'':value,identity);return true;
}

async function interceptText(update){
  const message=update.message||update.edited_message;
  if(!message?.from||message.from.is_bot||message.voice||message.document||message.photo?.length||message.location)return false;
  const raw=String(message.text||message.caption||'').trim(),normalized=norm(raw);
  const identity=await ensureTelegramIdentity(message.from),session=await getBotSession(message.chat.id,message.from.id);
  const procurementSession=session?.state?.startsWith('supplier_')||session?.state?.startsWith('rfq_');
  const procurementCommand=/^\/suppliers(?:@\w+)?$/i.test(raw)||procurementText.test(normalized);
  const gpsCommand=/^\/gps(?:@\w+)?$/i.test(raw)||gpsText.test(normalized);
  if(!procurementSession&&!procurementCommand&&!gpsCommand)return false;
  const group=await ensureTelegramGroup(message.chat);await storeTelegramMessage(update.update_id,message,group,identity);
  if(!identity.active){await sendMessage(message.chat.id,'حسابك غير معتمد لتنفيذ هذا الإجراء.');return true;}
  if(['group','supergroup'].includes(message.chat.type)&&!group.active){await sendMessage(message.chat.id,'المجموعة لم تعتمد بعد.');return true;}
  if(gpsCommand){await sendGpsFleetStatus(message.chat.id,'',identity);return true;}
  if(procurementSession){const handled=await continueProcurementSession(message,identity,session,raw);if(handled)return true;}
  if(/^\/suppliers(?:@\w+)?$/i.test(raw)){await showProcurementMenu(message,identity);return true;}
  if(await handleProcurementTextCommand(message,identity,raw))return true;
  return false;
}

export default async function handler(req,res){
  if(!method(req,res,['POST']))return;
  let update;
  try{verifyTelegram(req);update=await body(req,2_000_000);}catch(error){return errorResponse(res,error);}
  try{
    if(update.callback_query&&await interceptCallback(update))return json(res,200,{ok:true,gateway:true});
    if((update.message||update.edited_message)&&await interceptText(update))return json(res,200,{ok:true,gateway:true});
    req.body=update;
    return enterpriseHandler(req,res);
  }catch(error){console.error('[telegram webhook gateway]',error);return json(res,200,{ok:true,error_logged:true});}
}
