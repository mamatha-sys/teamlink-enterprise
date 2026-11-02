/**
 * NAUKRI WEBMAIL through the TeamLink bridge (embed/webmail-mailbox.mjs + the .../mailboxes/webmail routes in teamlink-integration.mjs).
 *
 * The real portal app and the real bridge router, on a throwaway in-memory database (the portal's own harness: PGlite, every
 * migration) and three fake IMAP servers on 127.0.0.1 with the portal's test certificate:
 *   SSL       IMAP over TLS from the first byte (port 993 style)
 *   STARTTLS  plain, upgraded by the STARTTLS command (port 143 style); can drop the first connection to prove the retry
 *   PLAIN     plain IMAP that does NOT offer STARTTLS
 * No real mailbox, no real database, nothing outside this machine.
 *
 *   cd job-portal-app/job_portal-main/api && node --test ../../embed/test/webmail-mailbox.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../job_portal-main');
const API_TEST = join(ROOT, 'api', 'test');
const { startTestDb, applyTestEnv } = await import(pathToFileURL(join(API_TEST, 'harness.mjs')).href);

const DB_PORT = 5611; const API_PORT = 9961;
const SSL_PORT = 9671; const STARTTLS_PORT = 9672; const PLAIN_PORT = 9673;
const TOKEN = 'zz-webmail-bridge-token';
const BOX_SSL = 'naukri.webmail-ssl@tl-webmail-test.in';
const BOX_STL = 'naukri.webmail@tl-webmail-test.in';
const PW_SSL = 'ssl-mailbox-pass-77';
const PW_STL = 'starttls pass "quoted" 42';
const KEY = readFileSync(join(API_TEST, 'fixtures/fake-imap-key.pem'));
const CERT = readFileSync(join(API_TEST, 'fixtures/fake-imap-cert.pem'));
const base = `http://127.0.0.1:${API_PORT}/api/integrations/teamlink/mailboxes`;
const seen = []; // every answer, to prove no password comes back

/* ---------------- fake IMAP ---------------- */
const accounts = new Map(); // user -> { password, messages }
let dropNextStarttls = 0;
let starttlsConnections = 0;
function speak(sock, state) {
  let buf = '';
  let who = null;
  sock.setEncoding('latin1');
  sock.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      const tag = line.split(' ')[0]; const cmd = (line.split(' ')[1] || '').toUpperCase();
      if (cmd === 'STARTTLS' && state.offersStarttls && !state.secure) {
        sock.write(`${tag} OK Begin TLS negotiation now\r\n`);
        sock.removeAllListeners('data');
        const secure = new tls.TLSSocket(sock, { isServer: true, key: KEY, cert: CERT });
        secure.on('error', () => {});
        speak(secure, { ...state, secure: true });
        return;
      }
      if (cmd === 'STARTTLS') { sock.write(`${tag} BAD STARTTLS not supported here\r\n`); continue; }
      if (cmd === 'LOGIN') {
        if (state.needsTls && !state.secure) { sock.write(`${tag} NO [PRIVACYREQUIRED] Use STARTTLS first\r\n`); continue; }
        const args = [...line.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\(.)/g, '$1'));
        const acc = accounts.get(args[0]);
        if (acc && acc.password === args[1]) { who = acc; sock.write(`${tag} OK LOGIN completed\r\n`); } else sock.write(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)\r\n`);
      } else if (cmd === 'SELECT') sock.write(`* ${who.messages.length} EXISTS\r\n${tag} OK [READ-WRITE] SELECT completed\r\n`);
      else if (cmd === 'SEARCH') sock.write(`* SEARCH ${who.messages.map((_, n) => n + 1).join(' ')}\r\n${tag} OK SEARCH completed\r\n`);
      else if (cmd === 'FETCH') {
        const n = Number(line.split(' ')[2]);
        let msg = who.messages[n - 1];
        if (/HEADER\.FIELDS/i.test(line)) msg = `${/^Message-ID:[^\r\n]*/im.exec(msg)[0]}\r\n\r\n`;
        sock.write(`* ${n} FETCH (BODY[] {${Buffer.byteLength(msg, 'latin1')}}\r\n${msg})\r\n${tag} OK FETCH completed\r\n`);
      } else if (cmd === 'LOGOUT') { sock.write(`* BYE\r\n${tag} OK LOGOUT completed\r\n`); sock.end(); } else sock.write(`${tag} BAD unknown command\r\n`);
    }
  });
  sock.on('error', () => {});
}
const listen = (srv, port) => new Promise((r) => srv.listen(port, '127.0.0.1', () => r(srv)));
const sslServer = () => listen(tls.createServer({ key: KEY, cert: CERT }, (s) => { s.write('* OK fake SSL IMAP ready\r\n'); speak(s, { secure: true }); }), SSL_PORT);
const starttlsServer = () => listen(net.createServer((s) => {
  starttlsConnections += 1;
  if (dropNextStarttls > 0) { dropNextStarttls -= 1; s.destroy(); return; }
  s.write('* OK [CAPABILITY IMAP4rev1 STARTTLS LOGINDISABLED] fake webmail ready\r\n');
  speak(s, { secure: false, offersStarttls: true, needsTls: true });
}), STARTTLS_PORT);
const plainServer = () => listen(net.createServer((s) => { s.write('* OK plain IMAP, no STARTTLS\r\n'); speak(s, { secure: false }); }), PLAIN_PORT);

let mseq = 0;
function email({ from, subject, body, attachment }) {
  mseq += 1;
  const head = [`Message-ID: <wm${mseq}.${Date.now()}@mailer.test>`, `From: ${from}`, 'To: inbox@tl-webmail-test.in', `Subject: ${subject}`, `Date: ${new Date().toUTCString()}`, 'MIME-Version: 1.0'];
  if (!attachment) return [...head, 'Content-Type: text/plain; charset=utf-8', '', body, ''].join('\r\n');
  return [...head, 'Content-Type: multipart/mixed; boundary="zzb"', '', '--zzb', 'Content-Type: text/plain; charset=utf-8', '', body, '--zzb',
    `Content-Type: application/pdf; name="${attachment.name}"`, 'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${attachment.name}"`, '',
    Buffer.from(attachment.bytes).toString('base64'), '--zzb--', ''].join('\r\n');
}
const tag = Date.now().toString(36);
const naukri = (name, mail, extra = {}) => email({
  from: 'Naukri <jobsapply@naukri.com>', subject: 'New application received for Java Developer', attachment: extra.attachment,
  body: ['Source: Naukri', '', `Candidate Name: ${name}`, `Candidate Email: ${mail}`, `Mobile: 9${String(400000000 + mseq).slice(-9)}`, 'Applied Role: Java Developer',
    'Total Experience: 4 years', 'Key Skills: Java, Spring Boot, SQL', 'Current Location: Hyderabad', ...(extra.profile ? [`Naukri Profile: ${extra.profile}`] : [])].join('\r\n'),
});
const shine = (name, mail) => email({ from: 'Shine <recruiters@alerts.shine.com>', subject: 'Email Response-Hiring for Java Developer',
  body: ['You have received an email response for Hiring for Java Developer.', `Candidate Name: ${name}`, `Email: ${mail}`, `Mobile: 9${String(500000000 + mseq).slice(-9)}`].join('\r\n') });
