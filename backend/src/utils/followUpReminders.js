// ---------------------------------------------------------------------------
// FOLLOW-UP CALL-BACKS ON SCREEN (founder 2026-11-04, on a follow-up "she said that, call on 7th november": "ilaanti vaatiki kuda
// recruiter ki popup avvali. screen meedha").
//
// When a follow-up is written (utils/clientFollowLog.js: a candidate's or a client's), the day to call back is taken from
//   * the "Call back on" date the person picked, else
//   * the words: "7th november", "nov 7", "07-11-2026", "7/11", "tomorrow", "day after tomorrow", "monday", "next week".
// On that day the people to remind get a pop-up on screen, wherever they are in TeamLink (components/FollowUpReminderPopup.jsx):
//   a candidate's follow-up -> the candidate's recruiter(s) (the owners of their open applications) and whoever wrote it
//   a client's follow-up    -> whoever wrote it, and the client's BDE
// Each person presses Done (gone for them) or Tomorrow (back the next day). Rows: raw table "FollowUpReminder", one per person.
// ---------------------------------------------------------------------------
const crypto = require('crypto');
const prisma = require('../db');

const IST = 330 * 60000;
const todayIst = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const DOW = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

function realDay(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
}
// a day with no year: this year; next year only when this year's is long gone ("5th January" written in December). A day
// that has just passed ("she joined on 2nd october", yesterday) is something that happened, not a call-back: null.
function nextOf(m, d, today) {
  const y = Number(today.slice(0, 4));
  const a = realDay(y, m, d);
  if (a && a >= today) return a;
  if (a && a >= addDays(today, -120)) return null;
  return realDay(y + 1, m, d);
}

// The call-back day in a note (YYYY-MM-DD, today or later), or null. Day first, as people write here (07-11 = 7 November).
function callBackDay(text, today = todayIst()) {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return null;
  const keep = (d) => (d && d >= today && d <= addDays(today, 400) ? d : null);
  if (/\bday after tomorrow\b/.test(t)) return addDays(today, 2);
  if (/\b(tomorrow|tmrw|tmr|repu)\b/.test(t)) return addDays(today, 1);
  if (/\bnext week\b/.test(t)) return addDays(today, 7);
  let m = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?(${MONTHS})\\b\\.?(?:[\\s,]+(\\d{4}))?`));
  if (m) { const mo = MON[m[2].slice(0, m[2].startsWith('sept') ? 4 : 3)]; return keep(m[3] ? realDay(+m[3], mo, +m[1]) : nextOf(mo, +m[1], today)); }
  m = t.match(new RegExp(`\\b(${MONTHS})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:[\\s,]+(\\d{4}))?`));
  if (m) { const mo = MON[m[1].slice(0, m[1].startsWith('sept') ? 4 : 3)]; return keep(m[3] ? realDay(+m[3], mo, +m[2]) : nextOf(mo, +m[2], today)); }
  m = t.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/);
  if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return keep(realDay(y, +m[2], +m[1])); }
  m = t.match(/\b(?:on|by|call|after)\s+(\d{1,2})[-/.](\d{1,2})\b/);
  if (m) return keep(nextOf(+m[2], +m[1], today));
  m = t.match(/\b(?:on|next|this|call(?:\s+on)?|coming)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/) || t.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (m) {
    const now = new Date(`${today}T00:00:00Z`).getUTCDay();
    let diff = (DOW[m[1]] - now + 7) % 7;
    if (diff === 0) diff = 7;
    return addDays(today, diff);
  }
  return null;
}

let ready = null;
function ensure() {
  if (!ready) {
    ready = prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "FollowUpReminder" (
      "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "remindOn" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'OPEN',
      "candidateId" TEXT, "clientId" TEXT, "entryId" TEXT, "note" TEXT, "byName" TEXT, "writtenOn" TEXT, "createdAt" TEXT NOT NULL, "doneAt" TEXT)`)
      .then(() => prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "FollowUpReminder_due" ON "FollowUpReminder" ("userId", "status", "remindOn")'))
      .catch((e) => { ready = null; throw e; });
  }
  return ready;
}

