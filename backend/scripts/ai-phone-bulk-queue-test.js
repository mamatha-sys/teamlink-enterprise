#!/usr/bin/env node
// ---------------------------------------------------------------------------
// BULK AI PHONE CALLS: the queue (calling/voice/phoneQueue.js), offline - no call, no database. (founder 2026-11-02)
//
//   cd backend && node scripts/ai-phone-bulk-queue-test.js
//
// Five candidates ticked: at most AI_VOICE_PARALLEL (2) calls at once, the next starts when one ends, a refused person is
// reported with the reason and skipped, the batch says done at the end; a role without bulk is refused; too many is refused.
// ---------------------------------------------------------------------------
const path = require('path');

process.env.AI_VOICE_PARALLEL = '2';
const V = path.resolve(__dirname, '../src/calling');
let pass = 0; let fail = 0;
const ok = (c, m, d) => { if (c) { pass += 1; console.log('PASS', m); } else { fail += 1; console.log('FAIL', m, d === undefined ? '' : JSON.stringify(d)); } };
const stub = (rel, exp) => { const f = require.resolve(path.join(V, rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports: exp }; };

// the call rows: "calling" until the test ends the call
const rows = new Map();
let live = 0; let maxLive = 0;
stub('schema.js', {
  one: async (sql, id) => {
    if (/FROM "AiCall"/.test(sql)) return rows.has(id) ? { status: rows.get(id) } : null;
    if (/FROM "Application"/.test(sql)) return { name: `Person ${id}` };
    return null;
  },
});
let bulkAllowed = true;
stub('settings.js', { load: async () => ({ maxBulk: 10 }) });
stub('callService.js', {
  fail: (status, code, error) => ({ ok: false, status, code, error }),
  newId: (p) => `${p}_${Math.random().toString(36).slice(2, 8)}`,
  accessVerdict: async () => (bulkAllowed ? { ok: true } : { ok: false, status: 403, code: 'role', error: 'Your role cannot send to many candidates at once.' }),
});
stub('voice/sipCall.js', {
  place: async (user, input) => {
    if (input.applicationId === 'app3') return { ok: false, status: 403, code: 'consent', error: 'No consent to call.' };
    const id = `call_${input.applicationId}`;
    rows.set(id, 'calling'); live += 1; maxLive = Math.max(maxLive, live);
    setTimeout(() => { rows.set(id, 'completed'); live -= 1; }, 300);
    return { ok: true, callId: id };
  },
});
const audit = require.resolve(path.resolve(__dirname, '../src/utils/audit'));
require.cache[audit] = { id: audit, filename: audit, loaded: true, exports: { logAudit: async () => {} } };

const Q = require(path.join(V, 'voice/phoneQueue.js'));

(async () => {
  const user = { id: 'u1', name: 'Tester' };
  // the queue polls each call every 4 s: make it quick for the test
  const realSetTimeout = global.setTimeout;
  global.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, ms === 4000 ? 50 : ms, ...a);

  const r = await Q.enqueue(user, { applicationIds: ['app1', 'app2', 'app3', 'app4', 'app5'], purpose: 'Screening', fields: {} });
  ok(r.ok && r.total === 5 && r.parallel === 2, 'Q1 five candidates are queued, 2 at a time', r);
  let st;
  for (let i = 0; i < 100; i += 1) { await new Promise((x) => realSetTimeout(x, 100)); st = Q.batchStatus(user, r.batchId); if (st.done) break; } // eslint-disable-line no-await-in-loop
  ok(maxLive === 2, 'Q2 never more than 2 calls at the same time', maxLive);
  ok(st && st.done && st.placed === 4, 'Q3 the batch finishes: 4 calls placed', st);
  ok(st && st.refused.length === 1 && st.refused[0].applicationId === 'app3' && /consent/i.test(st.refused[0].reason) && st.refused[0].name, 'Q4 the refused person is reported with the reason and skipped', st && st.refused);
  ok(Q.batchStatus({ id: 'other' }, r.batchId).ok === false, 'Q5 another login cannot read this batch');
  bulkAllowed = false;
  const no = await Q.enqueue(user, { applicationIds: ['a', 'b'], purpose: 'Screening' });
  ok(no.ok === false && no.code === 'role', 'Q6 a role without bulk calling is refused', no);
  bulkAllowed = true;
  const many = await Q.enqueue(user, { applicationIds: Array.from({ length: 11 }, (_, i) => `x${i}`), purpose: 'Screening' });
  ok(many.ok === false && many.code === 'too_many', 'Q7 more than the campaign limit is refused', many);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
