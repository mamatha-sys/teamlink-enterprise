// ---------------------------------------------------------------------------
// EMPLOYEE MONITORING - ALERTS (2026-11-05, module 6 of the founder's plan). Off until HR switches them on (Settings).
//
//   Long idle       the PC has been idle this long without a break        (default 30 minutes)
//   Agent stopped   the employee pressed Stop recording in work hours
//   No signal       the PC was working today and has gone silent           (default 15 minutes)
//                   or nothing came from it an hour into the work day. It cannot tell a PC switched off from an agent removed:
//                   the alert says so, and the person looks.
//   Low activity    after work: active hours under the limit               (default 4 hours)
//
// Who hears: the employee's team lead (the approval chain) and HR, by the bell. Each kind at most once a day per person. Nothing on
// a holiday or weekly off, on approved leave, in the lunch break, or for someone who clocked out or is on a break.
// Runs every 5 minutes (startSweep); the sandbox runs no timers.
// ---------------------------------------------------------------------------
const crypto = require('crypto');
const prisma = require('../db');
const M = require('./monitoring');

const IST = 330 * 60000;
const WORD = { idle: 'Long idle', stopped: 'Agent stopped', offline: 'No signal', low: 'Low activity' };
const hmOf = (ms) => new Date(ms + IST).toISOString().slice(11, 16);
const atIst = (day, hm) => new Date(`${day}T${hm}:00+05:30`).getTime();

// the idle time at the very end of the day's records (a break or real work ends it)
function trailingIdleSeconds(logs) {
  let sec = 0;
  for (let i = logs.length - 1; i >= 0; i -= 1) {
    if (!logs[i].isIdle || logs[i].isBreak) break;
    sec += logs[i].durationSeconds;
  }
  return sec;
}

async function recipients(employee, lad) {
  const workflow = require('./approvalWorkflow'); // eslint-disable-line global-require
  try {
    const chain = await workflow.resolveChain(employee, lad);
    const lead = ['TL', 'STL', 'ASSISTANT_MANAGER', 'MANAGER'].map((l) => chain[l]).find((p) => p && p.user && p.user.id && p.user.id !== employee.userId);
    const hr = chain.HR && chain.HR.user && chain.HR.user.id !== employee.userId ? chain.HR.user.id : null;
    return [lead && lead.user.id, hr].filter(Boolean);
  } catch { return []; }
}

// The alerts due now, without writing anything: [{ employeeId, kind, detail }]
async function scan(now = Date.now(), s = null) {
  const cfg = s || await M.settings();
  const day = M.istDay(now);
  const WD = require('./workingDays'); // eslint-disable-line global-require
  await WD.ready().catch(() => {});
  if (!WD.isWorking(day)) return [];
  const ws = atIst(day, cfg.workStart); const we = atIst(day, cfg.workEnd);
  if (now < ws) return [];
  const hm = hmOf(now);
  const lunch = !!cfg.breakStart && cfg.breakStart <= hm && hm < cfg.breakEnd;
  const inHours = now < we;
  const [devices, logs, leaves, catOf] = await Promise.all([
    prisma.monitoringDevice.findMany({ where: { isActive: true, employee: { employmentStatus: { notIn: ['Exited', 'Relieved', 'Terminated'] } } }, select: { employeeId: true, lastSeenAt: true, pausedState: true } }),
    prisma.activityLog.findMany({ where: { day }, orderBy: { startTime: 'asc' }, select: { employeeId: true, appName: true, windowTitle: true, durationSeconds: true, isIdle: true, isBreak: true, startTime: true, endTime: true } }),
    prisma.leaveRequest.findMany({ where: { status: 'Approved', fromDate: { lte: day }, toDate: { gte: day } }, select: { employeeId: true } }),
    M.categoryIndex(),
  ]);
  const onLeave = new Set(leaves.map((l) => l.employeeId));
  const latest = new Map();
  devices.forEach((d) => { const c = latest.get(d.employeeId); if (!c || new Date(d.lastSeenAt || 0) > new Date(c.lastSeenAt || 0)) latest.set(d.employeeId, d); });
  const byEmp = new Map();
  logs.forEach((l) => { if (!byEmp.has(l.employeeId)) byEmp.set(l.employeeId, []); byEmp.get(l.employeeId).push(l); });
  const out = [];
  latest.forEach((d, employeeId) => {
    if (onLeave.has(employeeId)) return;
    const mine = byEmp.get(employeeId) || [];
    const seen = d.lastSeenAt ? new Date(d.lastSeenAt).getTime() : 0;
    const seenToday = seen >= ws;
    if (inHours && !lunch) {
      if (d.pausedState === 'stopped' && seenToday) out.push({ employeeId, kind: 'stopped', detail: `Recording was stopped on the PC at ${M.istTime(seen)}.` });
      else if (!d.pausedState) {
        const silent = Math.round((now - seen) / 60000);
        if (seenToday && silent >= cfg.offlineMinutes) out.push({ employeeId, kind: 'offline', detail: `No signal from the PC since ${M.istTime(seen)}. The PC may be off, or the agent may have stopped.` });
        else if (!seenToday && now - ws >= 3600000) out.push({ employeeId, kind: 'offline', detail: 'No signal from the PC today. The PC may be off, or the agent may have stopped.' });
        const idleMin = Math.round(trailingIdleSeconds(mine) / 60);
        if (idleMin >= cfg.longIdleMinutes) out.push({ employeeId, kind: 'idle', detail: `Idle for ${idleMin} minutes.` });
      }
    }
    if (!inHours && mine.length) {
      const t = M.totalsOf(mine, catOf);
      if (t.activeHours < cfg.lowActivityHours) out.push({ employeeId, kind: 'low', detail: `Active for ${t.activeHours} hours today (the limit is ${cfg.lowActivityHours}).` });
    }
  });
  return out;
}

