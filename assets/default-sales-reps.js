(function(){
'use strict';
/* يضمن وجود موظفَين افتراضيين لحين إضافة الأسماء الحقيقية:
   "مسؤول مبيعات البلوك" و"مسؤول مبيعات الخرسانة". بمجرد ما يتسجل اسم حقيقي
   بنفس الدور، تقدر تعدّل/تحذف السجل المؤقت من تبويب "الموظفون" عاديًا —
   هذا السكريبت لا يعيد إنشاءه إلا لو الاسمين الاثنين مش موجودين خالص. */
const VERSION='2026.07.22-default-sales-reps-v2-visible-errors';
const PLACEHOLDERS=[
  {name:'مسؤول مبيعات البلوك',role:'مسؤول مبيعات البلوك'},
  {name:'مسؤول مبيعات الخرسانة',role:'مسؤول مبيعات الخرسانة'}
];
function norm(value){
  return String(value??'').trim().toLowerCase()
    .replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي')
    .replace(/[ًٌٍَُِّْـ]/g,'').replace(/\s+/g,' ');
}
function genId(){return 'emp-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);}
function notifyFailure(error){
  const message='تعذر تجهيز مسؤولي المبيعات الافتراضيين: '+String(error?.message||error||'خطأ غير معروف');
  console.error('[BinHamid default sales reps]',error);
  if(typeof window.toast==='function')window.toast(message,'err');
  else if(typeof window.opsToast==='function')window.opsToast(message,'err');
  window.dispatchEvent(new CustomEvent('binhamid-module-error',{detail:{module:'default-sales-reps',message,retryable:true}}));
}
function ensure(){
  // D هو نفس متغير الحالة القديم المُعرّف داخل legacy.html (بدون window.)
  if(typeof D==='undefined'||!D||!Array.isArray(D.emp))return false;
  let added=0;
  for(const p of PLACEHOLDERS){
    const exists=D.emp.some(e=>norm(e&&e.name)===norm(p.name));
    if(exists)continue;
    D.emp.push({
      id:genId(),name:p.name,nid:'',nat:'',role:p.role,no:'',tel:'',
      hire:'',lic:'',licE:'',cash:'',act:true,
      placeholder:true,
      createdAt:new Date().toISOString()
    });
    added++;
  }
  if(added){
    if(typeof save!=='function')throw new Error('دالة حفظ الموظفين غير متاحة');
    save();
    if(typeof rAll==='function')rAll();
    console.info('[BinHamid]',VERSION,'added',added,'placeholder sales rep(s)');
  }
  return true;
}
let tries=0;
const timer=setInterval(()=>{
  tries++;
  try{
    if(ensure()){clearInterval(timer);return;}
    if(tries>20){clearInterval(timer);notifyFailure(new Error('لم يكتمل تحميل سجل الموظفين خلال المهلة التشغيلية'));}
  }catch(error){clearInterval(timer);notifyFailure(error);}
},300);
console.info('[BinHamid]',VERSION,'loaded');
})();
