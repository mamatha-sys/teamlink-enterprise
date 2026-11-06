// ---------------------------------------------------------------------------
// THE OFFBOARDING CHECKLIST (founder 2026-11-06: "resignation details lo stages complete ayyaya ani automatic check undali, onboarding check boxes laga;
// assets return, full & final payment etc automatic click or HR manual click").
//
// One list for one exit, on the Resignation details and the Exit record:
//   auto     the system knows, so it ticks by itself and nobody can tick it by hand: submitted, approved, last working day, relieved. Ticking these by
//            hand would say an approval happened when it did not.
//   both     ticks by itself when the system sees it, and HR can tick it when it was done outside the system: assets, login, full & final.
//   manual   only a person knows: work handover, exit interview, experience letter.
// HR's ticks are kept in Employee.offboardingTasks, the list the employee's profile already shows, so both screens show one truth. Ticking never relieves
// anybody: that stays with the exit's approval and last working day (utils/exitFlow.js).
// ---------------------------------------------------------------------------
const prisma = require('../db');
const exitDate = require('./exitDate');

const DONE_RECORD = ['Notice Period', 'Accepted', 'Relieved'];
const CLOSED_RECORD = ['Rejected', 'Withdrawn'];
const LEFT = ['Relieved', 'Exited', 'Terminated'];

// `task` is the words stored in Employee.offboardingTasks: existing rows keep working.
const STEPS = [
  { key: 'submitted', label: 'Resignation submitted', mode: 'auto' },
  { key: 'approved', label: 'Resignation approved', mode: 'auto' },
  { key: 'handover', label: 'Work handover done', mode: 'manual', task: 'Work handover done' },
  { key: 'interview', label: 'Exit interview done', mode: 'manual', task: 'Exit interview scheduled' },
  { key: 'assets', label: 'Assets returned', mode: 'both', task: 'Assets returned' },
  { key: 'lwd', label: 'Last working day reached', mode: 'auto' },
  { key: 'access', label: 'Login access closed', mode: 'both', task: 'Access revoked' },
  { key: 'relieved', label: 'Relieved', mode: 'auto' },
  { key: 'fnf', label: 'Full & final payment done', mode: 'both', task: 'Full & final settlement processed' },
  { key: 'letter', label: 'Experience letter given', mode: 'manual', task: 'Experience letter issued' },
];
const LABELS = STEPS.map((s) => s.label);

const parseTasks = (raw) => {
  try { const t = raw ? JSON.parse(raw) : []; return Array.isArray(t) ? t : []; } catch { return []; }
};

// What the system itself can see, from the facts given. Pure, so it is tested on its own.
function autoFacts({ status, lastWorkingDate, today, employmentStatus, loginStatus, assets = [], fnf = null, resignationDate = null, dmy = (d) => d }) {
  const left = status === 'Relieved' || LEFT.includes(employmentStatus);
  const reached = !!lastWorkingDate && lastWorkingDate <= today;
  let fnfNote = 'Not started in Payroll';
  if (fnf) fnfNote = fnf.status === 'Processed' ? `Settled${fnf.settlementAmount != null ? `: Rs ${Number(fnf.settlementAmount).toLocaleString('en-IN')}` : ''}` : 'Waiting in Payroll';
  return {
    submitted: { done: true, note: resignationDate ? dmy(resignationDate) : null },
    approved: { done: DONE_RECORD.includes(status), note: status === 'Pending Approval' ? 'Waiting for approval' : null },
    assets: { done: assets.length === 0, note: assets.length ? `Still with them: ${assets.slice(0, 3).join(', ')}${assets.length > 3 ? ` and ${assets.length - 3} more` : ''}` : 'Nothing with them' },
    lwd: { done: left || reached, note: lastWorkingDate ? dmy(lastWorkingDate) : 'Not set yet' },
    access: { done: !!loginStatus && loginStatus !== 'Active' ? true : loginStatus === null, note: loginStatus === 'Active' ? 'Login is still open' : 'Closed' },
    relieved: { done: left, note: left ? (employmentStatus || 'Relieved') : null },
    fnf: { done: !!fnf && fnf.status === 'Processed', note: fnfNote },
  };
}

// The list as the screen shows it. A task the system ticked earlier (auto:true) follows the system; only a person's own tick stands by itself.
function stepsFrom(facts, tasks) {
  return STEPS.map((s) => {
    const fact = facts[s.key] || {};
    const saved = s.task ? tasks.find((t) => t.task === s.task) : null;
    const byHand = !!saved && !!saved.completed && !saved.auto;
    const autoDone = !!fact.done;
    return {
      key: s.key, label: s.label, mode: s.mode, note: fact.note || null,
      done: autoDone || byHand,
      how: autoDone ? 'auto' : (byHand ? 'hr' : null),
      by: !autoDone && byHand ? saved.by || null : null,
      at: !autoDone && byHand ? saved.at || null : null,
      canTick: s.mode !== 'auto' && !autoDone,
    };
  });
}

