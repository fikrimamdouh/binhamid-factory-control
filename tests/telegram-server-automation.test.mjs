import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('Telegram Excel posting runs in the server webhook path and keeps validation atomic',async()=>{
  const files=await read('api/_lib/bot-files.js'),daily=await read('api/_lib/routes/daily-report.js'),cloud=await read('assets/cloud-control.js');
  assert.match(files,/commitDailyReportFromTelegram/);assert.match(files,/autoPostingText/);assert.match(files,/affectedBalances/);assert.match(daily,/daily_report_auto_rejected/);assert.match(daily,/commit_daily_report_acceptance/);assert.match(cloud,/Daily financial Excel is posted by the webhook/);
});

test('browser assistance remains enabled without replaying webhook-posted daily accounting',async()=>{
  const cloud=await read('assets/cloud-control.js'),stream=await read('assets/telegram-site-two-way.js');
  const guard=await read('assets/import-review-guard.js');
  assert.match(cloud,/مساعد المتصفح/);assert.match(cloud,/Telegram\. The website remains a complete manual path/);assert.match(cloud,/status==='ready'/);assert.match(stream,/function eligible\(\)\{return false;\}/);assert.match(guard,/dailyWebsiteApproval:true/);assert.doesNotMatch(guard,/الترحيل التلقائي موقوف رقابيًا/);
});

test('dashboard and application shell expose a protected bot activity record',async()=>{
  const dashboard=await read('api/_lib/routes/manager-dashboard.js'),index=await read('index.html'),ui=await read('assets/bot-activity-dashboard.js');
  for(const marker of ['botActivity','topUsers','topActions','recentActions'])assert.match(dashboard,new RegExp(marker));assert.match(index,/bot-activity-dashboard\.js/);for(const marker of ['bhBotActivityTab','/api/dashboard','سجل وتحليلات البوت','topUsers'])assert.match(ui,new RegExp(marker));
});

test('Telegram Mini App validates signed identity and uses the shared router',async()=>{
  const route=await read('api/_lib/routes/telegram-mini-app.js'),router=await read('api/router.js'),config=JSON.parse(await read('vercel.json')),page=await read('telegram-operations.html'),bot=await read('api/_lib/bot-enterprise.js');
  assert.match(route,/validateTelegramWebApp/);assert.match(route,/telegram_mini_customer_updated/);assert.match(route,/telegram_mini_driver_assignment/);assert.match(router,/telegramMiniApp\.telegramMiniApp/);assert.equal(config.rewrites.find(x=>x.source==='/api/telegram/mini-app')?.destination,'/api/router?route=telegram/mini-app');assert.match(page,/failed_imports/);assert.match(bot,/telegram-operations\.html/);
});

test('proactive brief and weekly export are not reachable from the disabled cron endpoint',async()=>{
  const source=await read('api/_lib/bot-notifications.js'),cron=await read('api/cron/manager-brief.js'),operational=await read('.github/workflows/operational-schedule.yml'),telegram=await read('.github/workflows/bot-schedules.yml');
  for(const marker of ['htmlToPdf','sendScheduledManagerBrief','sendWeeklyOperationalExport','weekly-operational-export','Telegram conversation history'])assert.match(source,new RegExp(marker));
  assert.match(cron,/onDemandOnly:true/);assert.match(cron,/enabled:false/);assert.doesNotMatch(cron,/weeklyExport|sendScheduledManagerBrief|sendWeeklyOperationalExport|sendMeaningfulAlerts/);
  for(const workflow of [operational,telegram]){assert.doesNotMatch(workflow,/\bschedule:/);assert.doesNotMatch(workflow,/\bcron:/);assert.doesNotMatch(workflow,/curl --fail/);}
});


test('authorized Telegram daily sender reaches posting only with daily_report.approve',async()=>{
  const [{ capabilityAllowed },{ dailyReportApprovalDecision }]=await Promise.all([import('../api/_lib/permissions.js'),import('../api/_lib/bot-files.js')]);
  const canApprove=capabilityAllowed('accountant','daily_report.approve',[],[]);
  assert.equal(canApprove,true);
  assert.deepEqual(dailyReportApprovalDecision(true,'ready',canApprove),{shouldPost:true,waitingApproval:false});
});

test('unauthorized Telegram daily sender stays pending and approvers are notified',async()=>{
  const [{ capabilityAllowed },{ dailyReportApprovalDecision }]=await Promise.all([import('../api/_lib/permissions.js'),import('../api/_lib/bot-files.js')]);
  assert.equal(capabilityAllowed('block_sales','daily_report.approve',[],[]),false);
  assert.equal(capabilityAllowed('manager','daily_report.approve',[],[{capability:'daily_report.approve',allowed:false}]),false);
  assert.deepEqual(dailyReportApprovalDecision(true,'ready',false),{shouldPost:false,waitingApproval:true});
  const files=await read('api/_lib/bot-files.js');
  assert.match(files,/notifyDailyReportApprovers/);
  assert.match(files,/daily_report_pending_approval/);
  assert.match(files,/بانتظار الاعتماد/);
  assert.match(files,/لم تُرحّل أي مبيعات أو تحصيلات/);
});
