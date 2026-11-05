// ---------------------------------------------------------------------------
// /api/monitoring - EMPLOYEE MONITORING (2026-11-04, utils/monitoring.js has the rules and the privacy notes).
//
// THE DESKTOP AGENT (no browser login; "Authorization: Device <token>" after registering):
//   POST /devices/register   { email, password, deviceName, os, acceptPolicyVersion? }   the employee's own TeamLink login.
//                            -> 412 { consentRequired, policyVersion, policyText } until they accept the notice, then
//                            -> { deviceToken, settings }  (the token is shown once; only its hash is kept)
//                            { setupCode, deviceName, os, acceptPolicyVersion? }   the same with a one-time code from TeamLink
//   POST /activity           { records: [{ appName, windowTitle, start, end, isIdle }] }   every 1-5 minutes
//   POST /heartbeat          -> { settings, consentRequired }   updates last seen
// THE SCREENS (a TeamLink login; HR / Admin see everyone, anybody else only themselves):
//   GET  /overview?date=                         the Live Dashboard: HR / Admin everyone, a TL / STL / Manager their team
//   GET  /employee/:id?from=&to=                 the same reach, or :id = me (a look at someone else is audited)
//   GET  /reports?from=&to=&department=&view=employee|daily|team&format=   the same reach (format=xlsx|csv|pdf: the file)
//   GET  /usage?from=&to=&department=            top apps, top websites, the productive split
//   GET  /audit?from=&to=                        HR / Admin: who looked at what, exports, settings, PCs
//   GET/POST/PUT/DELETE /app-categories          HR / Admin (GET: + apps seen with no category)
//   GET/PUT /settings                            HR / Admin (GET is open to everyone: work hours and the notice)
//   GET  /devices, PUT /devices/:id/deactivate   HR / Admin all; an employee their own PCs
//   GET  /me, POST /me/consent                   my notice, my consent, my PCs
//   POST /setup-code { employeeId? }              a one-time code for the agent: HR / Admin for anyone, an employee for themselves
//   GET  /people?q=                              HR / Admin: find an employee for a code
//   GET  /agent                                  the double-click setup file holding the PC agent, for any TeamLink login
// The general API limit counts an agent per device (utils/apiRateLimit.js), with its own strict limits.
// ---------------------------------------------------------------------------
const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../db');
const { requireAuth } = require('../middleware/auth');
const { resolveIdentity } = require('../utils/identity');
const { ipOf } = require('../utils/clientIp');
const { logAudit } = require('../utils/audit');
const M = require('../utils/monitoring');

const router = express.Router();
const fail = (res, status, error, extra = {}) => res.status(status).json({ error, ...extra });
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const publicSettings = (s) => ({
  workStart: s.workStart, workEnd: s.workEnd, idleThresholdMinutes: s.idleThresholdMinutes, retentionDays: s.retentionDays,
  screenshotsEnabled: false, policyVersion: s.policyVersion,
});

