#!/usr/bin/env node
// ---------------------------------------------------------------------------
// RECRUITERS TOKENS: THE TEAMLINK SIDE OF THE BRIDGE (founder 2026-11-05). SANDBOX ONLY.
//   cd backend && npm run sandbox -- --detach && TL_API=http://localhost:4011 node scripts/omni-credit-bridge-test.js
//   B1 no signed token = refused; an unknown or inactive viewer = ok:false (never a 502/503)
//   B2 a Recruiter's answer holds ONLY their own row; the department comes from the seat code's first word, not the Employee record
//   B3 a Team Lead sees their team, not another department
//   B4 an Admin sees every seat holder; someone with no seat is hidden by name but their tokens stay in `past`
//   B5 `company` carries only ids and numbers, no names; workspaces come from the department logins
// ---------------------------------------------------------------------------
const crypto = require('crypto');
const Z = require('./lib/zzfix')('SCB');
const Cr = require('../src/outreach/credits');

const token = (over = {}) => {
  const secret = String(process.env.GREENSTART_SSO_SECRET || '');
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const iat = Math.floor(Date.now() / 1000);
  const p = b64({ iss: 'greenstart', aud: 'teamlink-voice', iat, exp: iat + 60, jti: crypto.randomUUID(), ...over });
  return `${h}.${p}.${crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`;
};
const ask = (viewer, month = Cr.thisMonth()) => Z.call('GET', `/api/public/omni-voice/credit-use?month=${month}&viewer=${encodeURIComponent(viewer)}`, token());

