/**
 * NAUKRI WEBMAIL (company mailbox) - the part of the Naukri & Shine Email Import that the portal's engine does not do itself.
 * 2026-11-02, founder: "Naukri: Email Integration (existing Gmail) + Webmail Integration (company webmail, own IMAP host / port /
 * security, Test Connection, Connect, Disconnect, Sync Now)".
 *
 * A webmail mailbox on IMAP over SSL (usually port 993) is the portal's own "Other (IMAP)" connection: nothing here is used for it
 * except Test Connection. What the portal's IMAP client cannot do is STARTTLS (a plain connection, usually port 143, upgraded to
 * TLS by the STARTTLS command). For those mailboxes this file is the reader:
 *
 *   testLogin()     Test Connection, nothing saved: SSL -> the portal's own testImapLogin (the very client its sync uses);
 *                   STARTTLS -> the client below. connect, (STARTTLS), LOGIN, SELECT INBOX, LOGOUT. A temporary failure (no answer,
 *                   connection dropped) is tried once more after 3 s; a refused password is not.
 *   connect()       the same login first, then the portal's own source_mailbox_save (sealed password, the same table, the same
 *                   recruiter rules), config.security = 'starttls'. The portal's timer (SSL only) must never try it, and the portal
 *                   database gives no way to switch its auto_sync off (no UPDATE policy; only Disconnect does it, and that erases the
 *                   password). Its timer skips a mailbox whose credential fingerprint is marked "refused" (mailbox_auth_refused,
 *                   0046), so that mark is set for a STARTTLS mailbox: the portal skips it, this file reads it. A password the server
 *                   really refused is tracked by the mailbox's own status instead (status 'error' + a "refused" last_error).
 *   reconnect()     test again (new or saved password), source_mailbox_reconnect, the mark again (a new password = a new mark).
 *   sync()          what the portal's syncMailbox does, with this reader: email_message_seen (the same message is never processed
 *                   twice), the portal's own processMessage (Naukri parsing, the candidate, the resume, duplicates, the mailbox's
 *                   recruiter), mailbox_synced / the audit counts, then the responses waiting for a requirement again.
 *   startTimer()    every INTAKE_SYNC_MS (5 min, like the portal), every connected STARTTLS mailbox. A password the server refused
 *                   is not sent again by the timer until someone reconnects (Sync Now still tries: a person asked).
 * The portal's log then shows one line per timer run for each STARTTLS mailbox ("refused this credential ... not sent again"):
 * that is the skip, not a login.
 *
 * Passwords: sealed by the portal (AES-256-GCM, publishing/secrets.js), never returned, never logged.
 * The portal's code is not changed: only its exported functions are called.
 */
import net from 'node:net';
import tls from 'node:tls';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SYSTEM = { userId: '', role: 'admin', profileId: null };
const BOARD = { naukri: 'Naukri', shine: 'Shine' };
const RETRYABLE = new Set(['needs_review', 'ignored', 'failed', 'needs_mapping', 'duplicate']);
const newId = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

export class WebmailError extends Error {
  constructor(status, code, message, details) { super(message); Object.assign(this, { status, code, details }); }
}

/* ------------------------------------------------------------------ *
 * an IMAP client that starts plain and upgrades with STARTTLS
 * (send / login / search / fetch as the portal's own client, intake/mailbox.js)
 * ------------------------------------------------------------------ */
