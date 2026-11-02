#!/usr/bin/env node
// ---------------------------------------------------------------------------
// TEAMLINK WHATSAPP NUMBERS ON OMNI-CHANNEL SETTINGS (routes/omniNumbers.js, founder 2026-11-02) - COPY DATABASE ONLY.
//
//   cd backend
//   node scripts/omni-numbers-test.js      makes its own VACUUM INTO copy of prisma/dev.db (opened READ-ONLY) in the temp
//                                          folder, starts a throw-away API on it (port 4096, TEST_MODE=1 TEAMLINK_SANDBOX=1,
//                                          Green Start sign-in switched off so nothing reaches a real Omni-Channel) and deletes it after
// Proves:
//   A  who: no pass = 401; an employee's pass = 403; an Admin's pass = the list (no token / secret in it)
//   C  CORS: the Green Start address (localhost:5190) gets credentials + the preflight; another site is refused
//   D  department: PUT needs X-TeamLink-Omni; it sets exactly ONE department and keeps the people / roles given the number;
//      the list then says that department; an empty department clears it; the change is written to the audit log
// ---------------------------------------------------------------------------
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const BACK = path.resolve(__dirname, '..');
const REAL = path.resolve(BACK, 'prisma', 'dev.db');
const copy = path.join(os.tmpdir(), `omninum-${Date.now().toString(36)}.db`);
{
  const { DatabaseSync } = require('node:sqlite');
  const src = new DatabaseSync(REAL, { readOnly: true });
  src.exec(`VACUUM INTO '${copy.split(path.sep).join('/').replace(/'/g, "''")}'`);
  src.close();
}
const PORT = Number(process.env.TEST_PORT || 4096);
if (PORT === 4010) process.exit(2);
const API = `http://127.0.0.1:${PORT}`;
const DB_URL = `file:${path.resolve(copy).split(path.sep).join('/')}?socket_timeout=60`;
process.env.DATABASE_URL = DB_URL;
process.env.TEST_MODE = '1';
process.env.TEAMLINK_SANDBOX = '1';
require(path.join(BACK, 'node_modules/dotenv')).config({ path: path.join(BACK, '.env'), override: false });
process.env.DATABASE_URL = DB_URL;
const prisma = require(path.join(BACK, 'src/db'));
const GE = require(path.join(BACK, 'src/utils/greenStartEmbed'));

let pass = 0; let fail = 0;
const check = (n, ok, d) => { if (ok) pass += 1; else fail += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${!ok && d != null ? `  -> ${String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 700)}` : ''}`); };
const RUN = Date.now().toString(36);
const GS = 'http://localhost:5190';
const P = '/api/omni-gs/teamlink-numbers';

async function http(method, p, { cookie, origin, body, headers } = {}) {
  const h = { ...(headers || {}) };
  if (cookie) h.Cookie = `${GE.COOKIE}=${cookie}`;
  if (origin) h.Origin = origin;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(`${API}${p}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(120000) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, body: json, text, h: r.headers };
}

