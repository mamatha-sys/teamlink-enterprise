#!/usr/bin/env node
// ---------------------------------------------------------------------------
// WHY DOES A CANDIDATE GET "INCORRECT EMAIL OR PASSWORD" ON THE JOB PORTAL? (founder 2026-11-10: "candidate portal lo ... gmail tho login
// ayina kani eppudu invalid ani ostundi"). READ ONLY: changes nothing, sends nothing, opens no session, prints no password, hash or token.
//   cd backend && node scripts/portal-login-check.js --find=<part of the email, name or phone>
// The portal answers "Incorrect email or password." for exactly two things (api/src/auth.js login): no account with that email / phone,
// or a wrong password. This shows which one, from the portal's own database:
//   * the portal accounts (users) whose email looks like it - the exact spelling saved, role, status, last sign-in, temporary password
//   * the portal candidates whose email / name / phone looks like it, and whether they have an account at all
//   * the login messages sent to them (candidate_invites) and password-reset requests
// ---------------------------------------------------------------------------
const path = require('path');

require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({ path: path.join(__dirname, '..', '.env') });

const PORTAL = path.resolve(process.env.JOB_PORTAL_DIR || path.join(__dirname, '..', '..', 'job-portal-app', 'job_portal-main'));
const arg = (k) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : ''; };
const find = String(arg('find') || '').trim().toLowerCase();
const when = (d) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 16) : '-');

(async () => {
  if (find.length < 4) { console.log('Give at least 4 letters: --find=<part of the email, name or phone>'); process.exit(2); }
  let pg;
  try { pg = require(path.join(PORTAL, 'api', 'node_modules', 'pg')); } catch { console.log(`The Job Portal is not at ${PORTAL} (set JOB_PORTAL_DIR).`); process.exit(2); }
  // the administrator connection when there is one (the app's own login cannot read the users table: row rules)
  const url = process.env.JOBPORTAL__ADMIN_DATABASE_URL || process.env.JOBPORTAL__DATABASE_URL
    || `postgres://postgres:postgres@127.0.0.1:${process.env.JOB_PORTAL_PG_PORT || 5434}/postgres`;
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 8000, query_timeout: 15000 });
  try { await c.connect(); } catch (e) { console.log('Could not open the Job Portal database:', e.message); process.exit(1); }
  const like = `%${find.replace(/[%_]/g, '')}%`;
  const digits = find.replace(/\D/g, '');
  const q = async (sql, p) => (await c.query(sql, p)).rows;
  try {
    await c.query('begin read only');
    const users = await q(`select u.id, u.email, u.role, u.status, u.created_at, u.last_login_at,
        (select max(s.created_at) from sessions s where s.user_id = u.id) as last_session,
        (select count(*) from password_resets r where r.user_id = u.id) as resets,
        (select max(r.created_at) from password_resets r where r.user_id = u.id) as last_reset
      from users u where lower(u.email) like $1 order by u.created_at`, [like]);
    let mustChange = new Map();
    try { mustChange = new Map((await q('select id, must_change_password from users where lower(email) like $1', [like])).map((r) => [r.id, r.must_change_password])); } catch { /* an older portal */ }
    console.log(`\nPORTAL ACCOUNTS (users) with "${find}" in the email: ${users.length}`);
    users.forEach((u) => console.log(`  "${u.email}"  role=${u.role}  status=${u.status}  made=${when(u.created_at)}  last sign-in=${when(u.last_login_at || u.last_session)}`
      + `  temporary password=${mustChange.get(u.id) ? 'yes (never changed)' : 'no'}  reset requests=${u.resets}${u.last_reset ? ` (last ${when(u.last_reset)})` : ''}`));

    const cands = await q(`select c.id, c.name, c.email, c.phone, c.user_id, c.created_at, u.email as login_email, u.status as login_status
      from candidates c left join users u on u.id = c.user_id
      where lower(coalesce(c.email,'')) like $1 or lower(c.name) like $1 ${digits.length >= 6 ? "or regexp_replace(coalesce(c.phone,''), '\\D', '', 'g') like $2" : ''}
      order by c.created_at limit 20`, digits.length >= 6 ? [like, `%${digits}%`] : [like]);
    console.log(`\nPORTAL CANDIDATES with "${find}" in the email, name${digits.length >= 6 ? ' or phone' : ''}: ${cands.length}`);
    for (const k of cands) {
      console.log(`  ${k.id}  ${k.name}  email="${k.email}"  phone=${k.phone || '-'}  made=${when(k.created_at)}`
        + `  login=${k.user_id ? `"${k.login_email}" (${k.login_status})` : 'NONE - this candidate has no portal account'}`);
      const inv = await q('select channel, status, to_address, provider, error, created_at from candidate_invites where candidate_id = $1 order by created_at desc limit 6', [k.id]).catch(() => []); // eslint-disable-line no-await-in-loop
      inv.forEach((i) => console.log(`      login message: ${when(i.created_at)} ${i.channel} -> ${i.to_address || '-'}  ${i.status}${i.provider ? ` via ${i.provider}` : ''}${i.error ? `  (${String(i.error).slice(0, 120)})` : ''}`));
      if (!inv.length) console.log('      login message: none was ever sent');
    }

    console.log('\nWHAT IT MEANS');
    if (!users.length && !cands.length) console.log('  Nothing in the Job Portal looks like this. There is no account: the candidate has to Register first (or be added and sent a login).');
    if (!users.length && cands.length) console.log('  The candidate exists but has NO portal account, so every sign-in says "Incorrect email or password". Register with this email, or send the login from TeamLink.');
    users.forEach((u) => {
      if (u.status !== 'active') console.log(`  "${u.email}" is ${u.status}: the portal says "not active", not "incorrect".`);
      else if (mustChange.get(u.id)) console.log(`  "${u.email}" has an account with a TEMPORARY password that was sent by message (see above) and never used. Use that one, or Forgot password.`);
      else console.log(`  "${u.email}" has an active account: "Incorrect" means the password typed is not this account's password. Use Forgot password, and check the email is typed exactly as shown above.`);
    });
    if (users.length && !users.some((u) => u.email.toLowerCase().includes('@gmail.com'))) console.log('  None of these is a @gmail.com address: check the spelling saved above (for example gamil / gmial).');
    await c.query('rollback');
  } catch (e) {
    console.log('The check failed:', e.message);
    process.exitCode = 1;
  } finally { await c.end().catch(() => {}); }
})();