const PDF = `%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\nRavi Teja resume - Java Developer, Hyderabad. ravi.${tag}@cand-webmail-test.in`;

/* ---------------- helpers ---------------- */
let dbh; let server; let raw; let imaps = [];
async function call(method, path, body) {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', 'x-teamlink-token': TOKEN }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  seen.push(text);
  let json = null; try { json = JSON.parse(text); } catch { json = { text }; }
  return { status: r.status, body: json };
}
const until = async (fn, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 150)); } };
const candidate = async (mail) => (await raw(`select id, owner_recruiter_id from candidates where lower(email) = lower($1)`, [mail])).rows[0];
const appsOf = async (candId) => (await raw(`select recruiter_id, source, resume_path from applications where candidate_id = $1`, [candId])).rows;
const box = async (address) => (await raw(`select * from email_mailboxes where address = $1`, [address])).rows[0];

const mailA = `amar.${tag}@cand-webmail-test.in`; const mailB = `bhavya.${tag}@cand-webmail-test.in`;
const mailR = `ravi.${tag}@cand-webmail-test.in`; const mailS = `sita.${tag}@cand-webmail-test.in`;
const mailL = `lata.${tag}@cand-webmail-test.in`;
let stlId; let sslId;

test('boot: in-memory portal database, the portal app with the TeamLink bridge in front, fake IMAP servers', async () => {
  dbh = await startTestDb(DB_PORT);
  imaps = [await sslServer(), await starttlsServer(), await plainServer()];
  applyTestEnv(dbh.url, {
    DISABLE_BACKGROUND_WORK: 'true', AI_API_KEY: '', MAILBOX_TLS_INSECURE: 'true', WEBMAIL_RETRY_MS: '200',
    INTEGRATION_SECRET_KEY: 'test-integration-key-webmail-long-enough', JOB_PORTAL_SYNC_TOKEN: TOKEN,
    STORAGE_LOCAL_DIR: resolve(ROOT, 'api/var/test-uploads-webmail'), EMAIL_API_KEY: '', SMS_API_KEY: '', WHATSAPP_API_KEY: '', OUTBOUND_ALLOWLIST: '',
    TEAMLINK_API_URL: 'http://127.0.0.1:9', JOB_PORTAL_PUSH_SECRET: '',
  });
  raw = (sql, params) => dbh.db.query(sql, params);
  await raw(`insert into companies (id, name) values ('co_w', 'Webmail Co')`);
  const { hashPassword } = await import(pathToFileURL(join(ROOT, 'api/src/auth.js')).href);
  const hash = await hashPassword('Staff123webmail');
  for (const [id, mail] of [['r_wA', 'rec.a.wm@tl-sink.local'], ['r_wB', 'rec.b.wm@tl-sink.local']]) {
    const u = (await raw(`insert into users (email,password_hash,role) values ($1,$2,'recruiter') returning id`, [mail, hash])).rows[0].id;
    await raw(`insert into recruiters (id,name,email,company_id,user_id) values ($1,$2,$3,'co_w',$4)`, [id, `Recruiter ${id}`, mail, u]);
  }
  await raw(`insert into jobs (id,title,company_id,recruiter_id,location,mode,exp_label,status,skills,description,published_at)
             values ('j_wm_java','Java Developer','co_w','r_wA','Hyderabad','Onsite','2-5 yrs','open',$1,'Build services.',now())`, [['Java', 'Spring Boot', 'SQL']]);
  accounts.set(BOX_SSL, { password: PW_SSL, messages: [naukri('Amar Kumar', mailA)] });
  accounts.set(BOX_STL, { password: PW_STL, messages: [
    naukri('Bhavya Rao', mailB, { profile: 'https://www.naukri.com/mnjuser/profile?id=zz123' }),
    naukri('Ravi Teja', mailR, { attachment: { name: 'Ravi_Teja_Resume.pdf', bytes: PDF } }),
    shine('Sita Devi', mailS),
    naukri('Amar Kumar', mailA), // the same person as the SSL mailbox imported: a duplicate, not a second candidate
  ] });
  const apiRequire = createRequire(join(ROOT, 'api', 'package.json'));
  const express = apiRequire('express');
  const { createApp } = await import(pathToFileURL(join(ROOT, 'api/src/app.js')).href);
  const { teamlinkFrontRouter } = await import(pathToFileURL(resolve(HERE, '../teamlink-integration.mjs')).href);
  const outer = express();
  outer.use(teamlinkFrontRouter({ root: ROOT, express }));
  outer.use(createApp({ logger: { error() {}, log() {} } }));
  await new Promise((r) => { server = outer.listen(API_PORT, '127.0.0.1', r); });
});

