// ---------------------------------------------------------------------------
// DELETE A TEST PERSON COMPLETELY (founder 2026-11-09: "remove this one completely, in ats & hrms" - TL535 / TL534, test joinings).
//
// The ordinary deletes stop short on purpose: HRMS Delete leaves the login, ATS Delete refuses a candidate past New. This one
// removes the whole person - login, employee, candidate, applications and everything that hangs off them - for a record made
// by mistake or for a test. Super Admin only, from Administration -> Users or the candidate's page, always as a preview first
// and then a typed confirmation.
//
// WHAT GOES: the login picked (or the candidate picked), its employee record, the applications that made that employee, the
// candidate of those applications when nothing else of the candidate stays, the candidate's own portal login, and every row
// that points at one of them through the database's foreign keys (followed downwards, so nothing is left half-there).
// Rows that only NAME one of them and may lose the name (an audit line, a job's recruiter, an asset) keep their row; the database
// clears the name.
//
// WHAT NEVER GOES (refused, or kept and shown as kept):
//   * a Super Admin / Admin login, or one of the Internal HR list: refused
//   * an employee record older than 30 days: a real person's history - refused when picked
//   * an employee reached through an application that was on record BEFORE that application (the joining matched a real person): kept
//   * anything with an invoice: refused (billing)
//   * a candidate that still has other applications or another person's login: kept
// Every deleted row is written to backups/deleted-people/<time>-<name>.json first; without that copy nothing is deleted.
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const prisma = require('../db');

const RECENT_DAYS = 30;
const DIR = path.join(__dirname, '..', '..', 'backups', 'deleted-people');
// SET NULL children that belong to the person, so they go with them rather than stay as nameless rows
const OWNED = new Set(['Notification']);
const LABEL = {
  User: 'Login', Employee: 'Employee record', Candidate: 'Candidate', Application: 'Application (job)', ApplicationStageEvent: 'Step history',
  ApplicationFollowUp: 'Follow-ups', InterviewEvent: 'Interviews', InterviewFeedback: 'Interview feedback', OfferVersion: 'Offers',
  EmployeeDocument: 'Employee documents', CandidateDocument: 'Candidate documents', CandidateResume: 'Resumes', CandidateNote: 'Candidate notes',
  CandidateMessage: 'Messages', Attendance: 'Attendance', AttendancePunch: 'Attendance punches', LeaveRequest: 'Leave requests', LeaveBalance: 'Leave balance',
  Payslip: 'Payslips', SalaryStructure: 'Salary', SalaryStructureVersion: 'Salary history', PositionAssignment: 'Seat history', Notification: 'Notifications',
  monitoring_devices: 'Monitoring PCs', activity_logs: 'Monitoring activity', monitoring_consents: 'Monitoring consent', monitoring_alerts: 'Monitoring alerts',
};
const q = (sql, ...args) => prisma.$queryRawUnsafe(sql, ...args);
const quote = (n) => `"${String(n).replace(/"/g, '""')}"`;
const chunks = (xs, n = 400) => { const out = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out; };
const daysOld = (d) => (d ? (Date.now() - new Date(d).getTime()) / 86400000 : Infinity);

let graph = null;
async function fkGraph() {
  if (graph) return graph;
  const tables = (await q("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%'")).map((t) => t.name);
  const children = new Map();
  for (const t of tables) {
    // eslint-disable-next-line no-await-in-loop
    for (const fk of await q(`PRAGMA foreign_key_list(${quote(t)})`)) {
      const list = children.get(fk.table) || [];
      list.push({ table: t, col: fk.from, parentCol: fk.to || 'id', onDelete: String(fk.on_delete || 'NO ACTION').toUpperCase() });
      children.set(fk.table, list);
    }
  }
  graph = { children };
  return graph;
}

const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN'];
async function isProtectedLogin(u) {
  if ([u.role, u.hrmsRole, u.atsRole, u.accountsRole].some((r) => ADMIN_ROLES.includes(r))) return true;
  return !!(await require('./hrSuper').resolveFor(u)); // eslint-disable-line global-require
}

