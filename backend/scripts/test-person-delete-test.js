#!/usr/bin/env node
/**
 * Delete a test person completely (utils/testPersonDelete.js). SANDBOX ONLY: a COPY of the sandbox database, in this process.
 *   node scripts/test-person-delete-test.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const SOURCE = process.env.TEST_SOURCE_DB || path.resolve(__dirname, '..', 'prisma', 'sandbox.db');
const COPY = path.join(os.tmpdir(), `zz-tpd-${process.pid}.db`).split(path.sep).join('/');
const src = new DatabaseSync(SOURCE, { readOnly: true });
src.exec(`VACUUM INTO '${COPY}'`);
src.close();
Object.assign(process.env, { TEAMLINK_SANDBOX: '1', TEST_MODE: '1', DATABASE_URL: `file:${COPY}` });
const prisma = require('../src/db');
const TP = require('../src/utils/testPersonDelete');

let failed = 0; let total = 0;
const check = (name, ok, extra) => { total += 1; if (ok) console.log(`  ok  ${name}`); else { failed += 1; console.log(`FAIL  ${name}\n      ${JSON.stringify(extra)}`); } };
const R = String(Date.now()).slice(-6);
const DAY = 86400000;
const copies = [];

(async () => {
  const boss = (await prisma.user.findMany({ where: { role: 'SUPER_ADMIN', status: 'Active' } })).find((u) => !/zz/i.test(u.name));
  const req = await prisma.requirement.findFirst({ select: { id: true } });
  const mkUser = (n, extra = {}) => prisma.user.create({ data: { name: `ZZTEST ${n} ${R}`, email: `zz-${n}-${R}@example.test`, passwordHash: 'x', role: 'EMPLOYEE', ...extra } });
  const mkEmp = (n, u, extra = {}) => prisma.employee.create({ data: { employeeCode: `ZZ${n}${R}`, name: `ZZTEST ${n} ${R}`, userId: u ? u.id : null, ...extra } });

  console.log('A test joining: login, employee, candidate, application');
  const cand = await prisma.candidate.create({ data: { name: `ZZTEST Cand ${R}`, phone: `90000${R}` } });
  const app = await prisma.application.create({ data: { candidateId: cand.id, requirementId: req.id, stage: 'JOINED' } });
  const u1 = await mkUser('Joiner');
  const e1 = await mkEmp('J', u1);
  await prisma.application.update({ where: { id: app.id }, data: { hrmsEmployeeId: e1.id } });
  await prisma.applicationStageEvent.create({ data: { applicationId: app.id, candidateId: cand.id, fromStage: 'SELECTED', toStage: 'JOINED', action: 'Joined' } });
  await prisma.attendance.create({ data: { employeeId: e1.id, date: '2026-11-07', status: 'Present' } });
  await prisma.notification.create({ data: { userId: u1.id, title: 'ZZTEST hello', message: 'x', channel: 'In-App' } });
  const audit = await prisma.auditLog.create({ data: { userId: u1.id, action: 'ZZTEST line', entity: 'User', entityId: u1.id } });

  const pv = await TP.preview({ userId: u1.id });
  const has = (t) => (pv.body.rows || []).find((r) => r.table === t)?.count || 0;
  check('the preview lists the login, employee, candidate, application and what hangs off them',
    pv.status === 200 && has('User') === 1 && has('Employee') === 1 && has('Candidate') === 1 && has('Application') === 1 && has('Attendance') === 1 && has('ApplicationStageEvent') >= 1 && has('Notification') === 1, pv.body);
  check('nothing is deleted by a preview', !!(await prisma.user.findUnique({ where: { id: u1.id } })));
  const wrong = await TP.run(boss, { userId: u1.id }, 'nope');
  check('a wrong confirmation word deletes nothing', wrong.status === 400 && !!(await prisma.employee.findUnique({ where: { id: e1.id } })), wrong.body);
  const done = await TP.run(boss, { userId: u1.id }, e1.employeeCode);
  if (done.body.copy) copies.push(done.body.copy);
  const gone = !(await prisma.user.findUnique({ where: { id: u1.id } })) && !(await prisma.employee.findUnique({ where: { id: e1.id } }))
    && !(await prisma.candidate.findUnique({ where: { id: cand.id } })) && !(await prisma.application.findUnique({ where: { id: app.id } }))
    && (await prisma.attendance.count({ where: { employeeId: e1.id } })) === 0 && (await prisma.notification.count({ where: { userId: u1.id } })) === 0;
  check('typed right: all of it is gone, in HRMS and ATS', done.status === 200 && gone, done.body);
  const kept = await prisma.auditLog.findUnique({ where: { id: audit.id } });
  check('the audit trail stays (only the name link is cleared)', !!kept && kept.userId === null, kept);
  const file = path.join(__dirname, '..', 'backups', 'deleted-people', done.body.copy || 'none');
  const saved = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  check('a copy of every removed row is saved first', !!saved && saved.tables.Employee?.length === 1 && saved.tables.Application?.length === 1);
  check('the deletion is in the audit log', !!(await prisma.auditLog.findFirst({ where: { action: 'Test person deleted completely', entityId: u1.id } })));

  console.log('A test joining that matched a REAL employee');
  const realU = await mkUser('Real');
  const realE = await mkEmp('R', realU);
  await prisma.employee.update({ where: { id: realE.id }, data: { createdAt: new Date(Date.now() - 10 * DAY) } });
  const cand2 = await prisma.candidate.create({ data: { name: `ZZTEST Cand2 ${R}` } });
  const app2 = await prisma.application.create({ data: { candidateId: cand2.id, requirementId: req.id, stage: 'JOINED', hrmsEmployeeId: realE.id } });
  const pv2 = await TP.preview({ candidateId: cand2.id });
  check('from the candidate: the real employee is kept, and the preview says so', pv2.status === 200 && pv2.body.employees.length === 0 && pv2.body.kept.some((k) => k.includes('real person')), pv2.body);
  const done2 = await TP.run(boss, { candidateId: cand2.id }, cand2.name);
  if (done2.body.copy) copies.push(done2.body.copy);
  check('the test joining goes, the real employee and their login stay',
    done2.status === 200 && !(await prisma.application.findUnique({ where: { id: app2.id } })) && !!(await prisma.employee.findUnique({ where: { id: realE.id } })) && !!(await prisma.user.findUnique({ where: { id: realU.id } })), done2.body);

  console.log('Refused');
  const oldU = await mkUser('Old');
  const oldE = await mkEmp('O', oldU);
  await prisma.employee.update({ where: { id: oldE.id }, data: { createdAt: new Date(Date.now() - 90 * DAY) } });
  const r1 = await TP.preview({ userId: oldU.id });
  check('an employee on record for more than 30 days', r1.status === 409 && /real person/.test(r1.body.error), r1.body);
  const admU = await mkUser('Adm', { role: 'ADMIN' });
  const r2 = await TP.preview({ userId: admU.id });
  check('an Admin login', r2.status === 409 && /Admin/.test(r2.body.error), r2.body);
  const cand3 = await prisma.candidate.create({ data: { name: `ZZTEST Cand3 ${R}` } });
  const client = await prisma.client.findFirst({ select: { id: true } });
  await prisma.invoice.create({ data: { clientId: client.id, amount: 1, invoiceDate: '2026-11-01', candidateId: cand3.id } });
  const r3 = await TP.preview({ candidateId: cand3.id });
  check('a candidate with an invoice', r3.status === 409 && /invoice/.test(r3.body.error), r3.body);
  const meU = await mkUser('Me');
  await mkEmp('M', meU);
  const r4 = await TP.run(meU, { userId: meU.id }, `ZZM${R}`);
  check('your own login', r4.status === 400, r4.body);

  console.log(failed ? `\n${failed} of ${total} checks FAILED` : `\nAll ${total} checks passed`);
  copies.forEach((c) => { try { fs.unlinkSync(path.join(__dirname, '..', 'backups', 'deleted-people', c)); } catch { /* none */ } });
  await prisma.$disconnect().catch(() => {});
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(COPY + s); } catch { /* none */ } }
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
