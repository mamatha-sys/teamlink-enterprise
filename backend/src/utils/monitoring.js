// ---------------------------------------------------------------------------
// EMPLOYEE MONITORING (2026-11-04) - how office PCs are used in work hours (routes/monitoring.js, the tables at the end of
// prisma/schema.prisma). A small desktop agent the employee installs (backend/agent/TeamLinkMonitor.ps1) sends what app is in front,
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
//   * HR / Admin (Super Admin, Admin, HR) see everyone; a team lead, STL or manager their own team; anybody else only themselves.
//     Clients, candidates and vendors have no monitoring at all. Who looked at whose data is in the audit log.
//   * the employee can pause it for a break, or clock out for the day, from the icon; nothing is recorded while paused.
// ---------------------------------------------------------------------------
const crypto = require('crypto');
const prisma = require('../db');

const IST = 330 * 60000;
const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const CATEGORIES = ['productive', 'neutral', 'unproductive'];
const ONLINE_MS = 3 * 60000; // a PC that sent a heartbeat in the last 3 minutes is online (the agent sends one every minute)
const MAX_RECORD_MS = 60 * 60000; // one record covers at most an hour
const MAX_BATCH = 500;
const BROWSERS = ['chrome', 'msedge', 'firefox', 'opera', 'brave', 'iexplore', 'vivaldi', 'safari'];
const CHAT = /whatsapp|telegram|signal|messenger|discord|wechat|viber|skype|snapchat|instagram/i;
const SECRET = /password|passcode|\bpin\b|otp|cvv|net ?banking/i;

const WHO_OLD = 'Who can see it: HR and Admin, and you yourself (HRMS -> Employee Monitoring -> My activity).';
const WHO_NEW = 'Who can see it: HR and Admin, your team lead or manager (their own team only), and you yourself (HRMS -> Employee Monitoring -> My activity). Every look at your activity by someone else is written in an audit log.';
const PAUSE_LINE = 'You can pause it for a break, or clock out for the day, from the TeamLink icon next to the clock. Nothing is recorded while it is paused.';
const POLICY_LINES = [
  'TeamLink records how this office PC is used during work hours, so that HR can see working time and idle time.',
  '',
  'What is recorded: the name of the app in front (for example Chrome or Excel), its window title, when the PC is in use or idle, and the first and last activity of the day.',
  'What is never recorded: what you type, passwords, the clipboard, screenshots, files, or the content of chats and mails. Chat apps are recorded by their name only.',
  'Only work hours are recorded. Records are deleted after the number of days HR has set (90 days unless changed).',
  WHO_NEW,
  PAUSE_LINE,
  'Nothing is recorded until you accept this notice. You can ask HR about it at any time.',
];
const DEFAULT_POLICY = POLICY_LINES.join('\n');
// the notice as first shipped: still the words in use -> replaced by the new one, as a new version everybody accepts again
const FIRST_POLICY = POLICY_LINES.filter((l) => l !== PAUSE_LINE).map((l) => (l === WHO_NEW ? WHO_OLD : l)).join('\n');

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

// What this login may see: { admin, lead, ids } - ids = the employees (null = everyone).
const LEAD_ROLES = ['TL', 'STL', 'MANAGER', 'ASSISTANT_MANAGER'];
async function accessOf(user) {
  if (isMonitorAdmin(user)) return { admin: true, lead: false, ids: null };
  const S = require('./scope'); // eslint-disable-line global-require
  if (LEAD_ROLES.includes(S.scopeOf(user).hrmsRole)) {
    const rows = await prisma.employee.findMany({ where: S.employeeWhere(user), select: { id: true } });
    return { admin: false, lead: true, ids: [...new Set([...rows.map((r) => r.id), user.employeeId].filter(Boolean))] };
  }
  return { admin: false, lead: false, ids: user && user.employeeId ? [user.employeeId] : [] };
}

