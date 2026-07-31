const endpoint=String(process.env.BINHAMID_WEEKLY_REPORT_URL||'https://binhamid-factory-control.vercel.app/api/router?route=weekly-report/send').trim();
const audience='binhamid-weekly-executive-report';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function required(value,name){if(!value)throw new Error(`Missing required environment variable: ${name}`);return value;}
async function oidcToken(){
  const url=new URL(required(process.env.ACTIONS_ID_TOKEN_REQUEST_URL,'ACTIONS_ID_TOKEN_REQUEST_URL'));
  url.searchParams.set('audience',audience);
  const response=await fetch(url,{headers:{Authorization:`Bearer ${required(process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,'ACTIONS_ID_TOKEN_REQUEST_TOKEN')}`}});
  if(!response.ok)throw new Error(`GitHub OIDC token request failed: ${response.status}`);
  const data=await response.json();
  return required(data.value,'GitHub OIDC token value');
}

let lastError='';
for(let attempt=1;attempt<=36;attempt++){
  try{
    const token=await oidcToken();
    const response=await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({source:'github-actions',force:true})});
    const text=await response.text();let data;try{data=text?JSON.parse(text):{};}catch{data={raw:text};}
    if(response.ok&&data?.ok){console.log(JSON.stringify(data,null,2));process.exit(0);}
    lastError=`HTTP ${response.status}: ${String(data?.error||data?.message||text).slice(0,500)}`;
    const deployPending=response.status===404||response.status===502||response.status===503||/API route not found|DEPLOYMENT_NOT_FOUND|FUNCTION_INVOCATION_FAILED/i.test(lastError);
    if(!deployPending)throw new Error(lastError);
  }catch(error){lastError=String(error?.message||error);}
  console.log(`[weekly-report] attempt ${attempt}/36 pending: ${lastError}`);
  if(attempt<36)await wait(10000);
}
throw new Error(`Weekly executive report was not delivered: ${lastError}`);
