import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('mix design endpoint is routed through the shared router and Vercel rewrite',()=>{
  const router=read('api/router.js'),vercel=read('vercel.json');
  assert.match(router,/import \* as mixDesigns/);
  assert.match(router,/'mix-designs':mixDesigns\.mixDesigns/);
  assert.match(vercel,/"source":"\/api\/mix-designs"/);
  assert.match(vercel,/"destination":"\/api\/router\?route=mix-designs"/);
});

test('mix design API maps every operation to an explicit business capability',()=>{
  const source=read('api/_lib/routes/mix-designs.js');
  for(const capability of ['mix_design.view','mix_design.manage','mix_material_prices.manage','mix_design.calculate','mix_design.approve'])assert.match(source,new RegExp(`requireCapability\\(req,'${capability.replace('.','\\.')}'\\)`));
  assert.doesNotMatch(source,/requireAdminOrDevice/);
  assert.match(source,/MIX_DESIGN_VERSION_REQUIRED/);
  assert.match(source,/clone_mix_design_version/);
  assert.match(source,/approve_mix_cost_run/);
});

test('mix design API validates ids numbers enumerations and payload size',()=>{
  const source=read('api/_lib/routes/mix-designs.js');
  assert.match(source,/ID_INVALID/);
  assert.match(source,/NUMBER_INVALID/);
  assert.match(source,/ENUM_INVALID/);
  assert.match(source,/body\(req,1_000_000\)/);
  assert.match(source,/encodeURIComponent/);
  assert.doesNotMatch(source,/ilike\.\$\{/);
});

test('atomic database functions protect approval cloning and invitation decisions',()=>{
  const migration=read('supabase/migrations/020_atomic_mix_invitation_and_sales_basis.sql');
  assert.match(migration,/clone_mix_design_version/);
  assert.match(migration,/approve_mix_cost_run/);
  assert.match(migration,/decide_user_invitation/);
  assert.match(migration,/for update/);
  assert.match(migration,/INVITATION_SELF_APPROVAL_FORBIDDEN/);
  assert.match(migration,/mix_cost_run_approved/);
});

test('sales tax basis fields are additive and non-destructive',()=>{
  const migration=read('supabase/migrations/020_atomic_mix_invitation_and_sales_basis.sql');
  for(const field of ['subtotal_before_vat','discount_amount','return_amount','vat_amount','vat_rate','amount_includes_vat','net_amount_before_vat'])assert.match(migration,new RegExp(`add column if not exists ${field}`));
  assert.doesNotMatch(migration,/\btruncate\b/i);
  assert.doesNotMatch(migration,/\bdrop table\b/i);
});
