// طبقة تنسيق موحّدة لرسائل البوت.
// الهدف: شكل واحد متسق عبر كل الوحدات بدل أن يبني كل ملف رسائله بطريقته، وقراءة
// سريعة بالعين — عنوان، فواصل، أرقام محاذاة، وشارات اتجاه وتنبيه واضحة.
const HTML={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
export const esc=value=>String(value??'').replace(/[&<>"']/g,char=>HTML[char]);
export const RULE='━━━━━━━━━━━━━━━';
const AR_DAYS=['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
const AR_MONTHS=['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

export function money(value,{decimals=0}={}){
  const number=Number(value||0);
  return number.toLocaleString('en-US',{minimumFractionDigits:decimals,maximumFractionDigits:decimals});
}
export function qty(value){
  const number=Number(value||0);
  return number.toLocaleString('en-US',{maximumFractionDigits:Number.isInteger(number)?0:3});
}
// «الأحد ٢٣ يوليو» — أوضح من 2026-07-23 في رسالة يقرؤها المشغّل بسرعة.
export function arabicDate(iso){
  const text=String(iso||'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text))return text||'—';
  const date=new Date(`${text}T12:00:00Z`);
  if(Number.isNaN(date.getTime()))return text;
  return`${AR_DAYS[date.getUTCDay()]} ${date.getUTCDate()} ${AR_MONTHS[date.getUTCMonth()]}`;
}
export const title=(icon,text)=>`${icon} <b>${esc(text)}</b>`;
export const section=(icon,text)=>`\n${icon} <b>${esc(text)}</b>`;
// سطر رقم رئيسي: أيقونة + وصف + قيمة بارزة، مع سطر تابع اختياري بمسافة بادئة.
export const line=(icon,label,value,unit='')=>`${icon} ${esc(label)} <b>${value}</b>${unit?` ${esc(unit)}`:''}`;
export const sub=(icon,label,value,note='')=>`   ${icon} ${esc(label)} <b>${value}</b>${note?` <i>(${esc(note)})</i>`:''}`;
export const note=text=>`<i>${esc(text)}</i>`;
export const bullet=(index,text)=>`${index}. ${text}`;

// شارة اتجاه مقارنة بفترة سابقة: ▲ نمو، ▼ تراجع، ▬ ثبات، مع النسبة.
export function trend(current,previous,{invert=false}={}){
  const now=Number(current||0),before=Number(previous||0);
  if(!before)return now?'<b>جديد</b>':'—';
  const change=((now-before)/Math.abs(before))*100;
  if(Math.abs(change)<0.5)return'▬ ثابت';
  const up=change>0,good=invert?!up:up;
  return`${up?'▲':'▼'}${Math.abs(change).toFixed(0)}٪ ${good?'✅':'⚠️'}`;
}
export const alert=text=>`⚠️ ${esc(text)}`;
export const ok=text=>`✅ ${esc(text)}`;
// يجمع الأقسام ويحذف الفراغات الزائدة حتى لا تتباعد الأسطر بلا داعٍ.
export function compose(...parts){
  return parts.flat().filter(part=>part!==null&&part!==undefined&&String(part).trim()!=='').join('\n').replace(/\n{3,}/g,'\n\n').trim();
}

// ردّ ترحيبي دافئ بكنية المستخدم، يتغيّر في كل مرة فلا يبدو آليًا مكررًا.
// يُستخدم صدرًا للردود الرئيسية فقط، لا في رسائل الخطأ حتى لا يبدو استخفافًا.
const ACKS=[
  'أبشر يا {name} 🌟','من عيني يا {name} ❤️','حاضر يا {name} 🤝','تم يا {name} ✅',
  'أمرك يا {name} 👑','على الراس يا {name} 🙌','يا هلا بك يا {name} 🌹','طال عمرك يا {name} ⭐',
  'جاهز يا {name} 💪','تفضّل يا {name} 📌','في خدمتك يا {name} 🌷','أبشر بالخير يا {name} ✨'
];
export function kunya(identity){
  const nick=String(identity?.nickname||'').trim();
  if(nick)return nick;
  const full=String(identity?.full_name||identity?.name||'').trim();
  if(!full)return'طويل العمر';
  const parts=full.split(/\s+/);
  return parts[0]==='أبو'||parts[0]==='ابو'?parts.slice(0,2).join(' '):parts[0];
}
// مؤشر دوّار يبدأ من موضع عشوائي ثم يتقدّم، فلا تتكرر العبارة مرتين متتاليتين
// داخل الجلسة الواحدة كما يحدث مع الاختيار العشوائي البحت.
let ackIndex=Math.floor(Math.random()*ACKS.length);
export function warmAck(identity){
  ackIndex=(ackIndex+1)%ACKS.length;
  return ACKS[ackIndex].replace('{name}',esc(kunya(identity)));
}
