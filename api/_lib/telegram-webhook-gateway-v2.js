import { verifyTelegram } from './auth.js';
import { body, errorResponse, json, method } from './http.js';
import { rpc } from './supabase.js';
import enterpriseHandler from './telegram-webhook-handler.js';

const one=value=>Array.isArray(value)?value[0]:value;
const safe=value=>String(value??'').replace(/postgres(?:ql)?:\/\/[^\s]+/gi,'[DATABASE_URL]').slice(0,400);

function bufferedResponse(){
  const headers=new Map();
  return{
    statusCode:200,
    headersSent:false,
    body:null,
    setHeader(name,value){headers.set(String(name).toLowerCase(),value);},
    getHeader(name){return headers.get(String(name).toLowerCase());},
    removeHeader(name){headers.delete(String(name).toLowerCase());},
    writeHead(status,values={}){this.statusCode=Number(status)||200;for(const [name,value] of Object.entries(values||{}))this.setHeader(name,value);},
    write(chunk){this.body=(this.body||'')+String(chunk||'');return true;},
    end(chunk=''){if(chunk)this.write(chunk);this.headersSent=true;return this;}
  };
}

export default async function telegramWebhookGatewayV2(req,res){
  if(!method(req,res,['POST']))return;
  let update,updateId='',claimed=false;
  try{
    verifyTelegram(req);
    update=await body(req,2_000_000);
    updateId=String(update?.update_id??'').trim();
    if(!/^\d+$/.test(updateId))throw Object.assign(new Error('Telegram update_id is missing or invalid'),{status:400,code:'TELEGRAM_UPDATE_ID_INVALID'});
    const updateType=update.callback_query?'callback_query':update.message?.document?'document':update.message?.voice?'voice':update.message?.photo?'photo':update.edited_message?'edited_message':'message';
    const claim=one(await rpc('claim_telegram_update',{p_update_id:updateId,p_update_type:updateType}));
    claimed=Boolean(claim?.claimed);
    if(!claimed)return json(res,200,{ok:true,duplicate:true,updateId,status:claim?.status||'completed'});

    const buffered=bufferedResponse();
    req.telegramGatewayManaged=true;
    req.body=update;
    await enterpriseHandler(req,buffered);
    if(Number(buffered.statusCode||200)>=400){
      throw Object.assign(new Error(`Telegram handler returned HTTP ${buffered.statusCode}`),{status:Number(buffered.statusCode),code:'TELEGRAM_HANDLER_REJECTED'});
    }

    await rpc('complete_telegram_update',{p_update_id:updateId});
    return json(res,200,{ok:true,duplicate:false,updateId});
  }catch(error){
    if(claimed&&updateId){
      try{await rpc('fail_telegram_update',{p_update_id:updateId,p_error_code:String(error?.code||'PROCESSING_FAILED').slice(0,120),p_error_message:safe(error?.message||error),p_retryable:true});}
      catch(recordError){console.error('[telegram update failure receipt]',{updateId,code:String(recordError?.code||'RECEIPT_FAILED').slice(0,80)});}
    }
    if(!update)return errorResponse(res,error);
    console.error('[telegram webhook gateway]',{updateId,code:String(error?.code||'PROCESSING_FAILED').slice(0,120),status:Number(error?.status||error?.upstreamStatus||0),message:safe(error?.message||error)});
    return json(res,503,{ok:false,retryable:true,updateId,error:'تعذر إكمال تحديث Telegram مؤقتًا. سيُعاد الاستلام بأمان.'});
  }
}
