import { json } from './_lib/http.js';
import * as admin from './_lib/routes/admin.js';
import * as management from './_lib/routes/management.js';
import * as imports from './_lib/routes/imports.js';
import * as systemRuntime from './_lib/routes/system-runtime.js';
import * as telegramAdmin from './_lib/routes/telegram-admin.js';
import * as stateRuntime from './_lib/routes/state.js';
import attendance from './_lib/attendance.js';
import managerBrief from './_lib/manager-brief.js';
import telegramWebhook from './_lib/webhook-v2.js';

const routes={
  'admin/groups':admin.groups,
  'admin/users':admin.users,
  'admin/attendance':attendance,
  'cron/manager-brief':managerBrief,
  'dashboard':management.dashboard,
  'conversations':management.conversations,
  'operations':management.operations,
  'reports':management.reports,
  'documents/verify':management.documentVerification,
  'imports/status':imports.status,
  'imports/file':imports.file,
  'system/database-readiness':systemRuntime.databaseReadiness,
  'system/status':systemRuntime.status,
  'telegram/register':telegramAdmin.register,
  'telegram/status':telegramAdmin.status,
  'telegram/test':telegramAdmin.test,
  'telegram/webhook':telegramWebhook,
  'telegram/webhook-v2':telegramWebhook,
  'telegram/webhook-v3':telegramWebhook,
  'state':stateRuntime.state
};

export default async function handler(req,res){
  const route=String(req.query?.route||'').replace(/^\/+|\/+$/g,'');
  const target=routes[route];
  if(!target)return json(res,404,{ok:false,error:'API route not found'});
  return target(req,res);
}
