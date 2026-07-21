from pathlib import Path
import subprocess
import re

ORIGINAL = 'ec743ddabe5089bed8cfda928e5b61a29fb43c56'
VERSION = '2026-07-14-original-plus-portfolio-v1'
SALES_EMPLOYEE_VERSION = '2026-07-21-sales-responsibles-v1'
PARAGRAPH_1 = 'ألتزم بمتابعة المبالغ غير المسددة خلال مهلة {الأيام} أيام من تاريخ التوريد، ورفع حالة المتأخرات للإدارة.'
PARAGRAPH_2 = 'ألتزم بأن مهلة السداد المحددة أعلاه ({الأيام} أيام) نافذة فقط في حال توفر السيولة الكافية لدى المنشأة لشراء المواد الخام التشغيلية؛ وفي حال عدم توفر هذه السيولة، ألتزم أنا (المحصل أو مسؤول مبيعات الخرسانة) بتحصيل دفعة مقدمة من العميل قبل التوريد، أو بتحصيل كامل قيمة الحساب فورًا، ولا يجوز الاعتداد بمهلة السداد المذكورة في هذه الحالة إلا بموافقة كتابية مسبقة من الإدارة.'
ADDED_CLAUSE = PARAGRAPH_1 + r'\u2028' + PARAGRAPH_2


def git_show(path: str) -> str:
    return subprocess.check_output(['git', 'show', f'{ORIGINAL}:{path}'], text=True, encoding='utf-8')


def object_block(text: str, marker: str = 'const DEF ='):
    start = text.index(marker)
    brace = text.index('{', start)
    depth = 0
    quote = None
    escape = False
    for i in range(brace, len(text)):
        ch = text[i]
        if quote:
            if escape:
                escape = False
            elif ch == '\\':
                escape = True
            elif ch == quote:
                quote = None
            continue
        if ch in ('"', "'", '`'):
            quote = ch
            continue
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                end = i + 1
                while end < len(text) and text[end] in ' \t;\r\n':
                    end += 1
                return start, end, text[start:end]
    raise RuntimeError('Unclosed DEF object')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one marker, found {count}')
    return text.replace(old, new, 1)


legacy_path = Path('legacy.html')
current = legacy_path.read_text(encoding='utf-8')
original = git_show('legacy.html')
_, _, original_def = object_block(original)
cli = re.search(r'(\bcli:`)(.*?)(`,\s*\n\s*cliX:)', original_def, re.S)
if not cli:
    raise RuntimeError('Original customer portfolio text was not found')
original_cli = cli.group(2).rstrip()
restored_def = original_def[:cli.start(2)] + original_cli + '\n' + ADDED_CLAUSE + original_def[cli.end(2):]
cur_start, cur_end, _ = object_block(current)
current = current[:cur_start] + restored_def + current[cur_end:]

version_line = f"const DECLARATION_TEXT_VERSION = '{VERSION}';"
if version_line not in current:
    insert_at = cur_start + len(restored_def)
    current = current[:insert_at] + '\n' + version_line + '\n' + current[insert_at:]

state_marker = '  txt: {...DEF},\n'
if 'declarationTextVersion: DECLARATION_TEXT_VERSION' not in current:
    current = replace_once(current, state_marker, state_marker + '  declarationTextVersion: DECLARATION_TEXT_VERSION,\n', 'declaration version state')

old_load = """      D.txtCustom = p.txtCustom===true;
      D.txt = mergeTxt(p.txt,D.txtCustom);
      D.veh = p.veh||[]; D.emp = p.emp||[]; D.cli = p.cli||[]; D.seq = p.seq||1;"""
new_load = """      const mustRestoreDeclarationTexts = p.declarationTextVersion !== DECLARATION_TEXT_VERSION;
      D.txtCustom = mustRestoreDeclarationTexts ? false : p.txtCustom===true;
      D.txt = mustRestoreDeclarationTexts ? {...DEF} : mergeTxt(p.txt,D.txtCustom);
      D.declarationTextVersion = DECLARATION_TEXT_VERSION;
      D.veh = p.veh||[]; D.emp = p.emp||[]; D.cli = p.cli||[]; D.seq = p.seq||1;
      if(mustRestoreDeclarationTexts)localStorage.setItem(K,JSON.stringify(D));"""
