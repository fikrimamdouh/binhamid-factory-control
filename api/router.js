import { json } from './_lib/http.js';
import * as admin from './_lib/routes/admin.js';
import * as management from './_lib/routes/management.js';
import * as imports from './_lib/routes/imports.js';
import * as system from './_lib/routes/system.js';
import * as telegramAdmin from './_lib/routes/telegram-admin.js';

const routes={
  'admin/groups':admin.groups,
  'admin/users':admin.users,
  'dashboard':management.dashboard,
  'conversations':management.conversations,
  'operations':management.operations,
  'reports':management.reports,
  'documents/verify':management.documentVerification,
  'imports/status':imports.status,
  'system/database-readiness':system.databaseReadiness,
  'system/status':system.status,
  'telegram/register':telegramAdmin.register,
  'telegram/status':telegramAdmin.status,
  'telegram/test':telegramAdmin.test
};

export default async function handler(req,res){
  const route=String(req.query?.route||'').replace(/^\/+|\/+$/g,'');
  const target=routes[route];
  if(!target)return json(res,404,{ok:false,error:'API route not found'});
  return target(req,res);
}