// =============================================================== the agent
router.post('/devices/register', wrap(async (req, res) => {
  const b = req.body || {};
  // a one-time code from TeamLink, or the employee's own email and password
  const setupCode = String(b.setupCode || '').trim();
  let who;
  if (setupCode) {
    const c = await M.readSetupCode(setupCode);
    if (!c) return fail(res, 401, 'This set-up code is wrong or has expired. Get a new one from TeamLink.');
    const emp = await prisma.employee.findUnique({ where: { id: c.employeeId }, select: { id: true, name: true, employmentStatus: true } });
    if (!emp || ['Exited', 'Relieved', 'Terminated'].includes(emp.employmentStatus)) return fail(res, 403, 'This employee is not active.');
    who = { employeeId: emp.id, name: emp.name, userId: null };
  } else {
    const email = String(b.email || '').trim();
    const pw = String(b.password || '');
    if (!email || !pw) return fail(res, 400, 'Type your TeamLink email and password.');
    const { isLocked, MAX_FAILED_LOGINS, LOCK_MINUTES } = require('../utils/passwordPolicy'); // eslint-disable-line global-require
    const { accounts } = await require('../utils/loginAccounts').resolveIdentifier(email); // eslint-disable-line global-require
    // the same rules as the website's sign-in: a locked login says so, and wrong tries lock it
    if (accounts.length && accounts.every(isLocked)) {
      const until = accounts.map((u) => new Date(u.lockedUntil).getTime()).sort((a, b) => a - b)[0];
      const mins = Math.max(1, Math.ceil((until - Date.now()) / 60000));
      return fail(res, 423, `This login is locked after too many wrong passwords. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`);
    }
    const matched = [];
    for (const u of accounts) {
      // eslint-disable-next-line no-await-in-loop
      if (!isLocked(u) && u.passwordHash && await bcrypt.compare(pw, u.passwordHash)) matched.push(u);
    }
    if (!matched.length) {
      if (accounts.length === 1) {
        const failed = (accounts[0].failedLoginCount || 0) + 1;
        const lock = failed >= MAX_FAILED_LOGINS;
        await prisma.user.update({ where: { id: accounts[0].id }, data: lock ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60000) } : { failedLoginCount: failed } }).catch(() => {});
      }
      await logAudit({ action: 'Monitoring agent: wrong sign-in', entity: 'User', toValue: email.slice(0, 120), reason: `IP ${ipOf(req)}` }).catch(() => {});
      return fail(res, 401, 'The email or password is not right. Use the same email and password as the TeamLink website.');
    }
    // several logins on one email and password: the one with an employee record (a PC belongs to an employee)
    let user = matched[0];
    let idn = await resolveIdentity(user.id);
    for (const u of matched.slice(1)) {
      if (idn && idn.employeeId) break;
      // eslint-disable-next-line no-await-in-loop
      const other = await resolveIdentity(u.id);
      if (other && other.employeeId) { user = u; idn = other; }
    }
    if (!idn || (idn.status && idn.status !== 'Active') || require('../utils/leftLogin').hasLeft(idn)) return fail(res, 403, 'This login is not active.'); // eslint-disable-line global-require
    if (user.failedLoginCount) await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0 } }).catch(() => {});
    if (!idn.employeeId) return fail(res, 403, 'This is a service login with no employee record. Sign in with the TeamLink login of the employee who uses this PC.');
    who = { employeeId: idn.employeeId, name: idn.name, userId: user.id };
  }
  const s = await M.settings();
  // NO HIDDEN MODE: the employee accepts the notice (this version) before the PC is registered
  if (!(await M.hasConsent(who.employeeId, s.policyVersion))) {
    if (Number(b.acceptPolicyVersion) !== s.policyVersion) return fail(res, 412, 'Please read and accept the monitoring notice first.', { consentRequired: true, policyVersion: s.policyVersion, policyText: s.policyText });
    await M.recordConsent(who.employeeId, s.policyVersion, ipOf(req), 'Agent');
  }
  const { token, device } = await M.registerDevice({ employeeId: who.employeeId, deviceName: b.deviceName, os: b.os });
  if (setupCode) await M.endSetupCode(setupCode); // one use
  await logAudit({ userId: who.userId, actorName: who.name, action: setupCode ? 'Monitoring: PC registered with a set-up code' : 'Monitoring: PC registered', entity: 'MonitoringDevice', entityId: device.id, toValue: `${device.deviceName} · ${who.name}` }).catch(() => {});
  return res.status(201).json({ deviceToken: token, deviceId: device.id, employee: who.name, settings: publicSettings(s) });
}));

const agent = wrap(async (req, res, next) => {
  const d = await M.deviceOf(req);
  if (!d) return fail(res, 401, 'This PC is not registered, or it was switched off by HR. Register it again.');
  req.device = d;
  return next();
});
router.post('/activity', agent, wrap(async (req, res) => {
  const out = await M.ingest(req.device, (req.body || {}).records);
  if (out.error) return res.status(out.status).json(out);
  return res.json({ saved: out.saved, skipped: out.skipped });
}));
router.post('/heartbeat', agent, wrap(async (req, res) => {
  await M.heartbeat(req.device, req.body || {});
  const s = await M.settings();
  const consent = await M.hasConsent(req.device.employeeId, s.policyVersion);
  return res.json({ settings: publicSettings(s), consentRequired: !consent, ...(consent ? {} : { policyText: s.policyText }) });
}));
// a new notice accepted on the PC itself
router.post('/consent', agent, wrap(async (req, res) => {
  const s = await M.settings();
  if (Number((req.body || {}).policyVersion) !== s.policyVersion) return fail(res, 409, 'The notice has changed; read the new one.', { policyVersion: s.policyVersion, policyText: s.policyText });
  await M.recordConsent(req.device.employeeId, s.policyVersion, ipOf(req), 'Agent');
  return res.json({ ok: true });
}));

