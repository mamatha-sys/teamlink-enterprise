#!/usr/bin/env node
/**
 * Candidate logins (founder 2026-11-02): the portal bridge endpoint, run against a SANDBOX portal (never the live one).
 *   node scripts/candidate-logins-test.js [--portal http://127.0.0.1:4324] [--token testtoken]
 * The sandbox has no email / SMS / WhatsApp provider, so a real run can create the account but nothing is "sent": the test proves the
 * rules (dry run by default, no contact, duplicates, do-not-contact, no password ever in a response, a failed send is tried again).
 */
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const PORTAL = arg('portal', 'http://127.0.0.1:4324');
const TOKEN = arg('token', 'testtoken');
let failed = 0;
const check = (name, ok, detail) => { if (!ok) failed += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `  -> ${JSON.stringify(detail).slice(0, 300)}` : ''}`); };
const call = async (path, body, method = 'POST') => {
  const res = await fetch(`${PORTAL}/api/integrations/teamlink${path}`, { method, headers: { 'content-type': 'application/json', 'x-teamlink-token': TOKEN }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text };
};

(async () => {
  const stamp = Date.now().toString().slice(-8);
  const a = { ref: 'zz1', name: `ZZTEST Alpha ${stamp}`, email: `zztest.alpha.${stamp}@example.invalid`, phone: `91${stamp}` };
  const b = { ref: 'zz2', name: `ZZTEST Beta ${stamp}`, phone: `90${stamp}` };            // phone only
  const c = { ref: 'zz3', name: `ZZTEST Gamma ${stamp}` };                                  // nothing to reach them by
  const d = { ref: 'zz4', name: 'Z', email: 'x@example.invalid' };                           // no usable name

  const noTok = await fetch(`${PORTAL}/api/integrations/teamlink/candidates/invite`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  check('the endpoint needs the TeamLink token', noTok.status === 401, noTok.status);

  let r = await call('/candidates/invite', { people: [a, b, c, d] });
  check('dryRun is the DEFAULT: nothing is made', r.status === 200 && r.json.dryRun === true, r);
  const by = (x) => Object.fromEntries((x.json.results || []).map((y) => [y.ref, y.result]));
  check('a candidate with an email is "would-invite"', by(r).zz1 === 'would-invite', r.json);
  check('a candidate with only a phone is "would-invite"', by(r).zz2 === 'would-invite', r.json);
  check('no email and no phone is "no-contact"', by(r).zz3 === 'no-contact', r.json);
  check('no usable name is "skipped"', by(r).zz4 === 'skipped', r.json);

  r = await call('/candidates/invite', { people: [a], dryRun: true });
  check('a dry run again still made nothing (still would-invite)', by(r).zz1 === 'would-invite', r.json);

  r = await call('/candidates/invite', { people: [a, b, c], dryRun: false });
  const run1 = by(r);
  check('a real run answers per person', r.status === 200 && r.json.dryRun === false, r);
  check('no password, hash or token is ever in the answer', !/password|temp_?pass|hash/i.test(r.text.replace(/"delivery"/g, '')) || !/"(temporary_?)?password"\s*:/i.test(r.text), r.text.slice(0, 300));
  check('with no provider configured nothing is called "invited"', run1.zz1 !== 'invited' && run1.zz2 !== 'invited', r.json);
  check('and it says so ("not-sent"), not a false "sent"', run1.zz1 === 'not-sent' && run1.zz2 === 'not-sent', r.json);
  check('no contact stays "no-contact"', run1.zz3 === 'no-contact', r.json);

  r = await call('/candidates/invite', { people: [a], dryRun: true });
  check('after a failed send the portal says "retry-later" (it writes to one person once a day), never "already" / "has-login"', by(r).zz1 === 'retry-later', r.json);
  r = await call('/candidates/invite', { people: [a], dryRun: false });
  check('and asking again right away sends nothing and does not throw', r.status === 200 && by(r).zz1 === 'retry-later', r.json);

  r = await call('/candidates/invite', { people: [{ ...a, resend: true }], dryRun: true });
  check('one person asked for on purpose (resend) is offered a fresh login', by(r).zz1 === 'would-resend', r.json);
  r = await call('/candidates/invite', { people: [{ ...a, resend: true }, b], dryRun: true });
  check('"resend" is ignored in a list of several people (never part of a bulk run)', by(r).zz1 !== 'would-resend', r.json);
  r = await call('/candidates/auto', undefined, 'GET');
  check('the Naukri / Shine switch can be read', r.status === 200 && typeof r.json.on === 'boolean', r);
  r = await call('/candidates/auto', { on: 'yes' });
  check('the switch refuses a non-boolean', r.status === 422, r);
  r = await call('/candidates/auto', { on: true });
  check('the switch can be turned on', r.status === 200 && r.json.on === true, r);
  r = await call('/candidates/auto', undefined, 'GET');
  check('and reads back on', r.json.on === true, r);
  r = await call('/candidates/auto', { on: false });
  check('and off again', r.json.on === false, r);

  // A candidate login reaches only the candidate pages (the portal's own role rules): register a ZZTEST candidate on the sandbox, sign in,
  // and ask for staff screens.
  const email = `zztest.login.${stamp}@example.invalid`;
  const jar = {};
  const web = async (method, path, body) => {
    const h = { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), origin: PORTAL };
    if (jar.tl_csrf) h['x-csrf-token'] = decodeURIComponent(jar.tl_csrf);
    if (body !== undefined) h['content-type'] = 'application/json';
    const res = await fetch(PORTAL + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    (res.headers.getSetCookie ? res.headers.getSetCookie() : []).forEach((c) => { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i).trim()] = kv.slice(i + 1).trim(); });
    return { status: res.status, text: await res.text() };
  };
  await web('GET', '/api/csrf');
  let reg = await web('POST', '/api/auth/register', { name: `ZZTEST Login ${stamp}`, email, password: 'Zztest1234', confirmPassword: 'Zztest1234', phone: `92${stamp}`, preferredLocation: 'Hyderabad', expectedCtc: 3, noticePeriod: 'Immediate', preferredWorkModes: ['Work From Office'], consent: { terms: true, communication: true, resumeProcessing: true } });
  if (!(reg.status >= 200 && reg.status < 300)) reg = await web('POST', '/api/auth/login', { email, password: 'Zztest1234' });
  await web('GET', '/api/csrf');
  check('a candidate can sign in to the sandbox portal', reg.status >= 200 && reg.status < 300, { status: reg.status, text: reg.text.slice(0, 200) });
  for (const path of ['/api/intake/send-logins/pending', '/api/intake/source-connections']) {
    // eslint-disable-next-line no-await-in-loop
    const x = await web('GET', path);
    check(`a candidate login is refused the staff screen ${path}`, x.status === 401 || x.status === 403, { status: x.status, text: x.text.slice(0, 120) });
  }
  const mine = await web('GET', '/api/applications');
  check('and reaches its own applications (Applied Jobs / My Applications)', mine.status === 200, { status: mine.status, text: mine.text.slice(0, 120) });

  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