// Writes the new alerts and rings the bell. A person's alert of a kind comes once a day (the table's unique key).
async function run(now = Date.now()) {
  const s = await M.settings();
  if (!s.alertsEnabled) return { created: 0, off: true };
  const due = await scan(now, s);
  if (!due.length) return { created: 0 };
  const day = M.istDay(now);
  const have = await prisma.monitoringAlert.findMany({ where: { day }, select: { employeeId: true, kind: true } });
  const seen = new Set(have.map((a) => `${a.employeeId}|${a.kind}`));
  const fresh = due.filter((a) => !seen.has(`${a.employeeId}|${a.kind}`));
  if (!fresh.length) return { created: 0 };
  const lad = await require('./approvalWorkflow').ladder().catch(() => null); // eslint-disable-line global-require
  const { notifyUsers } = require('./notify'); // eslint-disable-line global-require
  let created = 0;
  for (const a of fresh) {
    // eslint-disable-next-line no-await-in-loop
    const emp = await prisma.employee.findUnique({ where: { id: a.employeeId } });
    if (!emp) continue; // eslint-disable-line no-continue
    // eslint-disable-next-line no-await-in-loop
    const row = await prisma.monitoringAlert.create({ data: { id: crypto.randomUUID(), employeeId: a.employeeId, kind: a.kind, day, detail: a.detail } }).catch(() => null);
    if (!row) continue; // eslint-disable-line no-continue
    created += 1;
    // eslint-disable-next-line no-await-in-loop
    await notifyUsers(await recipients(emp, lad), { title: `🖥️ ${WORD[a.kind]}: ${emp.name}`, message: `${a.detail}\nOpen: /monitoring?tab=alerts` }).catch(() => {});
  }
  return { created };
}

// The Alerts tab
async function list(from, to, access = null) {
  const rows = await prisma.monitoringAlert.findMany({
    where: { day: { gte: from, lte: to }, ...(access && access.ids ? { employeeId: { in: access.ids } } : {}) },
    orderBy: { createdAt: 'desc' }, take: 1000,
    select: { id: true, kind: true, day: true, detail: true, createdAt: true, employee: { select: { id: true, name: true, employeeCode: true, department: true } } },
  });
  return { from, to, kinds: WORD, rows: rows.map((r) => ({ id: r.id, kind: r.kind, word: WORD[r.kind] || r.kind, day: r.day, detail: r.detail, at: r.createdAt, employeeId: r.employee.id, name: r.employee.name, code: r.employee.employeeCode, department: r.employee.department })) };
}

let TIMER = null;
function startSweep() {
  if (require('./sandbox').isSandbox() || TIMER) return; // eslint-disable-line global-require
  const tick = () => run().then((r) => { if (r.created) console.log(`[monitoring] ${r.created} alert(s)`); }).catch((e) => console.error('[monitoring alerts]', e.message)); // eslint-disable-line no-console
  TIMER = setInterval(tick, 5 * 60000);
  if (TIMER.unref) TIMER.unref();
}

module.exports = {
  WORD, trailingIdleSeconds, scan, run, list, startSweep,
};
