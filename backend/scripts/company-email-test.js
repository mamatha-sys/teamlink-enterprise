#!/usr/bin/env node
/**
 * Personal email and company email (utils/companyEmail.js, utils/cpanelMail.js, routes/employees.js, routes/auth.js, utils/passwordReset.js).
 * SANDBOX ONLY: a private server on a COPY of the sandbox database, port 4034, and a stand-in cPanel on 4035. Nothing real is called or mailed.
 *   node scripts/company-email-test.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const BACK = path.resolve(__dirname, '..');
const SOURCE = process.env.TEST_SOURCE_DB || path.join(BACK, 'prisma', 'sandbox.db');
const COPY = path.join(os.tmpdir(), `zz-company-email-${process.pid}.db`);
const src = new DatabaseSync(SOURCE, { readOnly: true });
src.exec(`VACUUM INTO '${COPY.replace(/'/g, "''")}'`);
src.close();
const dbx = new DatabaseSync(COPY);
const have = dbx.prepare('PRAGMA table_info("Employee")').all().map((c) => c.name);
if (!have.includes('personalEmail')) dbx.exec(fs.readFileSync(path.join(BACK, 'prisma', 'migrations', '20261106100000_employee_company_email', 'migration.sql'), 'utf8'));
dbx.close();

const PORT = 4034;
const API = `http://localhost:${PORT}/api`;
const env = {
  ...process.env, TEAMLINK_SANDBOX: '1', TEST_MODE: '1', PORT: String(PORT), JWT_SECRET: 'company-email-test', DATABASE_URL: `file:${COPY.split(path.sep).join('/')}`,
  TEST_MOCK_PORTS: '4035', CPANEL_BASE_URL: 'http://localhost:4035', CPANEL_USER: 'teamlink', CPANEL_TOKEN: 'stand-in-token', CPANEL_DOMAIN: 'teamlink.test', CPANEL_HOST: 'localhost',
};
Object.assign(process.env, env);
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const prisma = require('../src/db');
const { resolveIdentity, tokenPayload } = require('../src/utils/identity');
const CE = require('../src/utils/companyEmail');

let failed = 0; let total = 0;
const check = (name, ok, extra) => { total += 1; if (ok) console.log(`  ok  ${name}`); else { failed += 1; console.log(`FAIL  ${name}${extra !== undefined ? `\n      ${JSON.stringify(extra).slice(0, 300)}` : ''}`); } };
const call = async (method, url, body, token) => {
  const r = await fetch(API + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* none */ }
  return { status: r.status, body: j };
};
const tokenOf = async (id) => jwt.sign({ ...tokenPayload(await resolveIdentity(id)), tms: Date.now() }, env.JWT_SECRET, { expiresIn: '1h' });

// the stand-in cPanel
const cpanelSeen = [];
let cpanelAnswer = { status: 1, errors: null };
const cpanel = http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => { b += d; });
  req.on('end', () => { cpanelSeen.push({ url: req.url, auth: req.headers.authorization, body: b }); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(cpanelAnswer)); });
});

let server;
async function stop(code) {
  if (server) server.kill();
  cpanel.close();
  await prisma.$disconnect().catch(() => {});
  setTimeout(() => {
    for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(COPY + s); } catch { /* none */ } }
    process.exit(code);
  }, 800);
}