// --- settings ----------------------------------------------------------------------------------------------------
async function settings() {
  let row = await prisma.monitoringSetting.findUnique({ where: { id: 'default' } });
  if (!row) row = await prisma.monitoringSetting.create({ data: { id: 'default', policyText: DEFAULT_POLICY } }).catch(() => null);
  if (row && row.policyText === FIRST_POLICY) row = await prisma.monitoringSetting.update({ where: { id: 'default' }, data: { policyText: DEFAULT_POLICY, policyVersion: (row.policyVersion || 1) + 1 } }).catch(() => row);
  const s = row || { workStart: '09:30', workEnd: '18:30', breakStart: '12:30', breakEnd: '13:15', idleThresholdMinutes: 5, retentionDays: 90, screenshotsEnabled: false, policyVersion: 1, policyText: DEFAULT_POLICY };
  return { ...s, policyText: s.policyText || DEFAULT_POLICY, screenshotsEnabled: false };
}
async function saveSettings(user, body = {}) {
  const cur = await settings();
  const data = {};
  if (body.workStart !== undefined) { if (!HM.test(String(body.workStart))) return { status: 400, error: 'Write the start of work like 09:30.' }; data.workStart = String(body.workStart); }
  if (body.workEnd !== undefined) { if (!HM.test(String(body.workEnd))) return { status: 400, error: 'Write the end of work like 18:30.' }; data.workEnd = String(body.workEnd); }
  if ((data.workStart || cur.workStart) >= (data.workEnd || cur.workEnd)) return { status: 400, error: 'Work must end after it starts.' };
  if (body.breakStart !== undefined || body.breakEnd !== undefined) {
    const bs = String(body.breakStart || ''); const be = String(body.breakEnd || '');
    if ((bs || be) && !(HM.test(bs) && HM.test(be) && bs < be)) return { status: 400, error: 'Write the lunch break like 12:30 to 13:15, or leave both empty for no break.' };
    data.breakStart = bs; data.breakEnd = be;
  }
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

// --- one-time set-up codes (founder 2026-11-05: "naa emp login isthey, theeskovatledhu, developer dhi isthey theeskovatledhu") ----
// HR / Admin, or the employee, gets a code in TeamLink and types it into the agent instead of a password: nobody hands a password to
// a set-up, and a service login can set up a PC for an employee. One use, 30 minutes, kept only as a hash (AppSetting). The notice
// is still shown and accepted at the PC, by the employee.
const CODE_PREFIX = 'monitoring.code.';
const CODE_MS = 30 * 60000;
const CODE_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0 / O or 1 / I / L: read off a screen
const codeKey = (c) => CODE_PREFIX + hashToken(String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
async function newSetupCode(employeeId, user) {
  const raw = [...crypto.randomBytes(8)].map((x) => CODE_ABC[x % CODE_ABC.length]).join('');
  const until = new Date(Date.now() + CODE_MS).toISOString();
  // codes past their time go, and this employee's older code with them
  const old = await prisma.appSetting.findMany({ where: { key: { startsWith: CODE_PREFIX } } });
  const drop = old.filter((r) => { try { const v = JSON.parse(r.value); return v.until < new Date().toISOString() || v.employeeId === employeeId; } catch { return true; } }).map((r) => r.key);
  if (drop.length) await prisma.appSetting.deleteMany({ where: { key: { in: drop } } });
  await prisma.appSetting.create({ data: { key: codeKey(raw), value: JSON.stringify({ employeeId, until, by: user ? user.name || null : null }), updatedById: user ? user.id : null, updatedByName: user ? user.name || null : null } });
  return { code: `${raw.slice(0, 4)}-${raw.slice(4)}`, until };
}
async function readSetupCode(code) {
  const row = await prisma.appSetting.findUnique({ where: { key: codeKey(code) } });
  if (!row) return null;
  try {
    const v = JSON.parse(row.value);
    return v.until > new Date().toISOString() ? v : null;
  } catch { return null; }
}
const endSetupCode = (code) => prisma.appSetting.deleteMany({ where: { key: codeKey(code) } });

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
    // THE LUNCH BREAK (founder 2026-11-05: "break 12:30 - 1:15 consider cheyyu"): the part inside it is Break - not idle, and no app or title kept
    const bs = HM.test(s.breakStart || '') && HM.test(s.breakEnd || '') && s.breakStart < s.breakEnd ? atIst(day, s.breakStart).getTime() : null;
    const be = bs ? atIst(day, s.breakEnd).getTime() : null;
    const parts = bs && a < be && b > bs
      ? [[a, bs, false], [Math.max(a, bs), Math.min(b, be), true], [be, b, false]]
      : [[a, b, false]];
    parts.filter(([x, y]) => y - x >= 1000).forEach(([x, y, lunch]) => rows.push({
      deviceId: device.id, employeeId: device.employeeId, appName: lunch ? 'Break' : app, windowTitle: lunch ? null : cleanTitle(app, r.windowTitle),
      startTime: new Date(x), endTime: new Date(y), durationSeconds: Math.round((y - x) / 1000),
      isIdle: !lunch && r.isBreak !== true && (r.isIdle === true || r.idle === true), isBreak: lunch || r.isBreak === true, day,
    }));
  }
  // A batch can come twice (the answer was lost on a bad line, or the PC restarted right after sending): the same piece counts once.
  const fresh = [];
  if (rows.length) {
    const times = rows.map((x) => x.startTime.getTime());
    const have = await prisma.activityLog.findMany({ where: { deviceId: device.id, startTime: { gte: new Date(Math.min(...times)), lte: new Date(Math.max(...times)) } }, select: { startTime: true, appName: true } });
    const seen = new Set(have.map((x) => `${new Date(x.startTime).getTime()}|${x.appName}`));
    rows.forEach((x) => {
      const k = `${x.startTime.getTime()}|${x.appName}`;
      if (seen.has(k)) { skipped += 1; return; }
      seen.add(k); fresh.push(x);
    });
  }
  for (let i = 0; i < fresh.length; i += 200) {
    // eslint-disable-next-line no-await-in-loop
    await prisma.activityLog.createMany({ data: fresh.slice(i, i + 200) });
  }
  await prisma.monitoringDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  return { status: 200, saved: fresh.length, skipped };
}

