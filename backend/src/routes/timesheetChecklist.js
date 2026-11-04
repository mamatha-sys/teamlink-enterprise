// ---------------------------------------------------------------------------
// /api/timesheet-checklist — Timesheet > Checklist (founder 2026-11-03: "timesheet lo checklist: today date and time from and to,
// completed / pending / on processing status and description save; valla checklist matram vallaki kanipinchali; superadmin ki
// department wise, TLs ki valla team checklist matram").
//
//   GET    /?date=YYYY-MM-DD&department=&userId=   rows this login may see (+ departments with counts, people, who-am-I)
//   POST   /                                       add MY row { date?, fromTime, toTime, status, description }
//   PUT    /:id                                    change MY row
//   DELETE /:id                                    remove MY row
//
// Who sees what: everyone their OWN rows; a TL also their team (everyone under them on the reporting line); the Super Admin
// everyone, grouped by department. Only the person who wrote a row may change or remove it. A day in the future is refused.
// ---------------------------------------------------------------------------
const express = require('express');
const prisma = require('../db');
const { requireAuth, requirePerm } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

const router = express.Router();
router.use(requireAuth);
const VIEW = requirePerm('hrms', 'hrms', 'Employee Services', 'view');

const STATUSES = ['Completed', 'Pending', 'In Progress'];
const istToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ''));
const isSuperAdmin = (me) => [me.role, me.hrmsRole].some((r) => String(r || '').toUpperCase() === 'SUPER_ADMIN');
const EMP_SELECT = { id: true, userId: true, name: true, employeeCode: true, department: true, team: true, designation: true };

// Everyone under this employee on the reporting line (their team, and their team's team).
async function teamUnder(employeeId) {
  const seen = new Set();
  let frontier = [employeeId];
  const out = [];
  for (let depth = 0; frontier.length && depth < 6; depth += 1) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await prisma.employee.findMany({ where: { reportingManagerId: { in: frontier } }, select: EMP_SELECT });
    frontier = [];
    for (const e of rows) if (!seen.has(e.id)) { seen.add(e.id); out.push(e); frontier.push(e.id); }
  }
  return out;
}

// { me, mine (employee row), scope: 'all' | 'team' | 'self', people: employees this login may see }
async function reach(user) {
  const mine = await prisma.employee.findUnique({ where: { userId: user.id }, select: EMP_SELECT });
  if (isSuperAdmin(user)) {
    const people = await prisma.employee.findMany({ where: { userId: { not: null } }, select: EMP_SELECT });
    return { mine, scope: 'all', people };
  }
  const team = mine ? await teamUnder(mine.id) : [];
  const people = [...(mine ? [mine] : []), ...team].filter((e) => e.userId);
  return { mine, scope: team.length ? 'team' : 'self', people };
}

function clean(body, { partial = false } = {}) {
  const b = body || {};
  const out = {};
  const errors = {};
  if (!partial || b.date !== undefined) {
    const d = b.date ? String(b.date) : istToday();
    if (!isDay(d)) errors.date = 'Pick a date.';
    else if (d > istToday()) errors.date = 'A day in the future cannot be filled in yet.';
    else out.date = d;
  }
  for (const k of ['fromTime', 'toTime']) {
    if (!partial || b[k] !== undefined) {
      if (!isTime(b[k])) errors[k] = k === 'fromTime' ? 'Pick the start time.' : 'Pick the end time.';
      else out[k] = String(b[k]);
    }
  }
  if (out.fromTime && out.toTime && out.toTime <= out.fromTime) errors.toTime = 'The end time must be after the start time.';
  if (!partial || b.status !== undefined) {
    if (!STATUSES.includes(b.status)) errors.status = 'Pick Completed, Pending or In Progress.';
    else out.status = b.status;
  }
  if (!partial || b.description !== undefined) {
    const t = String(b.description || '').trim();
    if (!t) errors.description = 'Write what you did.';
    else out.description = t.slice(0, 2000);
  }
  return { out, errors };
}

