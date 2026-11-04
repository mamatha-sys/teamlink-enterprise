// ---------------------------------------------------------------------------
// EMPLOYEE MONITORING (2026-11-04) - how office PCs are used in work hours (routes/monitoring.js, the tables at the end of
// prisma/schema.prisma). A small desktop agent the employee installs (agent/TeamLinkMonitor.ps1) sends what app is in front,
// its window title and whether the PC is idle; HR / Admin see the totals, every employee sees their own.
//
// PRIVACY - the rules this file keeps:
//   * only the app name, the window title, active / idle time and the day's first / last activity are stored - never
//     keystrokes, passwords, the clipboard, screenshots or chat content. Chat apps (WhatsApp, Telegram ...) keep their name
//     only, never the title (it can name a person or show a message); a title that mentions a password is dropped.
//   * nothing is stored before the employee accepts the current policy (monitoring_consents, policy_version). A new policy
//     text is a new version: everyone accepts it again before anything more is recorded.
//   * only work hours are kept (monitoring_settings work_start .. work_end, India time); the rest is thrown away on arrival.
//   * activity older than retention_days (default 90) is deleted every few hours (startSweep).
//   * HR / Admin (Super Admin, Admin, HR) see everyone; anybody else sees only themselves.
// ---------------------------------------------------------------------------
const crypto = require('crypto');
const prisma = require('../db');

const IST = 330 * 60000;
const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const CATEGORIES = ['productive', 'neutral', 'unproductive'];
const ONLINE_MS = 6 * 60000; // a PC that sent a heartbeat in the last 6 minutes is online
const MAX_RECORD_MS = 60 * 60000; // one record covers at most an hour
const MAX_BATCH = 500;
const BROWSERS = ['chrome', 'msedge', 'firefox', 'opera', 'brave', 'iexplore', 'vivaldi', 'safari'];
const CHAT = /whatsapp|telegram|signal|messenger|discord|wechat|viber|skype|snapchat|instagram/i;
const SECRET = /password|passcode|\bpin\b|otp|cvv|net ?banking/i;

const DEFAULT_POLICY = [
  'TeamLink records how this office PC is used during work hours, so that HR can see working time and idle time.',
  '',
  'What is recorded: the name of the app in front (for example Chrome or Excel), its window title, when the PC is in use or idle, and the first and last activity of the day.',
  'What is never recorded: what you type, passwords, the clipboard, screenshots, files, or the content of chats and mails. Chat apps are recorded by their name only.',
  'Only work hours are recorded. Records are deleted after the number of days HR has set (90 days unless changed).',
  'Who can see it: HR and Admin, and you yourself (HRMS -> Employee Monitoring -> My activity).',
  'Nothing is recorded until you accept this notice. You can ask HR about it at any time.',
].join('\n');

// --- time ------------------------------------------------------------------------------------------------------
const istDay = (d) => new Date(new Date(d).getTime() + IST).toISOString().slice(0, 10);
const todayIst = () => istDay(Date.now());
const atIst = (day, hm) => new Date(`${day}T${hm}:00+05:30`);
const validDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
const addDays = (day, n) => new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

// --- who may see -------------------------------------------------------------------------------------------------
// HR / Admin: Super Admin, Admin and HR (by role or HRMS role) - the HR desk of the permission matrix (SET.HR_DESK).
function isMonitorAdmin(user) {
  return !!user && require('./exitDate').isHrDesk(user); // eslint-disable-line global-require
}

