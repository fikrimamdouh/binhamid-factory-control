import assert from 'node:assert/strict';
import test from 'node:test';
import { errorResponse } from '../api/_lib/http.js';

function responseCapture(){
  const headers={};
  return{
    statusCode:0,
    setHeader(name,value){headers[name]=value;},
    end(value){this.body=String(value);},
    headers,
    body:''
  };
}

function withoutConsoleError(run){
  const original=console.error;
  console.error=()=>{};
  try{return run();}finally{console.error=original;}
}

test('safe classified daily report 5xx errors keep their actionable message',()=>{
  const res=responseCapture();
  const error=Object.assign(new Error('تعذر حفظ النسخة الأصلية من ملف Excel في السحابة. لم يعتمد التقرير ولم تُرحّل أي حركة.'),{
    status:503,
    code:'DAILY_REPORT_STORAGE_FAILED'
  });
  withoutConsoleError(()=>errorResponse(res,error));
  const payload=JSON.parse(res.body);
  assert.equal(res.statusCode,503);
  assert.equal(payload.code,'DAILY_REPORT_STORAGE_FAILED');
  assert.equal(payload.error,error.message);
});

test('unclassified server errors remain masked',()=>{
  const res=responseCapture();
  const error=Object.assign(new Error('private infrastructure detail'),{status:503,code:'UPSTREAM_PRIVATE_FAILURE'});
  withoutConsoleError(()=>errorResponse(res,error));
  const payload=JSON.parse(res.body);
  assert.equal(res.statusCode,503);
  assert.equal(payload.error,'تعذر تنفيذ العملية على الخادم');
  assert.equal(payload.code,'UPSTREAM_PRIVATE_FAILURE');
});