router.get('/', VIEW, async (req, res, next) => {
  try {
    const { mine, scope, people } = await reach(req.user);
    const date = isDay(req.query.date) ? String(req.query.date) : istToday();
    // FILTERS (founder 2026-11-04: "paina filters add chey"): a day range (date .. to, at most 62 days), status, and words to find
    const to = isDay(req.query.to) && String(req.query.to) >= date ? String(req.query.to) : date;
    const status = STATUSES.includes(req.query.status) ? String(req.query.status) : null;
    const q = String(req.query.q || '').trim().toLowerCase().slice(0, 100);
    const byUser = new Map(people.map((p) => [p.userId, p]));
    const rows = await prisma.timesheetChecklist.findMany({
      where: { date: { gte: date, lte: to }, userId: { in: [...byUser.keys()] }, ...(status ? { status } : {}) },
      orderBy: [{ date: 'desc' }, { fromTime: 'asc' }, { createdAt: 'asc' }],
      take: 3000,
    });
    const decorate = (r) => {
      const p = byUser.get(r.userId) || {};
      return { ...r, name: p.name || '', employeeCode: p.employeeCode || '', department: p.department || 'No department', team: p.team || '', mine: r.userId === req.user.id };
    };
    const all = rows.map(decorate);
    const departments = [...new Set(all.map((r) => r.department))].sort().map((d) => ({ department: d, count: all.filter((r) => r.department === d).length }));
    let shown = q ? all.filter((r) => `${r.description} ${r.name} ${r.employeeCode}`.toLowerCase().includes(q)) : all;
    if (scope !== 'self' && req.query.department) shown = shown.filter((r) => r.department === req.query.department);
    if (scope !== 'self' && req.query.userId) shown = shown.filter((r) => r.userId === String(req.query.userId));
    res.json({
      date, to, today: istToday(), scope, statuses: STATUSES, canWrite: !!mine,
      departments,
      people: scope === 'self' ? [] : people.map((p) => ({ userId: p.userId, name: p.name, employeeCode: p.employeeCode, department: p.department || 'No department' })).sort((a, b) => a.name.localeCompare(b.name)),
      rows: shown,
    });
  } catch (err) { next(err); }
});

router.post('/', VIEW, async (req, res, next) => {
  try {
    const mine = await prisma.employee.findUnique({ where: { userId: req.user.id }, select: { id: true } });
    if (!mine) return res.status(403).json({ error: 'Only an employee can fill in a checklist.' });
    const { out, errors } = clean(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ error: Object.values(errors)[0], fields: errors });
    const row = await prisma.timesheetChecklist.create({ data: { ...out, userId: req.user.id, employeeId: mine.id } });
    await logAudit({ userId: req.user.id, action: 'Checklist entry added', entity: 'TimesheetChecklist', entityId: row.id, toValue: `${row.date} ${row.fromTime}-${row.toTime} ${row.status}` });
    res.status(201).json(row);
  } catch (err) { next(err); }
});

async function ownRow(req, res) {
  const row = await prisma.timesheetChecklist.findUnique({ where: { id: req.params.id } });
  if (!row) { res.status(404).json({ error: 'Checklist entry not found.' }); return null; }
  if (row.userId !== req.user.id) { res.status(403).json({ error: 'Only the person who wrote it can change it.' }); return null; }
  return row;
}

router.put('/:id', VIEW, async (req, res, next) => {
  try {
    const row = await ownRow(req, res);
    if (!row) return undefined;
    const { out, errors } = clean({ ...row, ...req.body });
    if (Object.keys(errors).length) return res.status(400).json({ error: Object.values(errors)[0], fields: errors });
    const saved = await prisma.timesheetChecklist.update({ where: { id: row.id }, data: out });
    await logAudit({ userId: req.user.id, action: 'Checklist entry changed', entity: 'TimesheetChecklist', entityId: row.id, fromValue: `${row.fromTime}-${row.toTime} ${row.status}`, toValue: `${saved.fromTime}-${saved.toTime} ${saved.status}` });
    return res.json(saved);
  } catch (err) { return next(err); }
});

router.delete('/:id', VIEW, async (req, res, next) => {
  try {
    const row = await ownRow(req, res);
    if (!row) return undefined;
    await prisma.timesheetChecklist.delete({ where: { id: row.id } });
    await logAudit({ userId: req.user.id, action: 'Checklist entry removed', entity: 'TimesheetChecklist', entityId: row.id, fromValue: `${row.date} ${row.fromTime}-${row.toTime} ${row.status}` });
    return res.json({ ok: true });
  } catch (err) { return next(err); }
});

module.exports = router;
