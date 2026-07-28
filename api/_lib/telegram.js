import { config } from './config.js';
import { upsert } from './supabase.js';
import { synthesizeTelegramReply } from './bot-voice.js';
import { markVoiceReplySent, shouldSpeakTelegramText } from './bot-voice-context.js';

function ensure() { if (!config.telegramToken) throw Object.assign(new Error('Telegram Bot Token غير مضبوط'), { status: 503 }); }
async function fetchRetry(url, options = {}, tries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try { return await fetch(url, options); }
    catch (error) {
      lastError = error;
      const signal = String(error?.cause?.code || error?.cause?.message || error?.message || '');
      const transient = /ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR|socket|network|fetch failed|terminated|TLS/i.test(signal);
      if (!transient || attempt === tries) throw error;
      await new Promise(resolve => setTimeout(resolve, 350 * attempt));
    }
  }
  throw lastError;
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function inferTelegramButtonStyle(button={}){
  if(button.style)return button.style;
  const value=`${String(button.text||'')} ${String(button.callback_data||'')}`.toLowerCase();
  if(/حذف|الغاء|إلغاء|رفض|ايقاف|إيقاف|خروج|تراجع|cancel|delete|reject|decline|stop|close/.test(value))return'danger';
  if(/تأكيد|تاكيد|اعتماد|حفظ|ارسال|إرسال|تنفيذ|استلام|موافق|اكمال|إكمال|تم|confirm|approve|accept|save|send|submit|complete|success/.test(value))return'success';
  if(/فتح|عرض|تعديل|بحث|التالي|السابق|رجوع|القائمه|القائمة|الرئيسيه|الرئيسية|تحديث|تفاصيل|open|view|edit|search|next|prev|back|menu|home|refresh|details/.test(value))return'primary';
  return'';
}

export function styleTelegramMarkup(replyMarkup){
  if(!replyMarkup||typeof replyMarkup!=='object')return replyMarkup;
  for(const key of ['inline_keyboard','keyboard']){
    const rows=replyMarkup[key];
    if(!Array.isArray(rows))continue;
    replyMarkup[key]=rows.map(row=>(row||[]).map(button=>{
      if(!button||typeof button!=='object')return button;
      const style=inferTelegramButtonStyle(button);
      return style&&!button.style?{...button,style}:button;
    }));
  }
  return replyMarkup;
}