test('Test Connection, SSL/TLS: the portal\'s own client opens the inbox; nothing is saved', async () => {
  const r = await call('POST', '/webmail/test', { host: '127.0.0.1', port: SSL_PORT, security: 'ssl', address: BOX_SSL, password: PW_SSL });
  assert.equal(r.status, 200); assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.match(r.body.message, /SSL\/TLS/);
  assert.equal((await raw('select count(*)::int n from email_mailboxes')).rows[0].n, 0);
});

test('Test Connection, STARTTLS: plain connection upgraded, then LOGIN (a password with spaces and quotes) and SELECT', async () => {
  const r = await call('POST', '/webmail/test', { host: '127.0.0.1', port: STARTTLS_PORT, security: 'starttls', username: BOX_STL, password: PW_STL });
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.match(r.body.message, /STARTTLS/);
});

test('Test Connection failures are explained: wrong password, no STARTTLS on that port, SSL chosen for a STARTTLS port, missing fields', async () => {
  const bad = await call('POST', '/webmail/test', { host: '127.0.0.1', port: STARTTLS_PORT, security: 'starttls', address: BOX_STL, password: 'wrong' });
  assert.equal(bad.body.ok, false); assert.match(bad.body.message, /refused the username or password/);
  const none = await call('POST', '/webmail/test', { host: '127.0.0.1', port: PLAIN_PORT, security: 'starttls', address: BOX_STL, password: PW_STL });
  assert.equal(none.body.ok, false); assert.match(none.body.message, /does not offer STARTTLS/);
  const wrongMode = await call('POST', '/webmail/test', { host: '127.0.0.1', port: STARTTLS_PORT, security: 'ssl', address: BOX_STL, password: PW_STL });
  assert.equal(wrongMode.body.ok, false);
  const empty = await call('POST', '/webmail/test', { host: '', security: 'ssl', password: '' });
  assert.equal(empty.status, 422);
});

