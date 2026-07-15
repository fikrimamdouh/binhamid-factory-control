import { spawnSync } from 'node:child_process';

const files=[
  'assets/cloud-control.js',
  'api/telegram/webhook-v3.js',
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
