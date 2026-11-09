// ---------------------------------------------------------------------------
// A COMPANY MAILBOX FROM TEAMLINK (cPanel UAPI Email::add_pop). Optional: until the server has a cPanel API token nothing here runs, and HR makes the
// mailbox in cPanel and types the address (utils/companyEmail.js). The token stays on the server: it is never saved in the database or sent to a browser.
//   CPANEL_HOST    the cPanel server, e.g. server1.example.com        CPANEL_USER    the cPanel account
//   CPANEL_TOKEN   an API token made in cPanel > Security > Manage API Tokens
//   CPANEL_DOMAIN  the mail domain, e.g. tmlink.in                    CPANEL_PORT    2083 unless changed
// CPANEL_BASE_URL replaces https://host:port (a stand-in server in the tests).
// ---------------------------------------------------------------------------
const crypto = require('crypto');

const env = () => ({
  host: String(process.env.CPANEL_HOST || '').trim(),
  user: String(process.env.CPANEL_USER || '').trim(),
  token: String(process.env.CPANEL_TOKEN || '').trim(),
  domain: String(process.env.CPANEL_DOMAIN || '').trim().toLowerCase(),
  port: Number(process.env.CPANEL_PORT) || 2083,
  base: String(process.env.CPANEL_BASE_URL || '').trim(),
});
const configured = () => { const c = env(); return !!((c.host || c.base) && c.user && c.token && c.domain); };
const domain = () => env().domain;

// "Ravi Kumar Reddy" -> ravi.reddy (letters only, as mailbox names are)
function suggestLocalPart(name) {
  const parts = String(name || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((p) => p.length > 1);
  if (!parts.length) return '';
  return parts.length === 1 ? parts[0] : `${parts[0]}.${parts[parts.length - 1]}`;
}

// a strong first password: upper, lower, digit and sign, whatever the random bytes give
function tempPassword() {
  return `Tl${crypto.randomBytes(12).toString('base64url')}#7a`;
}

/** -> { ok, email, password } | { ok: false, error } */
async function createMailbox({ localPart, password = tempPassword(), quotaMb = 1024 }, deps = {}) {
  const c = env();
  if (!configured()) return { ok: false, error: 'cPanel is not connected on this server.' };
  const form = new URLSearchParams({ email: localPart, password, domain: c.domain, quota: String(quotaMb), skip_update_db: '0' });
  try {
    const f = deps.fetch || fetch;
    // the password goes in the body, never in the address (addresses end up in server logs)
    const res = await f(`${c.base || `https://${c.host}:${c.port}`}/execute/Email/add_pop`, {
      method: 'POST', headers: { Authorization: `cpanel ${c.user}:${c.token}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString(), signal: AbortSignal.timeout(20000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) return { ok: false, error: res.status === 401 || res.status === 403 ? 'cPanel refused the API token. Check CPANEL_USER and CPANEL_TOKEN on the server.' : `cPanel did not answer properly (${res.status}).` };
    if (body.status !== 1) return { ok: false, error: `cPanel said: ${(body.errors && body.errors[0]) || 'the mailbox was not made.'}` };
    return { ok: true, email: `${localPart}@${c.domain}`, password };
  } catch (e) {
    return { ok: false, error: `cPanel could not be reached: ${e.message}` };
  }
}

// a new password on a mailbox that is already there (cPanel UAPI Email::passwd_pop) -> { ok } | { ok: false, error }
async function setMailboxPassword({ email, password }, deps = {}) {
  const c = env();
  if (!configured()) return { ok: false, error: 'cPanel is not connected on this server.' };
  const [localPart, mailDomain] = String(email || '').toLowerCase().split('@');
  if (!localPart || mailDomain !== c.domain) return { ok: false, error: `This mailbox is not on ${c.domain}, so TeamLink cannot set its password. Set it where the mailbox is kept.` };
  const form = new URLSearchParams({ email: localPart, password, domain: c.domain });
  try {
    const f = deps.fetch || fetch;
    const res = await f(`${c.base || `https://${c.host}:${c.port}`}/execute/Email/passwd_pop`, {
      method: 'POST', headers: { Authorization: `cpanel ${c.user}:${c.token}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString(), signal: AbortSignal.timeout(20000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) return { ok: false, error: res.status === 401 || res.status === 403 ? 'cPanel refused the API token. Check CPANEL_USER and CPANEL_TOKEN on the server.' : `cPanel did not answer properly (${res.status}).` };
    if (body.status !== 1) return { ok: false, error: `cPanel said: ${(body.errors && body.errors[0]) || 'the password was not changed.'}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `cPanel could not be reached: ${e.message}` };
  }
}

module.exports = { configured, domain, suggestLocalPart, tempPassword, createMailbox, setMailboxPassword };