// A heartbeat: what the PC is doing now, for the Live Dashboard (the app's name only, never a title).
async function heartbeat(device, body = {}) {
  const paused = ['break', 'clockout'].includes(body.paused) ? body.paused : null;
  await prisma.monitoringDevice.update({
    where: { id: device.id },
    data: {
      lastSeenAt: new Date(), currentApp: body.currentApp ? cleanApp(body.currentApp) || null : null, currentIdle: body.idle === true, pausedState: paused,
      ...(body.agentVersion ? { agentVersion: String(body.agentVersion).slice(0, 20) } : {}),
    },
  });
}

// --- categories (a department's own rule wins over the rule for everyone) --------------------------------------------------
async function categoryIndex() {
  const rows = await prisma.appCategory.findMany();
  const apps = new Map(); const sites = [];
  rows.forEach((c) => {
    if (c.kind === 'site') sites.push(c); else apps.set(`${c.department || ''}|${c.appName.toLowerCase()}`, c);
  });
  return (app, title, department = '') => {
    const a = String(app || '').toLowerCase();
    if (BROWSERS.includes(a) && title) {
      const t = String(title).toLowerCase();
      const hits = sites.filter((x) => t.includes(x.appName.toLowerCase()) && (!x.department || x.department === department));
      const site = hits.find((x) => x.department) || hits[0];
      if (site) return { key: site.appName, label: site.appName, kind: 'site', category: site.category };
    }
    const c = apps.get(`${department || ''}|${a}`) || apps.get(`|${a}`);
    return { key: a, label: app, kind: 'app', category: c ? c.category : null };
  };
}

