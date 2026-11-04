// ---------------------------------------------------------------------------
// THE SELECTION CONFIRMATION MAIL, SENT BY THE TL (founder 2026-11-04: "candidate select ithey, mail
// confirmation msg automatic ga generation avvali. and at the same time tl ki, ee recruiter yokka
// candidate ki, mail confirmation ayiindhi, send cheyyandi, candidate ki ani. appudu tl send ani click
// chestey, send avali, candidate ki").
//
//   A move to Selected  -> the confirmation mail is written by itself (draft, status WAITING) and the
//                          job's TL is told: a bell note + the pop-up on screen
//                          (components/SelectionMailPopup.jsx). Nothing goes to the candidate yet.
//   The TL presses Send -> the mail goes to the candidate (from the recruiter's mail identity, so the
//                          answer reaches the recruiter), through the normal one-person send (consent,
//                          STOP, the "Candidate emails" switch, limits all apply there). The recruiter
//                          is told it went.
//   The TL may correct the words first, or press "Do not send".
// This takes the place of the automatic "Selected" step message, so the candidate never gets two.
//
// Who sends: the job's TL (requirement.tlId); with no TL on the job, a Super Admin / Admin. A Super
// Admin / Admin, and a TL / STL / Manager who can see the candidate, may send any of them.
// Rows: raw table "SelectionMail" (made the first time it is needed).
// ---------------------------------------------------------------------------
const crypto = require('crypto');
const prisma = require('../db');

let ready = null;
function ensureTable() {
  if (!ready) {
    ready = prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "SelectionMail" (
      "id" TEXT PRIMARY KEY, "applicationId" TEXT NOT NULL, "candidateId" TEXT NOT NULL, "requirementId" TEXT,
      "recruiterId" TEXT, "recruiterName" TEXT, "tlIds" TEXT, "subject" TEXT NOT NULL, "body" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'WAITING', "result" TEXT, "createdAt" TEXT NOT NULL, "sentAt" TEXT,
      "sentById" TEXT, "sentByName" TEXT)`)
      .then(() => prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "SelectionMail_app" ON "SelectionMail" ("applicationId", "status")'))
      .catch((e) => { ready = null; throw e; });
  }
  return ready;
}
const q = async (sql, ...args) => { await ensureTable(); return prisma.$queryRawUnsafe(sql, ...args); };
const x = async (sql, ...args) => { await ensureTable(); return prisma.$executeRawUnsafe(sql, ...args); };

const POPUP_TITLE = '✉️ Selection mail to send: ';
const split = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

async function nameOf(userId) {
  if (!userId) return null;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, employee: { select: { name: true } } } }).catch(() => null);
  return u ? (u.employee && u.employee.name) || u.name : null;
}

// The words. Candidates never see the client's name in an automatic message (the same rule as
// utils/candidateComms.js); the TL may add it before sending.
function words({ candidate, requirement, recruiterName }) {
  const first = String((candidate && candidate.name) || 'there').trim().split(/\s+/)[0];
  const role = (requirement && requirement.title) || 'the role';
  const where = requirement && requirement.internal ? 'TeamLink' : 'our client';
  return {
    subject: `Congratulations - you are selected for ${role}`,
    body: [
      `Dear ${first},`,
      '',
      `Congratulations! We are happy to confirm that you have been selected for the role of ${role} with ${where}.`,
      '',
      `${recruiterName || 'Your recruiter'} will call you soon about the next steps: the offer, your documents and the joining date.`,
      '',
      'Please reply to this mail to confirm, or call us if you have any questions.',
      '',
      'Best wishes,',
      recruiterName || 'TeamLink',
      'TeamLink',
    ].join('\n'),
  };
}

// --- a move to Selected (utils/candidateComms.js recordStageCommunications) -----------------------------
async function onSelected({ application, candidate, requirement, user }) {
  if (!application || !candidate) return null;
  const r = requirement || {};
  const recruiterId = application.ownerRecruiterId || r.recruiterId || split(r.recruiterIds)[0] || (user && user.id) || null;
  const recruiterName = await nameOf(recruiterId);
  let tlIds = [r.tlId].filter(Boolean);
  if (!tlIds.length) {
    const admins = await prisma.user.findMany({ where: { status: 'Active', role: { in: ['SUPER_ADMIN', 'ADMIN'] } }, select: { id: true }, take: 5 }).catch(() => []);
    tlIds = admins.map((a) => a.id);
  }
  const { subject, body } = words({ candidate, requirement: r, recruiterName });
  // a candidate moved back and selected again: the waiting mail is renewed, not doubled
  await x(`UPDATE "SelectionMail" SET status = 'CANCELLED', result = 'Selected again: a new mail was written.' WHERE applicationId = ? AND status = 'WAITING'`, application.id);
  const id = crypto.randomUUID();
  await x(
    'INSERT INTO "SelectionMail" (id, applicationId, candidateId, requirementId, recruiterId, recruiterName, tlIds, subject, body, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, \'WAITING\', ?)',
    id, application.id, candidate.id, r.id || null, recruiterId, recruiterName, tlIds.join(','), subject, body, new Date().toISOString(),
  );
  const { notifyUsers } = require('./notify'); // eslint-disable-line global-require
  const client = r.internal ? 'TeamLink' : (r.client && r.client.name) || '';
  await notifyUsers(tlIds, {
    title: `${POPUP_TITLE}${candidate.name}`,
    message: `${recruiterName || 'The recruiter'}'s candidate ${candidate.name} is Selected for ${r.title || 'the job'}${client ? ` (${client})` : ''}. The confirmation mail is ready: check it and press Send.\nOpen: /candidates/${candidate.id}`,
  }).catch(() => {});
  return id;
}