(async () => {
  const { prisma } = Z;
  const DEPT = `ZZTEST SCB Dept ${Z.RUN}`;
  const OTHER = `ZZTEST SCB Other ${Z.RUN}`;
  const positions = [];
  let savedLogins = null;
  const callIds = [];
  try {
    if (String(process.env.GREENSTART_SSO_SECRET || '').length < 32) { Z.check('the sandbox has the shared secret', false, 'GREENSTART_SSO_SECRET missing'); return; }
    const noToken = await Z.call('GET', '/api/public/omni-voice/credit-use?month=2026-11&viewer=x');
    const nobody = await ask('no-such-user');
    Z.check('B1 no signed token = 401; an unknown viewer = 200 ok:false VIEWER_UNKNOWN', noToken.status === 401 && nobody.status === 200 && nobody.body.ok === false && nobody.body.code === 'VIEWER_UNKNOWN', [noToken.status, nobody.status, nobody.body]);

    const admin = await Z.mkUser('admin', { role: 'ADMIN', atsRole: 'ADMIN' }, {});
    const lead = await Z.mkUser('lead', { role: 'EMPLOYEE', atsRole: 'TL', atsDepartment: DEPT }, { department: DEPT });
    const r1 = await Z.mkUser('rec1', { role: 'EMPLOYEE', atsRole: 'RECRUITER', atsDepartment: DEPT }, { department: DEPT });
    const r2 = await Z.mkUser('rec2', { role: 'EMPLOYEE', atsRole: 'RECRUITER', atsDepartment: DEPT }, { department: DEPT });
    const r3 = await Z.mkUser('rec3', { role: 'EMPLOYEE', atsRole: 'RECRUITER', atsDepartment: OTHER }, { department: OTHER });
    const noSeat = await Z.mkUser('noseat', { role: 'EMPLOYEE', atsRole: 'RECRUITER', atsDepartment: DEPT }, { department: DEPT });

    const seat = async (u, code) => {
      const emp = await prisma.employee.findUnique({ where: { userId: u.id } });
      const p = await prisma.position.create({ data: { code, department: 'Written on the seat', kind: 'RECRUITER' } });
      positions.push(p.id);
      await prisma.positionAssignment.create({ data: { positionId: p.id, employeeId: emp.id, fromDate: '2026-01-01' } });
    };
    await seat(lead, `EDU TL ZZ${Z.RUN}`);
    await seat(r1, `EDU-ZZ${Z.RUN}`);
    await seat(r2, `BDE EDU-ZZ${Z.RUN}`);
    await seat(r3, `MED-ZZ${Z.RUN}`);

    await Cr.ensureTables();
    const now = Date.now();
    for (let i = 0; i < 3; i += 1) await Cr.record({ userId: r1.id, channel: 'whatsapp', ok: true, source: 'zz-scb', now: now - i * 1000 }); // eslint-disable-line no-await-in-loop
    await Cr.record({ userId: r3.id, channel: 'sms', ok: true, source: 'zz-scb', now });
    await Cr.record({ userId: noSeat.id, channel: 'email', ok: true, source: 'zz-scb', now });
    await Cr.record({ userId: noSeat.id, channel: 'email', ok: false, source: 'zz-scb', now }); // failed: no token

    const me = (await ask(r1.id)).body;
    const mine = (me.persons || [])[0];
    await require('../src/calling/schema').ensure();
    const stamp = new Date().toISOString();
    const call = (id, by, status, secs, key = null) => prisma.$executeRawUnsafe('INSERT INTO "AiCall" ("id","mode","purpose","status","candidateId","dedupeKey","initiatedById","durationSec","createdAt","updatedAt") VALUES (?,\'live\',\'zz\',?,?,?,?,?,?,?)', id, status, `ZZTEST-${Z.RUN}`, key || id, by, secs, stamp, stamp);
    callIds.push(`zzc1${Z.RUN}`, `zzc2${Z.RUN}`, `zzc3${Z.RUN}`, `zzc4${Z.RUN}`);
    await call(callIds[0], r1.id, 'completed', 90);
    await call(callIds[1], r1.id, 'no-answer', 0); // nobody talked: not counted
    await call(callIds[2], r1.id, 'completed', 60, `web:${callIds[2]}`); // a browser talk, not a phone call
    await call(callIds[3], null, 'completed', 30); // no person
    const me2 = (await ask(r1.id)).body;
    const m2 = me2.persons && me2.persons[0];
    Z.check('B7 tokens per way of sending, AI calls counted only when they talked, a call with no person goes apart', m2 && m2.channels.whatsapp === 3 && m2.aiCalls.calls === 1 && m2.aiCalls.seconds === 90 && m2.aiCalls.tokens === 0 && me2.noPersonCalls.calls >= 1, m2 ? { c: m2.channels, ai: m2.aiCalls, none: me2.noPersonCalls } : me2);

    Z.check('B2 a Recruiter: scope me, ONLY their row, 3 tokens, department Education from the seat code, no department list', me.ok === true && me.viewer.scope === 'me' && me.persons.length === 1 && mine.userId === r1.id && mine.credits === 3 && mine.department === 'Education' && mine.seat === `EDU-ZZ${Z.RUN}` && me.viewer.departments.length === 0, me.ok ? { v: me.viewer, mine } : me);

    const team = (await ask(lead.id)).body;
    const teamIds = (team.persons || []).map((p) => p.userId);
    Z.check('B3 a Team Lead: scope team, own team, not the other department', team.ok === true && team.viewer.scope === 'team' && teamIds.includes(r1.id) && teamIds.includes(r2.id) && !teamIds.includes(r3.id) && team.viewer.departments.includes('Education'), team.ok ? { v: team.viewer, teamIds, r1: r1.id } : team);

    const all = (await ask(admin.id)).body;
    const ids = (all.persons || []).map((p) => p.userId);
    const p2 = (all.persons || []).find((p) => p.userId === r2.id);
    const pastRow = (all.past || []).find((x) => x.department === DEPT);
    Z.check('B4 an Admin: scope all; BDE EDU-n counts as BDE; no seat = no name, its 1 token stays in past', all.ok === true && all.viewer.scope === 'all' && ids.includes(r1.id) && ids.includes(r3.id) && p2 && p2.department === 'BDE' && !ids.includes(noSeat.id) && pastRow && pastRow.credits === 1 && pastRow.sent === 1, all.ok ? { p2, pastRow, n: ids.length } : all);

    const row = (all.company || []).find((c) => c.userId === r1.id);
    Z.check('B5 company rows are ids and numbers only; workspaces is a map; cost comes from Credits', row && Object.keys(row).sort().join() === 'credits,joinings,userId' && row.credits === 3 && typeof all.workspaces === 'object' && all.cost && all.cost.whatsapp >= 0, row);

    // B6 needs the sandbox started with GREENSTART_ALL_ROLES=1: a department with no Omni-Channel login keeps the native sidebar, a department with one opens Green Start
    if (/^(1|true|yes|on)$/i.test(String(process.env.GREENSTART_ALL_ROLES || ''))) {
      const KEY = 'omni.gs.deptLogins';
      savedLogins = await prisma.appSetting.findUnique({ where: { key: KEY } });
      await prisma.appSetting.deleteMany({ where: { key: KEY } });
      const none = await Z.call('GET', '/api/outreach/me', await Z.mint(r1));
      await prisma.appSetting.create({ data: { key: KEY, value: JSON.stringify({ departments: { [DEPT.toLowerCase()]: { state: 'ready', email: 'zz-scb-dept@example.test', dept: DEPT, workspace: 'ZZTEST' } } }) } });
      const ready = await Z.call('GET', '/api/outreach/me', await Z.mint(r1));
      const other = await Z.call('GET', '/api/outreach/me', await Z.mint(r3));
      const boss = await Z.call('GET', '/api/outreach/me', await Z.mint(admin));
      Z.check('B6 Recruiter: no department login = native Omni-Channel; with one = Green Start; another department stays native; Admin always Green Start', none.body.greenStart === false && ready.body.greenStart === true && other.body.greenStart === false && boss.body.greenStart === true, [none.body.greenStart, ready.body.greenStart, other.body.greenStart, boss.body.greenStart]);
    } else Z.check('B6 skipped: start the sandbox with GREENSTART_ALL_ROLES=1', false);

    await prisma.user.update({ where: { id: r2.id }, data: { status: 'Inactive' } });
    const gone = (await ask(r2.id)).body;
    Z.check('B1b an inactive login is refused', gone.ok === false && gone.code === 'VIEWER_UNKNOWN', gone);
  } catch (err) { Z.fail += 1; console.log('FAIL  crashed', err && err.stack ? err.stack.slice(0, 900) : err); } finally {
    try {
      await prisma.$executeRawUnsafe('DELETE FROM "OmniCreditLedger" WHERE source = \'zz-scb\'');
      for (const id of callIds) await prisma.$executeRawUnsafe('DELETE FROM "AiCall" WHERE "id" = ?', id); // eslint-disable-line no-await-in-loop
      await prisma.positionAssignment.deleteMany({ where: { positionId: { in: positions } } });
      await prisma.position.deleteMany({ where: { id: { in: positions } } });
      await prisma.appSetting.deleteMany({ where: { key: 'omni.gs.deptLogins' } });
      if (savedLogins) await prisma.appSetting.create({ data: savedLogins });
    } catch (e) { console.log('cleanup failed:', String(e.message).slice(-200)); }
    await Z.cleanup().catch((e) => console.log('cleanup problem', String(e.message).slice(0, 160)));
    console.log(`\n${Z.pass} passed, ${Z.fail} failed`);
    await Z.prisma.$disconnect();
    process.exit(Z.fail ? 1 : 0);
  }
})();