// The saved tasks after this list: what the system sees is written down, so the employee's profile shows the same ticks.
function tasksAfter(steps, tasks) {
  const out = STEPS.filter((s) => s.task).map((s) => {
    const step = steps.find((x) => x.key === s.key);
    const saved = tasks.find((t) => t.task === s.task) || { task: s.task, completed: false };
    if (step.how === 'auto') return { ...saved, completed: true, auto: true };
    if (saved.auto) { const { auto, ...rest } = saved; return { ...rest, completed: false }; } // eslint-disable-line no-unused-vars
    return saved;
  });
  return [...out, ...tasks.filter((t) => !STEPS.some((s) => s.task === t.task))];
}

async function load(record) {
  const employee = record.employee || await prisma.employee.findUnique({ where: { id: record.employeeId } });
  const [detail, login, assets, assetRecords, fnf] = await Promise.all([
    prisma.resignationDetail.findUnique({ where: { recordId: record.id } }),
    employee.userId ? prisma.user.findUnique({ where: { id: employee.userId }, select: { status: true } }) : null,
    prisma.asset.findMany({ where: { assignedToId: employee.id, status: 'Assigned' }, select: { name: true } }),
    prisma.employeeRecord.findMany({ where: { type: 'ASSET', employeeId: employee.id, status: 'Assigned' }, select: { title: true } }),
    prisma.fnfRequest.findFirst({ where: { employeeId: employee.id }, orderBy: { createdAt: 'desc' } }),
  ]);
  const held = [...new Set([...assets.map((a) => a.name), ...assetRecords.map((a) => a.title)].filter(Boolean))];
  const facts = autoFacts({
    status: record.status, lastWorkingDate: exitDate.dateOf(record, detail) || null, today: require('./positions').today(),
    employmentStatus: employee.employmentStatus, loginStatus: login ? login.status : null, assets: held, fnf,
    resignationDate: detail ? detail.resignationDate : null, dmy: exitDate.dmy,
  });
  return { employee, tasks: parseTasks(employee.offboardingTasks), facts };
}

const statusAfter = (employee, tasks) => {
  if (tasks.length && tasks.every((t) => t.completed)) return 'Cleared';
  return employee.offboardingStatus === 'Cleared' ? 'Serving Notice' : employee.offboardingStatus;
};

async function save(employee, tasks) {
  const value = JSON.stringify(tasks);
  const offboardingStatus = statusAfter(employee, tasks);
  if (value === employee.offboardingTasks && offboardingStatus === employee.offboardingStatus) return;
  await prisma.employee.update({ where: { id: employee.id }, data: { offboardingTasks: value, offboardingStatus } });
}

const view = (steps) => ({ steps, doneCount: steps.filter((s) => s.done).length, total: steps.length });

// The checklist of one exit, or null when the exit was stopped (rejected, withdrawn): there is nothing to check off.
async function forRecord(record) {
  if (CLOSED_RECORD.includes(record.status)) return null;
  const { employee, tasks, facts } = await load(record);
  const steps = stepsFrom(facts, tasks);
  await save(employee, tasksAfter(steps, tasks));
  return view(steps);
}

// HR's tick. -> the new list, or { error } in plain words.
async function tick(record, key, done, user) {
  const step = STEPS.find((s) => s.key === key);
  if (!step) return { error: 'Unknown step.', status: 404 };
  if (CLOSED_RECORD.includes(record.status)) return { error: 'This exit was stopped, so there is nothing to tick.', status: 400 };
  if (step.mode === 'auto') return { error: `"${step.label}" ticks by itself.`, status: 400 };
  const { employee, tasks, facts } = await load(record);
  if (facts[key] && facts[key].done) return { error: `The system already shows "${step.label}", so this cannot be changed by hand.`, status: 400 };
  const without = tasks.filter((t) => t.task !== step.task);
  const mine = done ? { task: step.task, completed: true, by: user.name || 'HR', at: new Date().toISOString() } : { task: step.task, completed: false };
  const next = [...without, mine];
  const steps = stepsFrom(facts, next);
  await save(employee, tasksAfter(steps, next));
  return { checklist: view(steps), label: step.label };
}

module.exports = { STEPS, LABELS, autoFacts, stepsFrom, tasksAfter, statusAfter, forRecord, tick };