// The candidate's recruiters now: the owners of their open applications.
async function recruitersOf(candidateId) {
  const apps = await prisma.application.findMany({ where: { candidateId, stage: { notIn: ['REJECTED', 'JOINED', 'HIRED'] }, ownerRecruiterId: { not: null } }, select: { ownerRecruiterId: true } });
  const ids = [...new Set(apps.map((a) => a.ownerRecruiterId))];
  if (!ids.length) return [];
  const live = await prisma.user.findMany({ where: { id: { in: ids }, status: 'Active' }, select: { id: true } });
  return live.map((u) => u.id);
}
async function bdeOf(clientId) {
  try {
    const ids = await require('./clientBdes').ownerBdeIds({ clientId }); // eslint-disable-line global-require
    return (ids || []).filter(Boolean);
  } catch { return []; }
}

// After a follow-up is saved: set its call-back for the right people. -> { remindOn, people } or null
async function fromEntry(e, { remindOn = null } = {}) {
  const day = remindOn && /^\d{4}-\d{2}-\d{2}$/.test(remindOn) && remindOn >= todayIst() ? remindOn : callBackDay(e.note);
  if (!day) return null;
  await ensure();
  const people = new Set([e.byId].filter(Boolean));
  (e.candidateId ? await recruitersOf(e.candidateId) : await bdeOf(e.clientId)).forEach((id) => people.add(id));
  const now = new Date().toISOString();
  for (const userId of people) {
    // eslint-disable-next-line no-await-in-loop
    await prisma.$executeRawUnsafe(
      'INSERT INTO "FollowUpReminder" (id, userId, remindOn, status, candidateId, clientId, entryId, note, byName, writtenOn, createdAt) VALUES (?, ?, ?, \'OPEN\', ?, ?, ?, ?, ?, ?, ?)',
      crypto.randomUUID(), userId, day, e.candidateId || null, e.clientId || null, e.id, String(e.note || '').slice(0, 600), e.byName || null, e.onDate || null, now,
    );
  }
  return { remindOn: day, people: people.size };
}

// The reminders on screen for this login: open, due today or before.
async function dueFor(user) {
  await ensure();
  const rows = await prisma.$queryRawUnsafe('SELECT * FROM "FollowUpReminder" WHERE userId = ? AND status = \'OPEN\' AND remindOn <= ? ORDER BY remindOn ASC, createdAt ASC LIMIT 30', user.id, todayIst());
  if (!rows.length) return [];
  const candIds = [...new Set(rows.map((r) => r.candidateId).filter(Boolean))];
  const clientIds = [...new Set(rows.map((r) => r.clientId).filter(Boolean))];
  const [cands, clients] = await Promise.all([
    candIds.length ? prisma.candidate.findMany({ where: { id: { in: candIds } }, select: { id: true, name: true, phone: true } }) : [],
    clientIds.length ? prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true } }) : [],
  ]);
  const cBy = new Map(cands.map((c) => [c.id, c]));
  const kBy = new Map(clients.map((c) => [c.id, c]));
  return rows.map((r) => {
    const c = r.candidateId ? cBy.get(r.candidateId) : null;
    const k = r.clientId ? kBy.get(r.clientId) : null;
    return {
      id: r.id, remindOn: r.remindOn, late: r.remindOn < todayIst(), note: r.note, byName: r.byName, writtenOn: r.writtenOn,
      who: c ? c.name : k ? k.name : 'Follow-up', kind: c ? 'Candidate' : 'Client',
      link: c ? `/candidates/${c.id}?tab=followups` : k ? `/clients/${k.id}?tab=followups` : null,
    };
  });
}
async function act(user, id, what) {
  await ensure();
  const n = what === 'tomorrow'
    ? await prisma.$executeRawUnsafe('UPDATE "FollowUpReminder" SET remindOn = ? WHERE id = ? AND userId = ? AND status = \'OPEN\'', addDays(todayIst(), 1), id, user.id)
    : await prisma.$executeRawUnsafe('UPDATE "FollowUpReminder" SET status = \'DONE\', doneAt = ? WHERE id = ? AND userId = ? AND status = \'OPEN\'', new Date().toISOString(), id, user.id);
  return Number(n) === 1;
}
// The call-back days already set on these entries (the list shows "Call back on ...").
async function daysOfEntries(entryIds) {
  if (!entryIds.length) return new Map();
  await ensure();
  const rows = await prisma.$queryRawUnsafe(`SELECT entryId, MIN(remindOn) AS remindOn, SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END) AS open FROM "FollowUpReminder" WHERE entryId IN (${entryIds.map(() => '?').join(',')}) GROUP BY entryId`, ...entryIds);
  return new Map(rows.map((r) => [r.entryId, { remindOn: r.remindOn, open: Number(r.open) > 0 }]));
}

module.exports = {
  callBackDay, fromEntry, dueFor, act, daysOfEntries, todayIst,
};
