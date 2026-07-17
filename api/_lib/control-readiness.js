const number=value=>{const parsed=Number(value||0);return Number.isFinite(parsed)?parsed:0;};
const finding=(code,title,severity,evidence={})=>({code,title,severity,evidence});

export function evaluateControlReadiness(input){
  const {snapshot={},database={},runtime={},environment={},auditRows=[],users=[]}=input||{};
  const findings=[];
  const add=(condition,item)=>{if(condition)findings.push(item);};
  const activeUsers=users.filter(row=>row.active!==false);
  const roles=new Set(activeUsers.map(row=>row.role).filter(Boolean));
  const criticalAlerts=(snapshot.existingAlerts||[]).filter(row=>row.severity==='critical'&&row.status!=='resolved');

  add(!database.ready,finding('DATABASE_NOT_READY','قاعدة البيانات غير مكتملة','blocker',{schemaVersion:database.schemaVersion}));
  add(!environment.ready,finding('RUNTIME_ENVIRONMENT_INCOMPLETE','متغيرات الإنتاج غير مكتملة','blocker',{missingRequired:environment.missingRequired||[]}));
  add(!runtime.cloudConfigured,finding('CLOUD_NOT_CONFIGURED','الحفظ السحابي غير جاهز','blocker'));
  add(!runtime.telegramConfigured,finding('TELEGRAM_NOT_CONFIGURED','Telegram غير جاهز','blocker'));
  add(!snapshot.todayBatch,finding('TODAY_REPORT_MISSING','التقرير اليومي غير معتمد','warning',{day:snapshot.day}));
  add(Math.abs(number(snapshot.reconciliation?.difference))>0.01,finding('SALES_RECONCILIATION_DIFFERENCE','فرق في مطابقة المبيعات','blocker',snapshot.reconciliation||{}));
  add((snapshot.imports?.failed||[]).length>0,finding('FAILED_IMPORTS','ملفات استيراد فاشلة','blocker',{count:(snapshot.imports?.failed||[]).length}));
  add(number(snapshot.collections?.unallocated)>0,finding('UNALLOCATED_COLLECTIONS','تحصيلات غير موزعة','warning',{amount:snapshot.collections?.unallocated}));
  add((snapshot.debtors?.overLimit||[]).length>0,finding('CREDIT_LIMIT_BREACHES','تجاوزات حدود ائتمانية','blocker',{count:(snapshot.debtors?.overLimit||[]).length}));
  add(number(snapshot.fuel?.duplicates)>0,finding('FUEL_DUPLICATES','حركات ديزل مكررة محتملة','warning',{count:snapshot.fuel?.duplicates}));
  add(number(snapshot.fuel?.unassigned)>0,finding('FUEL_UNASSIGNED','حركات ديزل غير مرتبطة بأصل','warning',{count:snapshot.fuel?.unassigned}));
  add((snapshot.cost?.unclassified||[]).length>0,finding('UNCLASSIFIED_COSTS','تكاليف غير مصنفة','blocker',{count:(snapshot.cost?.unclassified||[]).length}));
  add((snapshot.maintenance?.critical||[]).length>0,finding('CRITICAL_MAINTENANCE','أصول متوقفة أو صيانة عاجلة','warning',{count:(snapshot.maintenance?.critical||[]).length}));
  add(snapshot.sync?.staleHours===null||snapshot.sync?.staleHours>12,finding('SYNC_STALE','المزامنة السحابية قديمة','blocker',{staleHours:snapshot.sync?.staleHours??null}));
  add(!snapshot.backup?.lastSuccessful||snapshot.backup?.ageHours===null||snapshot.backup?.ageHours>36,finding('BACKUP_STALE','النسخة الاحتياطية غير حديثة','blocker',{ageHours:snapshot.backup?.ageHours??null}));
  add(number(snapshot.notifications?.failed)>0,finding('NOTIFICATION_FAILURES','تنبيهات فشلت في الوصول','warning',{count:snapshot.notifications?.failed}));
  add(criticalAlerts.length>0,finding('OPEN_CRITICAL_ALERTS','تنبيهات حرجة غير مغلقة','blocker',{count:criticalAlerts.length}));
  add(activeUsers.length<2,finding('INSUFFICIENT_ACTIVE_USERS','فصل المهام غير مكتمل','warning',{activeUsers:activeUsers.length}));
  add(!roles.has('manager')&&!roles.has('admin'),finding('MANAGEMENT_ROLE_MISSING','دور الإدارة غير موجود','blocker',{roles:[...roles]}));
  add(auditRows.length===0,finding('AUDIT_LOG_EMPTY','سجل التدقيق فارغ','blocker'));

  const blockers=findings.filter(row=>row.severity==='blocker');
  const warnings=findings.filter(row=>row.severity==='warning');
  const score=Math.max(0,100-blockers.length*15-warnings.length*5);
  const status=blockers.length?'blocked':warnings.length?'conditional':'ready';
  return{status,score,decision:status==='ready'?'جاهز للتسليم والتشغيل الرقابي':status==='conditional'?'جاهز تشغيليًا مع ملاحظات':'غير جاهز للتسليم النهائي',blockers,warnings,findings,evaluatedAt:new Date().toISOString()};
}