// --- who may send -----------------------------------------------------------------------------------------
async function maySend(user, row, app) {
  if (!user || !row) return false;
  const { stageGlobal } = require('./permissions'); // eslint-disable-line global-require
  if (stageGlobal(user)) return true;
  if (split(row.tlIds).includes(user.id)) return true;
  const { atsViewRole, applicationInScope } = require('./scope'); // eslint-disable-line global-require
  return ['tl', 'stl', 'mgmt', 'admin'].includes(atsViewRole(user)) && !!app && applicationInScope(user, app);
}

const shape = (row, app) => ({
  id: row.id,
  applicationId: row.applicationId,
  candidateId: row.candidateId,
  candidate: app && app.candidate ? app.candidate.name : '',
  email: app && app.candidate ? app.candidate.email || '' : '',
  job: app && app.requirement ? app.requirement.title : '',
  client: app && app.requirement ? (app.requirement.internal ? 'TeamLink' : (app.requirement.client && app.requirement.client.name) || '') : '',
  recruiter: row.recruiterName || '',
  subject: row.subject,
  body: row.body,
  status: row.status,
  result: row.result || null,
  createdAt: row.createdAt,
  sentAt: row.sentAt || null,
  sentByName: row.sentByName || null,
});
const APP_INCLUDE = { candidate: { select: { id: true, name: true, email: true } }, requirement: { include: { client: { select: { name: true } } } } };

// The mails waiting for THIS login (the pop-up): only for candidates still at Selected.
async function pendingFor(user) {
  const rows = await q('SELECT * FROM "SelectionMail" WHERE status = \'WAITING\' ORDER BY createdAt DESC LIMIT 200');
  if (!rows.length) return [];
  const apps = await prisma.application.findMany({ where: { id: { in: rows.map((r) => r.applicationId) } }, include: APP_INCLUDE });
  const byId = new Map(apps.map((a) => [a.id, a]));
  const out = [];
  for (const row of rows) {
    const app = byId.get(row.applicationId);
    if (!app || app.stage !== 'SELECTED') continue; // eslint-disable-line no-continue
    // The pop-up is for the TL named on the row; others (Admin, a manager) find it on the profile.
    if (!split(row.tlIds).includes(user.id)) continue; // eslint-disable-line no-continue
    out.push(shape(row, app));
  }
  return out;
}

// The latest mail of one application (the candidate profile).
async function ofApplication(user, applicationId) {
  const rows = await q('SELECT * FROM "SelectionMail" WHERE applicationId = ? ORDER BY createdAt DESC LIMIT 1', applicationId);
  if (!rows.length) return null;
  const app = await prisma.application.findUnique({ where: { id: applicationId }, include: APP_INCLUDE });
  return { ...shape(rows[0], app), maySend: rows[0].status === 'WAITING' && (await maySend(user, rows[0], app)) };
}

