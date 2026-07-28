// كلام المستخدم الطبيعي يحمل حشوًا قبل اسم القطعة، ورسالة صوتية غاضبة مثل
// «يعني أنت مش عارف تبحث على رمان بلي» كانت تدخل محرك البحث كما هي.
const FILLER=/^(?:(?:يعني|طيب|خلاص|بس|ياعم|يا\s+عم|يابني|يا\s+بني|هو|انت|أنت|انتا|إنتا|احنا|إحنا|مش\s+عارف|مش\s+قادر|ما\s*تعرفش|ماتعرفش|لو\s+سمحت|من\s+فضلك|ممكن|ياريت|يا\s+ريت|ايه|إيه|ليه|ازاي|إزاي)\s+)/i;

export function stripConversationalFiller(value=''){
  let text=String(value||'').replace(/\s+/g,' ').trim();
  for(let pass=0;pass<6;pass++){
    const next=text.replace(FILLER,'').trim();
    if(next===text)break;
    text=next;
  }
  return text;
}
