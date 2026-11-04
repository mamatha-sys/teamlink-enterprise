#!/usr/bin/env node
// ---------------------------------------------------------------------------
// OMNI-CHANNEL > CAMPAIGNS > CREDITS & JOININGS (founder 2026-11-04). SANDBOX ONLY.
//   cd backend && TL_API=http://localhost:4011 node scripts/omni-credit-use-test.js
//   C1 the verdict rule: none / useful (+ costly over twice the company figure) / some / wasted
//   C2 a Recruiter sees ONLY their own row (credits used, verdict), never a colleague
//   C3 an Admin with the department picked sees that department: both people, the credits added up, the department verdict
//   C4 failed and Test-mode messages use no credits; the person who sent nothing is "Not used"
//   C5 the Export file has the person rows and the department rows; /me lists the new tab for a Recruiter
// ---------------------------------------------------------------------------
const Z = require('./lib/zzfix')('SCU');
const Ins = require('../src/outreach/insights');
const Cr = require('../src/outreach/credits');

(async () => {
  const { prisma } = Z;
  const DEPT = `ZZTEST SCU Dept ${Z.RUN}`;
  try {
    // C1: the rule alone
    const v = (o, avg = 10) => Ins.verdictOf({ credits: 0, joinings: 0, replies: 0, interviews: 0, ...o }, avg);
    const a = v({}); const b = v({ credits: 20, joinings: 2 }); const c = v({ credits: 60, joinings: 2 }); const d = v({ credits: 9, replies: 3 }); const e = v({ credits: 9 });
    Z.check('C1 verdict rule: none / useful 10 per joining / costly when 30 > 2 x 10 / some (replies, no joining) / wasted', a.verdict === 'none' && b.verdict === 'useful' && b.perJoining === 10 && !b.costly && c.verdict === 'useful' && c.costly && d.verdict === 'some' && e.verdict === 'wasted' && /nothing came back/.test(e.why), [a, b, c, d, e].map((x) => x.verdict));

    const admin = await Z.mkUser('admin', { role: 'ADMIN', atsRole: 'ADMIN' }, {});
    const r1 = await Z.mkUser('rec1', { role: 'EMPLOYEE', atsRole: 'RECRUITER' }, { department: DEPT });
    const r2 = await Z.mkUser('rec2', { role: 'EMPLOYEE', atsRole: 'RECRUITER' }, { department: DEPT });
    const TA = await Z.mint(admin); const T1 = await Z.mint(r1);
    await Cr.ensureTables();
    const now = Date.now();
    for (let i = 0; i < 4; i += 1) await Cr.record({ userId: r1.id, channel: 'whatsapp', ok: true, source: 'zz-scu', now: now - i * 1000 }); // eslint-disable-line no-await-in-loop
    await Cr.record({ userId: r1.id, channel: 'email', ok: true, source: 'zz-scu', now });
    await Cr.record({ userId: r1.id, channel: 'sms', ok: false, source: 'zz-scu', now }); // failed: no credit
    await Cr.record({ userId: r2.id, channel: 'whatsapp', mode: 'test', ok: true, source: 'zz-scu', now }); // test: no credit

    const me = await Z.call('GET', '/api/outreach/insights/credit-use', T1);
    const mine = me.body && me.body.persons;
    Z.check('C2 a Recruiter sees ONLY their own row: 5 credits, Wasted (nothing came back)', me.status === 200 && me.body.scope === 'me' && mine.length === 1 && mine[0].userId === r1.id && mine[0].credits === 5 && mine[0].verdict === 'wasted', [me.status, me.body && me.body.error, mine && mine.map((p) => [p.name, p.credits, p.verdict])]);

    const team = await Z.call('GET', `/api/outreach/insights/credit-use?dept=${encodeURIComponent(DEPT)}`, TA);
    const dRow = team.body && (team.body.departments || []).find((x) => x.name === DEPT);
    const p2 = team.body && (team.body.persons || []).find((p) => p.userId === r2.id);
    Z.check('C3 Admin + department picked: both people, 5 credits added up, department Wasted, 1 wasted person', team.status === 200 && team.body.persons.length === 2 && dRow && dRow.people === 2 && dRow.credits === 5 && dRow.verdict === 'wasted' && dRow.wasted === 1 && team.body.totals.wastedCredits === 5, [team.status, team.body && team.body.error, dRow]);
    Z.check('C4 failed + Test-mode messages use no credits: the second person is "Not used" (1 test message shown apart)', p2 && p2.credits === 0 && p2.verdict === 'none' && p2.testSent === 1, p2);

    const csv = await fetch(`${Z.API}/api/outreach/insights/credit-use.csv?dept=${encodeURIComponent(DEPT)}`, { headers: { Authorization: `Bearer ${TA}` } });
    const text = await csv.text();
    const acc = await Z.call('GET', '/api/outreach/me', T1);
    Z.check('C5 Export has person + department rows; a Recruiter\'s /me lists the Credits & joinings tab', csv.status === 200 && text.includes('Credits per joining') && text.includes(DEPT) && text.includes('Wasted') && (acc.body.pages || []).includes('credituse'), [csv.status, text.slice(0, 200), acc.body && acc.body.pages]);
  } catch (err) { Z.fail += 1; console.log('FAIL  crashed', err && err.stack ? err.stack.slice(0, 900) : err); } finally {
    try {
      await prisma.$executeRawUnsafe('DELETE FROM "OmniCreditLedger" WHERE source = \'zz-scu\'');
      await prisma.auditLog.deleteMany({ where: { action: 'Omni-Channel credits & joinings downloaded', userId: { in: Z.made.users } } });
    } catch (e) { console.log('cleanup failed:', String(e.message).slice(-200)); }
    await Z.cleanup().catch((e) => console.log('cleanup problem', String(e.message).slice(0, 160)));
    console.log(`\n${Z.pass} passed, ${Z.fail} failed`);
    await Z.prisma.$disconnect();
    process.exit(Z.fail ? 1 : 0);
  }
})();