if old_load in current:
    current = current.replace(old_load, new_load, 1)
elif new_load not in current:
    raise RuntimeError('State migration block not found')

old_upsert = """function opsUpsertSalesResponsible(kind,data){
  const key=opsSalesResponsibleKey(kind),role=opsSalesResponsibleRole(kind),old=opsSalesResponsible(kind),id=old?.id||`ops-sales-${kind}`;
  const employee={...(old||{}),id,name:String(data.name||'').trim(),nid:String(data.nid||'').trim(),no:String(data.no||'').trim(),tel:String(data.tel||'').trim(),role,act:true,nat:old?.nat||'',hire:old?.hire||'',lic:old?.lic||'',licE:old?.licE||'',cash:old?.cash||''};
  const index=(D.emp||[]).findIndex(x=>x.id===id);if(index>=0)D.emp[index]=employee;else D.emp.push(employee);
  OPS.settings[key]=id;return employee;
}"""
new_upsert = f"""const SALES_EMPLOYEE_DEFAULTS_VERSION='{SALES_EMPLOYEE_VERSION}';
const SALES_EMPLOYEE_DEFAULTS={{
  concrete:{{id:'ops-sales-concrete-khaled-abdullah',name:'خالد عبد الله',nid:'2414111530',salary:5000,commissionPerUnit:1,commissionUnit:'م³ خرسانة'}},
  block:{{id:'ops-sales-block-khaled-mohamed',name:'خالد محمد',nid:'2370328136',salary:3500,commissionPerUnit:0,commissionUnit:''}}
}};
function opsUpsertSalesResponsible(kind,data){{
  const key=opsSalesResponsibleKey(kind),role=opsSalesResponsibleRole(kind),old=opsSalesResponsible(kind),id=old?.id||`ops-sales-${{kind}}`;
  const salary=Number(data.salary??old?.salary??0)||0,commissionPerUnit=Number(data.commissionPerUnit??old?.commissionPerUnit??0)||0;
  const employee={{...(old||{{}}),id,name:String(data.name||'').trim(),nid:String(data.nid||'').trim(),no:String(data.no||'').trim(),tel:String(data.tel||'').trim(),role,act:true,nat:old?.nat||'',hire:old?.hire||'',lic:old?.lic||'',licE:old?.licE||'',cash:old?.cash||'',salary,commissionPerUnit,commissionUnit:String(data.commissionUnit??old?.commissionUnit??'').trim()}};
  const index=(D.emp||[]).findIndex(x=>x.id===id);if(index>=0)D.emp[index]=employee;else D.emp.push(employee);
  OPS.settings[key]=id;return employee;
}}
function opsEnsureConfiguredSalesEmployees(){{
  OPS.settings=OPS.settings||{{}};
  if(OPS.settings.salesEmployeeDefaultsVersion===SALES_EMPLOYEE_DEFAULTS_VERSION)return false;
  D.emp=Array.isArray(D.emp)?D.emp:[];
  for(const kind of ['concrete','block']){{
    const def=SALES_EMPLOYEE_DEFAULTS[kind],key=opsSalesResponsibleKey(kind),role=opsSalesResponsibleRole(kind);
    let index=D.emp.findIndex(x=>String(x?.nid||'').trim()===def.nid);
    if(index<0)index=D.emp.findIndex(x=>String(x?.name||'').trim()===def.name);
    if(index<0)index=D.emp.findIndex(x=>x?.id===def.id);
    const old=index>=0?D.emp[index]:null;
    const employee={{...(old||{{}}),id:old?.id||def.id,name:def.name,nid:def.nid,role,act:true,nat:old?.nat||'',no:old?.no||'',tel:old?.tel||'',hire:old?.hire||'',lic:old?.lic||'',licE:old?.licE||'',cash:old?.cash||'',salary:def.salary,commissionPerUnit:def.commissionPerUnit,commissionUnit:def.commissionUnit}};
    if(index>=0)D.emp[index]=employee;else D.emp.push(employee);
    OPS.settings[key]=employee.id;
  }}
  OPS.settings.salesEmployeeDefaultsVersion=SALES_EMPLOYEE_DEFAULTS_VERSION;
  return true;
}}"""
current = replace_once(current, old_upsert, new_upsert, 'sales employee functions')