let server = null;
(async () => {
  try {
    // Green Start sign-in off: the department job after a save fails at once instead of reaching a real Omni-Channel.
    server = spawn(process.execPath, ['src/index.js'], { cwd: BACK, env: { ...process.env, PORT: String(PORT), GREENSTART_SSO_SECRET: '', GREENSTART_ENABLED: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = ''; server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; });
    let healthy = false;
    for (let i = 0; i < 90 && !healthy; i += 1) {
      try { healthy = (await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(1500) })).ok; } catch { await new Promise((r) => setTimeout(r, 1000)); }
    }
    if (!healthy) { console.error('The throw-away server did not start.\n', log.slice(-1500)); process.exit(3); }

    const admin = await prisma.user.create({ data: { passwordHash: 'x', name: `ZZTEST ONM admin ${RUN}`, email: `zz-onm-a-${RUN}@example.test`, username: `zz-onm-a-${RUN}@example.test`, role: 'ADMIN', atsRole: 'ADMIN', hrmsRole: 'ADMIN', accountsRole: 'NONE', hrmsAccess: true, accountsAccess: false, atsAccess: true, status: 'Active' } });
    const emp = await prisma.user.create({ data: { passwordHash: 'x', name: `ZZTEST ONM emp ${RUN}`, email: `zz-onm-e-${RUN}@example.test`, username: `zz-onm-e-${RUN}@example.test`, role: 'EMPLOYEE', atsRole: 'NONE', hrmsRole: 'EMPLOYEE', accountsRole: 'NONE', hrmsAccess: true, accountsAccess: false, atsAccess: false, status: 'Active' } });
    const aPass = GE.makeToken(admin.id);
    const ePass = GE.makeToken(emp.id);

    // A - who
    const none = await http('GET', P, { origin: GS });
    check('A1 no Omni-Channel pass = 401', none.status === 401, none.status);
    const bad = await http('GET', P, { origin: GS, cookie: `${admin.id}.9999999999.forgedforgedforgedforged` });
    check('A2 a forged pass = 401', bad.status === 401, bad.status);
    const e = await http('GET', P, { origin: GS, cookie: ePass });
    check('A3 an employee\'s pass = 403 (Green Start then draws no card)', e.status === 403, e.status);
    const a = await http('GET', P, { origin: GS, cookie: aPass });
    const nums = (a.body && a.body.numbers) || [];
    if (a.status !== 200) console.log(log.split('\n').filter((l) => /Error|at /.test(l)).slice(-14).join('\n'));
    check('A4 an Admin gets every TeamLink number and the departments to pick from', a.status === 200 && nums.length >= 1 && Array.isArray(a.body.departments) && a.body.departments.length > 0, [a.status, nums.length, a.text.slice(0, 200)]);
    check('A5 no token, secret or app secret in the answer', !/token|secret/i.test(JSON.stringify(nums.map(({ problem, ...rest }) => rest))), nums[0]);
    check('A6 each number says its department, workspace and a plain problem line', nums.every((n) => 'department' in n && 'workspace' in n && 'problem' in n && Array.isArray(n.departments)), nums[0]);

    // C - CORS
    check('C1 the Green Start address gets its origin back with credentials', a.h.get('access-control-allow-origin') === GS && a.h.get('access-control-allow-credentials') === 'true', [a.h.get('access-control-allow-origin'), a.h.get('access-control-allow-credentials')]);
    const pre = await http('OPTIONS', `${P}/x/department`, { origin: GS, headers: { 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type,x-teamlink-omni' } });
    check('C2 the preflight allows PUT and the X-TeamLink-Omni header', pre.status === 204 && /PUT/.test(pre.h.get('access-control-allow-methods') || '') && /x-teamlink-omni/i.test(pre.h.get('access-control-allow-headers') || ''), [pre.status, pre.h.get('access-control-allow-methods')]);
    const evil = await http('GET', P, { origin: 'https://evil.example.com', cookie: aPass });
    check('C3 another website is refused, even with the pass', evil.status === 403 && !evil.h.get('access-control-allow-origin'), [evil.status, evil.h.get('access-control-allow-origin')]);

    // D - department (on a real row; the virtual "Main number" is moved into the list first)
    const target = nums.find((n) => n.id !== 'legacy') || nums[0];
    const id = target.id;
    const realId = id === 'legacy' ? null : id;
    const before = realId ? await prisma.$queryRawUnsafe('SELECT "kind","refId" FROM "WaNumberAccess" WHERE "numberId" = ?', realId) : [];
    const keepOthers = before.filter((x) => x.kind !== 'DEPARTMENT').map((x) => `${x.kind}|${x.refId}`).sort();
    const noHdr = await http('PUT', `${P}/${id}/department`, { origin: GS, cookie: aPass, body: { department: 'Education' } });
    check('D1 a PUT without X-TeamLink-Omni is refused (400)', noHdr.status === 400, noHdr.status);
    const ePut = await http('PUT', `${P}/${id}/department`, { origin: GS, cookie: ePass, body: { department: 'Education' }, headers: { 'X-TeamLink-Omni': '1' } });
    check('D2 an employee cannot change it (403)', ePut.status === 403, ePut.status);
    const put = await http('PUT', `${P}/${id}/department`, { origin: GS, cookie: aPass, body: { department: 'Education' }, headers: { 'X-TeamLink-Omni': '1' } });
    check('D3 the Admin gives the number to Education', put.status === 200 && put.body.ok && /Education/.test(put.body.message), [put.status, put.text.slice(0, 200)]);
    const rowId = realId || (await prisma.$queryRawUnsafe('SELECT "id" FROM "WaNumber" WHERE "credSource" = ? AND "removedAt" IS NULL', 'legacy'))[0].id;
    const after = await prisma.$queryRawUnsafe('SELECT "kind","refId" FROM "WaNumberAccess" WHERE "numberId" = ?', rowId);
    const depts = after.filter((x) => x.kind === 'DEPARTMENT').map((x) => x.refId);
    check('D4 exactly ONE department is saved', depts.length === 1 && depts[0] === 'Education', depts);
    check('D5 the people and roles given the number stay as they were', JSON.stringify(after.filter((x) => x.kind !== 'DEPARTMENT').map((x) => `${x.kind}|${x.refId}`).sort()) === JSON.stringify(keepOthers), [after, keepOthers]);
    const again = await http('GET', P, { origin: GS, cookie: aPass });
    const seen = (again.body.numbers || []).find((n) => n.id === rowId);
    check('D6 the list now shows Education for it', seen && seen.department === 'Education', seen);
    const audit = await prisma.auditLog.count({ where: { action: 'WhatsApp number assignment changed', entityId: rowId, userId: admin.id } });
    check('D7 the change is in the audit log under the Admin', audit >= 1, audit);
    const clear = await http('PUT', `${P}/${rowId}/department`, { origin: GS, cookie: aPass, body: { department: '' }, headers: { 'X-TeamLink-Omni': '1' } });
    const cleared = await prisma.$queryRawUnsafe('SELECT "kind" FROM "WaNumberAccess" WHERE "numberId" = ? AND "kind" = ?', rowId, 'DEPARTMENT');
    check('D8 an empty department clears it', clear.status === 200 && cleared.length === 0, [clear.status, cleared.length]);
  } catch (err) {
    fail += 1;
    console.error('ERROR', err);
  } finally {
    if (server) server.kill();
    await prisma.$disconnect().catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
    [copy, `${copy}-wal`, `${copy}-shm`, `${copy}-journal`].forEach((f) => { try { fs.unlinkSync(f); } catch { /* gone */ } });
    console.log(`\n${pass} passed, ${fail} failed (the copy database is deleted; prisma/dev.db was only read)`);
    process.exit(fail ? 1 : 0);
  }
})();
