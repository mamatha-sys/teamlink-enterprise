// ---------------------------------------------------------------------------
// VACANCIES ON THE DASHBOARD (founder 2026-11-02): "dashboard medha vacancies enni unai anni kuda kanipinchali. Education lo motham 13
// members untaru dantlo stl, tl's 2, employee 10 ... medical 1 tl, 5 employees, manufacturing 1 tl, 5 employees and medical and
// manufacturing rendu departments ki okate stl and bde ki tl-1, employee-5, and R&D tl-1, employee-3".
//
// PLAN  = how many people each department should have, per role (STL / TL / Employee). AppSetting 'hrms.vacancyPlan'; the founder's
//         numbers are the default; only the Super Admin changes it. A group may cover several departments (one STL for Medical +
//         Manufacturing).
// FILLED = employees who have not left (status not Relieved / Exited), by department and designation: a designation with "STL" or
//         "Senior Team Lead" = STL, one with "TL" or "Team Lead" = TL, everyone else = Employee. Notice Period still counts as filled
//         (shown as "leaving"), because the person is still working.
// VACANT = plan - filled (never below 0); more people than the plan shows as "over".
// ---------------------------------------------------------------------------
const prisma = require('../db');

const PLAN_KEY = 'hrms.vacancyPlan';
const ROLES = ['STL', 'TL', 'Employee'];
const LEFT = ['Relieved', 'Exited'];
const DEFAULT_PLAN = [
  { name: 'Education', departments: ['Education'], rows: [{ role: 'STL', planned: 1 }, { role: 'TL', planned: 2 }, { role: 'Employee', planned: 10 }] },
  { name: 'Medical', departments: ['Medical'], rows: [{ role: 'TL', planned: 1 }, { role: 'Employee', planned: 5 }] },
  { name: 'Manufacturing', departments: ['Manufacturing'], rows: [{ role: 'TL', planned: 1 }, { role: 'Employee', planned: 5 }] },
  { name: 'Medical + Manufacturing', departments: ['Medical', 'Manufacturing'], rows: [{ role: 'STL', planned: 1 }] },
  { name: 'BDE', departments: ['BDE'], rows: [{ role: 'TL', planned: 1 }, { role: 'Employee', planned: 5 }] },
  { name: 'R&D', departments: ['R&D'], rows: [{ role: 'TL', planned: 1 }, { role: 'Employee', planned: 3 }] },
];

const roleOf = (designation) => {
  const d = String(designation || '');
  if (/\bSTL\b|senior\s+team\s+lead/i.test(d)) return 'STL';
  if (/\bTL\b|team\s+lead/i.test(d)) return 'TL';
  return 'Employee';
};
const low = (s) => String(s || '').trim().toLowerCase();

async function readPlan() {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: PLAN_KEY } });
    const v = row ? JSON.parse(row.value) : null;
    if (Array.isArray(v) && v.length) return v;
  } catch { /* the default */ }
  return DEFAULT_PLAN;
}

// a plan from the screen -> a clean plan, or { error }
function cleanPlan(input) {
  if (!Array.isArray(input) || !input.length || input.length > 40) return { error: 'The plan needs at least one department.' };
  const out = [];
  for (const g of input) {
    const name = String((g && g.name) || '').trim().slice(0, 60);
    const departments = [...new Set((Array.isArray(g && g.departments) ? g.departments : [name]).map((d) => String(d || '').trim().slice(0, 60)).filter(Boolean))];
    if (!name || !departments.length) return { error: 'Every row needs a department name.' };
    const rows = [];
    for (const r of (g.rows || [])) {
      if (!ROLES.includes(r && r.role)) return { error: `"${name}": the role must be STL, TL or Employee.` };
      const planned = Number(r.planned);
      if (!Number.isInteger(planned) || planned < 0 || planned > 500) return { error: `"${name}" ${r.role}: give a whole number from 0 to 500.` };
      if (rows.some((x) => x.role === r.role)) return { error: `"${name}" has ${r.role} twice.` };
      rows.push({ role: r.role, planned });
    }
    out.push({ name, departments, rows });
  }
  return { plan: out };
}

async function savePlan(input) {
  const c = cleanPlan(input);
  if (c.error) return c;
  const value = JSON.stringify(c.plan);
  await prisma.appSetting.upsert({ where: { key: PLAN_KEY }, update: { value }, create: { key: PLAN_KEY, value } });
  return { ok: true };
}

// the dashboard view: every group, every role, planned / filled / vacant, with the names
async function view() {
  const plan = await readPlan();
  const people = await prisma.employee.findMany({
    where: { employmentStatus: { notIn: LEFT } },
    select: { id: true, name: true, department: true, designation: true, employmentStatus: true },
    orderBy: { name: 'asc' },
  });
  // which group counts a (department, role): the first group that covers the department AND plans that role
  const groupFor = (dept, role) => plan.findIndex((g) => g.departments.some((d) => low(d) === low(dept)) && g.rows.some((r) => r.role === role));
  const seat = plan.map((g) => Object.fromEntries(g.rows.map((r) => [r.role, []])));
  people.forEach((p) => {
    const role = roleOf(p.designation);
    const gi = groupFor(p.department, role);
    if (gi >= 0) seat[gi][role].push({ id: p.id, name: p.name, designation: p.designation || '', leaving: p.employmentStatus === 'Notice Period' });
  });
  let planned = 0; let filled = 0; let vacant = 0; let leaving = 0;
  const groups = plan.map((g, gi) => {
    const rows = g.rows.map((r) => {
      const ppl = seat[gi][r.role];
      const v = Math.max(0, r.planned - ppl.length);
      const l = ppl.filter((x) => x.leaving).length;
      planned += r.planned; filled += Math.min(ppl.length, r.planned); vacant += v; leaving += l;
      return { role: r.role, planned: r.planned, filled: ppl.length, vacant: v, over: Math.max(0, ppl.length - r.planned), leaving: l, people: ppl };
    });
    return { name: g.name, departments: g.departments, rows, planned: rows.reduce((s, r) => s + r.planned, 0), filled: rows.reduce((s, r) => s + r.filled, 0), vacant: rows.reduce((s, r) => s + r.vacant, 0) };
  });
  return { groups, totals: { planned, filled, vacant, leaving }, plan, roles: ROLES };
}

module.exports = { view, readPlan, savePlan, cleanPlan, roleOf, DEFAULT_PLAN, PLAN_KEY };
