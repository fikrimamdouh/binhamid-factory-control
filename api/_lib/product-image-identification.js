import { config } from './config.js';

function outputText(data={}){
  if(data.output_text)return String(data.output_text).trim();
  return(data.output||[]).flatMap(item=>item.content||[]).map(part=>part.text||'').join('\n').trim();
}

export async function identifyProductImage(buffer,mimeType='image/jpeg',caption=''){
  if(!config.openaiKey)throw Object.assign(new Error('البحث بالصورة غير مفعّل. يلزم ضبط OPENAI_API_KEY في Vercel.'),{status:503,code:'PRODUCT_IMAGE_NOT_CONFIGURED'});
  if(!buffer?.length)throw Object.assign(new Error('الصورة فارغة أو تعذر تنزيلها.'),{status:400,code:'PRODUCT_IMAGE_EMPTY'});
  if(buffer.length>12*1024*1024)throw Object.assign(new Error('حجم صورة القطعة أكبر من الحد المسموح للبحث.'),{status:413,code:'PRODUCT_IMAGE_TOO_LARGE'});
  const safeMime=/^image\/(jpeg|png|webp|gif)$/i.test(String(mimeType||''))?String(mimeType).toLowerCase():'image/jpeg';
  const imageUrl=`data:${safeMime};base64,${Buffer.from(buffer).toString('base64')}`;
  const model=config.textModel==='gpt-5.4-mini'?'gpt-5.6':config.textModel;
  const response=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',
    headers:{Authorization:`Bearer ${config.openaiKey}`,'Content-Type':'application/json'},
    body:JSON.stringify({
      model,
      store:false,
      max_output_tokens:500,
      instructions:'أنت خبير قطع غيار ومشتريات صناعية. حلل الصورة بدقة واقرأ كل نص ورقم ظاهر. لا تخمن العلامة أو رقم القطعة. أخرج أربع سطور فقط: SEARCH_QUERY: أفضل عبارة بحث عربية وإنجليزية تتضمن رقم القطعة والماركة والمقاس إن ظهر. IDENTIFICATION: وصف القطعة. READABLE_CODES: كل الأكواد والأرقام المقروءة مفصولة بفواصل. CONFIDENCE: high أو medium أو low. عند عدم كفاية الصورة اجعل SEARCH_QUERY وصفًا بصريًا واضحًا واذكر أن الرقم غير ظاهر.',
      input:[{role:'user',content:[{type:'input_text',text:`حلل صورة القطعة للبحث الشرائي. وصف المستخدم: ${String(caption||'لا يوجد').slice(0,300)}`},{type:'input_image',image_url:imageUrl,detail:'high'}]}]
    }),
    signal:AbortSignal.timeout(25000)
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(data?.error?.message||'تعذر تحليل صورة القطعة.'),{status:502,code:'PRODUCT_IMAGE_ANALYSIS_FAILED'});
  const text=outputText(data);
  const query=(text.match(/^SEARCH_QUERY:\s*(.+)$/mi)||[])[1]?.trim()||'';
  const identification=(text.match(/^IDENTIFICATION:\s*(.+)$/mi)||[])[1]?.trim()||'قطعة غير محددة';
  const codes=(text.match(/^READABLE_CODES:\s*(.+)$/mi)||[])[1]?.trim()||'لا توجد أكواد واضحة';
  const confidence=(text.match(/^CONFIDENCE:\s*(high|medium|low)$/mi)||[])[1]?.toLowerCase()||'low';
  if(query.length<2)throw Object.assign(new Error('لم أستطع تكوين عبارة بحث من الصورة. صوّر الملصق أو رقم القطعة عن قرب.'),{status:422,code:'PRODUCT_IMAGE_QUERY_EMPTY'});
  return{query:query.slice(0,220),identification:identification.slice(0,400),codes:codes.slice(0,300),confidence};
}