async function load(user, id) {
  const rows = await q('SELECT * FROM "SelectionMail" WHERE id = ?', String(id));
  if (!rows.length) return { error: 'This mail was not found.', status: 404 };
  const row = rows[0];
  const app = await prisma.application.findUnique({ where: { id: row.applicationId }, include: APP_INCLUDE });
  if (!(await maySend(user, row, app))) return { error: 'Only the team lead of this job (or an Admin) sends this mail.', status: 403 };
  if (row.status !== 'WAITING') return { error: row.status === 'SENT' ? `This mail was already sent${row.sentByName ? ` by ${row.sentByName}` : ''}.` : 'This mail is not waiting any more.', status: 409 };
  return { row, app };
}

const clearBell = (row) => prisma.notification.updateMany({ where: { read: false, title: { startsWith: POPUP_TITLE }, message: { endsWith: `/candidates/${row.candidateId}` }, userId: { in: split(row.tlIds) } }, data: { read: true } }).catch(() => {});

// TL: Send (optionally with corrected words)
async function send(user, id, { subject, body } = {}) {
  const f = await load(user, id);
  if (f.error) return f;
  const { row, app } = f;
  if (!app || app.stage !== 'SELECTED') return { error: 'The candidate is not at Selected any more, so this mail was not sent.', status: 409 };
  const subj = String(subject == null ? row.subject : subject).trim().slice(0, 300);
  const text = String(body == null ? row.body : body).trim().slice(0, 8000);
  if (!subj || !text) return { error: 'Write the subject and the mail.', status: 400 };
  // claim it first, so two presses cannot send twice
  const n = await x('UPDATE "SelectionMail" SET status = \'SENDING\', subject = ?, body = ? WHERE id = ? AND status = \'WAITING\'', subj, text, row.id);
  if (Number(n) !== 1) return { error: 'This mail is already being sent.', status: 409 };
  const ENGINE = require('./interviewEngine'); // eslint-disable-line global-require
  const sys = await ENGINE.systemIdentityFor(app).catch(() => null); // from the recruiter, so the answer reaches them
  let out;
  try {
    out = sys
      ? await require('./omniSend').send(sys, { // eslint-disable-line global-require
        audience: 'candidates', id: row.candidateId, channel: 'Email', applicationId: row.applicationId, purpose: 'Selection confirmation', subject: subj, body: text, urgent: true,
      })
      : { error: 'No sender could be found for this job.' };
  } catch (e) { out = { error: e.message }; }
  const ok = !!(out && out.ok === true);
  const who = (user.employee && user.employee.name) || user.name || 'TL';
  if (!ok) {
    const why = String((out && (out.error || out.reason)) || 'Not sent.').slice(0, 400);
    await x('UPDATE "SelectionMail" SET status = \'WAITING\', result = ? WHERE id = ?', why, row.id);
    return { error: `The mail was not sent: ${why}`, status: 409 };
  }
  await x('UPDATE "SelectionMail" SET status = \'SENT\', sentAt = ?, sentById = ?, sentByName = ?, result = ? WHERE id = ?', new Date().toISOString(), user.id, who, `Sent by ${who}`, row.id);
  await clearBell(row);
  const { notifyUsers } = require('./notify'); // eslint-disable-line global-require
  await notifyUsers([row.recruiterId], {
    title: `✅ Selection mail sent: ${app.candidate ? app.candidate.name : ''}`,
    message: `${who} sent the selection confirmation mail to ${app.candidate ? app.candidate.name : 'the candidate'}.`,
    exceptUserId: user.id,
  }).catch(() => {});
  await require('./audit').logAudit({ userId: user.id, action: 'Selection confirmation mail sent', entity: 'Application', entityId: row.applicationId, toValue: subj }).catch(() => {}); // eslint-disable-line global-require
  return { ok: true, message: `Sent to ${app.candidate ? app.candidate.name : 'the candidate'}.` };
}

// TL: Do not send
async function cancel(user, id) {
  const f = await load(user, id);
  if (f.error) return f;
  const who = (user.employee && user.employee.name) || user.name || 'TL';
  await x('UPDATE "SelectionMail" SET status = \'CANCELLED\', result = ?, sentById = ?, sentByName = ? WHERE id = ? AND status = \'WAITING\'', `Not sent: ${who} chose not to send it.`, user.id, who, f.row.id);
  await clearBell(f.row);
  return { ok: true, message: 'This mail will not be sent.' };
}

module.exports = {
  POPUP_TITLE, words, onSelected, pendingFor, ofApplication, send, cancel,
};
