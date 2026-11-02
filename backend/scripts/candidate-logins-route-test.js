#!/usr/bin/env node
/**
 * routes/candidateLogins.js: the screen's API (switch, counts, "send only with the counts you were shown"). The login / permission
 * middleware is replaced by a pass-through that sets a user; the portal bridge is a recorder, so nothing is ever sent.
 *   node scripts/candidate-logins-route-test.js
 */
process.env.NODE_ENV = 'development';
const express = require('express');
const prisma = require('../src/db');

const stub = (rel, exports) => { const p = require.resolve(rel); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
const calls = [];
let pending = { mail: 2, sourced: 3, total: 5, progress: null };
stub('../src/middleware/auth', { requireAuth: (req, _res, next) => { req.user = { id: 'u-test', name: 'Test' }; next(); } });
stub('../src/utils/permissions', { requirePerm: () => (_req, _res, next) => next() });
stub('../src/utils/audit', { logAudit: async () => {} });
stub('../src/utils/sandbox', { isSandbox: () => false });
stub('../src/utils/jobPortalBridge', {
  portalFetch: async (p, o = {}) => {
    calls.push({ p, method: o.method || 'GET', body: o.body });
    if (p.endsWith('/send-logins/pending')) return pending;
    if (p.endsWith('/send-logins')) return { started: true, total: o.body.expected };
    if (p.endsWith('/invite')) return { counts: { 'would-invite': (o.body.people || []).length }, results: [] };
    return { on: true };
  },
});
const L = require('../src/utils/candidateLogins');
const router = require('../src/routes/candidateLogins');

let failed = 0;
const check = (name, ok, detail) => { if (!ok) failed += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? `  -> ${JSON.stringify(detail).slice(0, 300)}` : ''}`); };

(async () => {
  const saved = await prisma.integration.findUnique({ where: { id: L.STORE_ID } }).catch(() => null);
  const app = express();
  app.use(express.json());
  app.use('/api/candidate-logins', router);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/candidate-logins`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  try {
    await prisma.integration.deleteMany({ where: { id: L.STORE_ID } });
    let r = await call('GET', '/');
    check('the screen loads: switch ON by default, the portal waiting list is shown', r.status === 200 && r.json.auto === true && r.json.portal.total === 5, r);
    check('before the first check the backlog says not ready (no number is invented)', r.json.backlog.ready === false, r.json);

    await L.sweep(); // starts the switch
    r = await call('GET', '/');
    check('after the first check the backlog is counted by a dry run', r.json.backlog.ready === true && typeof r.json.backlog.wouldInvite === 'number', r.json.backlog);

    r = await call('PUT', '/auto', { on: 'yes' });
    check('the switch refuses a non-boolean', r.status === 422, r);
    r = await call('PUT', '/auto', { on: false });
    check('the switch can be turned off', r.status === 200 && r.json.auto === false, r);
    check('and the portal own message is turned off too', calls.some((c) => c.p.endsWith('/candidates/auto') && c.body.on === false), calls);
    r = await call('PUT', '/auto', { on: true });
    check('and on again', r.status === 200 && r.json.auto === true, r);

    calls.length = 0;
    r = await call('POST', '/send', { expected: { teamlink: 1, portal: 5 } });
    check('sending without "confirm" is refused', r.status === 422, r);
    r = await call('POST', '/send', { confirm: true });
    check('sending without the counts is refused', r.status === 422, r);
    check('and nothing was started', !calls.some((c) => c.method === 'POST' && c.p.endsWith('/send-logins')), calls);
    r = await call('POST', '/send', { confirm: true, expected: { teamlink: 0, portal: 5 } });
    check('with the portal count shown, the portal run starts', r.status === 200 && r.json.portal.started === true, r);
    check('the portal is asked with the same count (its own rule: refused if the number changed)', calls.some((c) => c.p.endsWith('/send-logins') && c.method === 'POST' && c.body.expected === 5 && c.body.confirm === true), calls);

    r = await call('GET', '/progress');
    check('progress answers', r.status === 200 && 'teamlink' in r.json, r);
  } finally {
    server.close();
    await prisma.integration.deleteMany({ where: { id: L.STORE_ID } });
    if (saved) await prisma.integration.create({ data: { id: saved.id, enabled: saved.enabled, state: saved.state, values: saved.values } }).catch(() => {});
    await prisma.$disconnect();
  }
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
