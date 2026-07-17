import { body, errorResponse, json, method } from '../http.js';
import { assertSameOrigin, issueDeviceSession } from '../device-session.js';

export async function deviceSession(req,res){
  if(!method(req,res,['POST']))return;
  try{
    assertSameOrigin(req);
    const input=await body(req,4096),session=issueDeviceSession(req,res,input.deviceId);
    json(res,200,{ok:true,mode:'automatic-device-session',deviceId:session.deviceId,expiresAt:new Date(session.exp*1000).toISOString()});
  }catch(error){errorResponse(res,error);}
}