test('a temporary failure (the server drops the connection) is tried once more and then works', async () => {
  dropNextStarttls = 1;
  const before = starttlsConnections;
  const r = await call('POST', '/webmail/test', { host: '127.0.0.1', port: STARTTLS_PORT, security: 'starttls', address: BOX_STL, password: PW_STL });
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.ok(starttlsConnections - before >= 2);
});

test('Webmail on SSL/TLS = the portal\'s own "Other (IMAP)" connection: verified, sealed, read by the portal (auto sync on)', async () => {
  const r = await call('POST', '/intake/source-connections', { source: 'naukri', recruiterId: 'r_wA', address: BOX_SSL, provider: 'other', appPassword: PW_SSL, host: '127.0.0.1', port: SSL_PORT });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  sslId = r.body.connection.id;
  const b = await box(BOX_SSL);
  assert.equal(b.auto_sync, true); assert.equal(b.config.kind, 'other'); assert.equal(b.config.security, undefined);
  assert.ok(await until(() => candidate(mailA)), 'the SSL mailbox imported its candidate');
});

test('Webmail on STARTTLS: the login is verified first, the password sealed, the portal\'s SSL-only timer kept off it', async () => {
  const wrong = await call('POST', '/webmail/connect', { source: 'naukri', recruiterId: 'r_wB', address: BOX_STL, username: BOX_STL, password: 'nope', host: '127.0.0.1', port: STARTTLS_PORT });
  assert.equal(wrong.status, 400); assert.equal(await box(BOX_STL), undefined, 'nothing saved after a failed login');
  const missing = await call('POST', '/webmail/connect', { source: 'naukri', recruiterId: 'r_wB', address: 'not-an-email', host: '', password: '' });
  assert.equal(missing.status, 422); assert.ok(missing.body.error.details.address && missing.body.error.details.host);
  const r = await call('POST', '/webmail/connect', { source: 'naukri', recruiterId: 'r_wB', address: BOX_STL, username: BOX_STL, password: PW_STL, host: '127.0.0.1', port: STARTTLS_PORT });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  stlId = r.body.connection.id;
  const b = await box(BOX_STL);
  assert.equal(b.config.security, 'starttls'); assert.equal(b.source, 'naukri'); assert.equal(b.recruiter_id, 'r_wB');
  const { credentialFingerprint } = await import(pathToFileURL(join(ROOT, 'api/src/intake/mailbox.js')).href);
  assert.equal(b.auth_refused_fingerprint, credentialFingerprint(BOX_STL, PW_STL), 'the mark the portal timer skips on');
  assert.ok(b.secrets_sealed && !b.secrets_sealed.includes(PW_STL), 'sealed, not plain');
  const ids = await call('GET', '/webmail/starttls');
  assert.deepEqual(ids.body.ids, [stlId]);
});

test('the first sync imports the Naukri responses for the mailbox\'s recruiter: details, resume attachment, profile link; Shine mail is left alone; a known person is a duplicate', async () => {
  const done = await until(async () => {
    const n = (await raw(`select count(*)::int n from email_messages where mailbox_id = $1 and status <> 'new'`, [stlId])).rows[0].n;
    return n >= 4 ? n : null;
  });
  assert.ok(done, 'the background sync finished');
  const cb = await candidate(mailB); const cr = await candidate(mailR);
  assert.ok(cb && cr, 'both Naukri candidates imported');
  const ab = await appsOf(cb.id); const ar = await appsOf(cr.id);
  assert.equal(ab[0].recruiter_id, 'r_wB'); assert.equal(ab[0].source, 'naukri');
  assert.equal(ar[0].recruiter_id, 'r_wB'); assert.ok(ar[0].resume_path, 'the attached resume was kept');
  assert.equal(await candidate(mailS), undefined, 'a Shine email in the Naukri mailbox is not imported');
  const statuses = (await raw(`select status, subject from email_messages where mailbox_id = $1 order by received_at, id`, [stlId])).rows.map((x) => x.status);
  assert.ok(statuses.includes('duplicate'), JSON.stringify(statuses));
  assert.equal((await raw(`select count(*)::int n from candidates where lower(email) = lower($1)`, [mailA])).rows[0].n, 1, 'still one Amar');
  const rawOf = (await raw(`select raw from email_messages where mailbox_id = $1 and subject like '%Java%' and raw like '%mnjuser%'`, [stlId])).rows[0];
  assert.ok(rawOf, 'the Naukri profile link is kept with the email');
  const b = await box(BOX_STL);
  assert.equal(b.status, 'connected'); assert.ok(b.last_success_at);
  // the portal's own timer run: it skips the STARTTLS mailbox (no login, nothing written) and still reads the SSL one
  const before = starttlsConnections;
  const { syncAll } = await import(pathToFileURL(join(ROOT, 'api/src/intake/process.js')).href);
  const out = await syncAll({ userId: '', role: 'admin', profileId: null }, { onlyAuto: true });
  assert.equal(out.find((x) => x.mailboxId === stlId).error, 'auth_refused');
  assert.ok(!out.find((x) => x.mailbox === BOX_SSL).error, JSON.stringify(out.find((x) => x.mailbox === BOX_SSL)));
  assert.equal(starttlsConnections, before, 'the portal timer did not touch the STARTTLS server');
  const after = await box(BOX_STL);
  assert.equal(after.status, 'connected'); assert.equal(String(after.last_sync_at), String(b.last_sync_at));
});

