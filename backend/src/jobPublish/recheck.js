// ---------------------------------------------------------------------------
// "PLEASE CHECK IT ON THE SITE" -> LIVE, BY ITSELF (founder 2026-11-03: "posted ani automatic ga raavali"). Naukri reviews a new
// job for up to a day, so a post made by the browser engine often ends as NEEDS_CHECK with the listing's link but not yet
// visible. Every 30 minutes this opens each such link (a plain HTTP read, no sign-in) and, when the page answers and shows the
// job (its title or Job ID), writes PUBLISHED with the link - exactly what the runner writes for a post it saw itself -
// and the requirement's board row reads "Live on X - posted and checked by TeamLink". After 3 days it stops asking.
// ---------------------------------------------------------------------------
const prisma = require('../db');
const P = require('./portalPosting');
const bridge = require('./legacyBridge');
const { q } = require('./db');

const MAX_AGE_MS = 3 * 86400000;
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

async function looksLive(url, job) {
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 (TeamLink listing check)' } });
    if (!r.ok) return false;
    const html = norm((await r.text()).slice(0, 600000));
    return (!!job.title && html.includes(norm(job.title))) || (!!job.reqCode && html.includes(norm(job.reqCode)));
  } catch { return false; }
}

async function sweep() {
  const rows = await q('SELECT * FROM "PortalPosting" WHERE "status" = \'NEEDS_CHECK\' AND "portalUrl" IS NOT NULL LIMIT 50').catch(() => []);
  let live = 0;
  for (const row of rows) {
    const since = Number(row.updatedAt || row.createdAt || Date.now());
    if (Date.now() - since > MAX_AGE_MS) continue; // eslint-disable-line no-continue
    // eslint-disable-next-line no-await-in-loop
    const job = await prisma.requirement.findUnique({ where: { id: row.requirementId }, select: { id: true, title: true, reqCode: true } });
    if (!job) continue; // eslint-disable-line no-continue
    // eslint-disable-next-line no-await-in-loop
    if (!(await looksLive(row.portalUrl, job))) continue; // eslint-disable-line no-continue
    // eslint-disable-next-line no-await-in-loop
    await P.set(job.id, row.portal, { status: 'PUBLISHED', publishedAt: Date.now(), verifiedAt: Date.now(), lastError: null });
    // eslint-disable-next-line no-await-in-loop
    await bridge.onPublished(row.portal, job.id, { portalJobId: row.portalJobId, portalUrl: row.portalUrl, byName: 'TeamLink (checked live)' }).catch(() => {});
    live += 1;
  }
  return { checked: rows.length, live };
}

let timer = null;
function start() {
  if (timer || process.env.TEST_MODE) return;
  timer = setInterval(() => { sweep().catch((e) => console.error('[posting recheck]', e.message)); }, 30 * 60 * 1000); // eslint-disable-line no-console
  if (timer.unref) timer.unref();
}

module.exports = { sweep, start, looksLive };
