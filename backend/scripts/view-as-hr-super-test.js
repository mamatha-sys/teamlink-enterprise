#!/usr/bin/env node
/**
 * View as on a login of the Internal HR list (founder 2026-11-06: Purna's View as ended at once). SANDBOX ONLY: a COPY of the sandbox database, in this process.
 *   node scripts/view-as-hr-super-test.js
 */
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const SOURCE = process.env.TEST_SOURCE_DB || path.resolve(__dirname, '..', 'prisma', 'sandbox.db');
const COPY = path.join(os.tmpdir(), `zz-va-${process.pid}.db`).split(path.sep).join('/');
const src = new DatabaseSync(SOURCE, { readOnly: true });
src.exec(`VACUUM INTO '${COPY}'`);
src.close();
Object.assign(process.env, { TEAMLINK_SANDBOX: '1', TEST_MODE: '1', DATABASE_URL: `file:${COPY}` });
const prisma = require('../src/db');
const { resolveIdentity } = require('../src/utils/identity');
const va = require('../src/utils/viewAs');
const actAs = require('../src/utils/actAs');

let failed = 0; let total = 0;
const check = (name, ok, extra) => { total += 1; if (ok) console.log(`  ok  ${name}`); else { failed += 1; console.log(`FAIL  ${name}\n      ${JSON.stringify(extra)}`); } };

(async () => {
  const boss = (await prisma.user.findMany({ where: { role: 'SUPER_ADMIN', status: 'Active' } })).find((u) => !/zz/i.test(u.name));
  const purna = await prisma.user.findFirst({ where: { name: { contains: 'Purna' } } });
  const other = (await prisma.user.findMany({ where: { role: 'SUPER_ADMIN', status: 'Active', NOT: { id: boss.id } } })).find((u) => !/zz/i.test(u.name));
  const session = (target) => {
    const sid = va.newSid(); va.markLive(sid);
    return { viewAs: { byUserId: boss.id, byName: boss.name, readOnly: true, sid }, target };
  };
  const identity = await resolveIdentity(purna.id, purna);
  check('(an Internal HR login resolves as a Super Admin)', identity.role === 'SUPER_ADMIN' && !!identity.hrSuper, identity.role);
  check('View as stays open on them', (await va.checkSession(session(purna), identity)) === null);
  const real = await resolveIdentity(other.id, other);
  const out = await va.checkSession(session(other), real);
  check('a real Super Admin login is still never viewed as', !!out && out.status === 401, out);
  check('Act as, which makes real changes, stays refused on them', !!actAs.refusalFor(identity, purna));
  console.log(failed ? `\n${failed} of ${total} checks FAILED` : `\nAll ${total} checks passed`);
  await prisma.$disconnect().catch(() => {});
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
