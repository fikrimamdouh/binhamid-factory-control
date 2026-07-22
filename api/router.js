import { json } from './_lib/http.js';
import * as admin from './_lib/routes/admin.js';
import * as management from './_lib/routes/management.js';
import * as imports from './_lib/routes/imports.js';
import * as systemRuntime from './_lib/routes/system-runtime.js';
import * as telegramAdmin from './_lib/routes/telegram-admin.js';
import * as managerDashboard from './_lib/routes/manager-dashboard.js';
import * as controlCenter from './_lib/routes/control-center.js';
import * as governance from './_lib/routes/governance.js';
import * as masterData from './_lib/routes/master-data.js';
import * as canonicalMasterData from './_lib/routes/canonical-master-data.js';
import * as deviceSession from './_lib/routes/device-session.js';
import * as costs from './_lib/routes/costs.js';
import * as mixDesigns from './_lib/routes/mix-designs.js';
import * as driverWebApp from './_lib/routes/driver-webapp.js';
import * as resilience from './_lib/routes/resilience.js';
import * as dailyReport from './_lib/routes/daily-report.js';
import * as fifo from './_lib/routes/fifo.js';
import * as accounting from './_lib/routes/accounting.js';
import * as fleetStatus from './_lib/routes/fleet-status.js';
import * as webAuth from './_lib/routes/web-auth.js';
import * as factoryReset from './_lib/routes/factory-reset.js';
import * as telegramMiniApp from './_lib/routes/telegram-mini-app.js';
import * as reportsTelegram from './_lib/routes/reports-telegram.js';
import * as attendanceSafe from './_lib/routes/attendance-safe.js';
import * as botPermissions from './_lib/routes/bot-permissions.js';
import * as employeeManagement from './_lib/routes/employee-management.js';
import * as attendanceSitePresets from './_lib/routes/attendance-site-presets.js';
import * as permanentCleanup from './_lib/routes/permanent-cleanup.js';
import * as costCenterAssignments from './_lib/routes/cost-center-assignments.js';
import { openingBalances } from './_lib/routes/opening-balances.js';

const routes={
  'admin/groups':admin.groups,
  'admin/users':admin.users,
  'dashboard':managerDashboard.dashboard,
  'control-center':controlCenter.controlCenter,
  'governance':governance.governance,
  'master-data':masterData.masterData,
  'canonical-master-data':canonicalMasterData.canonicalMasterData,
  'employee-management':employeeManagement.employeeManagement,
  'attendance-site-presets':attendanceSitePresets.attendanceSitePresets,
  'permanent-cleanup':permanentCleanup.permanentCleanup,
  'cost-center-assignments':costCenterAssignments.costCenterAssignments,
  'device/session':deviceSession.deviceSession,
  'conversations':management.conversations,
  'operations':management.operations,
  'reports':management.reports,
  'documents/verify':management.documentVerification,
  'imports/status':imports.status,
  'daily-report':dailyReport.dailyReport,
  'daily-report/fifo':fifo.fifo,
  'accounting':accounting.accounting,
  'system/database-readiness':systemRuntime.databaseReadiness,
  'system/status':systemRuntime.status,
  'telegram/register':telegramAdmin.register,
  'telegram/status':telegramAdmin.status,
  'telegram/test':telegramAdmin.test,
  'telegram/notify':telegramAdmin.notify,
  'costs':costs.costs,
  'mix-designs':mixDesigns.mixDesigns,
  'driver/webapp':driverWebApp.driverWebApp,
  'resilience':resilience.resilience,
  'fleet/status':fleetStatus.fleetStatus,
  'auth/request':webAuth.requestWebLogin,
  'auth/verify':webAuth.verifyWebLogin,
  'factory-reset':factoryReset.factoryReset,
  'telegram/mini-app':telegramMiniApp.telegramMiniApp,
  'reports/send-telegram':reportsTelegram.sendPrintedReport,
  'attendance-safe':attendanceSafe.attendanceSafe,
  'bot-permissions':botPermissions.botPermissions,
  'opening-balances':openingBalances
};

export default async function handler(req,res){
  const route=String(req.query?.route||'').replace(/^\/+|\/+$/g,'');
  const target=routes[route];
  if(!target)return json(res,404,{ok:false,error:'API route not found'});
  return target(req,res);
}
