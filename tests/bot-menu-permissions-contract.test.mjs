import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here=dirname(fileURLToPath(import.meta.url));
const read=(...parts)=>fs.readFileSync(join(here,'..',...parts),'utf8');
const policy=read('api','_lib','bot-menu-permissions.js');
const route=read('api','_lib','routes','bot-permissions.js');
const enterprise=read('api','_lib','bot-enterprise.js');
const webhook=read('api','_lib','telegram-webhook-handler.js');
const ui=read('assets','cloud-user-roles.js');
const router=read('api','router.js');
const index=read('index.html');
const review=read('docs','PRODUCTION-STABILITY-REVIEW-2026-07-21.md');

test('bot modules use one catalog and fail-closed per-user capabilities',()=>{
  assert.match(policy,/BOT_MENU_CATALOG=Object\.freeze/);
  assert.match(policy,/BOT_MENU_PREFIX='bot\.menu\.'/);
  assert.match(policy,/requiredSelect\('user_capabilities'/);
  assert.match(policy,/BOT_CAPABILITIES_READ_FAILED/);
  assert.doesNotMatch(policy,/user_capabilities[\s\S]{0,180}\.catch\(\(\)=>\[\]\)/);
  assert.match(policy,/defaultBotModulesForRole/);
  assert.match(policy,/ownerOnly:true/);
  assert.match(policy,/filterBotKeyboard/);
  assert.match(policy,/moduleForCallback/);
  assert.match(policy,/moduleForText/);
  assert.match(policy,/moduleForSession/);
});

test('admin API provides inherit allow deny overrides without a migration',()=>{
  assert.match(route,/requireCapability\(req,'users\.manage'\)/);
  assert.match(route,/botMenuCapability/);
  assert.match(route,/upsert\('user_capabilities'/);
  assert.match(route,/remove\('user_capabilities'/);
  assert.match(route,/bot_menu_permissions_update/);
  assert.match(router,/'bot-permissions':botPermissions\.botPermissions/);
});

test('user modal previews exact icons and supports three-state control',()=>{
  assert.match(ui,/الأيقونات التي ستظهر للمستخدم/);
  assert.match(ui,/>حسب الدور</);
  assert.match(ui,/>إظهار وإتاحة</);
  assert.match(ui,/>إخفاء ومنع</);
  assert.match(ui,/bhBotPreview/);
  assert.match(ui,/data-bot-module/);
  assert.match(ui,/route=bot-permissions/);
  assert.doesNotMatch(ui,/setInterval\s*\(/);
  assert.match(index,/cloud-user-roles\.js\?v=20260721-bot-icons-1/);
});

test('menus and direct enterprise actions share the same policy',()=>{
  assert.match(enterprise,/await filteredMenu\(identity,markup\)/);
  assert.match(enterprise,/sendFilteredMenu/);
  assert.match(enterprise,/denyHiddenModule/);
  assert.match(enterprise,/moduleForCallback\(action,value\)/);
  assert.match(enterprise,/moduleForText\(raw\)/);
  assert.match(enterprise,/هذه الوحدة مخفية وموقوفة لحسابك/);
});

test('gateway blocks built-in commands old callbacks voice and active sessions',()=>{
  assert.match(webhook,/botMenuItem, botModuleAllowed, moduleForCallback, moduleForSession, moduleForText/);
  assert.match(webhook,/active&&await denyBotModule\(chatId,identity,moduleForText\(raw\)\)/);
  assert.ok(webhook.indexOf('active&&await denyBotModule')<webhook.indexOf('const builtIn=await handleBuiltInCommand'), 'permission gate must run before built-in invocation');
  assert.match(webhook,/moduleForSession\(session\?\.state\)/);
  assert.match(webhook,/moduleForCallback\(action,value\)/);
  assert.match(webhook,/result\.text\?handleText/);
  assert.match(webhook,/botMenuItem\(moduleId\)\?\.ownerOnly/);
});

test('registration and help remain available while controlled deep links are mapped',()=>{
  assert.ok(policy.includes("/^\\/start(?:@\\w+)?\\s+attendance$/i.test(raw))return'attendance'"));
  assert.match(policy,/\(menu\|home\|help\|whoami\)/);
  assert.match(policy,/\(reports\|report\)/);
  assert.match(policy,/return'reports'/);
});

test('stability review records permanent invariants and production acceptance',()=>{
  assert.match(review,/لا يعاد PUT بعد 409 دون Merge فعلي/);
  assert.match(review,/لا يضاف `MutationObserver`/);
  assert.match(review,/لا يضاف مستند مطبوع دون تسجيله في Print Registry/);
  assert.match(review,/لا تضاف أيقونة بوت دون Module ID/);
  assert.match(review,/Production Commit SHA/);
});
