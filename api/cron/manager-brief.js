import { json, method } from '../_lib/http.js';
import { sendManagerBrief } from '../_lib/bot-notifications.js';
function authorized(req){const expected=String(process.env.CRON_SECRET||'').trim();if(!expected)return true;return String(req.headers.authorization||'')===`Bearer ${expected}`;}
export default async function handler(req,res){
  if(!method(req,res,['GET','POST']))return;
  if(!authorized(req))return json(res,401,{ok:false,error:'unauthorized'});
  try{const result=await sendManagerBrief();json(res,200,{ok:true,...result});}catch(error){console.error('[manager brief]',error);json(res,500,{ok:false,error:error.message});}
}