old_boot = """  if(D?.cfg?.name) OPS.settings.companyName=D.cfg.name;
  opsAudit('تشغيل مركز الرقابة');"""
new_boot = """  if(D?.cfg?.name) OPS.settings.companyName=D.cfg.name;
  const salesEmployeeDefaultsApplied=opsEnsureConfiguredSalesEmployees();
  if(salesEmployeeDefaultsApplied)save();
  opsAudit('تشغيل مركز الرقابة');"""
current = replace_once(current, old_boot, new_boot, 'OPS boot migration')

concrete_tel = """<div class=\"full\"><label>رقم الجوال</label><input id=\"opsConcreteTel\" value=\"${opsEsc(concrete.tel||'')}\" dir=\"ltr\"></div></div></div><div class=\"ops-card ops-col-6\"><h3>مسؤول مبيعات البلوك</h3>"""
concrete_pay = """<div class=\"full\"><label>رقم الجوال</label><input id=\"opsConcreteTel\" value=\"${opsEsc(concrete.tel||'')}\" dir=\"ltr\"></div><div><label>إجمالي الراتب الشهري (ر.س)</label><input type=\"number\" id=\"opsConcreteSalary\" min=\"0\" step=\"0.01\" value=\"${Number(concrete.salary||0)}\"></div><div><label>العمولة لكل متر خرسانة (ر.س)</label><input type=\"number\" id=\"opsConcreteCommission\" min=\"0\" step=\"0.01\" value=\"${Number(concrete.commissionPerUnit||0)}\"></div></div></div><div class=\"ops-card ops-col-6\"><h3>مسؤول مبيعات البلوك</h3>"""
current = replace_once(current, concrete_tel, concrete_pay, 'concrete salary settings')

block_tel = """<div class=\"full\"><label>رقم الجوال</label><input id=\"opsBlockTel\" value=\"${opsEsc(block.tel||'')}\" dir=\"ltr\"></div></div></div></div><button class=\"ops-btn primary\" style=\"margin-top:10px\" onclick=\"opsSaveSalesEmployees()\">حفظ مسؤولي المبيعات</button>"""
block_pay = """<div class=\"full\"><label>رقم الجوال</label><input id=\"opsBlockTel\" value=\"${opsEsc(block.tel||'')}\" dir=\"ltr\"></div><div><label>إجمالي الراتب الشهري (ر.س)</label><input type=\"number\" id=\"opsBlockSalary\" min=\"0\" step=\"0.01\" value=\"${Number(block.salary||0)}\"></div><div><label>العمولة</label><input value=\"بدون عمولة\" readonly></div></div></div></div><button class=\"ops-btn primary\" style=\"margin-top:10px\" onclick=\"opsSaveSalesEmployees()\">حفظ مسؤولي المبيعات</button>"""
current = replace_once(current, block_tel, block_pay, 'block salary settings')

old_save_sales = """  const concrete={name:opsEl('opsConcreteName').value,nid:opsEl('opsConcreteNid').value,no:opsEl('opsConcreteNo').value,tel:opsEl('opsConcreteTel').value},block={name:opsEl('opsBlockName').value,nid:opsEl('opsBlockNid').value,no:opsEl('opsBlockNo').value,tel:opsEl('opsBlockTel').value};"""
new_save_sales = """  const concrete={name:opsEl('opsConcreteName').value,nid:opsEl('opsConcreteNid').value,no:opsEl('opsConcreteNo').value,tel:opsEl('opsConcreteTel').value,salary:Number(opsEl('opsConcreteSalary').value||0),commissionPerUnit:Number(opsEl('opsConcreteCommission').value||0),commissionUnit:'م³ خرسانة'},block={name:opsEl('opsBlockName').value,nid:opsEl('opsBlockNid').value,no:opsEl('opsBlockNo').value,tel:opsEl('opsBlockTel').value,salary:Number(opsEl('opsBlockSalary').value||0),commissionPerUnit:0,commissionUnit:''};"""
current = replace_once(current, old_save_sales, new_save_sales, 'sales employee save data')
legacy_path.write_text(current, encoding='utf-8')

