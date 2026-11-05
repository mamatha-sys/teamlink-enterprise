#!/usr/bin/env node
// ---------------------------------------------------------------------------
// TIMESHEET > CHECKLIST: A TL SEES THEIR WHOLE TEAM (founder 2026-11-05: "timesheet module lo tls ki valla andharu employee checklist
// kanipinchali and every day filters petukuntey") - COPY DATABASE ONLY.
//
//   cd backend
//   node scripts/timesheet-checklist-team-test.js     makes its own VACUUM INTO copy of prisma/dev.db (opened READ-ONLY) and deletes it after
//
// Starts its OWN throw-away API (port 4098) on the copy, adds ZZTEST fixtures to the COPY only and proves GET /api/timesheet-checklist:
//   T  a TL reaches their team with NO reporting manager filled in, and their direct report from another team; not a peer TL's team
//   R  roster: every person, written or not, for the day; the TL's own record is not in it; an exited person who wrote nothing is left out
//   D  a day range counts days; yesterday's filter does not show today's rows
//   F  status / words filters narrow the rows, not "who wrote"; Employee filter narrows the roster
//   S  an employee still sees only their own rows
// ---------------------------------------------------------------------------
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const BACK = path.resolve(__dirname, '..');
const REAL = path.resolve(BACK, 'prisma', 'dev.db');
const copy = path.join(os.tmpdir(), `tschecklist-${Date.now().toString(36)}.db`);
{
  const { DatabaseSync } = require('node:sqlite');
  const src = new DatabaseSync(REAL, { readOnly: true });
  src.exec(`VACUUM INTO '${copy.split(path.sep).join('/').replace(/'/g, "''")}'`);
  src.close();
}
const PORT = Number(process.env.TEST_PORT || 4098);
if (PORT === 4010) process.exit(2);
const API = `http://127.0.0.1:${PORT}`;
const DB_URL = `file:${path.resolve(copy).split(path.sep).join('/')}?socket_timeout=60`;
process.env.DATABASE_URL = DB_URL;
process.env.TEST_MODE = '1';
process.env.TEAMLINK_SANDBOX = '1';
require(path.join(BACK, 'node_modules/dotenv')).config({ path: path.join(BACK, '.env'), override: false });
process.env.DATABASE_URL = DB_URL;
const jwt = require(path.join(BACK, 'node_modules/jsonwebtoken'));
const prisma = require(path.join(BACK, 'src/db'));
const { resolveIdentity, tokenPayload } = require(path.join(BACK, 'src/utils/identity'));

let pass = 0; let fail = 0;
const check = (n, ok, d) => { if (ok) pass += 1; else fail += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${!ok && d != null ? `  -> ${String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 700)}` : ''}`); };
const RUN = Date.now().toString(36);
const DEPT = `ZZTEST TCL Dept ${RUN}`;
const TEAM_A = `ZZTEST TCL A ${RUN}`;
const TEAM_B = `ZZTEST TCL B ${RUN}`;
const istDay = (back = 0) => new Date(Date.now() + 330 * 60000 - back * 86400000).toISOString().slice(0, 10);
const TODAY = istDay(); const YDAY = istDay(1);

async function get(p, token) {
  const r = await fetch(`${API}${p}`, { headers: { Authorization: `Bearer ${token}`, 'X-Forwarded-For': `10.8.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }, signal: AbortSignal.timeout(120000) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const base = { passwordHash: 'x', hrmsRole: 'NONE', accountsRole: 'NONE', atsRole: 'NONE', hrmsAccess: true, accountsAccess: false, atsAccess: false, status: 'Active' };
async function mk(tag, role, team, extra = {}) {
  const name = `ZZTEST TCL ${tag} ${RUN}`;
  const u = await prisma.user.create({ data: { ...base, name, email: `zz-tcl-${tag}-${RUN}@example.test`, username: `zz-tcl-${tag}-${RUN}@example.test`, role, hrmsRole: role } });
  const e = await prisma.employee.create({ data: { employeeCode: `ZZTCL-${tag}-${RUN}`.slice(0, 40), name, userId: u.id, designation: role === 'TL' ? 'Team Lead' : 'Executive', employmentStatus: 'Active', department: DEPT, team, email: u.email, dateOfJoining: new Date('2025-01-01'), ...extra } });
  const t = jwt.sign(tokenPayload(await resolveIdentity(u.id)), process.env.JWT_SECRET, { expiresIn: '2h' });
  return { u, e, t, name };
}
const write = (who, date, status, description, fromTime = '10:00', toTime = '11:00') => prisma.timesheetChecklist.create({ data: { userId: who.u.id, employeeId: who.e.id, date, fromTime, toTime, status, description } });

