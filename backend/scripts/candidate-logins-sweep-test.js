#!/usr/bin/env node
/**
 * Candidate logins, TeamLink side (utils/candidateLogins.js): the switch, the cursor, who is handed over, the retry day, the backlog count
 * and the "only with the count you were shown" rule. The Job Portal is NEVER contacted: the bridge is replaced by a recorder.
 * Uses the local database with ZZTEST candidates that are removed again; the settings row is saved first and put back.
 *   node scripts/candidate-logins-sweep-test.js
 */
process.env.NODE_ENV = 'development';
const prisma = require('../src/db');

const bridgePath = require.resolve('../src/utils/jobPortalBridge');
const sandboxPath = require.resolve('../src/utils/sandbox');

const calls = [];
let answer = (p, body) => ({ counts: {}, results: (body.people || []).map((x) => ({ ref: x.ref, result: 'invited' })) });
require.cache[bridgePath] = { id: bridgePath, filename: bridgePath, loaded: true, exports: {
  portalFetch: async (p, opts = {}) => { calls.push({ p, body: opts.body }); return answer(p, opts.body || {}); },
} };
require.cache[sandboxPath] = { id: sandboxPath, filename: sandboxPath, loaded: true, exports: { isSandbox: () => false } };
const L = require('../src/utils/candidateLogins');

let failed = 0;
const check = (name, ok, detail) => { if (!ok) failed += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? `  -> ${JSON.stringify(detail).slice(0, 300)}` : ''}`); };
const invites = () => calls.filter((c) => c.p.endsWith('/invite') && c.body && c.body.dryRun === false);
const refsOf = (cs) => cs.flatMap((c) => c.body.people.map((x) => x.ref));
const tag = `ZZTEST${Date.now().toString().slice(-7)}`;
const made = [];
const mk = async (n, d) => { const c = await prisma.candidate.create({ data: { name: `${tag} ${n}`, ...d } }); made.push(c.id); return c; };
const pastRetry = async () => {
  const cur = await L.settings();
  await prisma.integration.update({ where: { id: L.STORE_ID }, data: { values: JSON.stringify({ ...cur, retry: cur.retry.map((x) => ({ ...x, after: new Date(Date.now() - 1000).toISOString() })) }) } });
};

(async () => {
  const saved = await prisma.integration.findUnique({ where: { id: L.STORE_ID } }).catch(() => null);
  try {
    await prisma.integration.deleteMany({ where: { id: L.STORE_ID } });
    calls.length = 0;
    let r = await L.sweep();
    check('the first pass only starts the switch (nobody is sent)', r.started === true && invites().length === 0, r);
    check('it also turns on the portal own Naukri / Shine message', calls.some((c) => c.p.endsWith('/candidates/auto') && c.body.on === true), calls);
    const s = await L.settings();
    check('"since" and the cursor are set, auto is ON by default', !!s.since && !!s.cursor && s.auto === true, s);

    // new candidates arrive after the switch
    await new Promise((x) => { setTimeout(x, 30); });
    const A = await mk('A email', { email: `${tag.toLowerCase()}.a@example.invalid` });
    const B = await mk('B nothing', {});
    const C = await mk('C dnc', { email: `${tag.toLowerCase()}.c@example.invalid`, doNotContact: true });
    const D = await mk('D withdrawn', { phone: '9000000004', consentStatus: 'WITHDRAWN' });
    const E = await mk('E phone', { phone: `98${Date.now().toString().slice(-8)}` });
    calls.length = 0;
    r = await L.sweep();
    const sent = refsOf(invites());
    check('a new candidate with an email is handed to the portal', sent.includes(A.id), sent);
    check('a new candidate with only a phone is handed to the portal', sent.includes(E.id), sent);
    check('nobody with no contact, do-not-contact or withdrawn consent is handed over', !sent.includes(B.id) && !sent.includes(C.id) && !sent.includes(D.id), sent);
    calls.length = 0;
    await L.sweep();
    check('the next pass sends nobody again (the cursor moved on)', invites().length === 0, calls);

    // a failed send is tried again once a day, three times in all
    const F = await mk('F fails', { email: `${tag.toLowerCase()}.f@example.invalid` });
    answer = (p, body) => ({ counts: { 'not-sent': 1 }, results: (body.people || []).map((x) => ({ ref: x.ref, result: 'not-sent' })) });
    calls.length = 0;
    await L.sweep();
    check('a failed send is recorded for a retry', (await L.settings()).retry.some((x) => x.id === F.id && x.tries === 1), await L.settings());
    calls.length = 0;
    await L.sweep();
    check('it is NOT tried again the same day', !refsOf(invites()).includes(F.id), refsOf(invites()));
    await pastRetry();
    calls.length = 0;
    await L.sweep();
    check('after a day it is tried again', refsOf(invites()).includes(F.id), refsOf(invites()));
    check('and the tries are counted (now 2)', (await L.settings()).retry.some((x) => x.id === F.id && x.tries === 2), await L.settings());
    await pastRetry();
    await L.sweep();
    check('after 3 tries it is dropped (no endless sending)', !(await L.settings()).retry.some((x) => x.id === F.id), await L.settings());

    // the backlog: everybody before the switch, counted by a dry run, sent only with that count
    answer = (p, body) => ({ counts: { 'would-invite': (body.people || []).length }, results: (body.people || []).map((x) => ({ ref: x.ref, result: 'would-invite' })) });
    const b = await L.backlogCount();
    const direct = await prisma.candidate.count({ where: { AND: [L.reachable(), { createdAt: { lte: new Date((await L.settings()).since) } }] } });
    check('the backlog count is the reachable candidates from before the switch', b.ready && b.total === direct, { b, direct });
    calls.length = 0;
    const out = await L.sendBacklog({ expected: b.wouldInvite + 1, by: 'test' });
    check('the backlog is refused with a different count than the one shown', out.started === false && /changed/.test(out.reason || ''), out);
    check('and nothing was sent', invites().length === 0, calls);

    // switching off and on
    await L.setAuto(false, 'test');
    check('switched off: a pass does nothing', (await L.sweep()).skipped === true);
    const G = await mk('G while off', { email: `${tag.toLowerCase()}.g@example.invalid` });
    await L.setAuto(true, 'test');
    calls.length = 0;
    await L.sweep();
    check('someone who arrived while it was OFF is not sent behind the Administrator back', !refsOf(invites()).includes(G.id), refsOf(invites()));
    check('they are part of the backlog now (the switch moved)', new Date((await L.settings()).since) >= G.createdAt);
  } finally {
    await prisma.candidate.deleteMany({ where: { id: { in: made } } });
    await prisma.integration.deleteMany({ where: { id: L.STORE_ID } });
    if (saved) await prisma.integration.create({ data: { id: saved.id, enabled: saved.enabled, state: saved.state, values: saved.values } }).catch(() => {});
    await prisma.$disconnect();
  }
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error(e); await prisma.candidate.deleteMany({ where: { id: { in: made } } }).catch(() => {}); process.exit(2); });
