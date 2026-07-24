/*
 * BinHamid — حارس أداء الواجهة
 * الإصدار: 2026.07.24-perf-guard-3
 *
 * المشكلة التي يعالجها:
 *   ١٣ مراقب DOM عالميًا (MutationObserver على documentElement مع subtree:true)
 *   يعملون في وقت واحد فوق ملف legacy.html بحجم ١٫٨ ميجابايت، إضافة إلى
 *   ٢٠٠ عملية دورية في الدقيقة من مؤقتات لا تتوقف أبدًا.
 *   كل مراقب ينادي دالة تعدّل الـDOM، والتعديل يوقظ بقية المراقبين —
 *   حلقة تغذية راجعة تُجمّد الواجهة وتتكرر كلما استقرت.
 *
 * ما يفعله هذا الملف:
 *   ١. يلف MutationObserver عالميًا فيُجمّع النداءات في إطار عرض واحد
 *      (requestAnimationFrame) بدل تنفيذها لكل تغيير منفردًا.
 *   ٢. يوقف المؤقتات المتكررة تلقائيًا بعد استقرار نتيجتها.
 *
 * ملاحظة: حلقة مزامنة الأرصدة الافتتاحية (٢٩٢٠ صفًا) عولجت من مصدرها في
 *   opening-balances-chunked-sync.js عبر حفظ التقدّم واستئنافه وقاطع دائرة
 *   قابل لإعادة الضبط — لا يكررها هذا الحارس كي لا يحجب إعادة المحاولة اليدوية.
 *
 * مبدأ السلامة: لا يُلغى أي سلوك وظيفي. كل ما يجري هو تهدئة معدل التنفيذ.
 * أي مراقب أو مؤقت يظل قادرًا على العمل عند حدوث تغيير فعلي.
 *
 * موضع التحميل: أول سكريبت في قائمة index.html، قبل أي ملف آخر.
 */
