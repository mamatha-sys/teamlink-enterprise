#!/usr/bin/env node
// ---------------------------------------------------------------------------
// TIMESHEET > CHECKLIST (founder 2026-11-03). SANDBOX ONLY.
//   cd backend && npm run sandbox -- --restart --detach --no-watch && TL_API=http://localhost:4011 node scripts/timesheet-checklist-test.js
// Proves: a person saves a row (today by default: from / to, status, description); bad input is refused; each person sees only
// their own rows; a TL also sees their team, not other teams; the Super Admin sees everyone with departments and counts; only
// the writer can change or remove a row.
// ---------------------------------------------------------------------------
const Z = require('./lib/zzfix')('TCL');

(async () => {
  const { prisma } = Z;
  const userIds = [];
  try {
    const opt = { hrmsAccess: true, atsRole: 'NONE', atsAccess: false };
    const tl = await Z.mkUser('tl', { role: 'TL', hrmsRole: 'TL', ...opt }, { designation: 'TL', department: 'ZZTEST Medical' });
    const emp = await Z.mkUser('emp', { role: 'EMPLOYEE', hrmsRole: 'EMPLOYEE', ...opt }, { designation: 'Employee', department: 'ZZTEST Medical' });
    const out = await Z.mkUser('out', { role: 'EMPLOYEE', hrmsRole: 'EMPLOYEE', ...opt }, { designation: 'Employee', department: 'ZZTEST Education' });
    const sa = await Z.mkUser('sa', { role: 'SUPER_ADMIN', hrmsRole: 'SUPER_ADMIN', ...opt }, { designation: 'Super Admin', department: 'ZZTEST Management' });
    userIds.push(tl.id, emp.id, out.id, sa.id);
    const tlEmp = await prisma.employee.findFirst({ where: { userId: tl.id } });
    await prisma.employee.updateMany({ where: { userId: emp.id }, data: { reportingManagerId: tlEmp.id } });
    const T = await Z.mint(tl); const E = await Z.mint(emp); const O = await Z.mint(out); const S = await Z.mint(sa);
    const day = (n) => new Date(Date.now() + 330 * 60000 + n * 86400000).toISOString().slice(0, 10);

    const a = await Z.call('POST', '/api/timesheet-checklist', E, { fromTime: '09:30', toTime: '11:00', status: 'Completed', description: 'ZZTEST TCL called 20 candidates' });
    Z.check('K1 a person saves a row; the day is today by default', a.status === 201 && a.body.date === day(0) && a.body.status === 'Completed', [a.status, a.body.date, a.body.error]);
    const bad1 = await Z.call('POST', '/api/timesheet-checklist', E, { fromTime: '11:00', toTime: '10:00', status: 'Pending', description: 'x' });
    const bad2 = await Z.call('POST', '/api/timesheet-checklist', E, { fromTime: '10:00', toTime: '11:00', status: 'Done?', description: 'x' });
    const bad3 = await Z.call('POST', '/api/timesheet-checklist', E, { fromTime: '10:00', toTime: '11:00', status: 'Pending', description: '  ' });
    const bad4 = await Z.call('POST', '/api/timesheet-checklist', E, { date: day(1), fromTime: '10:00', toTime: '11:00', status: 'Pending', description: 'future' });
    Z.check('K2 refused: end before start, unknown status, no description, a day in the future', [bad1, bad2, bad3, bad4].every((r) => r.status === 400), [bad1.status, bad2.status, bad3.status, bad4.status]);
    await Z.call('POST', '/api/timesheet-checklist', T, { fromTime: '10:00', toTime: '12:00', status: 'In Progress', description: 'ZZTEST TCL team review' });
    await Z.call('POST', '/api/timesheet-checklist', O, { fromTime: '09:00', toTime: '10:00', status: 'Pending', description: 'ZZTEST TCL other team' });

    const ge = (await Z.call('GET', '/api/timesheet-checklist', E)).body;
    Z.check('K3 a person sees only their own rows, no department or people lists', ge.scope === 'self' && ge.rows.length === 1 && ge.rows[0].mine && !ge.people.length, [ge.scope, ge.rows.length]);
    const gt = (await Z.call('GET', '/api/timesheet-checklist', T)).body;
    const tlNames = gt.rows.map((r) => r.userId);
    Z.check('K4 a TL sees their own and their team, not another team', gt.scope === 'team' && tlNames.includes(emp.id) && tlNames.includes(tl.id) && !tlNames.includes(out.id), [gt.scope, gt.rows.length]);
    const gs = (await Z.call('GET', '/api/timesheet-checklist', S)).body;
    const mine3 = gs.rows.filter((r) => userIds.includes(r.userId));
    const depts = Object.fromEntries(gs.departments.map((d) => [d.department, d.count]));
    Z.check('K5 the Super Admin sees everyone, with departments and counts', gs.scope === 'all' && mine3.length === 3 && depts['ZZTEST Medical'] === 2 && depts['ZZTEST Education'] === 1, [gs.scope, mine3.length, depts]);
    const gsd = (await Z.call('GET', '/api/timesheet-checklist?department=ZZTEST%20Education', S)).body;
    Z.check('K6 ...and can narrow to one department', gsd.rows.length >= 1 && gsd.rows.every((r) => r.department === 'ZZTEST Education'), gsd.rows.map((r) => r.department));
    const ot = (await Z.call('GET', '/api/timesheet-checklist?department=ZZTEST%20Education', E)).body;
    Z.check('K7 a person cannot reach other rows with filters', ot.rows.every((r) => r.userId === emp.id), ot.rows.length);

    const tryEdit = await Z.call('PUT', `/api/timesheet-checklist/${a.body.id}`, T, { status: 'Pending' });
    const tryDel = await Z.call('DELETE', `/api/timesheet-checklist/${a.body.id}`, S);
    Z.check('K8 nobody else (not the TL, not the Super Admin) can change or remove a row', tryEdit.status === 403 && tryDel.status === 403, [tryEdit.status, tryDel.status]);
    const ed = await Z.call('PUT', `/api/timesheet-checklist/${a.body.id}`, E, { status: 'In Progress', toTime: '11:30' });
    Z.check('K9 the writer changes their row', ed.status === 200 && ed.body.status === 'In Progress' && ed.body.toTime === '11:30' && ed.body.fromTime === '09:30', [ed.status, ed.body]);
    const del = await Z.call('DELETE', `/api/timesheet-checklist/${a.body.id}`, E);
    const left = await prisma.timesheetChecklist.count({ where: { id: a.body.id } });
    Z.check('K10 ...and removes it', del.status === 200 && left === 0, [del.status, left]);
    const audits = await prisma.auditLog.count({ where: { entity: 'TimesheetChecklist', entityId: a.body.id } });
    Z.check('K11 every change is in the audit trail', audits === 3, audits);
  } catch (err) { Z.fail += 1; console.log('FAIL  crashed', err && err.stack ? err.stack.slice(0, 900) : err); } finally {
    try {
      const rows = await prisma.timesheetChecklist.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
      await prisma.auditLog.deleteMany({ where: { entity: 'TimesheetChecklist', userId: { in: userIds } } });
      await prisma.timesheetChecklist.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    } catch (e) { console.log('cleanup', String(e.message).slice(0, 160)); }
    await Z.cleanup().catch((e) => console.log('cleanup problem', String(e.message).slice(0, 160)));
    console.log(`\n${Z.pass} passed, ${Z.fail} failed`);
    await Z.prisma.$disconnect();
    process.exit(Z.fail ? 1 : 0);
  }
})();
