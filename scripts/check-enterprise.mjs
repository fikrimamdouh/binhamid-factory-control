import { spawnSync } from 'node:child_process';

const files=[
  'assets/cloud-control.js',
  'assets/cloud-control-navigation-fix.js',
  'assets/attendance-control.js',
  'assets/cloud-conversations.js',
  'assets/cloud-operations.js',
  'assets/cloud-operations-actions.js',
  'assets/cloud-reports.js',
  'api/router.js',
  'api/telegram/webhook-v3.js',
  'api/admin/attendance.js',
  'api/cron/manager-brief.js',
  'api/imports/file.js',
  'api/state.js',
  'api/_lib/telegram-webhook-handler.js',
  'api/_lib/routes/admin.js',
  'api/_lib/routes/management.js',
  'api/_lib/routes/imports.js',
  'api/_lib/routes/system.js',
  'api/_lib/routes/system-runtime.js',
  'api/_lib/routes/telegram-admin.js',
  'api/_lib/telegram.js',
  'api/_lib/telegram-webapp.js',
  'api/_lib/bot-webhook-core.js',
  'api/_lib/bot-commands.js',
  'api/_lib/bot-attendance.js',
  'api/_lib/bot-enterprise.js',
  'api/_lib/bot-enterprise-store.js',
  'api/_lib/bot-enterprise-defs.js',
  'api/_lib/bot-enterprise-forms.js',
  'api/_lib/bot-enterprise-status.js',
  'api/_lib/bot-enterprise-priorities.js',
  'api/_lib/bot-enterprise-search.js',
  'api/_lib/bot-documents.js',
  'api/_lib/bot-gps.js',
  'api/_lib/bot-notifications.js',
  'api/_lib/bot-insights.js',
  'api/_lib/bot-insights-fleet.js',
  'api/_lib/bot-insights-ops.js'
];
for(const file of files){
  const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});
  if(result.status!==0)process.exit(result.status||1);
}
console.log(`Syntax verified for ${files.length} enterprise files.`);