// --- the numbers ----------------------------------------------------------------------------------------------------------
const hrs = (sec) => Math.round((sec / 3600) * 100) / 100;
function totalsOf(logs, catOf, department = '') {
  let active = 0; let idle = 0; let breaks = 0; let productive = 0; let unproductive = 0; let first = null; let last = null;
  logs.forEach((l) => {
    if (l.isBreak) breaks += l.durationSeconds;
    else if (l.isIdle) idle += l.durationSeconds;
    else {
      active += l.durationSeconds;
      const c = catOf(l.appName, l.windowTitle, department).category;
      if (c === 'productive') productive += l.durationSeconds;
      if (c === 'unproductive') unproductive += l.durationSeconds;
    }
    if (!first || l.startTime < first) first = l.startTime;
    if (!last || l.endTime > last) last = l.endTime;
  });
  return {
    activeSeconds: active, idleSeconds: idle, breakSeconds: breaks, productiveSeconds: productive, unproductiveSeconds: unproductive,
    activeHours: hrs(active), idleHours: hrs(idle), breakHours: hrs(breaks), productivity: active ? Math.round((productive / active) * 100) : null, first, last,
  };
}
async function employeesById(ids) {
  const rows = ids.length ? await prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, employeeCode: true, department: true, team: true, designation: true } }) : [];
  return new Map(rows.map((e) => [e.id, e]));
}
const LOG_SELECT = { employeeId: true, appName: true, windowTitle: true, startTime: true, endTime: true, durationSeconds: true, isIdle: true, isBreak: true, day: true };
const within = (access) => (access && access.ids ? { employeeId: { in: access.ids } } : {});

// What a PC is doing now, from its last heartbeat (a heartbeat comes every minute).
function liveStatus(dev, onLeave, now) {
  const fresh = dev && dev.lastSeenAt && now - new Date(dev.lastSeenAt).getTime() < ONLINE_MS;
  if (fresh) {
    if (dev.pausedState === 'break') return 'On break';
    if (dev.pausedState === 'clockout') return 'Clocked out';
    return dev.currentIdle ? 'Idle' : 'Online';
  }
  return onLeave ? 'On leave' : 'Offline';
}