// --- settings ----------------------------------------------------------------------------------------------------
async function settings() {
  let row = await prisma.monitoringSetting.findUnique({ where: { id: 'default' } });
  if (!row) row = await prisma.monitoringSetting.create({ data: { id: 'default', policyText: DEFAULT_POLICY } }).catch(() => null);
  const s = row || { workStart: '09:30', workEnd: '18:30', idleThresholdMinutes: 5, retentionDays: 90, screenshotsEnabled: false, policyVersion: 1, policyText: DEFAULT_POLICY };
  return { ...s, policyText: s.policyText || DEFAULT_POLICY, screenshotsEnabled: false };
}
async function saveSettings(user, body = {}) {
  const cur = await settings();
  const data = {};
  if (body.workStart !== undefined) { if (!HM.test(String(body.workStart))) return { status: 400, error: 'Write the start of work like 09:30.' }; data.workStart = String(body.workStart); }
  if (body.workEnd !== undefined) { if (!HM.test(String(body.workEnd))) return { status: 400, error: 'Write the end of work like 18:30.' }; data.workEnd = String(body.workEnd); }
  if ((data.workStart || cur.workStart) >= (data.workEnd || cur.workEnd)) return { status: 400, error: 'Work must end after it starts.' };
  if (body.idleThresholdMinutes !== undefined) {
    const n = Math.round(Number(body.idleThresholdMinutes));
    if (!(n >= 1 && n <= 60)) return { status: 400, error: 'Idle after: 1 to 60 minutes.' };
    data.idleThresholdMinutes = n;
  }
  if (body.retentionDays !== undefined) {
    const n = Math.round(Number(body.retentionDays));
    if (!(n >= 7 && n <= 730)) return { status: 400, error: 'Keep records for 7 to 730 days.' };
    data.retentionDays = n;
  }
  if (body.policyText !== undefined) {
    const t = String(body.policyText || '').trim().slice(0, 6000);
    if (t.length < 40) return { status: 400, error: 'Write the consent notice employees will accept (at least a few sentences).' };
    // a changed notice is a new version: everybody accepts it again before more is recorded
    if (t !== cur.policyText) { data.policyText = t; data.policyVersion = (cur.policyVersion || 1) + 1; }
  }
  data.updatedBy = user ? user.name || null : null;
  await prisma.monitoringSetting.upsert({ where: { id: 'default' }, create: { id: 'default', policyText: DEFAULT_POLICY, ...data }, update: data });
  await require('./audit').logAudit({ userId: user && user.id, action: 'Employee monitoring settings changed', entity: 'MonitoringSetting', entityId: 'default', toValue: JSON.stringify(data).slice(0, 400) }).catch(() => {}); // eslint-disable-line global-require
  return { status: 200, settings: await settings(), newVersion: !!data.policyVersion };
}

// --- consent -----------------------------------------------------------------------------------------------------
async function hasConsent(employeeId, version) {
  return !!(await prisma.monitoringConsent.findFirst({ where: { employeeId, policyVersion: version }, select: { id: true } }));
}
async function recordConsent(employeeId, version, ip, via) {
  if (await hasConsent(employeeId, version)) return;
  await prisma.monitoringConsent.create({ data: { employeeId, policyVersion: version, ipAddress: ip ? String(ip).slice(0, 64) : null, via } });
}

// --- devices & tokens -------------------------------------------------------------------------------------------------
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
async function deviceOf(req) {
  const h = String(req.headers.authorization || '');
  const tok = h.startsWith('Device ') ? h.slice(7).trim() : '';
  if (tok.length < 32) return null;
  const d = await prisma.monitoringDevice.findUnique({ where: { tokenHash: hashToken(tok) }, include: { employee: { select: { id: true, name: true, employmentStatus: true } } } });
  if (!d || !d.isActive) return null;
  if (['Exited', 'Relieved', 'Terminated'].includes(d.employee && d.employee.employmentStatus)) return null;
  return d;
}
async function registerDevice({ employeeId, deviceName, os }) {
  const token = crypto.randomBytes(32).toString('base64url');
  const device = await prisma.monitoringDevice.create({
    data: { employeeId, deviceName: String(deviceName || 'Office PC').trim().slice(0, 80) || 'Office PC', os: os ? String(os).trim().slice(0, 80) : null, tokenHash: hashToken(token), lastSeenAt: new Date() },
  });
  return { token, device };
}

