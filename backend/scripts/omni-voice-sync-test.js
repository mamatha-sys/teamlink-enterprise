#!/usr/bin/env node
/**
 * Finished AI calls -> Omni-Channel > Voice Calling (utils/omniVoiceSync.js). SANDBOX ONLY: a COPY of prisma/dev.db (VACUUM INTO, deleted at the end) and a
 * Green Start that is a stand-in (fetch is replaced): nothing is sent anywhere.
 *   node scripts/omni-voice-sync-test.js
 */
const fs = require('fs');
const path = require('path');

const BACK = path.resolve(__dirname, '..');
const DEV_DB = path.join(BACK, 'prisma', 'dev.db');
const COPY = path.join(BACK, 'prisma', 'zz-omnivoice-test.db');
for (const sfx of ['', '-wal', '-shm', '-journal']) { try { fs.unlinkSync(COPY + sfx); } catch { /* none */ } }
const { DatabaseSync } = require('node:sqlite');
let src;
try { src = new DatabaseSync(DEV_DB, { readOnly: true }); } catch { src = new DatabaseSync(DEV_DB); }
src.exec(`VACUUM INTO '${COPY.replace(/'/g, "''")}'`);
src.close();
process.env.NODE_ENV = 'development';
process.env.DATABASE_URL = `file:${COPY.split(path.sep).join('/')}`;

