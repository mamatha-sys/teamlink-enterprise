// ---------------------------------------------------------------------------
// utils/omniDeptLogins.js against a REAL local Green Start (Omni-Channel) - founder 2026-11-02: one workspace per WhatsApp number's
// department, a login per department that sees only that workspace, Super Admin / Admin see all.
//
// Needs: a THROWAWAY Green Start API on 127.0.0.1:$GREENSTART_API_PORT (never the PC's own 4020 or live) with TEAMLINK_SSO_SECRET =
// $GREENSTART_SSO_SECRET and a company account ($GREENSTART_SSO_EMAIL) on a plan with several workspaces; and a throwaway copy of
// TeamLink's database (TL_TEST_DB). The copy's WhatsApp numbers get ONE department each (as an Admin would set them).
// Email / SMS / WhatsApp are NOT pushed (pushChannels: false): Green Start would test them against real mail / Meta servers.
//   TL_API=http://localhost:4012 TL_TEST_DB=sandbox-dept.db GREENSTART_API_PORT=4031 GREENSTART_SSO_SECRET=... GREENSTART_SSO_EMAIL=...
//   node scripts/omni-dept-logins-test.js
// ---------------------------------------------------------------------------
const Z = require('./lib/zzfix')('OMNIDEPT');

const PORT = Number(process.env.GREENSTART_API_PORT);
if (!PORT || PORT === 4020) { console.error('Refusing: set GREENSTART_API_PORT to a throwaway Green Start (not 4020).'); process.exit(2); }
const GS = `http://127.0.0.1:${PORT}/api/v1`;
const COMPANY = String(process.env.GREENSTART_SSO_EMAIL || '').toLowerCase();
const gs = async (m, p, { token, ws, body } = {}) => {
  const r = await fetch(GS + p, { method: m, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(ws ? { 'x-workspace-id': ws } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; }
  if (!r.ok) throw new Error(`${m} ${p} ${r.status} ${t.slice(0, 200)}`);
  return d.data ?? d;
};
const list = (x) => (Array.isArray(x) ? x : (x && x.items) || []);

(async () => {
  const { prisma } = Z;
  const SSO = require('../src/utils/greenStartSso');
  const D = require('../src/utils/omniDeptLogins');
  const A = require('../src/outreach/access');
  try {
    await Z.preclean();
    // the copy: the company account, nothing remembered, each number ONE department
    await prisma.appSetting.deleteMany({ where: { key: { in: ['omni.gs.ssoEmail', 'omni.gs.waMap', D.KEY, 'omni.gs.integrationSync'] } } });
    await prisma.appSetting.create({ data: { key: 'omni.gs.ssoEmail', value: JSON.stringify(COMPANY) } });
    const nums = await prisma.$queryRawUnsafe('SELECT id, label FROM "WaNumber" WHERE "removedAt" IS NULL ORDER BY "createdAt"');
    if (nums.length < 3) throw new Error('the copy needs 3 WhatsApp numbers');
    const DEPTS = ['Medical', 'Education', 'Manufacturing'];
    await prisma.$executeRawUnsafe('DELETE FROM "WaNumberAccess"');
    for (const [i, n] of nums.slice(0, 3).entries()) {
      // eslint-disable-next-line no-await-in-loop
      await prisma.$executeRawUnsafe('INSERT INTO "WaNumberAccess" ("id","numberId","kind","refId","refLabel","grantedAt") VALUES (?,?,?,?,?,?)', `zz_acc_${i}`, n.id, 'DEPARTMENT', DEPTS[i], DEPTS[i], new Date().toISOString());
    }
    require('../src/utils/waNumbers').bust && require('../src/utils/waNumbers').bust(); // eslint-disable-line global-require

    // 1. the run: three department workspaces, three logins
    const r1 = await D.run({ why: 'test', pushChannels: false });
    const rows = r1.departments.filter((x) => x.state === 'ready');
    Z.check('T1 each number\'s department gets its workspace ("Teamlink <Department>") and its own login, all ready',
      r1.ok && rows.length === 3 && DEPTS.every((d) => rows.some((x) => x.dept === d && x.workspace === `Teamlink ${d}`)) && rows.every((x) => x.email === D.emailFor(x.dept, COMPANY)), r1);
    const map = JSON.parse((await prisma.appSetting.findUnique({ where: { key: 'omni.gs.waMap' } })).value);
    Z.check('T2 the numbers -> workspaces map (read by the integrations sync) holds each number\'s department workspace, marked automatic',
      nums.slice(0, 3).every((n, i) => map[n.id] && map[n.id].auto && map[n.id].dept === DEPTS[i] && map[n.id].workspaceId === rows.find((x) => x.dept === DEPTS[i]).workspaceId), map);

    // 2. in Omni-Channel: each department login sees ONLY its workspace, as Team Leader; the company account sees all
    const seen = {};
    for (const d of DEPTS) {
      const email = D.emailFor(d, COMPANY);
      // eslint-disable-next-line no-await-in-loop
      const l = await gs('POST', '/auth/teamlink', { body: { ticket: SSO.greenStartTicket({ email, name: d }) } });
      // eslint-disable-next-line no-await-in-loop
      seen[d] = list(await gs('GET', '/workspaces', { token: l.accessToken })).map((w) => w.name);
    }
    Z.check('T3 a department login sees only its own workspace', DEPTS.every((d) => JSON.stringify(seen[d]) === JSON.stringify([`Teamlink ${d}`])), seen);
    const cl = await gs('POST', '/auth/teamlink', { body: { ticket: SSO.greenStartTicket({ email: COMPANY, name: 'TeamLink' }) } });
    const cws = list(await gs('GET', '/workspaces', { token: cl.accessToken }));
    Z.check('T4 the company account sees every department workspace', DEPTS.every((d) => cws.some((w) => w.name === `Teamlink ${d}`)), cws.map((w) => w.name));
    const edu = cws.find((w) => w.name === 'Teamlink Education');
    const mem = list(await gs('GET', '/team/members?pageSize=100', { token: cl.accessToken, ws: edu.id }));
    const eduLogin = mem.find((m) => (m.user && m.user.email) === D.emailFor('Education', COMPANY));
    Z.check('T5 the department login has the Team Leader role (campaigns, replies, templates; no integrations or billing)', eduLogin && eduLogin.role.key === 'team_leader', eduLogin && eduLogin.role);

    // 3. again: nothing new, nothing doubled
    const before = cws.length;
    const r2 = await D.run({ why: 'test again', pushChannels: false });
    const after = list(await gs('GET', '/workspaces', { token: cl.accessToken })).length;
    Z.check('T6 running again makes nothing new (same workspaces, same logins, all ready)', r2.ok && after === before && r2.departments.filter((x) => x.state === 'ready').length === 3, [before, after, r2.words]);

    // 4. who opens what (the /sso-ticket choice)
    const admin = await Z.mkUser('adm', { role: 'SUPER_ADMIN', atsRole: 'SUPER_ADMIN', hrmsRole: 'SUPER_ADMIN', accountsRole: 'SUPER_ADMIN', atsAccess: true, hrmsAccess: true });
    const tlMed = await Z.mkUser('tlmed', { role: 'EMPLOYEE', atsRole: 'TL', atsDepartment: 'Medical', atsScopeDepartments: 'Medical', atsAccess: true }, { designation: 'Team Lead' });
    const tlHr = await Z.mkUser('tlhr', { role: 'EMPLOYEE', atsRole: 'TL', atsDepartment: 'HR', atsScopeDepartments: 'HR', atsAccess: true }, { designation: 'Team Lead' });
    const fresh = async (u) => prisma.user.findUnique({ where: { id: u.id } });
    const a = await D.loginFor(await fresh(admin));
    const m = await D.loginFor(await fresh(tlMed));
    const h = await D.loginFor(await fresh(tlHr));
    Z.check('T7 Super Admin / Admin open the company account (every department)', A.isAdmin(await fresh(admin)) && a.email === COMPANY && a.all, a);
    Z.check('T8 a Medical Team Lead opens the Medical login (only Medical\'s number and replies)', m.email === D.emailFor('Medical', COMPANY) && m.dept === 'Medical', m);
    Z.check('T9 a department with no number gets no Omni-Channel, with the reason (never the company account)', h.blocked && /HR/.test(h.reason) && !h.email, h);

    // 5. a number given to several departments is not guessed
    await prisma.$executeRawUnsafe('INSERT INTO "WaNumberAccess" ("id","numberId","kind","refId","refLabel","grantedAt") VALUES (?,?,?,?,?,?)', 'zz_acc_x', nums[2].id, 'DEPARTMENT', 'BDE', 'BDE', new Date().toISOString());
    require('../src/utils/waNumbers').bust && require('../src/utils/waNumbers').bust(); // eslint-disable-line global-require
    const r3 = await D.run({ why: 'test several', pushChannels: false });
    const note = r3.departments.find((x) => x.number === nums[2].label && /ONE department/.test(x.words || ''));
    const map3 = JSON.parse((await prisma.appSetting.findUnique({ where: { key: 'omni.gs.waMap' } })).value);
    Z.check('T10 a number given to several departments: said plainly, not placed', note && !map3[nums[2].id], [note, map3[nums[2].id]]);
    const last = await D.last();
    Z.check('T11 no password or token is stored with the department logins', !/accessToken|password|secret|ticket/i.test(JSON.stringify(last)));
  } catch (e) { Z.fail += 1; console.log('FAIL  crashed', e && e.stack ? e.stack.slice(0, 900) : e); } finally {
    await prisma.appSetting.deleteMany({ where: { key: { in: ['omni.gs.waMap', D.KEY, 'omni.gs.integrationSync'] } } }).catch(() => {});
    const left = await Z.cleanup().catch(() => null);
    Z.check('Z1 every ZZTEST row is gone', left && Object.values(left).every((v) => v === 0), left);
    console.log(`\n${Z.pass} passed, ${Z.fail} failed`);
    await prisma.$disconnect();
    process.exit(Z.fail ? 1 : 0);
  }
})();