// --- one batch from the agent -------------------------------------------------------------------------------------------
const cleanApp = (s) => String(s || '').trim().replace(/\.exe$/i, '').replace(/[^\w .+-]/g, '').slice(0, 80);
function cleanTitle(app, title) {
  const t = String(title || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 300);
  if (!t) return null;
  if (CHAT.test(app) || CHAT.test(t)) return null; // chat apps: the name only, never who or what
  if (SECRET.test(t)) return null;
  return t;
}
// -> { saved, skipped, reasons }
async function ingest(device, records) {
  const s = await settings();
  if (!(await hasConsent(device.employeeId, s.policyVersion))) return { status: 412, error: 'The employee has not accepted the current monitoring notice yet.', consentRequired: true, policyVersion: s.policyVersion, policyText: s.policyText };
  if (!Array.isArray(records)) return { status: 400, error: 'Send records as a list.' };
  if (records.length > MAX_BATCH) return { status: 400, error: `At most ${MAX_BATCH} records at a time.` };
  const now = Date.now();
  const rows = [];
  let skipped = 0;
  for (const r of records) {
    const app = cleanApp(r && r.appName);
    const st = new Date(r && r.start).getTime();
    const en = new Date(r && r.end).getTime();
    if (!app || !Number.isFinite(st) || !Number.isFinite(en) || en <= st || en - st > MAX_RECORD_MS || en > now + 5 * 60000 || st < now - 7 * 86400000) { skipped += 1; continue; } // eslint-disable-line no-continue
    // work hours only (India time), cut to the day of the record
    const day = istDay(st);
    const ws = atIst(day, s.workStart).getTime();
    const we = atIst(day, s.workEnd).getTime();
    const a = Math.max(st, ws);
    const b = Math.min(en, we);
    if (b - a < 1000) { skipped += 1; continue; } // eslint-disable-line no-continue
    rows.push({
      deviceId: device.id, employeeId: device.employeeId, appName: app, windowTitle: cleanTitle(app, r.windowTitle),
      startTime: new Date(a), endTime: new Date(b), durationSeconds: Math.round((b - a) / 1000), isIdle: r.isIdle === true || r.idle === true, day,
    });
  }
  for (let i = 0; i < rows.length; i += 200) {
    // eslint-disable-next-line no-await-in-loop
    await prisma.activityLog.createMany({ data: rows.slice(i, i + 200) });
  }
  await prisma.monitoringDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  return { status: 200, saved: rows.length, skipped };
}

// --- categories ----------------------------------------------------------------------------------------------------------
async function categoryIndex() {
  const rows = await prisma.appCategory.findMany();
  const apps = new Map(); const sites = [];
  rows.forEach((c) => { if (c.kind === 'site') sites.push(c); else apps.set(c.appName.toLowerCase(), c); });
  return (app, title) => {
    const a = String(app || '').toLowerCase();
    if (BROWSERS.includes(a) && title) {
      const t = String(title).toLowerCase();
      const site = sites.find((x) => t.includes(x.appName.toLowerCase()));
      if (site) return { key: site.appName, label: site.appName, kind: 'site', category: site.category };
    }
    const c = apps.get(a);
    return { key: a, label: app, kind: 'app', category: c ? c.category : null };
  };
}

// --- the numbers ----------------------------------------------------------------------------------------------------------
const hrs = (sec) => Math.round((sec / 3600) * 100) / 100;
function totalsOf(logs, catOf) {
  let active = 0; let idle = 0; let productive = 0; let unproductive = 0; let first = null; let last = null;
  logs.forEach((l) => {
    if (l.isIdle) idle += l.durationSeconds; else {
      active += l.durationSeconds;
      const c = catOf(l.appName, l.windowTitle).category;
      if (c === 'productive') productive += l.durationSeconds;
      if (c === 'unproductive') unproductive += l.durationSeconds;
    }
    if (!first || l.startTime < first) first = l.startTime;
    if (!last || l.endTime > last) last = l.endTime;
  });
  return {
    activeSeconds: active, idleSeconds: idle, productiveSeconds: productive, unproductiveSeconds: unproductive,
    activeHours: hrs(active), idleHours: hrs(idle), productivity: active ? Math.round((productive / active) * 100) : null, first, last,
  };
}
async function employeesById(ids) {
  const rows = ids.length ? await prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, employeeCode: true, department: true, designation: true } }) : [];
  return new Map(rows.map((e) => [e.id, e]));
}