// =============================================================== the screens
router.use(requireAuth);
// clients, candidates and other outside logins have no monitoring at all
router.use((req, res, next) => (['CLIENT', 'CANDIDATE'].includes(req.user.role) ? fail(res, 403, 'This is not part of your login.') : next()));
const teamOnly = wrap(async (req, res, next) => {
  req.access = await M.accessOf(req.user);
  if (!req.access.admin && !req.access.lead) return fail(res, 403, 'You can see your own activity under My activity.');
  return next();
});
const adminOnly = (req, res, next) => (M.isMonitorAdmin(req.user) ? next() : fail(res, 403, 'Employee monitoring is for HR and Admin. You can see your own activity under My activity.'));

router.get('/overview', teamOnly, wrap(async (req, res) => res.json(await M.overview(req.query.date, req.access))));

router.get('/employee/:id', wrap(async (req, res) => {
  const id = req.params.id === 'me' ? req.user.employeeId : req.params.id;
  if (!id) return fail(res, 404, 'Your login has no employee record.');
  const access = await M.accessOf(req.user);
  if (access.ids && !access.ids.includes(id)) return fail(res, 403, 'You can see only your own activity.');
  const out = await M.employeeDetail(id, req.query.from, req.query.to);
  if (!out) return fail(res, 404, 'Employee not found.');
  if (id !== req.user.employeeId) await logAudit({ userId: req.user.id, actorName: req.user.name, action: 'Monitoring: looked at the activity of', entity: 'Monitoring', entityId: id, toValue: `${out.employee.name} · ${out.from} to ${out.to}` }).catch(() => {});
  return res.json(out);
}));

router.get('/reports', teamOnly, wrap(async (req, res) => {
  const view = ['daily', 'team'].includes(req.query.view) ? req.query.view : 'employee';
  const out = await M.reportRows(req.query.from, req.query.to, req.query.department || '', req.access, view);
  const KIT = require('../utils/exportKit'); // eslint-disable-line global-require
  const format = req.query.format ? KIT.formatOf(req.query) : null;
  if (!format) return res.json(out);
  const pct = (v) => (v == null ? '' : `${v}%`);
  const tm = (d) => (d ? new Date(d).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }) : '');
  const nums = (r) => [r.activeHours, r.idleHours, r.breakHours, r.productiveHours, r.unproductiveHours, pct(r.productivity)];
  const tail = ['Active hours', 'Idle hours', 'Break hours', 'Productive hours', 'Unproductive hours', 'Productivity'];
  const table = {
    employee: [['Employee', 'Code', 'Department', 'Days', ...tail], (r) => [r.name, r.code || '', r.department || '', r.days, ...nums(r)]],
    daily: [['Date', 'Employee', 'Code', 'Department', 'Login', 'Logout', ...tail], (r) => [r.day, r.name, r.code || '', r.department || '', tm(r.login), tm(r.logout), ...nums(r)]],
    team: [['Department', 'Employees', ...tail], (r) => [r.name, r.employees, ...nums(r)]],
  }[view];
  return KIT.sendTable(req, res, {
    format, name: `employee-monitoring-${view}-${out.from}-to-${out.to}`, title: `Employee monitoring ${out.from} to ${out.to}${req.query.department ? ` · ${req.query.department}` : ''}`,
    headers: table[0], rows: out.rows.map(table[1]),
    sheet: 'Monitoring', entity: 'ActivityLog', what: 'Employee monitoring report', scope: req.query.department || 'All departments', period: { from: out.from, to: out.to }, screen: 'Employee Monitoring',
  });
}));

router.get('/usage', teamOnly, wrap(async (req, res) => res.json(await M.usage(req.query.from, req.query.to, req.query.department || '', req.access))));

router.get('/audit', adminOnly, wrap(async (req, res) => res.json(await M.auditRows(req.query.from, req.query.to))));