// The Live Dashboard / Overview of one day: every employee this login may see who has a registered PC.
async function overview(day, access = null) {
  const d = validDay(day) ? day : todayIst();
  const live = d === todayIst();
  const cfg = await settings();
  const nowHm = new Date(Date.now() + IST).toISOString().slice(11, 16);
  const lunchNow = live && cfg.breakStart && cfg.breakStart <= nowHm && nowHm < cfg.breakEnd;
  const [devices, logs, catOf, leaves] = await Promise.all([
    prisma.monitoringDevice.findMany({ where: { isActive: true, ...within(access) }, select: { employeeId: true, lastSeenAt: true, currentApp: true, currentIdle: true, pausedState: true } }),
    prisma.activityLog.findMany({ where: { day: d, ...within(access) }, select: LOG_SELECT }),
    categoryIndex(),
    prisma.leaveRequest.findMany({ where: { status: 'Approved', fromDate: { lte: d }, toDate: { gte: d }, ...within(access) }, select: { employeeId: true } }),
  ]);
  const onLeave = new Set(leaves.map((l) => l.employeeId));
  const ids = [...new Set([...devices.map((x) => x.employeeId), ...logs.map((l) => l.employeeId)])];
  const emps = await employeesById(ids);
  const byEmp = new Map(ids.map((id) => [id, []]));
  logs.forEach((l) => byEmp.get(l.employeeId).push(l));
  const latest = new Map();
  devices.forEach((x) => { const cur = latest.get(x.employeeId); if (!cur || new Date(x.lastSeenAt || 0) > new Date(cur.lastSeenAt || 0)) latest.set(x.employeeId, x); });
  const now = Date.now();
  const rows = ids.map((id) => {
    const e = emps.get(id) || { id, name: 'Employee', department: null };
    const t = totalsOf(byEmp.get(id), catOf, e.department || '');
    const dev = latest.get(id) || null;
    let status = live ? liveStatus(dev, onLeave.has(id), now) : (onLeave.has(id) ? 'On leave' : null);
    if (lunchNow && ['Online', 'Idle'].includes(status)) status = 'On break'; // the lunch break
    return {
      employeeId: id, name: e.name, code: e.employeeCode || null, department: e.department || null, team: e.team || null,
      firstSeen: t.first, lastSeen: t.last, activeHours: t.activeHours, idleHours: t.idleHours, breakHours: t.breakHours, productivity: t.productivity,
      status, currentApp: live && dev && ['Online', 'Idle'].includes(status) ? dev.currentApp || null : null,
      lastHeartbeat: dev ? dev.lastSeenAt : null, online: status === 'Online' || status === 'Idle',
    };
  }).sort((a, b) => b.activeHours - a.activeHours || String(a.name).localeCompare(String(b.name)));
  const withData = rows.filter((r) => r.activeHours || r.idleHours);
  const avg = (k) => (withData.length ? Math.round((withData.reduce((n, r) => n + r[k], 0) / withData.length) * 100) / 100 : 0);
  const count = (s) => rows.filter((r) => r.status === s).length;
  return {
    day: d, live,
    cards: {
      tracked: new Set(devices.map((x) => x.employeeId)).size, online: count('Online'), idle: count('Idle'), offline: count('Offline'), onLeave: count('On leave'),
      onBreak: count('On break') + count('Clocked out'), avgActiveHours: avg('activeHours'), avgIdleHours: avg('idleHours'),
    },
    rows,
    departments: [...new Set(rows.map((r) => r.department).filter(Boolean))].sort(),
    teams: [...new Set(rows.map((r) => r.team).filter(Boolean))].sort(),
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
    prisma.activityLog.findMany({ where: { employeeId, day: { gte: a, lte: b } }, orderBy: { startTime: 'asc' }, select: LOG_SELECT }),
    categoryIndex(),
  ]);
  if (!emp) return null;
  const dept = emp.department || '';
  const totals = totalsOf(logs, catOf, dept);
  const usage = new Map();
  logs.filter((l) => !l.isIdle && !l.isBreak).forEach((l) => {
    const c = catOf(l.appName, l.windowTitle, dept);
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
  const perDay = days.map((d) => ({ day: d, ...totalsOf(logs.filter((l) => l.day === d), catOf, dept) }));
  const s = await settings();
  return {
    employee: emp, from: a, to: b, totals, apps, top10: apps.slice(0, 10), perDay,
    // the timeline of one day: one bar, active / idle / break
    timeline: a === b ? logs.map((l) => ({ start: l.startTime, end: l.endTime, idle: l.isIdle, break: l.isBreak, app: l.appName })) : null,
    workStart: s.workStart, workEnd: s.workEnd,
  };
}

function rangeOf(from, to, days) {
  const t = todayIst();
  let a = validDay(from) ? from : addDays(t, -6);
  let b = validDay(to) ? to : t;
  if (b < a) [a, b] = [b, a];
  if (addDays(a, days) < b) a = addDays(b, -days);
  return [a, b];
}
// The reports. view: employee (one row per person), daily (one row per person per day, with login and logout), team (per department).
async function reportRows(from, to, department, access = null, view = 'employee') {
  const [a, b] = rangeOf(from, to, 366);
  const logs = await prisma.activityLog.findMany({ where: { day: { gte: a, lte: b }, ...within(access) }, select: LOG_SELECT });
  const catOf = await categoryIndex();
  const ids = [...new Set(logs.map((l) => l.employeeId))];
  const emps = await employeesById(ids);
  const deptOf = (id) => (emps.get(id) || {}).department || '';
  const kept = logs.filter((l) => !department || deptOf(l.employeeId) === department);
  const group = (keyOf) => { const m = new Map(); kept.forEach((l) => { const k = keyOf(l); if (!m.has(k)) m.set(k, []); m.get(k).push(l); }); return m; };
  const base = (list, dept) => {
    const x = totalsOf(list, catOf, dept);
    return {
      days: new Set(list.map((l) => l.day)).size, login: x.first, logout: x.last, activeHours: x.activeHours, idleHours: x.idleHours, breakHours: x.breakHours,
      productiveHours: hrs(x.productiveSeconds), unproductiveHours: hrs(x.unproductiveSeconds), productivity: x.productivity,
    };
  };
  let rows;
  if (view === 'team') {
    rows = [...group((l) => deptOf(l.employeeId) || 'No department').entries()].map(([name, list]) => {
      // each person is scored by their own department's rules
      const parts = [...new Set(list.map((l) => l.employeeId))].map((id) => base(list.filter((l) => l.employeeId === id), deptOf(id)));
      const sum = (k) => Math.round(parts.reduce((n, p) => n + p[k], 0) * 100) / 100;
      const active = sum('activeHours'); const productive = sum('productiveHours');
      return {
        key: name, name, employees: parts.length, activeHours: active, idleHours: sum('idleHours'), breakHours: sum('breakHours'),
        productiveHours: productive, unproductiveHours: sum('unproductiveHours'), productivity: active ? Math.round((productive / active) * 100) : null,
      };
    }).sort((p, q) => String(p.name).localeCompare(String(q.name)));
  } else if (view === 'daily') {
    rows = [...group((l) => `${l.employeeId}|${l.day}`).entries()].map(([k, list]) => {
      const [id, day] = k.split('|');
      const e = emps.get(id) || {};
      return { key: k, employeeId: id, day, name: e.name || 'Employee', code: e.employeeCode || null, department: e.department || null, ...base(list, e.department || '') };
    }).sort((p, q) => q.day.localeCompare(p.day) || String(p.name).localeCompare(String(q.name)));
  } else {
    rows = [...group((l) => l.employeeId).entries()].map(([id, list]) => {
      const e = emps.get(id) || {};
      return { key: id, employeeId: id, name: e.name || 'Employee', code: e.employeeCode || null, department: e.department || null, ...base(list, e.department || '') };
    }).sort((p, q) => String(p.name).localeCompare(String(q.name)));
  }
  return { from: a, to: b, view, rows, departments: [...new Set([...emps.values()].map((e) => e.department).filter(Boolean))].sort() };
}

// App & website usage over a period: top apps, top websites, the split, per department.
async function usage(from, to, department, access = null) {
  const [a, b] = rangeOf(from, to, 366);
  const logs = await prisma.activityLog.findMany({ where: { day: { gte: a, lte: b }, isIdle: false, isBreak: false, ...within(access) }, select: LOG_SELECT });
  const catOf = await categoryIndex();
  const emps = await employeesById([...new Set(logs.map((l) => l.employeeId))]);
  const deptOf = (id) => (emps.get(id) || {}).department || '';
  const apps = new Map(); const split = { productive: 0, neutral: 0, unproductive: 0, unset: 0 }; const teams = new Map();
  logs.filter((l) => !department || deptOf(l.employeeId) === department).forEach((l) => {
    const dept = deptOf(l.employeeId);
    const c = catOf(l.appName, l.windowTitle, dept);
    const u = apps.get(c.key) || { key: c.key, name: c.label, kind: c.kind, category: c.category, seconds: 0, people: new Set() };
    u.seconds += l.durationSeconds; u.people.add(l.employeeId);
    apps.set(c.key, u);
    const cat = c.category || 'unset';
    split[cat] += l.durationSeconds;
    const t = teams.get(dept || 'No department') || { name: dept || 'No department', productive: 0, neutral: 0, unproductive: 0, unset: 0 };
    t[cat] += l.durationSeconds;
    teams.set(t.name, t);
  });
  const list = [...apps.values()].sort((x, y) => y.seconds - x.seconds).map((u) => ({ key: u.key, name: u.name, kind: u.kind, category: u.category, hours: hrs(u.seconds), minutes: Math.round(u.seconds / 60), people: u.people.size }));
  const inHours = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? hrs(v) : v]));
  return {
    from: a, to: b, topApps: list.filter((x) => x.kind === 'app').slice(0, 20), topSites: list.filter((x) => x.kind === 'site').slice(0, 20),
    split: inHours(split), byDepartment: [...teams.values()].map(inHours).sort((p, q) => String(p.name).localeCompare(String(q.name))),
    departments: [...new Set([...emps.values()].map((e) => e.department).filter(Boolean))].sort(),
  };
}