test('Sync Now again: every email is recognised, nothing is imported twice', async () => {
  accounts.get(BOX_STL).messages.push(naukri('Lata Iyer', mailL));
  const r = await call('POST', `/webmail/${stlId}/sync`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.imported, 1); assert.equal(r.body.alreadyRead, 4);
  const again = await call('POST', `/webmail/${stlId}/sync`);
  assert.equal(again.body.imported, 0); assert.equal(again.body.alreadyRead, 5);
  assert.equal((await raw(`select count(*)::int n from email_messages where mailbox_id = $1`, [stlId])).rows[0].n, 5);
});

test('a refused password: the sync says why and marks the mailbox; Reconnect with the wrong one is refused, with the right one works (timer still off)', async () => {
  accounts.get(BOX_STL).password = 'changed-on-the-server';
  const r = await call('POST', `/webmail/${stlId}/sync`);
  assert.match(r.body.error, /refused/);
  let b = await box(BOX_STL);
  assert.equal(b.status, 'error'); assert.match(b.last_error, /refused/);
  const bad = await call('POST', `/webmail/${stlId}/reconnect`, { password: 'still-wrong' });
  assert.equal(bad.status, 400);
  accounts.get(BOX_STL).password = PW_STL;
  const ok = await call('POST', `/webmail/${stlId}/reconnect`, {});
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  b = await box(BOX_STL);
  assert.equal(b.status, 'connected'); assert.equal(b.config.security, 'starttls');
  const { credentialFingerprint } = await import(pathToFileURL(join(ROOT, 'api/src/intake/mailbox.js')).href);
  assert.equal(b.auth_refused_fingerprint, credentialFingerprint(BOX_STL, PW_STL), 'still skipped by the portal timer');
});

test('the portal\'s list shows both mailboxes with their counts; Disconnect erases the saved password and Sync is refused', async () => {
  await until(async () => { const r = await call('POST', `/webmail/${stlId}/sync`); return r.status === 200 ? r : null; }, 5000);
  const list = await call('GET', '/intake/source-connections');
  const stl = list.body.connections.find((c) => c.id === stlId); const ssl = list.body.connections.find((c) => c.id === sslId);
  assert.ok(stl && ssl);
  assert.equal(stl.recruiterId, 'r_wB'); assert.ok(stl.candidatesImported >= 3); assert.ok(stl.duplicatesSkipped >= 1); assert.ok(stl.lastSuccessfulSyncAt);
  const d = await call('POST', `/intake/source-connections/${stlId}/disconnect`, {});
  assert.equal(d.status, 200);
  assert.equal((await box(BOX_STL)).secrets_sealed, null);
  const s = await call('POST', `/webmail/${stlId}/sync`);
  assert.equal(s.status, 409);
});

test('no password or sealed secret ever comes back', async () => {
  const all = seen.join('\n');
  for (const secret of [PW_SSL, PW_STL, 'changed-on-the-server']) assert.ok(!all.includes(secret), `leaked ${secret}`);
  assert.ok(!all.includes('secrets_sealed'));
});

test('stop', async () => {
  await new Promise((r) => server.close(r));
  for (const s of imaps) s.close();
  const { getPool } = await import(pathToFileURL(join(ROOT, 'api/src/db.js')).href);
  try { await getPool().end(); } catch { /* closed */ }
  await dbh.stop();
  setTimeout(() => process.exit(0), 200).unref();
});
