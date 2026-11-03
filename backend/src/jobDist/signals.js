// ---------------------------------------------------------------------------
// "LIVE" WITHOUT ANYBODY SAYING SO (founder 2026-11-03: "memu manual ga posted ani click cheyyakudadhu ... posted ani
// automatic ga raavali"). Some sites never tell a program that a job is up (LinkedIn Jobs, Indeed, WhatsApp groups, YouTube,
// Apna, WorkIndia ...). Every post there carries TeamLink's tracked link (?src=<place>, jobDist/text.js). The first person
// who comes from that link - opens the job, or applies - proves the post is up, so the place turns Live by itself:
//   record(requirementId, rawSrc, kind, { referrer })   kind 'visit' | 'apply'; an unknown src is ignored
//   onLive (internal)   the first signal of a place for a requirement:
//       - Job distribution (semi places): marked posted "seen live by TeamLink" (jobDist/tracker.js markPosted)
//       - a by-hand task of Naukri / Shine / Indeed / LinkedIn (RequirementPosting): done, "Seen live by TeamLink ..."
//   forJob(requirementId)   { place: { firstAt, visits, applies } } for the screens
// A TeamLink staff member opening their own link does not count (the careers API is called with their sign-in then).
// Raw SQL table, made on first use (like calling/schema.js); nothing existing is altered.
// ---------------------------------------------------------------------------
const crypto = require('crypto');
const prisma = require('../db');

const DDL = [
  `CREATE TABLE IF NOT EXISTS "PostingSignal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requirementId" TEXT NOT NULL,
    "place" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "firstAt" TEXT NOT NULL,
    "lastAt" TEXT NOT NULL,
    "referrer" TEXT
  )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS "PostingSignal_key" ON "PostingSignal"("requirementId", "place", "kind")',
];
let ready = null;
const ensure = () => {
  if (!ready) ready = (async () => { for (const sql of DDL) await prisma.$executeRawUnsafe(sql); return true; })().catch((e) => { ready = null; throw e; }); // eslint-disable-line no-await-in-loop
  return ready;
};
const plain = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v]));

// The place a tracked link names: a job-distribution platform key (linkedin, apna, whatsapp ...) or a job-board name.
function placeOf(rawSrc) {
  const s = String(rawSrc || '').trim().toLowerCase().slice(0, 60);
  if (!s) return null;
  let key = null;
  try { key = require('./attribution').keyFor(s); } catch { key = null; } // eslint-disable-line global-require
  return key || (/^[a-z0-9_-]{2,40}$/.test(s) ? s : null);
}
const hostOf = (ref) => { try { return new URL(String(ref)).host.toLowerCase(); } catch { return ''; } };
function ownHost(host) {
  const mine = [process.env.FRONTEND_URL, process.env.APP_BASE_URL, process.env.PUBLIC_API_URL].map(hostOf).filter(Boolean);
  return !!host && mine.includes(host);
}

async function record(requirementId, rawSrc, kind, { referrer } = {}) {
  try {
    const place = placeOf(rawSrc);
    if (!requirementId || !place || !['visit', 'apply'].includes(kind)) return null;
    const ref = hostOf(referrer);
    if (kind === 'visit' && ownHost(ref)) return null; // our own screens previewing the link
    await ensure();
    const now = new Date().toISOString();
    const before = await prisma.$queryRawUnsafe('SELECT "kind" FROM "PostingSignal" WHERE "requirementId" = ? AND "place" = ? LIMIT 1', String(requirementId), place);
    await prisma.$executeRawUnsafe(
      'INSERT INTO "PostingSignal" ("id", "requirementId", "place", "kind", "count", "firstAt", "lastAt", "referrer") VALUES (?, ?, ?, ?, 1, ?, ?, ?) ON CONFLICT("requirementId", "place", "kind") DO UPDATE SET "count" = "count" + 1, "lastAt" = excluded."lastAt"',
      `sig_${crypto.randomBytes(8).toString('hex')}`, String(requirementId), place, kind, now, now, ref || null,
    );
    if (!before.length) await onLive(String(requirementId), place, kind, now).catch((e) => console.error('[signals] live mark failed:', e.message)); // eslint-disable-line no-console
    return place;
  } catch (e) {
    console.error('[signals] could not record:', e.message); // eslint-disable-line no-console
    return null;
  }
}

const LEGACY = { naukri: 'naukri', shine: 'shine', indeed: 'indeed', linkedin: 'linkedin', foundit: 'foundit' };
const OPEN_HAND = ['Integration Required', 'Pending', 'Setup Required', 'Failed'];

async function onLive(requirementId, place, kind, at) {
  const day = new Date(at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  const words = `Seen live by TeamLink: the first person came from ${place} (${kind === 'apply' ? 'applied' : 'opened the job'}) on ${day}`;
  // 1. job distribution: a semi / manual place becomes "posted"
  try {
    const P = require('./platforms'); // eslint-disable-line global-require
    const T = require('./tracker'); // eslint-disable-line global-require
    const p = await P.get(place);
    if (p && p.kind !== 'auto' && p.active) {
      const has = await T.rowOf(requirementId, p.key);
      if (!has || has.state !== 'POSTED') {
        const job = await prisma.requirement.findUnique({ where: { id: requirementId }, select: { id: true, internal: true, reqCode: true } });
        if (job) await T.markPosted(null, job, p, { postedBy: 'TeamLink (seen live)', notes: words });
      }
    }
  } catch (e) { console.error('[signals] distribution mark:', e.message); } // eslint-disable-line no-console
  // 2. a by-hand task on a job board (RequirementPosting) is done
  const source = LEGACY[place];
  if (source) {
    const row = await prisma.requirementPosting.findUnique({ where: { requirementId_source: { requirementId, source } } }).catch(() => null);
    if (row && OPEN_HAND.includes(row.status)) {
      await prisma.requirementPosting.update({ where: { id: row.id }, data: { status: 'Posted by hand', postedAt: new Date(at), removedAt: null, errorMessage: words } });
    }
  }
  await require('../utils/audit').logAudit({ userId: null, actorName: 'TeamLink', action: 'Posting seen live', entity: 'Requirement', entityId: requirementId, toValue: words }).catch(() => {}); // eslint-disable-line global-require
}

async function forJob(requirementId) {
  try {
    await ensure();
    const rows = (await prisma.$queryRawUnsafe('SELECT * FROM "PostingSignal" WHERE "requirementId" = ?', String(requirementId))).map(plain);
    const out = {};
    rows.forEach((r) => {
      const o = out[r.place] || (out[r.place] = { firstAt: r.firstAt, visits: 0, applies: 0 });
      if (r.firstAt < o.firstAt) o.firstAt = r.firstAt;
      if (r.kind === 'visit') o.visits += r.count; else o.applies += r.count;
    });
    return out;
  } catch { return {}; }
}

module.exports = { record, forJob, placeOf };