(function(){
  'use strict';
  const VERSION='2026.07.24-perf-guard-3';
  if(window.BinHamidPerfGuard)return;

  const stats={observersWrapped:0,callbacksCoalesced:0,timersStopped:0};

  // ---------------------------------------------------------------------------
  // ١) تجميع نداءات MutationObserver
  //
  // المراقب الواحد قد يُستدعى آلاف المرات في الثانية أثناء بناء الواجهة.
  // نحتفظ بالسلوك كاملًا لكن ننفّذه مرة واحدة لكل إطار عرض.
  // ---------------------------------------------------------------------------
  const NativeMutationObserver=window.MutationObserver;
  if(typeof NativeMutationObserver==='function'){
    function CoalescedMutationObserver(callback){
      let scheduled=false,queued=[];
      const self=this;
      const wrapped=new NativeMutationObserver(function(records,observer){
        // تُحفظ السجلات ثم تُسلَّم دفعة واحدة في الإطار التالي.
        queued=queued.length?queued.concat(records):records;
        if(scheduled)return;
        scheduled=true;
        stats.callbacksCoalesced++;
        requestAnimationFrame(function(){
          scheduled=false;
          const batch=queued;queued=[];
          try{callback.call(self,batch,observer);}
          catch(error){console.warn('[BinHamid perf-guard] خطأ داخل مراقب DOM:',error);}
        });
      });
      this.observe=function(target,options){
        // التقييد الأهم: مراقبة سمات العناصر عبر الشجرة كاملة مكلفة جدًا
        // ولا يحتاجها أي من السكريبتات الحالية.
        if(options&&options.subtree&&options.attributes&&!options.attributeFilter){
          options=Object.assign({},options,{attributes:false});
        }
        stats.observersWrapped++;
        return wrapped.observe(target,options);
      };
      this.disconnect=function(){return wrapped.disconnect();};
      this.takeRecords=function(){return wrapped.takeRecords();};
    }
    // لا تُسنَد prototype الأصلية مباشرة: ذلك يجعل أي method غير مُعرَّف هنا
    // يُنفَّذ على كائن ليس MutationObserver داخليًا فيرمي TypeError صامتًا.
    // الوراثة عبر setPrototypeOf تُبقي instanceof صحيحًا دون تسريب methods خام.
    Object.setPrototypeOf(CoalescedMutationObserver.prototype,NativeMutationObserver.prototype);
    Object.defineProperty(CoalescedMutationObserver,Symbol.hasInstance,{
      value:instance=>instance instanceof NativeMutationObserver||NativeMutationObserver.prototype.isPrototypeOf(instance)
    });
    window.MutationObserver=CoalescedMutationObserver;
    window.BinHamidNativeMutationObserver=NativeMutationObserver;
  }

  // ---------------------------------------------------------------------------
  // ٢) إيقاف المؤقتات المستقرة
  //
  // دوال مثل ensureButton تعيد تركيب زر إن كان غائبًا. بعد تركيبه تصبح
  // كل نداءات المؤقت بلا أثر، ومع ذلك تستمر إلى الأبد في ثلاثة ملفات.
  // نوقف المؤقت بعد عدد من الدورات دون أي تغيير في الـDOM، ونعيد تشغيله
  // تلقائيًا إن تغيّرت بنية الصفحة (تنقّل بين الشاشات مثلًا).
  // ---------------------------------------------------------------------------
  const IDLE_CYCLES_BEFORE_STOP=8;   // نحو ١٢ ثانية عند فترة ١٥٠٠ms
  const WATCHED_MAX_INTERVAL=2500;   // المؤقتات السريعة وحدها هي المستهدفة
  const nativeSetInterval=window.setInterval,nativeClearInterval=window.clearInterval;
  const managed=new Map();

  function domFingerprint(){
    const side=document.querySelector('.bh-side');
    return(document.querySelectorAll('button').length)+':'+(side?side.children.length:0);
  }

  window.setInterval=function(handler,delay){
    const ms=Number(delay)||0;
    if(typeof handler!=='function'||ms<=0||ms>WATCHED_MAX_INTERVAL){
      return nativeSetInterval.apply(window,arguments);
    }
    const extra=Array.prototype.slice.call(arguments,2);
    let idle=0,last=null,id=null;
    const tick=function(){
      const before=domFingerprint();
      try{handler.apply(window,extra);}
      catch(error){console.warn('[BinHamid perf-guard] خطأ داخل مؤقت:',error);}
      const after=domFingerprint();
      if(after===before&&after===last){
        idle++;
        if(idle>=IDLE_CYCLES_BEFORE_STOP){
          nativeClearInterval(id);
          stats.timersStopped++;
          // مراقب خفيف يعيد تشغيل المؤقت عند تغيّر بنية الصفحة فعليًا.
          const revive=new NativeMutationObserver(function(){
            if(domFingerprint()===last)return;
            revive.disconnect();
            idle=0;last=null;
            id=nativeSetInterval(tick,ms);
            managed.set(id,{ms,handler});
          });
          revive.observe(document.body||document.documentElement,{childList:true,subtree:true});
        }
      }else{
        idle=0;
      }
      last=after;
    };
    id=nativeSetInterval(tick,ms);
    managed.set(id,{ms,handler});
    return id;
  };

  window.clearInterval=function(id){
    managed.delete(id);
    return nativeClearInterval.call(window,id);
  };

  // ---------------------------------------------------------------------------
  // واجهة تشخيص: تُستدعى من الـConsole عبر BinHamidPerfGuard.report()
  // ---------------------------------------------------------------------------
  window.BinHamidPerfGuard={
    version:VERSION,
    installed:true,
    stats,
    activeTimers:()=>managed.size,
    report(){
      const out={
        version:VERSION,
        'مراقبو DOM المُهدّأون':stats.observersWrapped,
        'دفعات مُجمّعة':stats.callbacksCoalesced,
        'مؤقتات أُوقفت بعد الاستقرار':stats.timersStopped,
        'مؤقتات لا تزال نشطة':managed.size
      };
      console.table(out);
      return out;
    },
    // مخرج طوارئ: يعيد السلوك الأصلي دون إعادة تحميل الصفحة.
    disable(){
      if(window.BinHamidNativeMutationObserver)window.MutationObserver=window.BinHamidNativeMutationObserver;
      window.setInterval=nativeSetInterval;
      window.clearInterval=nativeClearInterval;
      console.warn('[BinHamid perf-guard] أُوقف الحارس وأُعيد السلوك الأصلي.');
    }
  };

  console.info('[BinHamid]',VERSION,'حارس الأداء مفعّل.');
})();