// Overview of one day: every employee with a registered PC, and what they did.
async function overview(day) {
  const d = validDay(day) ? day : todayIst();
  const [devices, logs, catOf] = await Promise.all([
    prisma.monitoringDevice.findMany({ where: { isActive: true }, select: { employeeId: true, lastSeenAt: true } }),
    prisma.activityLog.findMany({ where: { day: d }, select: { employeeId: true, appName: true, windowTitle: true, startTime: true, endTime: true, durationSeconds: true, isIdle: true } }),
    categoryIndex(),
  ]);
  const ids = [...new Set([...devices.map((x) => x.employeeId), ...logs.map((l) => l.employeeId)])];
  const emps = await employeesById(ids);
  const byEmp = new Map(ids.map((id) => [id, []]));
  logs.forEach((l) => byEmp.get(l.employeeId).push(l));
  const seen = new Map();
  devices.forEach((x) => { const t = x.lastSeenAt ? new Date(x.lastSeenAt).getTime() : 0; if (!seen.has(x.employeeId) || t > seen.get(x.employeeId)) seen.set(x.employeeId, t); });
  const now = Date.now();
  const rows = ids.map((id) => {
    const e = emps.get(id) || { id, name: 'Employee', department: null };
    const t = totalsOf(byEmp.get(id), catOf);
    return {
      employeeId: id, name: e.name, code: e.employeeCode || null, department: e.department || null,
      firstSeen: t.first, lastSeen: t.last, activeHours: t.activeHours, idleHours: t.idleHours, productivity: t.productivity,
      online: d === todayIst() && seen.has(id) && now - seen.get(id) < ONLINE_MS,
    };
  }).sort((a, b) => b.activeHours - a.activeHours || String(a.name).localeCompare(String(b.name)));
  const withData = rows.filter((r) => r.activeHours || r.idleHours);
  const avg = (k) => (withData.length ? Math.round((withData.reduce((n, r) => n + r[k], 0) / withData.length) * 100) / 100 : 0);
  return {
    day: d,
    cards: { tracked: new Set(devices.map((x) => x.employeeId)).size, online: rows.filter((r) => r.online).length, avgActiveHours: avg('activeHours'), avgIdleHours: avg('idleHours') },
    rows,
    departments: [...new Set(rows.map((r) => r.department).filter(Boolean))].sort(),
  };
}

// One employee over a few days: the day's timeline (one day), the top apps, the usage table, the totals.
async function employeeDetail(employeeId, from, to) {
  const t = todayIst();
  let a = validDay(from) ? from : t;
  let b = validDay(to) ? to : a;
  if (b < a) [a, b] = [b, a];
  if (addDays(a, 92) < b) a = addDays(b, -92);
  const [emp, logs, catOf] = await Promise.all([
    prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, name: true, employeeCode: true, department: true, designation: true } }),
    prisma.activityLog.findMany({ where: { employeeId, day: { gte: a, lte: b } }, orderBy: { startTime: 'asc' }, select: { appName: true, windowTitle: true, startTime: true, endTime: true, durationSeconds: true, isIdle: true, day: true } }),
    categoryIndex(),
  ]);
  if (!emp) return null;
  const totals = totalsOf(logs, catOf);
  const usage = new Map();
  logs.filter((l) => !l.isIdle).forEach((l) => {
    const c = catOf(l.appName, l.windowTitle);
    const u = usage.get(c.key) || { key: c.key, name: c.label, kind: c.kind, category: c.category, seconds: 0, titles: new Map() };
    u.seconds += l.durationSeconds;
    if (l.windowTitle) u.titles.set(l.windowTitle, (u.titles.get(l.windowTitle) || 0) + l.durationSeconds);
    usage.set(c.key, u);
  });
  const apps = [...usage.values()].sort((x, y) => y.seconds - x.seconds).map((u) => ({
    key: u.key, name: u.name, kind: u.kind, category: u.category, seconds: u.seconds, hours: hrs(u.seconds),
    topTitles: [...u.titles.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([title, sec]) => ({ title, minutes: Math.round(sec / 60) })),
  }));
  const days = [...new Set(logs.map((l) => l.day))].sort();
  const perDay = days.map((d) => ({ day: d, ...totalsOf(logs.filter((l) => l.day === d), catOf) }));
  const s = await settings();
  return {
    employee: emp, from: a, to: b, totals, apps, top10: apps.slice(0, 10), perDay,
    // the timeline of one day (the last day in the range): one bar, active / idle
    timeline: a === b ? logs.map((l) => ({ start: l.startTime, end: l.endTime, idle: l.isIdle, app: l.appName })) : null,
    workStart: s.workStart, workEnd: s.workEnd,
  };
}