// Who and what: the four kinds of record, before following the database's links.
async function people({ userId, candidateId }) {
  const users = new Map(); const employees = new Map(); const candidates = new Map(); const apps = new Map(); const kept = [];
  const refuse = (error) => ({ refused: error });
  if (userId) {
    const u = await prisma.user.findUnique({ where: { id: String(userId) } });
    if (!u) return refuse('That login does not exist.');
    users.set(u.id, u);
    const e = await prisma.employee.findFirst({ where: { userId: u.id } });
    if (e) {
      if (daysOld(e.createdAt) > RECENT_DAYS) return refuse(`${e.name} (${e.employeeCode || 'no code'}) has been on record for more than ${RECENT_DAYS} days, so this is a real person's history. Use Disable or Exit instead.`);
      employees.set(e.id, e);
    }
    if (u.candidateId) {
      const c = await prisma.candidate.findUnique({ where: { id: u.candidateId } });
      if (c) candidates.set(c.id, c);
    }
  }
  if (candidateId) {
    const c = await prisma.candidate.findUnique({ where: { id: String(candidateId) } });
    if (!c) return refuse('That candidate does not exist.');
    candidates.set(c.id, c);
    (await prisma.application.findMany({ where: { candidateId: c.id } })).forEach((a) => apps.set(a.id, a));
  }
  // the applications that made these employees
  if (employees.size) (await prisma.application.findMany({ where: { hrmsEmployeeId: { in: [...employees.keys()] } } })).forEach((a) => apps.set(a.id, a));
  // the employees these applications made - only recent ones; an older record stays
  const madeIds = [...new Set([...apps.values()].map((a) => a.hrmsEmployeeId).filter((id) => id && !employees.has(id)))];
  for (const e of madeIds.length ? await prisma.employee.findMany({ where: { id: { in: madeIds } } }) : []) {
    const madeBy = [...apps.values()].filter((a) => a.hrmsEmployeeId === e.id).map((a) => new Date(a.createdAt).getTime());
    if (daysOld(e.createdAt) > RECENT_DAYS || new Date(e.createdAt).getTime() < Math.min(...madeBy)) {
      kept.push(`${e.name} (${e.employeeCode || 'employee'}) is kept: this employee record existed before the joining, so it is a real person.`);
      continue;
    }
    employees.set(e.id, e);
    if (e.userId && !users.has(e.userId)) {
      const u = await prisma.user.findUnique({ where: { id: e.userId } }); // eslint-disable-line no-await-in-loop
      if (u) users.set(u.id, u);
    }
  }
  // the candidates of these applications: only when every application of theirs goes too
  const candIds = [...new Set([...apps.values()].map((a) => a.candidateId))];
  for (const cid of candIds) {
    // eslint-disable-next-line no-await-in-loop
    const all = await prisma.application.findMany({ where: { candidateId: cid }, select: { id: true } });
    // eslint-disable-next-line no-await-in-loop
    const c = await prisma.candidate.findUnique({ where: { id: cid } });
    if (!c) continue;
    if (all.every((a) => apps.has(a.id))) candidates.set(c.id, c);
    else if (!candidates.has(c.id)) kept.push(`${c.name} (candidate) is kept: they have other applications.`);
  }
  // a picked candidate always takes all their applications (above); a candidate's own portal logins go with them
  for (const c of [...candidates.values()]) {
    // eslint-disable-next-line no-await-in-loop
    for (const u of await prisma.user.findMany({ where: { candidateId: c.id } })) users.set(u.id, u);
  }
  // a login that belongs to an employee we keep is not ours to delete
  for (const u of [...users.values()]) {
    // eslint-disable-next-line no-await-in-loop
    const e = await prisma.employee.findFirst({ where: { userId: u.id }, select: { id: true, name: true } });
    if (e && !employees.has(e.id)) { users.delete(u.id); kept.push(`${u.name}'s login is kept: it belongs to an employee record that stays.`); }
  }
  for (const u of users.values()) {
    // eslint-disable-next-line no-await-in-loop
    if (await isProtectedLogin(u)) return refuse(`${u.name} is a Super Admin, Admin or Internal HR login. It cannot be deleted here.`);
  }
  const candOfApps = [...new Set([...apps.values()].map((a) => a.candidateId))];
  const invoices = await prisma.invoice.count({ where: { candidateId: { in: [...new Set([...candidates.keys(), ...candOfApps])] } } });
  if (invoices) return refuse(`There ${invoices === 1 ? 'is an invoice' : `are ${invoices} invoices`} for this person, so it is billing history and cannot be deleted.`);
  return { users, employees, candidates, apps, kept };
}

// Every row to delete, with how deep it sits (children first when deleting).
async function rowsOf(p) {
  const { children } = await fkGraph();
  const found = new Map(); // table -> Map(rowid -> { row, depth })
  const visit = async (table, col, values, depth) => {
    for (const part of chunks([...new Set(values)].filter((v) => v !== null && v !== undefined))) {
      // eslint-disable-next-line no-await-in-loop
      const rows = await q(`SELECT rowid AS "__rowid", * FROM ${quote(table)} WHERE ${quote(col)} IN (${part.map(() => '?').join(',')})`, ...part);
      const fresh = [];
      const m = found.get(table) || new Map();
      rows.forEach((r) => {
        const k = String(r.__rowid);
        const had = m.get(k);
        if (!had) { m.set(k, { row: r, depth }); fresh.push(r); } else if (had.depth < depth) { had.depth = depth; fresh.push(r); }
      });
      found.set(table, m);
      for (const fk of children.get(table) || []) {
        const follow = ['CASCADE', 'RESTRICT', 'NO ACTION'].includes(fk.onDelete) || (fk.onDelete === 'SET NULL' && OWNED.has(fk.table));
        // eslint-disable-next-line no-await-in-loop
        if (follow && fresh.length) await visit(fk.table, fk.col, fresh.map((r) => r[fk.parentCol]), depth + 1);
      }
    }
  };
  await visit('Application', 'id', [...p.apps.keys()], 1);
  await visit('Candidate', 'id', [...p.candidates.keys()], 0);
  await visit('Employee', 'id', [...p.employees.keys()], 0);
  await visit('User', 'id', [...p.users.keys()], 0);
  return found;
}

