// ---------------------------------------------------------------------------
// WORKING DAYS ONLY (founder 2026-11-03: "Timesheet or any module only working days are calculated, not the week-offs and holidays").
// A working day = not a weekly off (HrConfig.weeklyOffDays, Sunday unless HR changed it) and not a company holiday (every holiday of
// the calendar except type 'Optional' - the same rule as leave days, utils/leaveDays.js, and the attendance day rule).
//
// The week-off setting and the holiday dates are kept in memory for 10 minutes so the counting stays synchronous for code that is
// (decorate() in routes/tasks.js, monthStats() in utils/attendanceMath.js). A route calls `await ready()` once, then counts.
// Leave days already count this way (utils/leaveDays.js). Payroll is left alone on purpose: there a holiday is a PAID day.
// ---------------------------------------------------------------------------
const prisma = require('../db');
const { weeklyOffs } = require('./attendanceDays');

let cache = { at: 0, offs: new Set([0]), holidays: new Set() };
let loading = null;

async function ready() {
  if (Date.now() - cache.at < 10 * 60 * 1000) return;
  if (!loading) {
    loading = (async () => {
      try {
        const cfg = (await prisma.hrConfig.findFirst()) || {};
        const rows = await prisma.holiday.findMany({ select: { date: true, type: true } });
        cache = { at: Date.now(), offs: weeklyOffs(cfg), holidays: new Set(rows.filter((h) => h.type !== 'Optional').map((h) => String(h.date).slice(0, 10))) };
      } finally { loading = null; }
    })();
  }
  await loading;
}
// after HR changes holidays or the week-off setting
const reset = () => { cache.at = 0; };

const addDay = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const isWorking = (d) => !cache.offs.has(new Date(`${d}T00:00:00Z`).getUTCDay()) && !cache.holidays.has(d);

// working days AFTER `from` up to and including `to` (how many working days late a task due on `from` is on `to`); 0 when to <= from
function after(from, to) {
  const f = String(from || '').slice(0, 10);
  const t = String(to || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || !/^\d{4}-\d{2}-\d{2}$/.test(t) || t <= f) return 0;
  let n = 0;
  for (let d = addDay(f, 1), guard = 0; d <= t && guard < 3700; d = addDay(d, 1), guard += 1) if (isWorking(d)) n += 1;
  return n;
}
// working days of a month (YYYY-MM)
function inMonth(month) {
  const [y, m] = String(month || '').split('-').map(Number);
  if (!y || !m) return 0;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let n = 0;
  for (let d = 1; d <= last; d += 1) if (isWorking(`${month}-${String(d).padStart(2, '0')}`)) n += 1;
  return n;
}

module.exports = { ready, reset, isWorking, after, inMonth };