export class StartTlsImap {
  constructor({ host, port, user, password, timeout = 20000 }) {
    Object.assign(this, { host, port: Number(port) || 143, user, password, timeout });
    this.tag = 0; this.buffer = ''; this.pending = null; this.closed = null; this.socket = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const plain = net.connect({ host: this.host, port: this.port });
      let text = '';
      let stage = 'greeting';
      let settled = false;
      const timer = setTimeout(() => fail(new Error('the mail server did not answer')), this.timeout);
      function fail(err) {
        if (settled) return;
        settled = true; clearTimeout(timer);
        try { plain.destroy(); } catch { /* gone */ }
        reject(err);
      }
      const onPlain = (chunk) => {
        text += chunk.toString('latin1');
        let i;
        while ((i = text.indexOf('\r\n')) >= 0) {
          const line = text.slice(0, i); text = text.slice(i + 2);
          if (stage === 'greeting') {
            if (/^\* BYE/i.test(line)) return fail(new Error(`the mail server closed the connection: ${line.slice(0, 120)}`));
            if (!/^\* (OK|PREAUTH)/i.test(line)) continue; // eslint-disable-line no-continue
            stage = 'starttls';
            plain.write('a0 STARTTLS\r\n');
          } else if (/^a0 /i.test(line)) {
            if (!/^a0 OK/i.test(line)) {
              return fail(new Error(`the mail server does not offer STARTTLS on port ${this.port} (it answered: ${line.slice(3, 120)}). `
                + 'Choose SSL/TLS (usually port 993) or check the port.'));
            }
            plain.removeListener('data', onPlain);
            const servername = net.isIP(this.host) ? undefined : this.host;
            const secure = tls.connect({ socket: plain, servername, rejectUnauthorized: process.env.MAILBOX_TLS_INSECURE !== 'true' });
            secure.once('error', fail);
            secure.once('secureConnect', () => {
              if (settled) return;
              settled = true; clearTimeout(timer);
              secure.removeListener('error', fail);
              const dropped = (err) => {
                this.closed = err instanceof Error ? err : new Error('the mail server dropped the connection');
                const p = this.pending; this.pending = null;
                if (p) p.reject(this.closed);
              };
              secure.on('error', dropped);
              secure.on('close', () => dropped(new Error('the mail server closed the connection')));
              secure.setEncoding('latin1'); // one byte = one character: a FETCH literal's byte count stays exact
              secure.on('data', (c) => this.onData(c));
              this.socket = secure;
              resolve(secure);
            });
            return undefined;
          }
        }
        return undefined;
      };
      plain.on('data', onPlain);
      plain.once('error', fail);
      plain.once('close', () => fail(new Error('the mail server closed the connection')));
    });
  }

  onData(chunk) {
    this.buffer += chunk;
    if (!this.pending) return;
    const { tag, resolve, reject } = this.pending;
    const done = new RegExp(`^${tag} (OK|NO|BAD)([^\\r\\n]*)`, 'm').exec(this.buffer);
    if (!done) return;
    const payload = this.buffer;
    this.buffer = ''; this.pending = null;
    if (done[1] === 'OK') resolve(payload);
    else reject(new Error(`the mail server refused: ${done[1]}${done[2] || ''}`));
  }

  send(command) {
    if (this.closed) return Promise.reject(this.closed);
    const tag = `a${++this.tag}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending && this.pending.tag === tag) { this.pending = null; reject(new Error('the mail server stopped responding')); }
      }, this.timeout);
      const wrap = (fn) => (v) => { clearTimeout(timer); fn(v); };
      this.pending = { tag, resolve: wrap(resolve), reject: wrap(reject) };
      this.socket.write(`${tag} ${command}\r\n`);
    });
  }

  async login() {
    const q = (s) => `"${String(s).replace(/(["\\])/g, '\\$1')}"`;
    await this.send(`LOGIN ${q(this.user)} ${q(this.password)}`);
  }

  async selectInbox() { await this.send('SELECT INBOX'); }

  async search(since) {
    const d = since instanceof Date ? since : new Date(Date.now() - 7 * 86400000);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const out = await this.send(`SEARCH SINCE ${d.getDate()}-${months[d.getMonth()]}-${d.getFullYear()}`);
    const line = /^\* SEARCH([^\r\n]*)/m.exec(out);
    return line ? line[1].trim().split(/\s+/).filter(Boolean).map(Number).filter(Number.isFinite) : [];
  }

  fetchMessageId(seq) { return this.fetch(seq, 'BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)]'); }

  async fetch(seq, part = 'BODY.PEEK[]') {
    const out = await this.send(`FETCH ${seq} (${part})`);
    const lit = /\{(\d+)\}\r?\n/.exec(out); // the message is exactly that many bytes after the literal's line
    if (!lit) return out;
    const from = lit.index + lit[0].length;
    return out.slice(from, from + Number(lit[1]));
  }

  async logout() {
    try { if (this.socket) await this.send('LOGOUT'); } catch { /* closing anyway */ }
    try { if (this.socket) this.socket.end(); } catch { /* already gone */ }
  }
}