// The report: one row per employee over the days, by department.
async function reportRows(from, to, department) {
  const t = todayIst();
  let a = validDay(from) ? from : addDays(t, -6);
  let b = validDay(to) ? to : t;
  if (b < a) [a, b] = [b, a];
  if (addDays(a, 366) < b) a = addDays(b, -366);
  const logs = await prisma.activityLog.findMany({ where: { day: { gte: a, lte: b } }, select: { employeeId: true, appName: true, windowTitle: true, startTime: true, endTime: true, durationSeconds: true, isIdle: true, day: true } });
  const catOf = await categoryIndex();
  const ids = [...new Set(logs.map((l) => l.employeeId))];
  const emps = await employeesById(ids);
  const rows = ids.map((id) => {
    const mine = logs.filter((l) => l.employeeId === id);
    const x = totalsOf(mine, catOf);
    const e = emps.get(id) || {};
    return {
      employeeId: id, name: e.name || 'Employee', code: e.employeeCode || null, department: e.department || null,
      days: new Set(mine.map((l) => l.day)).size, activeHours: x.activeHours, idleHours: x.idleHours,
      productiveHours: hrs(x.productiveSeconds), unproductiveHours: hrs(x.unproductiveSeconds), productivity: x.productivity,
    };
  }).filter((r) => !department || r.department === department).sort((p, q) => String(p.name).localeCompare(String(q.name)));
  return { from: a, to: b, rows, departments: [...new Set([...emps.values()].map((e) => e.department).filter(Boolean))].sort() };
}

// Apps / sites seen in the last 30 days that have no category yet (to mark them).
async function uncategorised() {
  const since = addDays(todayIst(), -30);
  const logs = await prisma.activityLog.groupBy({ by: ['appName'], where: { day: { gte: since }, isIdle: false }, _sum: { durationSeconds: true } });
  const known = new Set((await prisma.appCategory.findMany({ select: { appName: true } })).map((c) => c.appName.toLowerCase()));
  return logs.filter((g) => !known.has(String(g.appName).toLowerCase()))
    .map((g) => ({ appName: g.appName, hours: hrs(g._sum.durationSeconds || 0) }))
    .sort((x, y) => y.hours - x.hours).slice(0, 100);
}

// ATTENDANCE: the first and last PC activity of each day (shown as "PC activity"; it never changes the marked attendance).
async function pcActivity(employeeIds, from, to) {
  const out = new Map();
  if (!employeeIds.length) return out;
  const rows = await prisma.activityLog.groupBy({
    by: ['employeeId', 'day'],
    where: { employeeId: { in: employeeIds }, day: { gte: from, lte: to } },
    _min: { startTime: true }, _max: { endTime: true },
  }).catch(() => []);
  rows.forEach((r) => out.set(`${r.employeeId}|${r.day}`, { first: r._min.startTime, last: r._max.endTime }));
  return out;
}

// --- retention ------------------------------------------------------------------------------------------------------------------
async function purge() {
  const s = await settings();
  const cutoff = addDays(todayIst(), -s.retentionDays);
  const r = await prisma.activityLog.deleteMany({ where: { day: { lt: cutoff } } });
  return r.count;
}
let TIMER = null;
function startSweep() {
  if (require('./sandbox').isSandbox() || TIMER) return; // eslint-disable-line global-require
  const tick = () => purge().then((n) => { if (n) console.log(`[monitoring] ${n} old activity record(s) deleted`); }).catch((e) => console.error('[monitoring]', e.message)); // eslint-disable-line no-console
  setTimeout(tick, 5 * 60000).unref?.();
  TIMER = setInterval(tick, 6 * 3600000);
  if (TIMER.unref) TIMER.unref();
}

module.exports = {
  CATEGORIES, DEFAULT_POLICY, isMonitorAdmin, settings, saveSettings, hasConsent, recordConsent, hashToken, deviceOf, registerDevice,
  ingest, categoryIndex, overview, employeeDetail, reportRows, uncategorised, pcActivity, purge, startSweep, todayIst, istDay, cleanTitle,
};
