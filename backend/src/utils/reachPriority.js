// ---------------------------------------------------------------------------
// BEST WAY TO REACH A CANDIDATE (founder 2026-11-04: "candiates ki priority based
// vundali ... ai calling ki respond avutharu, ledh antey, wtsp ki respond
// avuthunnara, ledhantey, sms ki respond avuthunnara? ... candidate profile open
// chesthey, vallau response ayye dhanni batti, dhani priority vundali").
//
// From what is already recorded about the person, nothing new is stored:
//   AI call     "AiCall" rows: tried = the call was placed; responded = they picked
//               up and talked (completed, some seconds, not "No Response").
//   Phone call  CandidateMessage channel Call (the call queue / call log):
//               responded = Answered / Call back.
//   WhatsApp, SMS, Email   CandidateMessage: tried = really sent; responded = a
//               reply from them (status RECEIVED). WhatsApp "Read" counts as seen.
//
// rank(candidateId) -> { channels: [...best first], best, preferred, basis }
// A channel's score is its reply rate, softened for few tries, and lifted a
// little when the last reply is recent. Channels never tried come last.
// ---------------------------------------------------------------------------
const prisma = require('../db');

const DAY = 86400000;
const SENT = ['SENT', 'DELIVERED', 'READ', 'OPENED_ON_DEVICE', 'QUEUED_PROVIDER', 'ACCEPTED'];
const ANSWERED_CALL = /^(Answered|Call back)\b/i;
const NOT_ANSWERED_CALL = /^(Not answered|Busy|Wrong number)\b/i;
const ORDER_IF_UNTRIED = ['WhatsApp', 'AI call', 'Phone call', 'SMS', 'Email'];

const blank = (key) => ({ key, tried: 0, responded: 0, seen: 0, lastTriedAt: null, lastResponseAt: null });
const later = (a, b) => (!a ? b : !b ? a : (a > b ? a : b));
const iso = (v) => { if (!v) return null; const d = new Date(typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };

async function aiCallsOf(candidateId) {
  try {
    return await prisma.$queryRawUnsafe(
      'SELECT "status", "outcome", "durationSec", "startedAt", "lastAttemptAt", "createdAt" FROM "AiCall" WHERE "candidateId" = ? AND "deletedAt" IS NULL AND "mode" != \'Test\'',
      String(candidateId),
    );
  } catch { return []; } // the AI calling tables are made the first time AI calling is used
}

function scoreOf(c, now) {
  if (!c.tried && !c.responded) return null;
  const tries = Math.max(c.tried, c.responded);
  let s = (c.responded + 0.5) / (tries + 1.5);
  if (c.lastResponseAt && now - new Date(c.lastResponseAt).getTime() < 30 * DAY) s += 0.15;
  else if (c.lastResponseAt && now - new Date(c.lastResponseAt).getTime() < 90 * DAY) s += 0.05;
  if (c.key === 'WhatsApp' && !c.responded && c.seen) s += 0.05; // read but did not answer: a little better than nothing
  return Math.round(s * 100) / 100;
}

function wordsOf(c) {
  if (!c.tried && !c.responded) return 'Not tried yet';
  const what = { 'AI call': 'calls answered', 'Phone call': 'calls answered', WhatsApp: 'messages replied', SMS: 'messages replied', Email: 'mails replied' }[c.key];
  const base = `${c.responded} of ${Math.max(c.tried, c.responded)} ${what}`;
  return c.key === 'WhatsApp' && c.seen && !c.responded ? `${base} (${c.seen} read)` : base;
}

async function rank(candidateId, { now = Date.now() } = {}) {
  const id = String(candidateId || '');
  const ch = Object.fromEntries(ORDER_IF_UNTRIED.map((k) => [k, blank(k)]));
  const [msgs, calls, thread] = await Promise.all([
    prisma.candidateMessage.findMany({ where: { candidateId: id }, select: { channel: true, template: true, status: true, body: true, sentAt: true, attempts: true, createdAt: true } }).catch(() => []),
    aiCallsOf(id),
    prisma.$queryRawUnsafe('SELECT "preferredChannel" FROM "Conversation" WHERE "personType" = \'CANDIDATE\' AND "personId" = ? LIMIT 1', id).catch(() => []),
  ]);
  for (const m of msgs) {
    const at = iso(m.sentAt || m.createdAt);
    if (m.channel === 'Call') {
      if (m.template === 'AI_CALL') continue; // eslint-disable-line no-continue -- the AI call's copy in the history: counted from "AiCall" below
      const c = ch['Phone call'];
      if (ANSWERED_CALL.test(m.body || '')) { c.tried += 1; c.responded += 1; c.lastResponseAt = later(c.lastResponseAt, at); c.lastTriedAt = later(c.lastTriedAt, at); } else if (NOT_ANSWERED_CALL.test(m.body || '')) { c.tried += 1; c.lastTriedAt = later(c.lastTriedAt, at); }
      continue; // eslint-disable-line no-continue
    }
    const c = ch[m.channel];
    if (!c) continue; // eslint-disable-line no-continue
    if (m.status === 'RECEIVED') { c.responded += 1; c.lastResponseAt = later(c.lastResponseAt, at); } else if (SENT.includes(m.status) || m.sentAt || m.attempts > 0) {
      c.tried += 1; c.lastTriedAt = later(c.lastTriedAt, at);
      if (m.status === 'READ') c.seen += 1;
    }
  }
  for (const r of calls) {
    const c = ch['AI call'];
    const at = iso(r.startedAt || r.lastAttemptAt || r.createdAt);
    const placed = ['completed', 'no-answer', 'busy', 'failed'].includes(String(r.status)) && (r.lastAttemptAt || r.startedAt || String(r.status) !== 'failed');
    if (!placed) continue; // eslint-disable-line no-continue
    c.tried += 1; c.lastTriedAt = later(c.lastTriedAt, at);
    if (String(r.status) === 'completed' && Number(r.durationSec) > 0 && r.outcome !== 'No Response') { c.responded += 1; c.lastResponseAt = later(c.lastResponseAt, at); }
  }
  const list = Object.values(ch).map((c) => ({ ...c, score: scoreOf(c, now), words: wordsOf(c) }));
  list.sort((a, b) => {
    if (a.score === null && b.score === null) return ORDER_IF_UNTRIED.indexOf(a.key) - ORDER_IF_UNTRIED.indexOf(b.key);
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    return b.score - a.score || (b.lastResponseAt || '').localeCompare(a.lastResponseAt || '');
  });
  const top = list[0];
  const best = top && top.responded ? top.key : null;
  const preferred = (thread[0] && thread[0].preferredChannel) || null;
  return {
    channels: list.map((c, i) => ({ ...c, rank: i + 1 })),
    best,
    preferred,
    basis: best ? `${best} gets the most answers from this person` : list.some((c) => c.tried) ? 'No replies yet on any channel' : 'Nothing tried yet',
  };
}

module.exports = { rank };