function header(raw, name) {
  const m = new RegExp(`^${name}\\s*:\\s*([^\\r\\n]*(?:\\r?\\n[ \\t][^\\r\\n]*)*)`, 'im').exec(raw);
  return m ? m[1].replace(/\r?\n[ \t]+/g, ' ').trim() : '';
}
function decodeMime(v) {
  return String(v || '').replace(/(\?=)\s+(=\?)/g, '$1$2').replace(/=\?[^?]+\?([BQ])\?([^?]*)\?=/gi, (_, enc, data) => {
    try {
      if (enc.toUpperCase() === 'B') return Buffer.from(data, 'base64').toString('utf8');
      return Buffer.from(data.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (__, h) => String.fromCharCode(parseInt(h, 16))), 'binary').toString('utf8');
    } catch { return data; }
  });
}

/** Not answering / dropped / reset: worth one more try. A refused password or an unknown server is not. */
export function isTemporary(err) {
  const m = String((err && err.message) || err || '');
  return /did not answer|stopped responding|closed the connection|dropped the connection|ECONNRESET|ETIMEDOUT|EPIPE|EAI_AGAIN/i.test(m)
    && !/refused: NO|AUTHENTICATIONFAILED|STARTTLS/i.test(m);
}
async function withRetry(fn, { tries = 2, waitMs = Number(process.env.WEBMAIL_RETRY_MS) || 3000 } = {}) {
  let last;
  for (let i = 0; i < tries; i += 1) {
    try { return await fn(); } catch (err) { // eslint-disable-line no-await-in-loop
      last = err;
      if (i === tries - 1 || !isTemporary(err)) throw err;
      await sleep(waitMs); // eslint-disable-line no-await-in-loop
    }
  }
  throw last;
}

/* ------------------------------------------------------------------ *
 * the engine, bound to the portal's own modules
 * ------------------------------------------------------------------ */