const stub = (rel, exports) => { const p = require.resolve(rel); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
stub('../src/utils/greenStartSso', { secretSet: () => true, ssoEmail: async () => 'company@example.test', EMAIL_RE: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, greenStartTicket: () => 'ticket' });
stub('../src/utils/sandbox', { isSandbox: () => false });
const prisma = require('../src/db');
const DB = require('../src/calling/schema');
const V = require('../src/utils/omniVoiceSync');

let failed = 0;
const check = (name, ok, detail) => { if (!ok) failed += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? `  -> ${JSON.stringify(detail).slice(0, 300)}` : ''}`); };

// ---- the stand-in Green Start
const posts = [];
let down = false;
const realFetch = global.fetch;
global.fetch = async (url, init = {}) => {
  if (down) throw new Error('connection refused');
  const u = String(url);
  const json = (data) => ({ ok: true, status: 200, text: async () => JSON.stringify({ success: true, data }) });
  if (u.endsWith('/auth/teamlink')) return json({ accessToken: 'tok' });
  if (u.endsWith('/workspaces')) return json([{ id: 'ws-medical', name: 'Teamlink Medical', createdAt: '2026-11-01' }, { id: 'ws-edu', name: 'Teamlink Education', createdAt: '2026-11-02' }]);
  if (u.endsWith('/voice/calls/import')) { const b = JSON.parse(init.body); posts.push({ ws: init.headers['x-workspace-id'], auth: init.headers.authorization, items: b.items }); return json({ created: b.items.length, updated: 0, skipped: 0 }); }
  return { ok: false, status: 404, text: async () => '{}' };
};

(async () => {
  try {
    await DB.ensure();
    const cands = await prisma.candidate.findMany({ where: { phone: { not: null } }, take: 6, select: { id: true, name: true, phone: true } });
    const reqs = await prisma.requirement.findMany({ take: 40, select: { id: true, title: true, department: true } });
    const edu = reqs.find((r) => /education/i.test(r.department || ''));
    const other = reqs.find((r) => !/education|medical/i.test(r.department || '') && r.id !== (edu && edu.id)) || reqs[0];
    check('the copy has candidates with a phone and requirements', cands.length >= 5 && !!edu && !!other, { cands: cands.length, edu: !!edu, other: !!other });
    const now = new Date().toISOString();
    const mk = async (i, c, r, over = {}) => {
      const base = { id: `zzov_${i}`, mode: 'live', purpose: 'Screening', status: 'completed', candidateId: c.id, requirementId: r.id, dedupeKey: `zzov${i}`, attempts: 1, maxAttempts: 3, outcome: 'Interested', summary: 'Name confirmed. Interested.', durationSec: 73,
        startedAt: now, endedAt: now, transcript: JSON.stringify([{ who: 'assistant', text: 'Hello' }, { who: 'candidate', text: 'Yes sir' }]), nextAttemptAt: null, createdAt: now, updatedAt: now, ...over };
      const cols = Object.keys(base);
      await DB.run(`INSERT INTO "AiCall" (${cols.map((x) => `"${x}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map((k) => base[k]));
    };
    await mk(1, cands[0], edu);                                                              // finished, an Education requirement -> its own workspace
    await mk(2, cands[1], other);                                                            // another department -> the first workspace
    await mk(3, cands[2], edu, { status: 'calling', outcome: null, endedAt: null });         // still on the phone: not sent
    await mk(4, cands[3], edu, { status: 'no-answer', outcome: null, nextAttemptAt: new Date(Date.now() + 3600000).toISOString() }); // will be tried again: not final
    await mk(5, cands[4], edu, { status: 'no-answer', outcome: null, summary: null, transcript: null, failReason: 'The candidate did not answer.' }); // gave up: sent as a failed call
    await mk(6, cands[0], edu, { attempts: 0, status: 'failed' });                           // never dialled: not sent

    const p0 = await V.pending();
    check('only finished calls are waiting (3 of the 6: not the one on the phone, the one to be retried, nor the one never dialled)', p0.length === 3, p0.map((x) => x.item.externalId));
    let r = await V.sync();
    check('the sync sends them', r.sent === 3, r);
    const byWs = Object.fromEntries(posts.map((p) => [p.ws, p.items.map((i) => i.externalId).sort()]));
    check('an Education requirement goes to the Education workspace, others to the first workspace', JSON.stringify(byWs['ws-edu']) === JSON.stringify(['zzov_1', 'zzov_5']) && JSON.stringify(byWs['ws-medical']) === JSON.stringify(['zzov_2']), byWs);
    check('it signs in (one-click ticket) and sends with that token', posts.every((p) => p.auth === 'Bearer tok'));
    const one = posts.flatMap((p) => p.items).find((i) => i.externalId === 'zzov_1');
    check('the call carries the number as +91, status, outcome, summary, duration and what was said', /^\+91\d{10}$/.test(one.toNumber) && one.status === 'completed' && one.outcome === 'Interested' && one.durationSeconds === 73 && one.turns.length === 2 && one.turns[0].who === 'assistant' && one.turns[1].who === 'candidate', one);
    check('the contact name and the job are with it', /\s-\s/.test(one.contactName), one.contactName);
    const failedOne = posts.flatMap((p) => p.items).find((i) => i.externalId === 'zzov_5');
    check('a call that gave up is sent as it was, with its reason', failedOne.status === 'no-answer' && failedOne.failureReason === 'The candidate did not answer.' && failedOne.turns.length === 0, failedOne);

    posts.length = 0;
    r = await V.sync();
    check('a second sync sends nothing (each call is sent once)', r.sent === 0 && posts.length === 0, r);

    await DB.run('UPDATE "AiCall" SET "summary" = ?, "updatedAt" = ? WHERE "id" = ?', 'Name confirmed. Interested. Wants a call back on Monday.', new Date().toISOString(), 'zzov_1');
    r = await V.sync();
    check('a call that changed afterwards is sent again (it updates its row there)', r.sent === 1 && posts[0].items[0].externalId === 'zzov_1', { r, posts });

    // the call on the phone finishes
    posts.length = 0;
    await DB.run('UPDATE "AiCall" SET "status" = ?, "endedAt" = ?, "updatedAt" = ? WHERE "id" = ?', 'completed', new Date().toISOString(), new Date().toISOString(), 'zzov_3');
    r = await V.sync();
    check('a call that was on the phone is sent once it is finished', r.sent === 1 && posts[0].items[0].externalId === 'zzov_3', r);

    // Green Start down
    posts.length = 0;
    await DB.run('UPDATE "AiCall" SET "outcome" = ?, "updatedAt" = ? WHERE "id" = ?', 'Not Interested', new Date().toISOString(), 'zzov_2');
    down = true;
    r = await V.sync();
    check('with Green Start down the sync says so in words, never throws, and marks nothing as sent', !!r.error && /not running/i.test(r.error), r);
    down = false;
    r = await V.sync();
    check('and when it is back the same call goes through', r.sent === 1 && posts[0].items[0].externalId === 'zzov_2', r);
    check('status() says what happened last', V.status().ok === true && /sent to Voice Calling/.test(V.status().words), V.status());

    process.env.GREENSTART_ENABLED = 'false';
    await DB.run('UPDATE "AiCall" SET "outcome" = ?, "updatedAt" = ? WHERE "id" = ?', 'Call Back Later', new Date().toISOString(), 'zzov_2');
    r = await V.sync();
    check('with Green Start switched off nothing is attempted', !!r.skipped && posts.length === 1, r);
    process.env.GREENSTART_ENABLED = 'true';
    check('the number helper writes a ten-digit mobile as +91', V.dialled('9030048228') === '+919030048228' && V.dialled('') === '');
  } finally {
    global.fetch = realFetch;
    await prisma.$disconnect().catch(() => {});
    for (const sfx of ['', '-wal', '-shm', '-journal']) { try { fs.unlinkSync(COPY + sfx); } catch { /* none */ } }
  }
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); try { fs.unlinkSync(COPY); } catch { /* */ } process.exit(2); });