export async function telegram(method, payload = {}) {
  ensure();
  const response = await fetchRetry(`https://api.telegram.org/bot${config.telegramToken}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await response.json();
  if (!data.ok) throw Object.assign(new Error(data.description || 'Telegram API error'), { status: 502, upstreamStatus: response.status, telegramErrorCode: data.error_code, data });
  return data.result;
}

async function recordOutgoing(result, method, fallback = {}) {
  try {
    if (!result?.chat?.id || !result?.message_id) return;
    const messageType = result.voice ? 'voice' : result.document ? 'document' : result.photo ? 'photo' : result.location ? 'location' : 'text';
    const row = {
      update_id: `out:${result.chat.id}:${result.message_id}`,
      chat_id: String(result.chat.id),
      message_id: String(result.message_id),
      group_id: null,
      sender_user_id: null,
      sender_external_id: 'bot',
      sender_name: 'مساعد مصنع بن حامد',
      chat_type: String(result.chat.type || ''),
      message_type: messageType,
      text: result.text || result.caption || fallback.text || fallback.caption || '',
      transcription: null,
      file_id: result.voice?.file_id || result.document?.file_id || result.photo?.at?.(-1)?.file_id || null,
      file_name: result.document?.file_name || fallback.filename || null,
      mime_type: result.document?.mime_type || result.voice?.mime_type || fallback.contentType || null,
      file_path: null,
      related_entity_type: null,
      related_entity_id: null,
      direction: 'outgoing',
      delivery_status: 'sent',
      reply_to_message_id: result.reply_to_message?.message_id ? String(result.reply_to_message.message_id) : null,
      bot_method: method,
      action_name: fallback.actionName || null,
      action_payload: fallback.actionPayload || {},
      raw: { message: result, method },
      created_at: new Date((result.date || Date.now() / 1000) * 1000).toISOString()
    };
    await upsert('telegram_messages', [row], 'chat_id,message_id');
  } catch (error) {
    console.warn('[telegram outgoing log]', error?.message || error);
  }
}

export function restoreTelegramPhoneLinks(text=''){
  return String(text??'').replace(/<a\s+href=(["'])tel:([^"']+)\1[^>]*>.*?<\/a>/gis,(_match,_quote,phone)=>String(phone||'').replace(/[^\d+]/g,''));
}

export async function sendMessage(chatId, text, extra = {}) {
  const { action_name: actionName, action_payload: actionPayload, disable_voice_reply: disableVoiceReply, ...telegramExtra } = extra || {};
  if(telegramExtra.reply_markup)telegramExtra.reply_markup=styleTelegramMarkup(telegramExtra.reply_markup);
  const telegramText=restoreTelegramPhoneLinks(text);
  const result = await telegram('sendMessage', { chat_id: chatId, text:telegramText, parse_mode: 'HTML', disable_web_page_preview: true, ...telegramExtra });
  await recordOutgoing(result, 'sendMessage', { text:telegramText, actionName, actionPayload });
  if(shouldSpeakTelegramText(chatId,telegramText,{disable_voice_reply:disableVoiceReply})){
    markVoiceReplySent(chatId);
    const speech=await synthesizeTelegramReply(telegramText);
    if(speech.buffer)await sendVoiceBuffer(chatId,speech.buffer).catch(error=>console.warn('[telegram voice reply]',{message:String(error?.message||'').slice(0,220)}));
    else console.warn('[telegram voice synthesis]',{reason:String(speech?.reason||'unknown'),detail:String(speech?.detail||'').slice(0,220)});
  }
  return result;
}

export async function answerCallback(id, text = '') {
  try{return await telegram('answerCallbackQuery', { callback_query_id: id, text, show_alert: false });}
  catch(error){
    const message=String(error?.message||'');
    if(/query is too old|response timeout expired|query ID is invalid/i.test(message)){
      console.warn('[telegram callback expired]',{message:message.slice(0,180)});
      return null;
    }
    throw error;
  }
}
export async function getFile(fileId) { return telegram('getFile', { file_id: fileId }); }
async function getFileWithRetry(fileId,tries=3){
  let lastError;
  for(let attempt=1;attempt<=tries;attempt++){
    try{return await getFile(fileId);}
    catch(error){
      lastError=error;
      const permanent=/file is too big|wrong file identifier|bad request: file/i.test(String(error?.message||''));
      if(permanent||attempt===tries)throw error;
      await wait(400*attempt);
    }
  }
  throw lastError;
}
export async function downloadTelegramFile(fileId,options={}) {
  const maxBytes=Number(options.maxBytes||config.maxImportFileBytes||0),expectedSize=Number(options.expectedSize||0);
  if(maxBytes&&expectedSize>maxBytes)throw Object.assign(new Error('file is too big'),{status:413,code:'TELEGRAM_FILE_TOO_LARGE'});
  const info=await getFileWithRetry(fileId),reportedSize=Number(info?.file_size||expectedSize||0);
  if(!info?.file_path)throw Object.assign(new Error('Telegram file path is missing'),{status:502,code:'TELEGRAM_FILE_PATH_MISSING'});
  if(maxBytes&&reportedSize>maxBytes)throw Object.assign(new Error('file is too big'),{status:413,code:'TELEGRAM_FILE_TOO_LARGE'});
  let response,lastStatus=0;
  for(let attempt=1;attempt<=3;attempt++){
    response=await fetchRetry(`https://api.telegram.org/file/bot${config.telegramToken}/${info.file_path}`);
    lastStatus=response.status;
    if(response.ok)break;
    if(![408,425,429,500,502,503,504].includes(response.status)||attempt===3)break;
    await response.arrayBuffer().catch(()=>null);
    await wait(450*attempt);
  }
  if (!response?.ok) throw Object.assign(new Error('تعذر تنزيل ملف Telegram'), { status: 502, upstreamStatus:lastStatus,code:'TELEGRAM_FILE_DOWNLOAD_FAILED' });
  const buffer=Buffer.from(await response.arrayBuffer());
  if(!buffer.length)throw Object.assign(new Error('Telegram file is empty'),{status:502,code:'TELEGRAM_FILE_EMPTY'});
  if(maxBytes&&buffer.length>maxBytes)throw Object.assign(new Error('file is too big'),{status:413,code:'TELEGRAM_FILE_TOO_LARGE'});
  return { buffer, filePath: info.file_path, contentType: response.headers.get('content-type') || 'application/octet-stream' };
}
export function keyboard(rows) { return { reply_markup: styleTelegramMarkup({ inline_keyboard: rows }) }; }
export function replyKeyboard(rows, options = {}) { return { reply_markup: styleTelegramMarkup({ keyboard: rows, resize_keyboard: true, one_time_keyboard: Boolean(options.oneTime), selective: true }) }; }

// تيليغرام يعرض الرسائل الصوتية أصلًا بصيغة OGG/OPUS؛ إرسال mp3 يجبره على إعادة ترميز
// تخفض وضوح الصوت. نتعرف على الصيغة من بصمة الملف بدل افتراضها.
export function detectVoiceFormat(buffer) {
  const head = Buffer.isBuffer(buffer) ? buffer.subarray(0, 4) : Buffer.from(buffer || []).subarray(0, 4);
  if (head.length >= 4 && head.toString('latin1') === 'OggS') return { contentType: 'audio/ogg', filename: 'reply.ogg' };
  return { contentType: 'audio/mpeg', filename: 'reply.mp3' };
}

export async function sendVoiceBuffer(chatId, buffer, caption = '') {
  ensure();
  const { contentType, filename } = detectVoiceFormat(buffer);
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (caption) form.append('caption', caption);
  form.append('voice', new Blob([buffer], { type: contentType }), filename);
  const response = await fetchRetry(`https://api.telegram.org/bot${config.telegramToken}/sendVoice`, { method: 'POST', body: form });
  const data = await response.json();
  if (!data.ok) throw Object.assign(new Error(data.description || 'تعذر إرسال الرد الصوتي'), { status: 502 });
  await recordOutgoing(data.result, 'sendVoice', { caption, filename, contentType });
  return data.result;
}

export async function sendDocumentBuffer(chatId, buffer, filename, contentType = 'application/octet-stream', caption = '') {
  ensure();
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (caption) form.append('caption', caption);
  form.append('document', new Blob([buffer], { type: contentType }), filename || 'document.bin');
  const response = await fetchRetry(`https://api.telegram.org/bot${config.telegramToken}/sendDocument`, { method: 'POST', body: form });
  const data = await response.json();
  if (!data.ok) throw Object.assign(new Error(data.description || 'تعذر إرسال المستند'), { status: 502 });
  await recordOutgoing(data.result, 'sendDocument', { caption, filename, contentType });
  return data.result;
}