export function webmailEngine({ root, withUser }) {
  let mods = null;
  const load = async () => {
    if (mods) return mods;
    const at = (p) => import(pathToFileURL(join(root, 'api', 'src', p)).href);
    const [mailbox, mime, proc, source, secrets, routes] = await Promise.all([
      at('intake/mailbox.js'), at('intake/mime.js'), at('intake/process.js'), at('intake/source.js'), at('publishing/secrets.js'), at('routes/source-mailboxes.js'),
    ]);
    mods = { mailbox, mime, proc, source, secrets, routes };
    return mods;
  };
  const running = new Set();
  const explain = async (out, host) => (await load()).routes.explainLoginFailure(out, { provider: 'other', host });

  async function starttlsLogin({ host, port, user, password }) {
    const client = new StartTlsImap({ host, port, user, password });
    try { await client.connect(); await client.login(); await client.selectInbox(); return { ok: true }; } finally { await client.logout(); }
  }

  /** Test Connection: { host, port, security: 'ssl' | 'starttls', user, password } -> { ok, message } (nothing is saved). */
  async function testLogin({ host, port, security, user, password }) {
    const m = await load();
    const pw = m.routes.cleanAppPassword('other', password);
    const p = Number(port) || (security === 'starttls' ? 143 : 993);
    let out;
    if (security === 'starttls') {
      try { out = await withRetry(() => starttlsLogin({ host, port: p, user, password: pw })); } catch (err) {
        out = { ok: false, error: String((err && err.message) || err).slice(0, 300), authFailed: m.mailbox.isAuthFailure(err) };
      }
    } else {
      out = await m.mailbox.testImapLogin({ host, port: p, user, password: pw });
      if (!out.ok && isTemporary(out.error)) { await sleep(Number(process.env.WEBMAIL_RETRY_MS) || 3000); out = await m.mailbox.testImapLogin({ host, port: p, user, password: pw }); }
    }
    if (out.ok) return { ok: true, message: `Connected: ${user} opened the inbox on ${host}:${p} (${security === 'starttls' ? 'STARTTLS' : 'SSL/TLS'}). Nothing was saved yet.` };
    const why = /STARTTLS/.test(out.error || '') ? out.error : await explain(out, host);
    return { ok: false, message: why };
  }

  const dbRefusal = (err) => {
    const s = String((err && err.message) || '');
    if (/MAILBOX_OTHER_SOURCE/.test(s)) return new WebmailError(409, 'MAILBOX_OTHER_SOURCE', 'This mailbox is already connected for the other job board. Naukri and Shine need separate mailboxes.');
    if (/MAILBOX_OWNED/.test(s)) return new WebmailError(409, 'MAILBOX_OWNED', 'This mailbox is already connected to another recruiter. Use Reassign on that row to change its recruiter on purpose.');
    if (/MAILBOX_PERSONAL/.test(s)) return new WebmailError(409, 'MAILBOX_PERSONAL', `This mailbox is a recruiter's personal mailbox (${(err && err.detail) || 'another recruiter'}). Tick "take it over" to make it this board's mailbox.`);
    if (/NO_SUCH_RECRUITER/.test(s)) return new WebmailError(422, 'VALIDATION_FAILED', 'Select a recruiter who exists.', { recruiterId: 'Select a recruiter.' });
    return err;
  };
  const boxOf = (id) => withUser(SYSTEM, async (c) => (await c.query(`select * from email_mailboxes where id = $1 and source is not null`, [id])).rows[0]);
  // the portal's timer skips a mailbox whose credential carries the "refused" mark (see the top of this file)
  const keepOffPortalTimer = async (id, address, password) => {
    const mark = (await load()).mailbox.credentialFingerprint(address, password);
    await withUser(SYSTEM, (c) => c.query(`select mailbox_auth_refused($1,$2)`, [id, mark]));
  };

  /** Connect a STARTTLS mailbox: { source, recruiterId, address, username?, password, host, port, takeOver? }. */
  async function connect(b) {
    const m = await load();
    if (!m.secrets.secretKeyConfigured()) {
      throw new WebmailError(503, 'INTEGRATION_SECRET_KEY_MISSING', 'The server cannot store mailbox passwords safely yet: INTEGRATION_SECRET_KEY is not set.');
    }
    const details = {};
    const address = String(b.address || '').trim().toLowerCase();
    const host = String(b.host || '').trim();
    const port = Number(b.port) || 143;
    if (!['naukri', 'shine'].includes(b.source)) details.source = 'Choose Naukri or Shine.';
    if (!b.recruiterId) details.recruiterId = 'Select a recruiter.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) details.address = 'That is not a valid email address.';
    if (!host) details.host = 'Enter the IMAP server, for example mail.yourcompany.com.';
    if (!(port >= 1 && port <= 65535)) details.port = 'Enter a port between 1 and 65535.';
    if (!b.password) details.password = 'Enter the mailbox password.';
    if (Object.keys(details).length) throw new WebmailError(422, 'VALIDATION_FAILED', 'Please check the highlighted fields.', details);
    const rec = await withUser(SYSTEM, async (c) => (await c.query(
      `select r.id, r.name, coalesce(u.status, 'active') as login_status from recruiters r left join users u on u.id = r.user_id where r.id = $1`, [String(b.recruiterId)])).rows[0]);
    if (!rec) throw new WebmailError(422, 'VALIDATION_FAILED', 'Select a recruiter who exists.', { recruiterId: 'Select a recruiter.' });
    if (rec.login_status !== 'active') throw new WebmailError(422, 'VALIDATION_FAILED', `${rec.name}'s login is not active, so a mailbox cannot be connected to them.`, { recruiterId: 'Not active.' });

    const user = String(b.username || '').trim() || address;
    const password = m.routes.cleanAppPassword('other', b.password);
    const test = await testLogin({ host, port, security: 'starttls', user, password });
    if (!test.ok) throw new WebmailError(400, 'MAILBOX_LOGIN_FAILED', test.message);

    const cfg = { kind: 'other', host, port, security: 'starttls' };
    let id;
    try {
      id = await withUser(SYSTEM, async (c) => (await c.query(
        `select source_mailbox_save($1,$2,$3,$4,'imap',$5::jsonb,$6,'app_password',$7) as id`,
        [newId('mbx'), address, b.source, rec.id, JSON.stringify(cfg), m.secrets.sealSecrets({ user, password }), b.takeOver === true])).rows[0].id);
    } catch (err) { throw dbRefusal(err); }
    await keepOffPortalTimer(id, address, password);
    syncInBackground(id);
    return {
      connection: { id, address, source: b.source, sourceLabel: BOARD[b.source], recruiterId: rec.id, recruiterName: rec.name, security: 'starttls' },
      message: `${BOARD[b.source]} webmail connected for ${rec.name}. The login was verified (STARTTLS); the first sync has started.`,
    };
  }

  /** Reconnect a STARTTLS mailbox: { password?, username? } (no password = the saved one). */
  async function reconnect(id, b = {}) {
    const m = await load();
    const box = await boxOf(id);
    if (!box) throw new WebmailError(404, 'NOT_FOUND', 'That mailbox connection could not be found.');
    const cfg = box.config || {};
    const stored = m.mailbox.mailboxSecrets(box.address, box);
    const user = String(b.username || '').trim() || (stored.sealed ? stored.user : box.address);
    const password = b.password ? m.routes.cleanAppPassword('other', b.password) : (stored.sealed ? stored.password : '');
    if (!password) throw new WebmailError(422, 'VALIDATION_FAILED', 'This mailbox has no saved password (it was disconnected). Enter the password to reconnect.', { password: 'Enter the password.' });
    const test = await testLogin({ host: cfg.host, port: cfg.port, security: 'starttls', user, password });
    if (!test.ok) {
      await withUser(SYSTEM, (c) => c.query(
        `update email_mailboxes set status = case when status = 'disconnected' then status else 'error' end, last_error = $2, updated_at = now() where id = $1`, [id, test.message]));
      throw new WebmailError(400, 'MAILBOX_LOGIN_FAILED', test.message);
    }
    const sealed = b.password || !stored.sealed ? m.secrets.sealSecrets({ user, password }) : null;
    await withUser(SYSTEM, (c) => c.query(`select source_mailbox_reconnect($1,$2,$3::jsonb)`, [id, sealed, JSON.stringify({ ...cfg, security: 'starttls' })]));
    await keepOffPortalTimer(id, box.address, password);
    syncInBackground(id);
    return { connectionId: id, message: 'Reconnected. The login was verified (STARTTLS); a sync has started.' };
  }

  async function fetchNew(box, { since, limit, known }) {
    const m = await load();
    const s = m.mailbox.mailboxSecrets(box.address, box);
    const cfg = box.config || {};
    const client = new StartTlsImap({ host: cfg.host, port: cfg.port, user: s.user, password: s.password, timeout: Number(process.env.MAILBOX_TIMEOUT_MS) || 60000 });
    await client.connect();
    try {
      await client.login();
      await client.selectInbox();
      const wanted = (await client.search(since)).slice(-limit);
      const out = [];
      for (const n of wanted) {
        if (known && known.size) {
          let mid = '';
          try { mid = header(await client.fetchMessageId(n), 'Message-ID'); } catch { /* read it in full */ } // eslint-disable-line no-await-in-loop
          if (mid && known.has(mid)) { out.push({ messageId: mid, from: '', to: box.address, subject: '', text: '', raw: '', receivedAt: new Date(), hasAttachment: false }); continue; } // eslint-disable-line no-continue
        }
        let raw;
        try { raw = await client.fetch(n); } catch { continue; } // eslint-disable-line no-await-in-loop, no-continue
        const body = m.mime.bodyOf(raw);
        const attachments = m.mime.attachmentsOf(raw); // before raw is clipped: a resume needs every byte
        out.push({
          attachments,
          messageId: header(raw, 'Message-ID') || `imap-${box.id}-${n}`,
          from: header(raw, 'From'),
          to: header(raw, 'To') || box.address,
          subject: decodeMime(header(raw, 'Subject')),
          text: typeof body === 'string' ? body : body.text,
          raw: raw.slice(0, 200000),
          receivedAt: new Date(header(raw, 'Date') || Date.now()),
          attachmentName: (attachments[0] && attachments[0].filename) || (typeof body === 'string' ? null : (body.attachment || null)),
          hasAttachment: attachments.length > 0 || (typeof body === 'string' ? false : !!body.attachment),
        });
      }
      return out;
    } finally { await client.logout(); }
  }

  /** One sync of a STARTTLS mailbox (Sync Now and the timer). The answer has the portal sync's shape. */
  async function sync(id, { limit = 100, auto = false } = {}) {
    const m = await load();
    const box = await boxOf(id);
    if (!box) throw new WebmailError(404, 'NOT_FOUND', 'That mailbox connection could not be found.');
    if (box.status === 'disconnected') throw new WebmailError(409, 'MAILBOX_DISCONNECTED', 'This mailbox is disconnected. Reconnect it first.');
    if (running.has(id)) throw new WebmailError(409, 'SYNC_RUNNING', 'A sync of this mailbox is already running.');
    const s = m.mailbox.mailboxSecrets(box.address, box);
    if (!s.password) {
      await withUser(SYSTEM, (c) => c.query(`select mailbox_synced($1,$2)`, [id, 'No saved password: reconnect the mailbox.']));
      return { error: 'No saved password: reconnect the mailbox.', emailsRead: 0, imported: 0 };
    }
    if (auto && box.status === 'error' && /refused/i.test(box.last_error || '')) return { skipped: 'password refused before: waiting for Reconnect', emailsRead: 0, imported: 0 };
    running.add(id);
    try {
      const known = new Set((await withUser(SYSTEM, async (c) => (await c.query(
        `select message_id from email_messages where mailbox_id = $1 and status <> 'new'`, [id])).rows)).map((r) => r.message_id));
      let fetched;
      try {
        fetched = await withRetry(() => fetchNew(box, { since: null, limit, known }));
      } catch (err) {
        const out = { ok: false, error: String((err && err.message) || err).slice(0, 300), authFailed: m.mailbox.isAuthFailure(err) };
        const words = /STARTTLS/.test(out.error) ? out.error : await explain(out, (box.config || {}).host);
        await withUser(SYSTEM, (c) => c.query(`select mailbox_synced($1,$2)`, [id, words]));
        return { error: words, emailsRead: 0, imported: 0 };
      }

      const results = [];
      let imported = 0;
      for (const message of fetched) {
        const rowId = m.mailbox.newMessageId();
        let stored;
        try {
          stored = await withUser(SYSTEM, async (c) => (await c.query( // eslint-disable-line no-await-in-loop
            `select email_message_seen($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as id`,
            [rowId, id, message.messageId, message.from, message.to, message.subject, message.receivedAt, String(message.text || '').slice(0, 2000),
              String(message.raw || message.text || ''), !!message.hasAttachment, message.attachmentName || null])).rows[0].id);
        } catch (err) { results.push({ messageId: message.messageId, status: 'failed', reason: err.message }); continue; } // eslint-disable-line no-continue
        if (stored !== rowId) { // read before: the unique index (mailbox, Message-ID) handed back the old row
          const prior = await withUser(SYSTEM, async (c) => (await c.query(`select status, reason from email_messages where id = $1`, [stored])).rows[0]); // eslint-disable-line no-await-in-loop
          if (prior && prior.status !== 'new') { results.push({ messageId: message.messageId, status: 'already_processed', reason: prior.reason || `already ${prior.status}` }); continue; } // eslint-disable-line no-continue
        }
        // who owns the mailbox, read again before every email: a disconnect or reassignment applies to the very next one
        const now = await withUser(SYSTEM, async (c) => (await c.query(`select recruiter_id, status, source from email_mailboxes where id = $1`, [id])).rows[0]); // eslint-disable-line no-await-in-loop
        if (!now || now.status === 'disconnected') break;
        try {
          const out = await m.proc.processMessage(SYSTEM, { mailbox: { ...box, recruiter_id: now.recruiter_id, source: now.source }, message, rowId: stored, provider: now.source }); // eslint-disable-line no-await-in-loop
          if (out.status === 'processed') imported += 1;
          results.push({ messageId: message.messageId, source: (m.source.detectSource(message) || {}).id, ...out });
        } catch (err) {
          await withUser(SYSTEM, (c) => c.query(`select email_message_result($1,'failed',$2,null,null,null)`, [stored, err.message])).catch(() => {}); // eslint-disable-line no-await-in-loop
          results.push({ messageId: message.messageId, status: 'failed', reason: err.message });
        }
      }
      await withUser(SYSTEM, (c) => c.query(`select mailbox_synced($1,null)`, [id]));
      const n = (...st) => results.filter((x) => st.includes(x.status)).length;
      await withUser(SYSTEM, (c) => c.query(`select source_mailbox_synced_audit($1,$2::jsonb)`, [id, JSON.stringify({
        seen: fetched.length, imported, review: n('needs_review', 'needs_mapping'), duplicates: n('duplicate'), alreadyRead: n('already_processed'), failed: n('failed'),
      })])).catch(() => {});
      // the responses waiting for a requirement, again (as the portal's own Sync does)
      try {
        const ids = (await withUser(SYSTEM, async (c) => (await c.query(
          `select id from email_messages where mailbox_id = $1 and status = 'needs_mapping' and application_id is null`, [id])).rows)).map((x) => x.id);
        if (ids.length) await m.proc.reprocessUnmapped(SYSTEM, { ids });
      } catch (err) { console.error('[webmail] waiting messages could not be imported again:', String(err && err.message)); }
      return {
        emailsRead: fetched.length, imported, duplicates: n('duplicate'), alreadyRead: n('already_processed'),
        pendingReview: n('needs_review', 'needs_mapping'), failed: n('failed'),
        notThisBoard: results.filter((x) => x.status === 'ignored' && /this mailbox imports/.test(x.reason || '')).length,
      };
    } finally { running.delete(id); }
  }

  function syncInBackground(id) {
    if (running.has(id)) return;
    sync(id).catch((err) => console.error('[webmail] sync failed for', id, String(err && err.message)));
  }

  /** The STARTTLS mailboxes (ids), for the screen's Security column and for routing Sync / Reconnect. */
  async function starttlsIds() {
    return (await withUser(SYSTEM, async (c) => (await c.query(
      `select id from email_mailboxes where source is not null and config->>'security' = 'starttls'`)).rows)).map((r) => r.id);
  }

  let timer = null;
  let ticking = false;
  function startTimer() {
    if (timer || process.env.DISABLE_BACKGROUND_WORK === 'true') return;
    const every = Number(process.env.INTAKE_SYNC_MS) || 5 * 60 * 1000;
    timer = setInterval(async () => {
      if (ticking) return;
      ticking = true;
      try {
        const ids = await withUser(SYSTEM, async (c) => (await c.query(
          `select id from email_mailboxes where source is not null and status <> 'disconnected' and config->>'security' = 'starttls' order by created_at`)).rows);
        for (const { id } of ids) {
          // eslint-disable-next-line no-await-in-loop
          const out = await sync(id, { auto: true }).catch((err) => ({ error: err.message }));
          if (out && out.error) console.error(`[webmail] ${id}: ${out.error}`);
          else if (out && out.imported) console.log(`[webmail] ${id}: ${out.imported} imported`);
        }
      } catch (err) { console.error('[webmail] timer:', String(err && err.message)); } finally { ticking = false; }
    }, every);
    if (timer.unref) timer.unref();
  }

  return { testLogin, connect, reconnect, sync, starttlsIds, startTimer, isRunning: (id) => running.has(id) };
}
