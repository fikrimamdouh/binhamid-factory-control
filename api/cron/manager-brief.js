import { json, method } from '../_lib/http.js';

function authorized(req){
  const expected=String(process.env.CRON_SECRET||'').trim();
  if(!expected)return{ok:false,status:503,error:'CRON_SECRET غير مضبوط'};
  const supplied=String(req.headers.authorization||'');
  return supplied===`Bearer ${expected}`?{ok:true}:{ok:false,status:401,error:'unauthorized'};
}

export default async function handler(req,res){
  if(!method(req,res,['GET','POST']))return;
  const auth=authorized(req);
  if(!auth.ok)return json(res,auth.status,{ok:false,error:auth.error});
  return json(res,410,{
    ok:false,
    enabled:false,
    onDemandOnly:true,
    error:'الإشعارات والتقارير المجدولة متوقفة؛ البوت يعمل عند الطلب فقط'
  });
}