// --- app categories
router.get('/app-categories', adminOnly, wrap(async (req, res) => {
  const [rows, unset, depts] = await Promise.all([
    prisma.appCategory.findMany({ orderBy: [{ department: 'asc' }, { appName: 'asc' }] }), M.uncategorised(),
    prisma.employee.findMany({ where: { department: { not: null } }, select: { department: true }, distinct: ['department'] }),
  ]);
  res.json({ rows, uncategorised: unset, categories: M.CATEGORIES, departments: depts.map((d) => d.department).filter(Boolean).sort() });
}));
const catBody = (b) => {
  const appName = String(b.appName || '').trim().toLowerCase().replace(/\.exe$/, '').slice(0, 80);
  const kind = b.kind === 'site' ? 'site' : 'app';
  const department = String(b.department || '').trim().slice(0, 80);
  const category = String(b.category || '').toLowerCase();
  if (!appName) return { error: 'Write the app (like chrome or excel) or a website word (like youtube).' };
  if (!M.CATEGORIES.includes(category)) return { error: 'Pick productive, neutral or unproductive.' };
  return { appName, kind, category, department };
};
router.post('/app-categories', adminOnly, wrap(async (req, res) => {
  const c = catBody(req.body || {});
  if (c.error) return fail(res, 400, c.error);
  const row = await prisma.appCategory.upsert({ where: { appName_department: { appName: c.appName, department: c.department } }, create: { ...c, setBy: req.user.name || null }, update: { kind: c.kind, category: c.category, setBy: req.user.name || null } });
  return res.status(201).json(row);
}));
router.put('/app-categories/:id', adminOnly, wrap(async (req, res) => {
  const cur = await prisma.appCategory.findUnique({ where: { id: req.params.id } });
  if (!cur) return fail(res, 404, 'Not found.');
  const c = catBody({ ...cur, ...(req.body || {}) });
  if (c.error) return fail(res, 400, c.error);
  return res.json(await prisma.appCategory.update({ where: { id: cur.id }, data: { ...c, setBy: req.user.name || null } }));
}));
router.delete('/app-categories/:id', adminOnly, wrap(async (req, res) => {
  await prisma.appCategory.delete({ where: { id: req.params.id } }).catch(() => null);
  res.json({ ok: true });
}));

// --- settings
router.get('/settings', wrap(async (req, res) => {
  const s = await M.settings();
  res.json({ ...publicSettings(s), policyText: s.policyText, updatedBy: s.updatedBy || null, updatedAt: s.updatedAt || null, canEdit: M.isMonitorAdmin(req.user) });
}));
router.put('/settings', adminOnly, wrap(async (req, res) => {
  const out = await M.saveSettings(req.user, req.body || {});
  if (out.error) return fail(res, out.status, out.error);
  return res.json({ ...publicSettings(out.settings), policyText: out.settings.policyText, message: out.newVersion ? 'Saved. The notice changed, so every employee accepts it again before more is recorded.' : 'Saved.' });
}));

// --- devices
router.get('/devices', wrap(async (req, res) => {
  const admin = M.isMonitorAdmin(req.user);
  if (!admin && !req.user.employeeId) return res.json({ rows: [] });
  // a lead looks at people on the Live Dashboard; Devices is HR / Admin's, and each employee's own PCs
  const rows = await prisma.monitoringDevice.findMany({
    where: admin ? {} : { employeeId: req.user.employeeId },
    orderBy: [{ isActive: 'desc' }, { lastSeenAt: 'desc' }],
    select: { id: true, deviceName: true, os: true, agentVersion: true, registeredAt: true, lastSeenAt: true, isActive: true, employee: { select: { id: true, name: true, employeeCode: true, department: true } } },
  });
  const now = Date.now();
  res.json({ rows: rows.map((d) => ({ ...d, online: d.isActive && d.lastSeenAt && now - new Date(d.lastSeenAt).getTime() < 3 * 60000 })), canManage: admin });
}));
router.put('/devices/:id/deactivate', wrap(async (req, res) => {
  const d = await prisma.monitoringDevice.findUnique({ where: { id: req.params.id } });
  if (!d) return fail(res, 404, 'Not found.');
  if (!M.isMonitorAdmin(req.user) && d.employeeId !== req.user.employeeId) return fail(res, 403, 'Only HR, Admin or the employee can switch this PC off.');
  await prisma.monitoringDevice.update({ where: { id: d.id }, data: { isActive: false } });
  await logAudit({ userId: req.user.id, action: 'Monitoring: PC switched off', entity: 'MonitoringDevice', entityId: d.id, toValue: d.deviceName }).catch(() => {});
  res.json({ ok: true, message: `${d.deviceName} no longer sends activity. It can be registered again from the agent.` });
}));