(async () => {
  await new Promise((r) => { cpanel.listen(4035, r); });
  server = spawn(process.execPath, ['src/index.js'], { cwd: BACK, env, stdio: 'ignore' });
  for (let i = 0; i < 40; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const up = await fetch(`${API}/health`).then((r) => r.ok).catch(() => false);
    if (up) break;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { setTimeout(r, 500); });
  }
  const list = await prisma.employee.findMany({ where: { userId: { not: null }, email: { contains: '@' }, employmentStatus: { in: ['Active', 'On Probation', 'Confirmed'] }, user: { status: 'Active', role: { not: 'SUPER_ADMIN' } } }, take: 3, include: { user: true } });
  const admin = (await prisma.user.findMany({ where: { status: 'Active', role: 'SUPER_ADMIN' }, take: 5 })).find((u) => !/zztest|example\.test/i.test(`${u.name}${u.email}`));
  await prisma.user.updateMany({ where: { id: { in: [admin.id, ...list.map((x) => x.userId)] } }, data: { passwordResetRequired: false, passwordChangedAt: new Date(Date.now() - 86400000) } }); // (the copy) a starting password would stop every call
  await new Promise((r) => { setTimeout(r, 1100); });
  const hr = await tokenOf(admin.id);
  const e = list[0];
  const other = list[1];
  const userId = e.userId;
  const personal = e.email.toLowerCase();
  const PASS = 'Company-Test-9182!x';
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(PASS, 10), passwordChangedAt: new Date(Date.now() - 86400000), failedLoginCount: 0, lockedUntil: null } });
  await new Promise((r) => { setTimeout(r, 1100); });
  const oldToken = await tokenOf(userId);
  const att = await prisma.attendance.count({ where: { employeeId: e.id } });
  const url = `/employees/${e.id}/company-email`;

  console.log('The screen and the checks');
  const st = await call('GET', url, null, hr);
  check('HR sees the state: nothing given yet, cPanel on, a suggestion on the company domain', st.status === 200 && st.body.companyEmail === null && st.body.cpanel.on === true && /@teamlink\.test$/.test(st.body.suggestion), st.body);
  check('an employee cannot open it for somebody else', (await call('GET', url, null, await tokenOf(other.userId))).status === 403);
  check('a personal mail service is refused (the domain rule)', (await call('POST', url, { email: 'someone@gmail.com' }, hr)).status === 409);
  check('a bad address is refused', (await call('POST', url, { email: 'not an email' }, hr)).status === 409);
  await prisma.user.update({ where: { id: other.userId }, data: { email: 'taken@teamlink.test', username: 'taken@teamlink.test' } });
  const dup = await call('POST', url, { email: 'taken@teamlink.test' }, hr);
  check('an address another login uses is refused', dup.status === 409 && /Another login/.test(dup.body.error), dup.body);
  check('nothing changed after the refusals', (await prisma.user.findUnique({ where: { id: userId } })).email === e.user.email);

  console.log('Assigning');
  const CO = 'ravi.kumar@teamlink.test';
  const ok = await call('POST', url, { email: ` ${CO.toUpperCase()} ` }, hr);
  check('assigned', ok.status === 200 && ok.body.ok && ok.body.email === CO && ok.body.personalEmail === personal, ok.body);
  const u2 = await prisma.user.findUnique({ where: { id: userId } });
  const e2 = await prisma.employee.findUnique({ where: { id: e.id } });
  check('the SAME login row: only the email moved (login and username)', u2 && u2.id === userId && u2.email === CO && u2.username === CO);
  check('the employee\'s working email is the company email, so mail and HRMS follow', e2.email === CO);
  const st2 = await call('GET', url, null, hr);
  check('the personal email is kept', st2.body.personalEmail === personal && st2.body.companyEmail === CO && st2.body.loginEmail === CO && !!st2.body.assignedAt, st2.body);
  check('attendance stays attached to the person', (await prisma.attendance.count({ where: { employeeId: e.id } })) === att);
  check('the old session is signed out', (await call('GET', '/auth/me', null, oldToken)).status === 401);
  const aud = await prisma.auditLog.findFirst({ where: { action: 'Login email changed', entityId: userId }, orderBy: { createdAt: 'desc' } });
  check('the audit log has from and to', aud && aud.fromValue === e.user.email && aud.toValue === CO, aud);
  check('the onboarding task is ticked', /Company email assigned/.test(e2.onboardingTasks || '') && JSON.parse(e2.onboardingTasks).find((t) => t.task === CE.TASK).completed === true);
  check('the person gets a bell', !!(await prisma.notification.findFirst({ where: { userId, recipient: { startsWith: 'company-email|' } } })));
  check('the same address again changes nothing', (await call('POST', url, { email: CO }, hr)).body.unchanged === true);

  console.log('Signing in');
  const a = await call('POST', '/auth/login', { email: CO, password: PASS });
  check('the company email signs in with the same password', a.status === 200 && !!a.body.token, a.body);
  const b = await call('POST', '/auth/login', { email: personal, password: PASS });
  check('the personal email with the right password: told to use the company email', b.status === 401 && b.body.code === 'USE_COMPANY_EMAIL' && b.body.error.includes(CO), b.body);
  const c = await call('POST', '/auth/login', { email: personal, password: 'wrong-password-1' });
  check('the personal email with a wrong password: the plain answer, nothing learned', c.status === 401 && c.body.error === 'Invalid email or password' && !JSON.stringify(c.body).includes(CO), c.body);
  const rec = await CE.recoveryLogin(personal);
  check('forgot password with the personal email: the link goes to the personal email', rec && rec.user.id === userId && rec.to === personal, rec);
  check('forgot password for an unrelated address: nothing', (await CE.recoveryLogin('nobody-at-all@nowhere.test')) === null);

  console.log('The profile forms');
  const f1 = await call('PUT', `/employees/${e.id}`, { email: 'other@teamlink.test' }, hr);
  check('the profile form cannot change a company email', f1.status === 400 && /company email/.test(f1.body.error), f1.body);
  check('(sending the same one is fine)', (await CE.emailLocked(e.id, CO)) === null);
  check('(an employee with none is not touched)', (await CE.emailLocked(list[2].id, 'x@y.test')) === null);

  console.log('Changing it, and cPanel');
  const third = list[2];
  const url3 = `/employees/${third.id}/company-email`;
  const p3 = third.email.toLowerCase();
  cpanelAnswer = { status: 0, errors: ['An account with that name already exists.'] };
  const bad = await call('POST', url3, { email: 'new.person@teamlink.test', createMailbox: true }, hr);
  check('cPanel says no: its words are shown and nothing changes', bad.status === 502 && /already exists/.test(bad.body.error) && (await prisma.user.findUnique({ where: { id: third.userId } })).email === third.user.email, bad.body);
  cpanelAnswer = { status: 1, errors: null };
  cpanelSeen.length = 0;
  const made = await call('POST', url3, { email: 'new.person@teamlink.test', createMailbox: true }, hr);
  check('the mailbox is made and the email assigned', made.status === 200 && made.body.email === 'new.person@teamlink.test', made.body);
  const cp = cpanelSeen[0] || {};
  check('cPanel was called with the token, the password in the body, not the address', cp.url === '/execute/Email/add_pop' && cp.auth === 'cpanel teamlink:stand-in-token' && /email=new\.person/.test(cp.body) && /password=/.test(cp.body), cp);
  const ch = await call('POST', url, { email: 'ravi.k@teamlink.test' }, hr);
  const st3 = await call('GET', url, null, hr);
  check('a second change moves the login again, and the personal email stays what it was', ch.status === 200 && st3.body.personalEmail === personal && st3.body.loginEmail === 'ravi.k@teamlink.test', st3.body);
  const p = await prisma.employee.findUnique({ where: { id: third.id } });
  check('the third person is on the mailbox made for them', p.email === 'new.person@teamlink.test' && (await call('GET', url3, null, hr)).body.personalEmail === p3);

  console.log(failed ? `\n${failed} of ${total} checks FAILED` : `\nAll ${total} checks passed`);
  await stop(failed ? 1 : 0);
})().catch(async (err) => { console.error(err); await stop(1); });