server_path = Path('api/_lib/customer-portfolio-pdf.js')
server = server_path.read_text(encoding='utf-8')
canonical = 'const CUSTOMER_PORTFOLIO_DECLARATION = `' + original_cli + '\n' + ADDED_CLAUSE + '`;'
role_line = "const ROLE_BY_TYPE={block:'مسؤول مبيعات البلوك',concrete:'مسؤول مبيعات الخرسانة'};"
if 'const CUSTOMER_PORTFOLIO_DECLARATION =' not in server:
    server = replace_once(server, role_line, role_line + '\n' + canonical, 'server declaration')
server = server.replace("declarationText:legacy?.txt?.cli||'',", 'declarationText:CUSTOMER_PORTFOLIO_DECLARATION,')
server_path.write_text(server, encoding='utf-8')

verification = f"""import fs from 'node:fs';
const legacy=fs.readFileSync('legacy.html','utf8');
const server=fs.readFileSync('api/_lib/customer-portfolio-pdf.js','utf8');
const required=[
'أُقر بأنني استلمت المركبة/المعدة الموصوفة أعلاه بحالة فنية سليمة',
'أُقر بأن العملاء المدرجين في هذا النموذج مُسندون إليّ',
'يقر المندوب بمسؤوليته الكاملة عن العملاء المُسندين إليه',
'أُقر باستلامي العهدة النقدية الموضحة أعلاه',
'أُقر بأنني المسؤول المباشر والفني عن تشغيل محطة الخلط',
'يُقر مشرف المحطة بمسؤوليته الفنية الكاملة عن جودة الخلطات',
'أُقر باستلامي عهدة الورشة من عُدد وأجهزة قياس ومعدات',
'وبناءً عليه، أُقر أنا الموقّع أدناه بأنني قرأت هذا النموذج',
'حُرِّرت هذه الوثيقة من نسختين أصليتين',
"const DECLARATION_TEXT_VERSION = '{VERSION}';",
"const SALES_EMPLOYEE_DEFAULTS_VERSION='{SALES_EMPLOYEE_VERSION}';",
"name:'خالد عبد الله',nid:'2414111530',salary:5000,commissionPerUnit:1",
"name:'خالد محمد',nid:'2370328136',salary:3500,commissionPerUnit:0",
'id=\"opsConcreteSalary\"','id=\"opsConcreteCommission\"','id=\"opsBlockSalary\"'];
for(const text of required){{if(!legacy.includes(text))throw new Error('Missing required text: '+text);}}
const added1={PARAGRAPH_1!r},added2={PARAGRAPH_2!r};
const count=(text,needle)=>text.split(needle).length-1;
if(count(legacy,added1)!==1||count(legacy,added2)!==1)throw new Error('Added portfolio clause must exist once');
if(!server.includes('const CUSTOMER_PORTFOLIO_DECLARATION =')||!server.includes(added1)||!server.includes(added2))throw new Error('Server PDF canonical declaration missing');
if(server.includes("declarationText:legacy?.txt?.cli||''"))throw new Error('Server still reads mutable declaration text');
for(const removed of ['ألتزم بإثبات كل توريد باسم العميل الصحيح','يقر المسؤول بأن الرصيد الظاهر لكل عميل ناتج عن التوريدات المسجلة'])if(legacy.includes(removed))throw new Error('Old replacement wording remains: '+removed);
console.log('DECLARATION_AND_SALES_SETTINGS_OK');
"""
Path('scripts/verify-declaration-sales.mjs').write_text(verification, encoding='utf-8')
print('Scoped restoration applied')