// --- attendance: "PC activity" (first / last activity of each day), beside the marked times - it never changes them
//     GET /pc-activity?from=&to=   HR / Admin: everyone; anybody else: their own days. -> { rows: { "<employeeId>|<day>": { first, last } } }
router.get('/pc-activity', wrap(async (req, res) => {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const from = day.test(String(req.query.from || '')) ? String(req.query.from) : M.todayIst();
  const to = day.test(String(req.query.to || '')) ? String(req.query.to) : from;
  const access = await M.accessOf(req.user);
  const ids = access.ids || [...new Set((await prisma.activityLog.findMany({ where: { day: { gte: from, lte: to } }, select: { employeeId: true }, distinct: ['employeeId'] })).map((x) => x.employeeId))];
  const map = await M.pcActivity(ids, from, to);
  res.json({ rows: Object.fromEntries(map) });
}));

// --- a one-time set-up code for the agent
router.post('/setup-code', wrap(async (req, res) => {
  const id = String((req.body || {}).employeeId || '') || req.user.employeeId;
  if (!id) return fail(res, 400, 'Pick the employee.');
  if (!M.isMonitorAdmin(req.user) && id !== req.user.employeeId) return fail(res, 403, 'You can get a code only for yourself.');
  const emp = await prisma.employee.findUnique({ where: { id }, select: { id: true, name: true, employmentStatus: true } });
  if (!emp || ['Exited', 'Relieved', 'Terminated'].includes(emp.employmentStatus)) return fail(res, 404, 'This employee is not active.');
  const out = await M.newSetupCode(id, req.user);
  await logAudit({ userId: req.user.id, actorName: req.user.name, action: 'Monitoring: set-up code made', entity: 'Monitoring', entityId: id, toValue: emp.name }).catch(() => {});
  return res.status(201).json({ ...out, employee: emp.name });
}));
router.get('/people', adminOnly, wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ rows: [] });
  const rows = await prisma.employee.findMany({
    where: { employmentStatus: { notIn: ['Exited', 'Relieved', 'Terminated'] }, OR: [{ name: { contains: q } }, { employeeCode: { contains: q } }] },
    select: { id: true, name: true, employeeCode: true, department: true }, orderBy: { name: 'asc' }, take: 12,
  });
  return res.json({ rows });
}));

// --- the agent itself: any TeamLink login downloads it from Settings / My activity (it records nothing until its own set-up)
router.get('/agent', wrap(async (req, res) => {
  res.set('Content-Type', 'application/octet-stream');
  res.set('Content-Disposition', 'attachment; filename="TeamLinkMonitorSetup.cmd"');
  res.send(Buffer.from(M.agentSetupFile(), 'utf8'));
}));

// --- me
router.get('/me', wrap(async (req, res) => {
  const s = await M.settings();
  const id = req.user.employeeId;
  const consents = id ? await prisma.monitoringConsent.findMany({ where: { employeeId: id }, orderBy: { acceptedAt: 'desc' } }) : [];
  res.json({
    hasEmployee: !!id, isAdmin: M.isMonitorAdmin(req.user), isLead: (await M.accessOf(req.user)).lead, settings: publicSettings(s), policyText: s.policyText,
    accepted: consents.some((c) => c.policyVersion === s.policyVersion), consents,
  });
}));
router.post('/me/consent', wrap(async (req, res) => {
  if (!req.user.employeeId) return fail(res, 404, 'Your login has no employee record.');
  const s = await M.settings();
  if (Number((req.body || {}).policyVersion) !== s.policyVersion) return fail(res, 409, 'The notice has changed; read the new one.');
  await M.recordConsent(req.user.employeeId, s.policyVersion, ipOf(req), 'Web');
  res.json({ ok: true, message: 'Thank you. You accepted the monitoring notice.' });
}));

module.exports = router;
