// ---------------------------------------------------------------------------
// routes/portalMailboxes.js - NAUKRI WEBMAIL (founder 2026-11-02): Test Connection, STARTTLS mailboxes sent to the bridge's reader,
// SSL/TLS webmail and Gmail to the portal exactly as before, method + security on every row. Runs the real route against a
// STAND-IN portal (no real mailbox, no login) on a throwaway copy of the database (prisma/sandbox-webmail.db, deleted at the end).
//   node scripts/naukri-webmail-routes-test.js
// ---------------------------------------------------------------------------
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DB = path.join(__dirname, '..', 'prisma', 'sandbox-webmail.db');
for (const x of ['', '-wal', '-shm', '-journal']) fs.rmSync(`${DB}${x}`, { force: true });
{ const d = new DatabaseSync(path.join(__dirname, '..', 'prisma', 'dev.db'), { readOnly: true }); d.exec(`VACUUM INTO '${DB.split(path.sep).join('/')}'`); d.close(); }
process.env.DATABASE_URL = `file:${DB.split(path.sep).join('/')}`;
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: false });
process.env.DATABASE_URL = `file:${DB.split(path.sep).join('/')}`;

const express = require('express');
const prisma = require('../src/db');

let pass = 0; let fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass += 1; else fail += 1; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? `  (${extra})` : ''}`); };
const stub = (rel, exports) => { const f = require.resolve(rel); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
const PW = 'zz-webmail-secret-91';
const calls = [];
const portal = {
  connections: [
    { id: 'mbxG', source: 'naukri', sourceLabel: 'Naukri', address: 'naukri@gmail.example', provider: 'gmail', recruiterId: 'r1', recruiterName: 'Asha', status: 'connected' },
    { id: 'mbxS', source: 'naukri', sourceLabel: 'Naukri', address: 'jobs-ssl@company.example', provider: 'other', host: 'mail.company.example', port: 993, recruiterId: 'r1', recruiterName: 'Asha', status: 'connected' },
    { id: 'mbxT', source: 'naukri', sourceLabel: 'Naukri', address: 'jobs@company.example', provider: 'other', host: 'mail.company.example', port: 143, recruiterId: 'r1', recruiterName: 'Asha', status: 'connected' },
    { id: 'mbxH', source: 'shine', sourceLabel: 'Shine', address: 'shine@gmail.example', provider: 'gmail', recruiterId: 'r1', recruiterName: 'Asha', status: 'connected' },
  ],
  starttls: ['mbxT'],
  bridgeHasWebmail: true,
};
stub('../src/utils/jobPortalBridge', {
  portalFetch: async (p, o = {}) => {
    calls.push({ p, method: o.method || 'GET', body: o.body });
    if (p.endsWith('/recruiters')) return { recruiters: [{ id: 'r1', name: 'Asha', email: 'asha@x.invalid', employeeId: 'EMP-7' }] };
    if (p.endsWith('/webmail/starttls')) { if (!portal.bridgeHasWebmail) throw Object.assign(new Error('404'), { status: 404 }); return { ids: portal.starttls }; }
    if (p.endsWith('/webmail/test')) return o.body.password === PW ? { ok: true, message: `Connected (${o.body.security})` } : { ok: false, message: 'The mail server refused the username or password.' };
    if (p.endsWith('/webmail/connect')) { const c = { id: 'mbxN', source: o.body.source, address: o.body.address, recruiterId: o.body.recruiterId, recruiterName: 'Asha' }; return { connection: c, message: 'Naukri webmail connected for Asha.' }; }
    let m = /\/webmail\/([^/]+)\/(sync|reconnect)$/.exec(p);
    if (m) return m[2] === 'sync' ? { emailsRead: 3, imported: 2, duplicates: 1, via: 'bridge' } : { message: 'Reconnected (STARTTLS).' };
    m = /source-connections\/([^/]+)\/(sync|reconnect)$/.exec(p);
    if (m) return m[2] === 'sync' ? { emailsRead: 1, imported: 1, via: 'portal' } : { connection: { id: m[1] }, message: 'Reconnected.' };
    if (p.endsWith('/source-connections') && o.method === 'POST') return { connection: { id: 'mbxP', ...o.body, appPassword: undefined, recruiterName: 'Asha' } };
    if (p.endsWith('/source-connections')) return { connections: portal.connections.map((c) => ({ ...c })), providers: [], canStoreCredentials: true };
    throw new Error(`unexpected ${p}`);
  },
});
stub('../src/utils/jobPortalRecruiters', {
  ensureQuietly: async () => null, seatList: async () => [], seatData: async () => [],
  people: async () => [{ name: 'Asha', email: 'asha@x.invalid', department: 'Medical', seats: ['MED-1'] }], successorOf: async () => null,
});
stub('../src/utils/mailImports', { pullQuietly: async () => ({ added: 0, already: 0, waiting: 0, waitingTitles: [] }), lastRun: () => null });
stub('../src/middleware/auth', { requireAuth: (req, _res, next) => { req.user = { id: 'test-admin', name: 'Test Admin' }; next(); } });
stub('../src/utils/permissions', { requirePerm: () => (_req, _res, next) => next() });
const audits = [];
stub('../src/utils/audit', { logAudit: async (a) => { audits.push(a); return null; } });
const app = express(); app.use(express.json()); app.use('/m', require('../src/routes/portalMailboxes'));

(async () => {
  const server = app.listen(0);
  const url = `http://127.0.0.1:${server.address().port}/m`;
  const seen = [];
  const req = async (method, p, body) => {
    const r = await fetch(`${url}${p}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text(); seen.push(text);
    return { status: r.status, body: JSON.parse(text) };
  };
  const last = (re) => calls.filter((c) => re.test(c.p)).pop();
  try {
    let r = await req('POST', '/test', { host: ' mail.company.example ', port: 993, security: 'ssl', address: 'jobs@company.example', appPassword: PW });
    let c = last(/webmail\/test$/);
    ok('Test Connection (SSL/TLS): sent to the bridge with the password, host trimmed; the answer passed on', r.status === 200 && r.body.ok === true && c.body.security === 'ssl' && c.body.host === 'mail.company.example' && c.body.password === PW, JSON.stringify(r.body));
    r = await req('POST', '/test', { host: 'mail.company.example', port: 143, security: 'starttls', username: 'jobs', appPassword: 'wrong' });
    c = last(/webmail\/test$/);
    ok('Test Connection (STARTTLS, wrong password): ok false with the reason; security and username passed', r.body.ok === false && /refused/.test(r.body.message) && c.body.security === 'starttls' && c.body.username === 'jobs');
    ok('Test Connection saves nothing (no connect call, no audit row)', !calls.some((x) => /webmail\/connect$|source-connections$/.test(x.p) && x.method === 'POST') && audits.length === 0);

    r = await req('POST', '/', { source: 'naukri', recruiterId: 'r1', address: 'new-stl@company.example', provider: 'other', security: 'starttls', host: 'mail.company.example', port: 143, username: 'new-stl', appPassword: PW });
    c = last(/webmail\/connect$/);
    ok('Webmail Connect, STARTTLS: to the bridge reader (password, host, port, username, recruiter), 201', r.status === 201 && c && c.body.password === PW && c.body.host === 'mail.company.example' && c.body.port === 143 && c.body.recruiterId === 'r1' && c.body.username === 'new-stl', JSON.stringify(r.body));
    ok('...not to the portal\'s SSL-only Connect', !calls.some((x) => x.p.endsWith('/source-connections') && x.method === 'POST'));
    ok('...audited as webmail (STARTTLS), without the password', /webmail connected \(STARTTLS\)/.test(audits[audits.length - 1].action) && !JSON.stringify(audits).includes(PW));

    r = await req('POST', '/', { source: 'naukri', recruiterId: 'r1', address: 'new-ssl@company.example', provider: 'other', security: 'ssl', host: 'mail.company.example', port: 993, appPassword: PW });
    c = last(/source-connections$/);
    ok('Webmail Connect, SSL/TLS: the portal\'s own "Other (IMAP)" connection with host and port', r.status === 201 && c.method === 'POST' && c.body.provider === 'other' && c.body.host === 'mail.company.example' && c.body.port === 993 && c.body.appPassword === PW);
    r = await req('POST', '/', { source: 'naukri', recruiterId: 'r1', address: 'new@gmail.example', provider: 'gmail', appPassword: PW });
    c = last(/source-connections$/);
    ok('Email Integration (Gmail) Connect: unchanged, to the portal', r.status === 201 && c.body.provider === 'gmail' && !c.body.host);

    r = await req('GET', '/');
    const by = Object.fromEntries((r.body.connections || []).map((x) => [x.id, x]));
    ok('list: Gmail = email, company IMAP = webmail; STARTTLS / SSL marked; Shine unchanged', by.mbxG.method === 'email' && by.mbxS.method === 'webmail' && by.mbxS.security === 'ssl' && by.mbxT.method === 'webmail' && by.mbxT.security === 'starttls' && by.mbxH.method === 'email', JSON.stringify(by));
    ok('list: the recruiters keep their employee ID (shown next to the recruiter)', (r.body.recruiters || []).some((x) => x.employeeId === 'EMP-7'));

    r = await req('POST', '/mbxT/sync');
    ok('Sync Now, STARTTLS mailbox: read by the bridge', r.status === 200 && r.body.via === 'bridge' && last(/sync$/).p.includes('/webmail/mbxT/sync'));
    r = await req('POST', '/mbxS/sync');
    ok('Sync Now, SSL/TLS webmail: read by the portal as before', r.body.via === 'portal' && last(/sync$/).p.includes('source-connections/mbxS/sync'));
    r = await req('POST', '/mbxT/reconnect', { appPassword: PW });
    c = last(/reconnect$/);
    ok('Reconnect, STARTTLS mailbox: to the bridge with the new password', c.p.includes('/webmail/mbxT/reconnect') && c.body.password === PW && r.body.message);
    r = await req('POST', '/mbxG/reconnect', {});
    c = last(/reconnect$/);
    ok('Reconnect, Gmail: to the portal as before (saved password)', c.p.includes('source-connections/mbxG/reconnect') && !c.body.appPassword);

    r = await req('POST', '/', { source: 'naukri', recruiterId: 'r1', address: 'JOBS@company.example', provider: 'other', security: 'starttls', host: 'mail.company.example', appPassword: PW });
    c = last(/reconnect$/);
    ok('the same STARTTLS address again with a new password: the SAME connection, re-tested by the bridge', r.status === 200 && r.body.moved === true && c.p.includes('/webmail/mbxT/reconnect') && c.body.password === PW, JSON.stringify(r.body));

    portal.bridgeHasWebmail = false;
    r = await req('GET', '/');
    ok('an older bridge without the webmail routes: the list still loads (every mailbox SSL/TLS)', r.status === 200 && r.body.connections.every((x) => x.security === 'ssl'));
    ok('no password in any answer', !seen.join('\n').includes(PW));
  } finally {
    server.close();
    await prisma.$disconnect();
    for (const x of ['', '-wal', '-shm', '-journal']) fs.rmSync(`${DB}${x}`, { force: true });
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error(e); await prisma.$disconnect().catch(() => {}); process.exit(1); });
