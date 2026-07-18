import { config } from './config.js';

function outputText(data={}){
  if(data.output_text)return String(data.output_text).trim();
  return(data.output||[]).flatMap(item=>item.content||[]).map(part=>part.text||'').join('\n').trim();
}
function parseVision(text=''){
  const query=(text.match(/^SEARCH_QUERY:\s*(.+)$/mi)||[])[1]?.trim()||'';
  const identification=(text.match(/^IDENTIFICATION:\s*(.+)$/mi)||[])[1]?.trim()||'قطعة غير محددة';
  const codes=(text.match(/^READABLE_CODES:\s*(.+)$/mi)||[])[1]?.trim()||'لا توجد أكواد واضحة';
  const confidence=(text.match(/^CONFIDENCE:\s*(high|medium|low)$/mi)||[])[1]?.toLowerCase()||'low';
  return{query,identification,codes,confidence,raw:text};
}
function usefulCodes(value=''){
  const text=String(value||'').trim();
  if(!text||/لا توجد|غير واضح|none|n\/a/i.test(text))return[];
  return [...new Set(text.split(/[,،;|\n]+/).map(x=>x.trim()).filter(x=>x.length>=3))];
}
function weak(result={}){
  const text=`${result.query||''} ${result.identification||''} ${result.codes||''}`;
  return result.confidence==='low'||result.query.length<6||/غير واضح|غير مقروء|غير محدد|الصورة.*غير|unclear|unreadable|unknown/i.test(text)||!usefulCodes(result.codes).length;
}
function score(result={}){
  const confidence={high:30,medium:18,low:5}[result.confidence]||0;
  const codes=Math.min(30,usefulCodes(result.codes).length*10);
  const query=Math.min(25,Math.max(0,result.query.length-5));
  const identification=/غير محدد|unknown/i.test(result.identification||'')?0:15;
  return confidence+codes+query+identification;
}
async function analyze({imageUrl,model,caption,attempt,prior=''}){
  const retry=attempt>1;
  const instructions=retry
    ?`أعد فحص صورة قطعة الغيار بصورة مستقلة ودقيقة. القراءة الأولى كانت ضعيفة، فلا تكرر عبارة «الصورة غير واضحة» لمجرد أن بعض النص صغير. افحص الشعار، شكل القطعة، نقاط التثبيت، ألوان الملصق، التغليف، الأرقام الجزئية، الحروف المعكوسة أو المائلة، والمقاسات. كوّن عبارة بحث مفيدة حتى عند غياب رقم كامل، مستخدمًا وصفًا بصريًا محددًا وأي كود جزئي. لا تخمن رقمًا غير ظاهر. أخرج أربع سطور فقط وبنفس العناوين الإنجليزية: SEARCH_QUERY، IDENTIFICATION، READABLE_CODES، CONFIDENCE.`
    :`أنت خبير قطع غيار ومشتريات صناعية وقراءة ملصقات. افحص الصورة كاملة بدقة عالية، بما في ذلك الشعار، شكل القطعة، نقاط التثبيت، الألوان، التغليف، المقاسات، الأرقام الجزئية، النص المائل أو المعكوس. لا ترفض الصورة لمجرد أن بعض الكتابة صغيرة، ولا تقل «الصورة غير واضحة» إلا إذا لم يظهر أي جسم قابل للوصف. لا تخمن علامة أو رقم قطعة غير ظاهر. كوّن عبارة بحث عربية وإنجليزية قابلة للاستخدام، ولو بالوصف البصري المحدد مع الأكواد الجزئية. أخرج أربع سطور فقط: SEARCH_QUERY: أفضل عبارة بحث. IDENTIFICATION: وصف دقيق للقطعة. READABLE_CODES: كل الأكواد والأرقام المقروءة مفصولة بفواصل. CONFIDENCE: high أو medium أو low.`;
  const response=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',
    headers:{Authorization:`Bearer ${config.openaiKey}`,'Content-Type':'application/json'},
    body:JSON.stringify({
      model,
      store:false,
      max_output_tokens:700,
      instructions,
      input:[{role:'user',content:[
        {type:'input_text',text:`حلل صورة القطعة للبحث الشرائي. وصف المستخدم: ${String(caption||'لا يوجد').slice(0,300)}${prior?`\nالقراءة السابقة للاستفادة النقدية فقط، لا لتكرارها: ${String(prior).slice(0,1000)}`:''}`},
        {type:'input_image',image_url:imageUrl,detail:'high'}
      ]}]
    }),
    signal:AbortSignal.timeout(30000)
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(data?.error?.message||'تعذر تحليل صورة القطعة.'),{status:502,code:'PRODUCT_IMAGE_ANALYSIS_FAILED'});
  return parseVision(outputText(data));
}

export async function identifyProductImage(buffer,mimeType='image/jpeg',caption=''){
  if(!config.openaiKey)throw Object.assign(new Error('البحث بالصورة غير مفعّل. يلزم ضبط OPENAI_API_KEY في Vercel.'),{status:503,code:'PRODUCT_IMAGE_NOT_CONFIGURED'});
  if(!buffer?.length)throw Object.assign(new Error('الصورة فارغة أو تعذر تنزيلها.'),{status:400,code:'PRODUCT_IMAGE_EMPTY'});
  if(buffer.length>12*1024*1024)throw Object.assign(new Error('حجم صورة القطعة أكبر من الحد المسموح للبحث.'),{status:413,code:'PRODUCT_IMAGE_TOO_LARGE'});
  const safeMime=/^image\/(jpeg|png|webp|gif)$/i.test(String(mimeType||''))?String(mimeType).toLowerCase():'image/jpeg';
  const imageUrl=`data:${safeMime};base64,${Buffer.from(buffer).toString('base64')}`;
  const configured=String(config.textModel||'').trim(),model=configured==='gpt-5.4-mini'||!configured?'gpt-5.6':configured;
  const first=await analyze({imageUrl,model,caption,attempt:1});
  let best=first,passes=1;
  if(weak(first)){
    try{
      const second=await analyze({imageUrl,model,caption,attempt:2,prior:first.raw});
      passes=2;if(score(second)>score(first))best=second;
    }catch(error){console.warn('[product image second pass]',{message:String(error?.message||'').slice(0,240)});}
  }
  const codes=usefulCodes(best.codes).join('، ')||'لا توجد أكواد مؤكدة';
  let query=String(best.query||'').trim();
  if(query.length<2){
    const fallback=[best.identification,...usefulCodes(best.codes),caption].filter(Boolean).join(' ');
    query=fallback.trim();
  }
  if(query.length<2)throw Object.assign(new Error('لم أستطع تكوين عبارة بحث من الصورة. أرسلها كملف صورة أصلي أو أرفق اسم المعدة.'),{status:422,code:'PRODUCT_IMAGE_QUERY_EMPTY'});
  return{query:query.slice(0,260),identification:String(best.identification||'قطعة غير محددة').slice(0,500),codes:codes.slice(0,400),confidence:best.confidence,analysisPasses:passes,needsMoreDetail:weak(best)};
}