const summary = (found) => [...found.entries()].map(([table, m]) => ({ table, label: LABEL[table] || table, count: m.size })).filter((x) => x.count)
  .sort((a, b) => (LABEL[b.table] ? 1 : 0) - (LABEL[a.table] ? 1 : 0) || b.count - a.count);
const nameOf = (p) => [...p.employees.values()][0]?.name || [...p.users.values()][0]?.name || [...p.candidates.values()][0]?.name || 'this person';
const codeOf = (p) => [...p.employees.values()][0]?.employeeCode || '';

async function preview(target) {
  const p = await people(target);
  if (p.refused) return { status: 409, body: { error: p.refused } };
  const found = await rowsOf(p);
  return {
    status: 200,
    body: {
      name: nameOf(p), code: codeOf(p), confirmWord: codeOf(p) || nameOf(p),
      logins: [...p.users.values()].map((u) => ({ name: u.name, email: u.email })),
      employees: [...p.employees.values()].map((e) => ({ name: e.name, code: e.employeeCode })),
      candidates: [...p.candidates.values()].map((c) => ({ name: c.name, phone: c.phone })),
      applications: p.apps.size,
      rows: summary(found), kept: p.kept,
    },
  };
}

async function run(actor, target, confirm) {
  const p = await people(target);
  if (p.refused) return { status: 409, body: { error: p.refused } };
  const word = codeOf(p) || nameOf(p);
  if (String(confirm || '').trim().toLowerCase() !== String(word).trim().toLowerCase()) return { status: 400, body: { error: `Type ${word} exactly to confirm.` } };
  if (p.users.has(actor.id)) return { status: 400, body: { error: 'You cannot delete your own login.' } };
  const found = await rowsOf(p);
  // the copy first: without it nothing is deleted
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(DIR, `${stamp}-${String(word).replace(/[^\w.-]+/g, '_').slice(0, 40)}.json`);
  const copy = { deletedAt: new Date().toISOString(), by: { id: actor.id, name: actor.name }, target, tables: {} };
  found.forEach((m, table) => { copy.tables[table] = [...m.values()].map((x) => x.row); });
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(copy, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 1));
  } catch (e) {
    return { status: 500, body: { error: `The safety copy could not be written (${e.message}), so nothing was deleted.` } };
  }
  const order = [];
  found.forEach((m, table) => m.forEach((x, rowid) => order.push({ table, rowid, depth: x.depth })));
  order.sort((a, b) => b.depth - a.depth);
  const ops = [];
  let i = 0;
  while (i < order.length) {
    const { table, depth } = order[i];
    const ids = [];
    while (i < order.length && order[i].table === table && order[i].depth === depth && ids.length < 400) { ids.push(order[i].rowid); i += 1; }
    ops.push(prisma.$executeRawUnsafe(`DELETE FROM ${quote(table)} WHERE rowid IN (${ids.map(() => '?').join(',')})`, ...ids.map(Number)));
  }
  try {
    await prisma.$transaction(ops);
  } catch (e) {
    return { status: 409, body: { error: `Nothing was deleted: ${e.message.split('\n').slice(-1)[0]}` } };
  }
  try { const { markCandidateDirty } = require('./candidateListCache'); p.candidates.forEach((c) => markCandidateDirty(c.id)); } catch { /* list cache is optional */ } // eslint-disable-line global-require
  const rows = summary(found);
  await require('./audit').logAudit({ // eslint-disable-line global-require
    userId: actor.id, action: 'Test person deleted completely', entity: 'User', entityId: target.userId || target.candidateId,
    fromValue: `${nameOf(p)}${codeOf(p) ? ` (${codeOf(p)})` : ''}`, toValue: rows.map((r) => `${r.label}: ${r.count}`).join(', ').slice(0, 1000),
    reason: `Copy kept on the server: backups/deleted-people/${path.basename(file)}`,
  });
  return { status: 200, body: { ok: true, message: `${nameOf(p)} is deleted completely. A copy of every removed row is kept on the server.`, rows, copy: path.basename(file) } };
}

module.exports = { preview, run, RECENT_DAYS };