// Apps seen in the last 30 days that have no rule yet (to mark them).
async function uncategorised() {
  const since = addDays(todayIst(), -30);
  const logs = await prisma.activityLog.groupBy({ by: ['appName'], where: { day: { gte: since }, isIdle: false, isBreak: false }, _sum: { durationSeconds: true } });
  const known = new Set((await prisma.appCategory.findMany({ where: { kind: 'app', department: '' }, select: { appName: true } })).map((c) => c.appName.toLowerCase()));
  return logs.filter((g) => !known.has(String(g.appName).toLowerCase()) && g.appName !== 'Break')
    .map((g) => ({ appName: g.appName, hours: hrs(g._sum.durationSeconds || 0) }))
    .sort((x, y) => y.hours - x.hours).slice(0, 100);
}

// The audit log of this module: who looked at whose data, what was exported, settings, PCs.
const AUDIT_ENTITIES = ['Monitoring', 'MonitoringDevice', 'MonitoringSetting', 'ActivityLog'];
async function auditRows(from, to) {
  const [a, b] = rangeOf(from, to, 366);
  const rows = await prisma.auditLog.findMany({
    where: { entity: { in: AUDIT_ENTITIES }, createdAt: { gte: atIst(a, '00:00'), lte: new Date(atIst(b, '23:59').getTime() + 60000) } },
    orderBy: { createdAt: 'desc' }, take: 1000,
    select: { id: true, createdAt: true, action: true, toValue: true, actorName: true, user: { select: { name: true } } },
  });
  return { from: a, to: b, rows: rows.map((r) => ({ id: r.id, at: r.createdAt, who: r.actorName || (r.user && r.user.name) || 'TeamLink', action: r.action, detail: r.toValue || null })) };
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

// --- the download: one file that runs on a double-click ---------------------------------------------------------------------
// Windows opens a .ps1 in Notepad on a double-click (founder 2026-11-05: "download chesaka, ilaa vachindhi"). So the download is a
// .cmd holding the agent: it writes the agent to %APPDATA%\TeamLinkMonitor and runs it. It installs nothing else, and the notice
// and sign-in still come first. payload: the agent's text (tests pass a small script).
function agentSetupFile(payload) {
  const text = payload === undefined
    ? require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'agent', 'TeamLinkMonitor.ps1'), 'utf8') // eslint-disable-line global-require
    : payload;
  return [
    '@echo off',
    'title TeamLink Monitor',
    'setlocal',
    'set "TLDIR=%APPDATA%\\TeamLinkMonitor"',
    'if not exist "%TLDIR%" mkdir "%TLDIR%"',
    'set "TLSELF=%~f0"',
    'echo Starting TeamLink Monitor...',
    // the marker is built in two parts here, so the only whole one in this file is the line above the agent
    'powershell -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllText($env:TLSELF); $m=\':\'+\'::TEAMLINK-AGENT\'; $i=$t.IndexOf($m); [IO.File]::WriteAllText((Join-Path $env:TLDIR \'TeamLinkMonitor.ps1\'), $t.Substring($i+$m.Length).TrimStart())"',
    'if not "%errorlevel%"=="0" goto failed',
    'powershell -NoProfile -ExecutionPolicy Bypass -File "%TLDIR%\\TeamLinkMonitor.ps1"',
    'if not "%errorlevel%"=="0" goto failed',
    'exit /b 0',
    ':failed',
    'echo.',
    'echo TeamLink Monitor could not start. Please show this window to HR or IT.',
    'pause',
    'exit /b 1',
    ':::TEAMLINK-AGENT',
    String(text).replace(/\r\n/g, '\n'),
  ].join('\n').replace(/\n/g, '\r\n');
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
  newSetupCode, readSetupCode, endSetupCode, agentSetupFile, CATEGORIES, DEFAULT_POLICY, AUDIT_ENTITIES, isMonitorAdmin, accessOf, heartbeat, usage, auditRows, settings, saveSettings, hasConsent, recordConsent, hashToken, deviceOf, registerDevice,
  ingest, categoryIndex, overview, employeeDetail, reportRows, uncategorised, pcActivity, purge, startSweep, todayIst, istDay, cleanTitle,
};
