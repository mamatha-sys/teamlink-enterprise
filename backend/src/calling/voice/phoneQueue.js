// ---------------------------------------------------------------------------
// BULK AI PHONE CALLS through our own line (founder 2026-11-02: "ai calling ippudu individual ga proper ga work avuthundhi.
// same alaagey bulk lo kuda pampinchey option vundali").
//
// The recruiter ticks several candidates and confirms once. Every call is the same one-candidate call (sipCall.place: the
// same rules - consent, test numbers, calling hours, daily limits, one call per candidate at a time - checked per person),
// placed from one queue for the whole server: AI_VOICE_PARALLEL calls at a time (default 2, at most 4: the office gateway
// has a few working SIMs and the server hears 4 calls at once in ~1.8 s), the next one starting when a call ends.
// A person refused by a rule is reported (reason) and skipped; nothing else waits on them.
// ---------------------------------------------------------------------------
const { logAudit } = require('../../utils/audit');
const DB = require('../schema');
const settingsStore = require('../settings');
const svc = require('../callService');

const PARALLEL = Math.min(4, Math.max(1, Number(process.env.AI_VOICE_PARALLEL) || 2));
const POLL_MS = 4000;
const MAX_CALL_MS = 20 * 60 * 1000; // a call still "calling" after this frees its place in the queue
const log = (...a) => console.log('[ai-voice queue]', ...a); // eslint-disable-line no-console

const queue = []; // { batch, user, applicationId, purpose, fields }
let running = 0;
const batches = new Map(); // batchId -> { by, at, total, placed, refused: [{ applicationId, name, reason }], done }

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function waitForEnd(callId) {
  const t0 = Date.now();
  while (Date.now() - t0 < MAX_CALL_MS) {
    const row = await DB.one('SELECT "status" FROM "AiCall" WHERE "id" = ?', callId).catch(() => null); // eslint-disable-line no-await-in-loop
    if (!row || row.status !== 'calling') return;
    await sleep(POLL_MS); // eslint-disable-line no-await-in-loop
  }
}

async function runOne(job) {
  const b = batches.get(job.batch);
  const place = require('./sipCall').place; // eslint-disable-line global-require
  let r;
  try { r = await place(job.user, { applicationId: job.applicationId, purpose: job.purpose, fields: job.fields }); } catch (e) { r = { ok: false, error: e.message }; }
  if (!r || !r.ok) {
    const reason = (r && (r.error || r.message)) || 'The call could not be placed.';
    const name = await DB.one('SELECT c."name" AS "name" FROM "Application" a JOIN "Candidate" c ON c."id" = a."candidateId" WHERE a."id" = ?', job.applicationId).then((x) => x && x.name).catch(() => null);
    if (b) b.refused.push({ applicationId: job.applicationId, name: name || null, reason: String(reason).slice(0, 200) });
    return;
  }
  if (b) b.placed += 1;
  await waitForEnd(r.callId);
}

function pump() {
  while (running < PARALLEL && queue.length) {
    const job = queue.shift();
    running += 1;
    runOne(job)
      .catch((e) => log('call failed:', e.message))
      .finally(() => {
        running -= 1;
        const b = batches.get(job.batch);
        if (b && !queue.some((q) => q.batch === job.batch)) b.done = b.placed + b.refused.length >= b.total;
        pump();
      });
  }
}

// Confirmed once by the recruiter for every ticked candidate. Returns { ok, batchId, total, parallel } or a refusal.
async function enqueue(user, { applicationIds, purpose, fields }) {
  const ids = [...new Set((applicationIds || []).map((x) => String(x || '').slice(0, 60)).filter(Boolean))];
  if (!ids.length) return svc.fail(400, 'none', 'Tick the candidates to call.');
  const s = await settingsStore.load({ fresh: true });
  if (ids.length > s.maxBulk) return svc.fail(400, 'too_many', `A campaign can have at most ${s.maxBulk} candidates.`);
  if (ids.length > 1) {
    const acc = await svc.accessVerdict(user, null, s, { bulk: true });
    if (!acc.ok) return acc;
  }
  const batchId = svc.newId('aiq');
  batches.set(batchId, { by: user.id, at: new Date().toISOString(), total: ids.length, placed: 0, refused: [], done: false });
  // keep the last 50 batches only
  if (batches.size > 50) batches.delete(batches.keys().next().value);
  ids.forEach((applicationId) => queue.push({ batch: batchId, user, applicationId, purpose, fields }));
  await logAudit({ userId: user.id, action: 'AI phone calls queued', entity: 'AiCall', entityId: batchId, toValue: `${ids.length} candidate(s), ${purpose}, ${PARALLEL} at a time, own SIP line` }).catch(() => {});
  pump();
  return { ok: true, batchId, total: ids.length, parallel: PARALLEL };
}

// How a batch is going (for the window that started it): placed, refused (with reasons), still waiting.
function batchStatus(user, batchId) {
  const b = batches.get(String(batchId || ''));
  if (!b || b.by !== user.id) return svc.fail(404, 'none', 'This list of calls is not known (the server may have restarted).');
  const waiting = queue.filter((q) => q.batch === batchId).length;
  return { ok: true, total: b.total, placed: b.placed, refused: b.refused, waiting, done: b.done || (waiting === 0 && b.placed + b.refused.length >= b.total), parallel: PARALLEL };
}

module.exports = { enqueue, batchStatus, PARALLEL, _queue: queue };
