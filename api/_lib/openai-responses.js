// أدوات مشتركة لنداءات Responses API.
// السبب: نماذج التفكير (gpt-5*, o*) تستهلك max_output_tokens في التفكير قبل كتابة الإجابة،
// فترجع الاستجابة بحالة 200 لكن status='incomplete' ونص فارغ. بدون هذا الفحص يظهر الخطأ
// كأنه «بيانات غير قابلة للقراءة» بينما السبب الحقيقي هو سقف توكنات مخنوق.

const REASONING_MODEL=/^(?:gpt-5|o[134])/i;

export function isReasoningModel(model=''){return REASONING_MODEL.test(String(model||'').trim());}

// نخفض جهد التفكير حتى يبقى أغلب سقف التوكنات متاحًا للإجابة نفسها.
export function reasoningFor(model='',effort='low'){
  return isReasoningModel(model)?{reasoning:{effort}}:{};
}

export function responsesOutputText(data={}){
  if(data.output_text)return String(data.output_text).trim();
  return(data.output||[])
    .flatMap(item=>item.content||[])
    .filter(part=>part?.type==='output_text'||typeof part?.text==='string')
    .map(part=>part.text||'')
    .join('\n')
    .trim();
}

// يرمي خطأً واضحًا عند اقتطاع الإجابة بسبب سقف التوكنات بدل ابتلاعها كنص فارغ.
export function assertResponseComplete(data={},{code='OPENAI_RESPONSE_INCOMPLETE',model=''}={}){
  const status=String(data?.status||'').toLowerCase();
  if(status!=='incomplete')return;
  const reason=String(data?.incomplete_details?.reason||'').toLowerCase();
  const message=reason==='max_output_tokens'
    ?'انتهى سقف التوكنات قبل اكتمال الإجابة. ارفع max_output_tokens أو اخفض جهد التفكير.'
    :`لم تكتمل استجابة النموذج (${reason||'سبب غير معروف'}).`;
  throw Object.assign(new Error(message),{status:502,code,model,reason:reason||'unknown'});
}

// خطأ «النموذج غير موجود/غير مسموح» يستحق تجربة نموذج بديل، بعكس بقية الأخطاء.
export function modelUnavailable(error={}){
  const status=Number(error?.status||0);
  if(![400,403,404].includes(status))return false;
  return /model|not found|does not exist|unsupported|access/i.test(String(error?.message||''));
}

// نجرب النموذج الأقوى أولًا. لو ردّ المزود بأنه غير متاح، نحفظ ذلك لعمر هذه النسخة
// من الدالة فلا نهدر محاولة فاشلة في كل طلب لاحق.
const unavailable=new Set();

export function markModelUnavailable(model){if(model)unavailable.add(String(model).trim());}
export function isModelKnownUnavailable(model){return unavailable.has(String(model||'').trim());}

// تُرجع القائمة بعد إسقاط ما ثبت أنه غير متاح، مع إبقاء الخيار الأخير كشبكة أمان.
export function usableModels(list=[]){
  const clean=[...new Set(list.map(value=>String(value||'').trim()).filter(Boolean))];
  const usable=clean.filter(model=>!unavailable.has(model));
  return usable.length?usable:clean.slice(-1);
}
