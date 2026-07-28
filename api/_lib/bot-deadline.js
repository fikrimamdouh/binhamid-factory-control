// ميزانية زمنية واحدة لكل استدعاء webhook.
// حد دالة Vercel هو 60 ثانية، وتجاوزه يقتل الطلب فلا يصل للمستخدم شيء —
// وهو ما ظهر فعلًا كـ504 على مسار البوت. كل مرحلة تسأل عن المتبقي بدل أن تفترض.
import { AsyncLocalStorage } from 'node:async_hooks';

const storage=new AsyncLocalStorage();
export const INVOCATION_LIMIT_MS=60000;
export const SAFETY_MARGIN_MS=7000;

export function startInvocation(limitMs=INVOCATION_LIMIT_MS){
  storage.enterWith({deadline:Date.now()+Math.max(10000,limitMs-SAFETY_MARGIN_MS)});
}

export function remainingMs(){
  const store=storage.getStore();
  if(!store)return INVOCATION_LIMIT_MS-SAFETY_MARGIN_MS;
  return Math.max(0,store.deadline-Date.now());
}

// تُرجع ما يمكن إنفاقه على مرحلة مع حجز وقت للمراحل التالية.
export function budgetFor(desiredMs,reserveMs=0){
  const left=remainingMs()-Math.max(0,reserveMs);
  return left<=0?0:Math.min(Math.max(0,desiredMs),left);
}
