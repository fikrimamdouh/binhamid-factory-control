import { spawnSync } from 'node:child_process';

const files=[
  'assets/cloud-control.js',
  'assets/cloud-control-navigation-fix.js',
  'assets/attendance-control.js',
  'api/telegram/webhook-v2.js',
  'api/telegram/register.js',
  'api/admin/attendance.js',
  'api/admin/users.js',
  'api/cron/manager-brief.js',
  'api/_lib/telegram-webapp.js',
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
