// ---------------------------------------------------------------------------
// RECRUITERS TOKENS, THE TEAMLINK SIDE (founder 2026-11-05). Omni-Channel (Green Start) > Campaigns > Recruiters Tokens shows tokens (message credits) per department
// and per recruiter against their joinings. Green Start owns its own sends; everything about PEOPLE is TeamLink's, so it asks here, server to server
// (GET /api/public/omni-voice/credit-use, routes/omniVoiceBridge.js, signed with the shared secret):
//   viewer      who may see what: TeamLink's own rule (insights.scopeOf). The id comes from the signed sign-in ticket, because a department's login is shared.
//   persons     the CURRENT HRMS seat holders in that scope (founder 2026-10-29: past holders hidden, a new holder appears by themselves), their department from the
//               seat code's first word (BDE EDU-1 = BDE), with their TeamLink tokens, replies, interviews and same-month joinings.
//   past        TeamLink tokens of people not in a seat now, by department, with no names: past credits stay in the month's history.
//   company     every seat holder's tokens + joinings, only for the "costly" yardstick. Green Start never shows these rows.
//   workspaces  Green Start workspace id -> department (utils/omniDeptLogins.js), for the sends no person can be named for.
// A login that is not active here is refused. Reads only; writes nothing.
// ---------------------------------------------------------------------------
const prisma = require('../db');
const A = require('./access');
const Cr = require('./credits');
const Ins = require('./insights');
const { deptOfSeat } = require('../utils/assetHrmsScope');
const { resolveIdentity } = require('../utils/identity');

const num = (v) => (typeof v === 'bigint' ? Number(v) : (v == null ? 0 : Number(v)));

/** userId -> { seat, department } of everybody sitting in a seat today (PositionAssignment.toDate empty). */
async function seatHolders() {
  const rows = await prisma.positionAssignment.findMany({
    where: { toDate: null, position: { active: true } },
    select: { position: { select: { code: true, department: true } }, employee: { select: { userId: true, department: true } } },
    orderBy: { fromDate: 'desc' },
  });
  const out = new Map();
  rows.forEach((r) => {
    const id = r.employee && r.employee.userId;
    if (!id || out.has(id)) return;
    out.set(id, { seat: r.position.code, department: deptOfSeat(r.position.code) || r.position.department || r.employee.department || 'No department' });
  });
  return out;
}

/** Green Start workspace id -> department, from the department logins TeamLink itself set up. */
async function workspaceDepartments() {
  const st = await require('../utils/omniDeptLogins').last(); // eslint-disable-line global-require
  const map = {};
  Object.values((st && st.departments) || {}).forEach((row) => {
    (row.workspaceIds || (row.workspaceId ? [row.workspaceId] : [])).forEach((id) => { if (id && row.dept) map[id] = row.dept; });
  });
  return map;
}

async function interviewsBy(ids, from, to) {
  const out = new Map();
  try {
    const ev = await prisma.applicationStageEvent.groupBy({ by: ['actorUserId'], where: { toStage: 'INTERVIEW_SCHEDULED', actorUserId: { in: ids }, createdAt: { gte: new Date(from), lt: new Date(to) } }, _count: { _all: true } });
    ev.forEach((x) => out.set(x.actorUserId, x._count._all));
  } catch { /* none */ }
  return out;
}

/** -> { ok:true, ... } or { ok:false, code, error } (never throws for an unknown login). */
async function forOmni(viewerId, month) {
  const id = String(viewerId || '').trim().slice(0, 80);
  const user = id ? await resolveIdentity(id).catch(() => null) : null;
  if (!user || (user.status && user.status !== 'Active') || require('../utils/leftLogin').hasLeft(user)) { // eslint-disable-line global-require
    return { ok: false, code: 'VIEWER_UNKNOWN', error: 'TeamLink does not know this login, or it is not active. Open Omni-Channel again from TeamLink.' };
  }
  try { await A.warm(); } catch { /* keep the last list */ }
  const sc = await Ins.scopeOf(user);
  const scope = sc.all ? 'all' : (sc.departments ? 'department' : (sc.userIds ? 'team' : 'me'));
  const m = Cr.isMonth(month) ? month : Cr.thisMonth();
  const act = await Cr.activity(m, Ins.actOpts(sc));
  const everybody = sc.all ? act : await Cr.activity(m, { all: true });
  const holders = await seatHolders();
  const { from, to } = Cr.range(m);

  // a Recruiter always sees their own row, even on a day their seat is not recorded
  const rows = act.rows.filter((r) => holders.has(r.userId) || (scope === 'me' && r.userId === user.id));
  const ids = rows.map((r) => r.userId);
  const replyBy = await Ins.repliesByOwner(ids, from, to);
  const intBy = await interviewsBy(ids, from, to);
  const persons = rows.map((r) => {
    const h = holders.get(r.userId);
    return { userId: r.userId, name: r.name, code: r.code || null, seat: h ? h.seat : null, department: (h && h.department) || r.department || 'No department', credits: r.used, sent: r.sent, replies: replyBy.get(r.userId) || 0, interviews: intBy.get(r.userId) || 0, joinings: r.joinings };
  });

  await Cr.ensureTables();
  const ledger = await prisma.$queryRawUnsafe('SELECT userId u, department d, COUNT(*) n, COALESCE(SUM(credits),0) c FROM "OmniCreditLedger" WHERE at >= ? AND at < ? AND mode = \'live\' AND result <> \'failed\' AND userId IS NOT NULL GROUP BY userId, department', from, to);
  const pastBy = new Map();
  ledger.filter((r) => !holders.has(r.u) && !ids.includes(r.u)).forEach((r) => {
    const k = r.d || 'No department';
    const o = pastBy.get(k) || { department: k, credits: 0, sent: 0 };
    o.credits += num(r.c); o.sent += num(r.n);
    pastBy.set(k, o);
  });

  const companyIds = new Set([...holders.keys(), ...ids]);
  const departments = [...new Set([...(sc.departments || []), ...persons.map((p) => p.department)])];
  return {
    ok: true, month: m,
    viewer: { scope, words: sc.words, departments: scope === 'me' ? [] : departments },
    cost: act.rules.cost,
    persons,
    past: [...pastBy.values()],
    company: [...everybody.rows, ...rows].filter((r, i, all) => companyIds.has(r.userId) && all.findIndex((x) => x.userId === r.userId) === i).map((r) => ({ userId: r.userId, credits: r.used, joinings: r.joinings })),
    workspaces: await workspaceDepartments(),
  };
}

module.exports = { forOmni, seatHolders, workspaceDepartments };