let server = null;
(async () => {
  try {
    server = spawn(process.execPath, ['src/index.js'], { cwd: BACK, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = ''; server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; });
    let healthy = false;
    for (let i = 0; i < 90 && !healthy; i += 1) {
      try { healthy = (await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(1500) })).ok; } catch { await new Promise((r) => setTimeout(r, 1000)); }
    }
    if (!healthy) { console.error('The throw-away server did not start.\n', log.slice(-1500)); process.exit(3); }

    const tl = await mk('tl', 'TL', TEAM_A);
    const peerTl = await mk('peer', 'TL', TEAM_B);
    const a = await mk('a', 'EMPLOYEE', TEAM_A); // no reporting manager: the old rule lost this person
    const b = await mk('b', 'EMPLOYEE', TEAM_A); // writes nothing
    const direct = await mk('direct', 'EMPLOYEE', TEAM_B, { reportingManagerId: tl.e.id }); // reports to the TL from another team
    const other = await mk('other', 'EMPLOYEE', TEAM_B); // the peer TL's person
    const gone = await mk('gone', 'EMPLOYEE', TEAM_A, { employmentStatus: 'Exited' });
    await write(a, TODAY, 'Completed', 'called twenty candidates');
    await write(a, YDAY, 'Pending', 'old day work');
    await write(direct, TODAY, 'In Progress', 'sheet update');
    await write(other, TODAY, 'Completed', 'not for this TL');
    await write(tl, TODAY, 'Completed', 'my own work');

    const today = await get(`/api/timesheet-checklist?date=${TODAY}`, tl.t);
    const names = (today.body.roster || []).map((p) => p.name);
    check('T1 a TL with people and no reporting line is a team lead here', today.status === 200 && today.body.scope === 'team', [today.status, today.body && today.body.scope]);
    check('T2 the team member with no reporting manager is in', names.includes(a.name), names);
    check('T3 the direct report from another team is in', names.includes(direct.name), names);
    check('T4 the peer TL\'s person and the peer TL are not', !names.includes(other.name) && !names.includes(peerTl.name) && !today.body.rows.some((r) => r.userId === other.u.id), names);
    check('R1 the person who wrote nothing is listed, with 0 entries', (today.body.roster.find((p) => p.name === b.name) || {}).entries === 0, today.body.roster);
    check('R2 the TL\'s own record is not in the team list', !names.includes(tl.name), names);
    check('R3 somebody who has left and wrote nothing is left out', !names.includes(gone.name), names);
    check('R4 not written comes first, then a count per status', today.body.roster[0].entries === 0 && (today.body.roster.find((p) => p.name === a.name) || {}).completed === 1, today.body.roster.slice(0, 3));
    check('R5 the Employee list holds the whole team', today.body.people.some((p) => p.userId === b.u.id) && today.body.people.some((p) => p.userId === a.u.id), today.body.people.length);

    const y = await get(`/api/timesheet-checklist?date=${YDAY}`, tl.t);
    check('D1 yesterday shows yesterday only', y.body.rows.length === 1 && y.body.rows[0].date === YDAY && (y.body.roster.find((p) => p.name === direct.name) || {}).entries === 0, y.body.rows);
    const range = await get(`/api/timesheet-checklist?date=${YDAY}&to=${TODAY}`, tl.t);
    check('D2 two days: 2 days counted for the person who wrote on both', (range.body.roster.find((p) => p.name === a.name) || {}).days === 2, range.body.roster);

    const st = await get(`/api/timesheet-checklist?date=${TODAY}&status=Completed`, tl.t);
    const stA = st.body.roster.find((p) => p.name === direct.name) || {};
    check('F1 a status filter narrows the rows, and the In Progress person still counts as written', !st.body.rows.some((r) => r.status !== 'Completed') && stA.entries === 1, [st.body.rows.length, stA]);
    const one = await get(`/api/timesheet-checklist?date=${TODAY}&userId=${b.u.id}`, tl.t);
    check('F2 the Employee filter narrows the team list to that person', one.body.roster.length === 1 && one.body.roster[0].name === b.name, one.body.roster.length);

    const self = await get(`/api/timesheet-checklist?date=${TODAY}`, a.t);
    check('S an employee sees only their own rows and no team list', self.body.scope === 'self' && self.body.roster.length === 0 && self.body.rows.every((r) => r.userId === a.u.id), self.body.scope);
  } catch (e) {
    fail += 1;
    console.error('ERROR', e);
  } finally {
    if (server) server.kill();
    await prisma.$disconnect().catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
    [copy, `${copy}-wal`, `${copy}-shm`, `${copy}-journal`].forEach((f) => { try { fs.unlinkSync(f); } catch { /* gone */ } });
    console.log(`\n${pass} passed, ${fail} failed (the copy database is deleted; prisma/dev.db was only read)`);
    process.exit(fail ? 1 : 0);
  }
})();
