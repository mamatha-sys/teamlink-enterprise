#!/usr/bin/env node
// ---------------------------------------------------------------------------
// LINKEDIN: ONE SIGN-IN FOR TEAMLINK, JOB POSTS AND OMNI-CHANNEL (founder 2026-11-02: "linkedin account connect cheyyi job portal,
// integrations, omnichannel anni vatiki"). NO REAL LINKEDIN, NO REAL OMNI-CHANNEL.
//   cd backend && node scripts/linkedin-omni-test.js
// Runs on its OWN copy of prisma/sandbox.db (deleted at the end), with a stub LinkedIn (www + api) and a stub Omni-Channel API on
// 127.0.0.1. The LinkedIn calls are the ones LinkedIn documents (learn.microsoft.com, 2026-10): /oauth/v2/authorization,
// /oauth/v2/accessToken, /v2/userinfo, /rest/posts (Linkedin-Version) and the Share on LinkedIn /v2/ugcPosts. Proves:
//   L1 Connect LinkedIn: the login address carries the client id, the exact redirect address, a state and ONLY openid profile w_member_social
//   L2 the callback exchanges the code (form POST with the same redirect address), reads /v2/userinfo, saves the profile as the default,
//      token encrypted, and the job-posting LinkedIn connection is filled in by itself (still OFF)
//   L3 the bridge has the default LinkedIn account for Omni-Channel (token + expiry, never TeamLink's app secret)
//   L4 Omni-Channel gets it (POST /social/linkedin/connect-token); unchanged = already the same; Omni's OWN LinkedIn is never replaced;
//      an Omni-Channel without its LinkedIn update says so plainly; an expired token is not sent
//   L5 a Company Page default sends the token + the Page (urn:li:organization:...) to Omni-Channel
//   L6 a job post: /rest/posts with Linkedin-Version 202610 and X-Restli-Protocol-Version 2.0.0, the post id comes back
//   L7 /rest/posts refused for the profile (403) -> the same text once through /v2/ugcPosts (plain text), never twice; a Page is not retried
//   L8 changing a post that LinkedIn will not let change: said in words
// ---------------------------------------------------------------------------
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const BACK = path.join(__dirname, '..');
const copy = path.join(os.tmpdir(), `tl-liomni-${Date.now()}.db`);
let pass = 0; let fail = 0;
const check = (name, ok, info) => { if (ok) { pass += 1; console.log(`  PASS ${name}`); } else { fail += 1; console.log(`  FAIL ${name}`, info === undefined ? '' : JSON.stringify(info).slice(0, 600)); } };
const TOKEN = 'AQVzzliFAKEtokenFORtheTEST-1234567890_abcdef';
const listen = (handler) => new Promise((resolve) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => resolve(s)); });
const readBody = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => resolve(b)); });

(async () => {
  const { DatabaseSync } = require('node:sqlite');
  const src = new DatabaseSync(path.join(BACK, 'prisma', 'sandbox.db'), { readOnly: true });
  src.exec(`VACUUM INTO '${copy.replace(/\\/g, '/')}'`);
  src.close();
  process.env.DATABASE_URL = `file:${copy.replace(/\\/g, '/')}`;
  process.env.TEST_MODE = '1';
  require(path.join(BACK, 'node_modules/dotenv')).config({ path: path.join(BACK, '.env'), override: false });
  process.env.DATABASE_URL = `file:${copy.replace(/\\/g, '/')}`;
  process.env.APP_BASE_URL = 'https://teamlink.zzli.example.test';
  delete process.env.LINKEDIN_CLIENT_ID; delete process.env.LINKEDIN_CLIENT_SECRET; delete process.env.TL_LINKEDIN_VERSION;
  process.env.TL_API_STRICT_LOCAL = '1';

  // stub LinkedIn: OAuth on "www", REST on "api" (one server, both bases point at it)
  const li = { seen: [], rest: 'ok', nextId: 900 };
  const lis = await listen(async (req, res) => {
    const raw = await readBody(req);
    const u = new URL(req.url, 'http://x');
    const rec = { method: req.method, path: u.pathname, headers: req.headers, raw };
    li.seen.push(rec);
    const send = (code, obj, headers = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', ...headers }); res.end(obj === null ? '' : JSON.stringify(obj)); };
    if (u.pathname === '/oauth/v2/accessToken') {
      const f = Object.fromEntries(new URLSearchParams(raw));
      rec.form = f;
      if (f.grant_type !== 'authorization_code' || f.client_id !== 'zzliClient01' || f.client_secret !== 'zzli-secret-value-01' || f.redirect_uri !== 'https://teamlink.zzli.example.test/api/public/linkedin-connect/callback') return send(401, { error: 'invalid_client', error_description: 'Client authentication failed' });
      if (f.code !== 'good-code') return send(400, { error: 'invalid_request', error_description: 'The provided authorization grant is invalid' });
      return send(200, { access_token: TOKEN, expires_in: 5184000, scope: 'openid,profile,w_member_social' });
    }
    const auth = req.headers.authorization === `Bearer ${TOKEN}`;
    if (u.pathname === '/v2/userinfo') return auth ? send(200, { sub: 'ZZli782bb', name: 'ZZTEST Vasu', given_name: 'ZZTEST', family_name: 'Vasu' }) : send(401, { message: 'Invalid access token', status: 401 });
    if (!auth) return send(401, { message: 'Invalid access token', status: 401 });
    if (u.pathname === '/rest/posts' && req.method === 'POST') {
      if (!/^\d{6}$/.test(req.headers['linkedin-version'] || '') || req.headers['x-restli-protocol-version'] !== '2.0.0') return send(400, { message: 'Missing Linkedin-Version or X-Restli-Protocol-Version header', status: 400 });
      if (li.rest === 'denied') return send(403, { message: 'Not enough permissions to access: partnerApiPostsExternal.CREATE.20261001', status: 403, serviceErrorCode: 100 });
      li.nextId += 1; return send(201, null, { 'x-restli-id': `urn:li:share:${li.nextId}` });
    }
    if (u.pathname === '/v2/ugcPosts' && req.method === 'POST') {
      if (req.headers['x-restli-protocol-version'] !== '2.0.0') return send(400, { message: 'X-Restli-Protocol-Version 2.0.0 required', status: 400 });
      li.nextId += 1; return send(201, null, { 'x-restli-id': `urn:li:ugcPost:${li.nextId}` });
    }
    if (/^\/rest\/posts\//.test(u.pathname) && req.method === 'POST') return li.rest === 'denied' ? send(403, { message: 'Not enough permissions to access: partnerApiPostsExternal.PARTIAL_UPDATE', status: 403 }) : send(204, null);
    return send(404, { message: 'unknown' });
  });
  const LIB = `http://127.0.0.1:${lis.address().port}`;
  process.env.TL_LINKEDIN_AUTH_BASE = LIB;
  process.env.TL_LINKEDIN_API_BASE = LIB;

  // stub Omni-Channel (Green Start API)
  const gs = { own: false, noUpdate: false, got: [] };
  const gss = await listen(async (req, res) => {
    const raw = await readBody(req);
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET' && req.url.startsWith('/api/v1/integrations')) return res.end(JSON.stringify(gs.own ? [{ id: 'l1', provider: 'linkedin', status: 'CONNECTED' }] : []));
    if (req.method === 'POST' && req.url === '/api/v1/social/linkedin/connect-token') {
      if (gs.noUpdate) { res.statusCode = 404; return res.end(JSON.stringify({ message: 'Cannot POST /api/v1/social/linkedin/connect-token', statusCode: 404 })); }
      gs.got.push(JSON.parse(raw || '{}')); return res.end(JSON.stringify({ connected: true }));
    }
    res.statusCode = 404; return res.end('{}');
  });
  process.env.GREENSTART_API_PORT = String(gss.address().port);

  const prisma = require(path.join(BACK, 'src/db'));
  const express = require(path.join(BACK, 'node_modules/express'));
  const LC = require(path.join(BACK, 'src/utils/linkedinConnect'));
  const SA = require(path.join(BACK, 'src/utils/socialAccounts'));
  const GI = require(path.join(BACK, 'src/utils/greenStartIntegrations'));
  const Cred = require(path.join(BACK, 'src/jobPublish/credentials'));
  const LI = require(path.join(BACK, 'src/portals/linkedinpost/LinkedInPostAdapter'));
  const app = express();
  app.use('/api/public/linkedin-connect', LC.router);
  const tls = await listen(app);
  const TLB = `http://127.0.0.1:${tls.address().port}`;
  try {
    await prisma.appSetting.deleteMany({ where: { key: { in: ['social.accounts', 'social.linkedin.app'] } } });
    await Cred.remove('linkedinpost', null).catch(() => {});
    const admin = await prisma.user.findFirst({ where: { role: { in: ['admin', 'superadmin'] } } }) || await prisma.user.findFirst();
    const fakeReq = { headers: {}, get: () => null, protocol: 'https' };

    // ---------------------------------------------------------------- L1 / L2: connect
    const saved = await LC.saveApp(admin, { clientId: 'zzliClient01', clientSecret: 'zzli-secret-value-01' });
    const view = await LC.appView(fakeReq);
    const st = await LC.start(admin, fakeReq, {});
    const url = new URL(st.url);
    check('L1 Connect LinkedIn: LinkedIn\'s own login page with the client id, the exact redirect address, a state and only the profile scopes',
      saved.ok && view.redirectUri === 'https://teamlink.zzli.example.test/api/public/linkedin-connect/callback' && !JSON.stringify(view).includes('zzli-secret')
      && url.pathname === '/oauth/v2/authorization' && url.searchParams.get('response_type') === 'code' && url.searchParams.get('client_id') === 'zzliClient01'
      && url.searchParams.get('redirect_uri') === view.redirectUri && url.searchParams.get('scope') === 'openid profile w_member_social' && !!url.searchParams.get('state'), [view, st.url]);

    const cb = await fetch(`${TLB}/api/public/linkedin-connect/callback?code=good-code&state=${encodeURIComponent(url.searchParams.get('state'))}`, { redirect: 'manual' });
    const back = cb.headers.get('location') || '';
    const tokCall = li.seen.find((x) => x.path === '/oauth/v2/accessToken');
    const acc = (await SA.list()).linkedin || [];
    const rawList = (await prisma.appSetting.findUnique({ where: { key: 'social.accounts' } })).value;
    const jp = await Cred.read('linkedinpost');
    const jpOne = await Cred.one('linkedinpost');
    check('L2 callback: code exchanged (form POST, same redirect address), /v2/userinfo read, profile saved as the default, token encrypted, job posting filled in and still OFF',
      cb.status === 302 && /\/admin\/integrations\?tab=facebook&sub=linkedin&linkedin=connected$/.test(back) && !back.includes(TOKEN)
      && tokCall && /x-www-form-urlencoded/.test(tokCall.headers['content-type']) && tokCall.form.redirect_uri === view.redirectUri
      && li.seen.some((x) => x.path === '/v2/userinfo') && acc.length === 1 && acc[0].externalId === 'urn:li:person:ZZli782bb' && acc[0].isDefault && acc[0].name === 'ZZTEST Vasu'
      && !rawList.includes(TOKEN) && jp.ok && jp.username === 'urn:li:person:ZZli782bb' && jp.password === TOKEN && jpOne.enabled === false, [cb.status, back, acc, jpOne && jpOne.status]);

    // ---------------------------------------------------------------- L3 / L4: Omni-Channel
    let want = await GI.teamlinkChannels();
    check('L3 the bridge has the default LinkedIn account for Omni-Channel: its token and expiry, no Page, no app secret',
      want.linkedin && want.linkedin.body && want.linkedin.body.accessToken === TOKEN && /^\d{4}-\d\d-\d\dT/.test(want.linkedin.body.expiresAt) && !want.linkedin.body.organization
      && !JSON.stringify(want.linkedin).includes('zzli-secret') && want.linkedin.name === 'ZZTEST Vasu', want.linkedin && { ...want.linkedin, body: Object.keys(want.linkedin.body || {}) });
    const ws = { id: 'ws-main', name: 'Main' };
    const s1 = await GI.pushOne('tok', ws, 'linkedin', want.linkedin, null, false);
    const s2 = await GI.pushOne('tok', ws, 'linkedin', want.linkedin, s1.fp, false);
    gs.own = true;
    const s3 = await GI.pushOne('tok', ws, 'linkedin', want.linkedin, null, false);
    gs.own = false; gs.noUpdate = true;
    const s4 = await GI.pushOne('tok', ws, 'linkedin', want.linkedin, null, true);
    gs.noUpdate = false;
    // an expired TeamLink sign-in: nothing is sent
    const all = await SA.readAll();
    const keepExp = all.find((a) => a.platform === 'linkedin').expiresAt;
    all.find((a) => a.platform === 'linkedin').expiresAt = new Date(Date.now() - 60000).toISOString();
    await prisma.appSetting.update({ where: { key: 'social.accounts' }, data: { value: JSON.stringify(all) } });
    const wantExp = (await GI.teamlinkChannels()).linkedin;
    all.find((a) => a.platform === 'linkedin').expiresAt = keepExp;
    await prisma.appSetting.update({ where: { key: 'social.accounts' }, data: { value: JSON.stringify(all) } });
    check('L4 Omni-Channel gets it (connect-token); unchanged = already the same; Omni\'s own LinkedIn is left alone; no LinkedIn update there = said plainly; an expired sign-in is not sent',
      s1.state === 'sent' && gs.got.length === 1 && gs.got[0].accessToken === TOKEN && !('name' in gs.got[0]) && s2.state === 'same' && s3.state === 'skipped' && /own LinkedIn connection/.test(s3.words)
      && s4.state === 'failed' && /claude\/linkedin-from-teamlink/.test(s4.words) && !!wantExp.none && /expired/.test(wantExp.none), [s1, s2, s3, s4, wantExp]);

    // ---------------------------------------------------------------- L5: a Company Page default
    const page = await SA.addLinkedin(admin, { sub: 'ZZli782bb', name: 'ZZTEST Vasu', token: TOKEN, expiresAt: keepExp, orgId: '12345678', orgName: 'ZZTEST TeamLink Consultants' });
    const pageAcc = (await SA.list()).linkedin.find((a) => a.externalId === 'urn:li:organization:12345678');
    await SA.setDefault(admin, pageAcc.id, {});
    want = await GI.teamlinkChannels();
    gs.got.length = 0;
    const s5 = await GI.pushOne('tok', ws, 'linkedin', want.linkedin, s1.fp, false);
    check('L5 a Company Page default: Omni-Channel gets the same token plus the Page (urn:li:organization:12345678)',
      page && s5.state === 'sent' && gs.got[0] && gs.got[0].accessToken === TOKEN && gs.got[0].organization && gs.got[0].organization.urn === 'urn:li:organization:12345678' && gs.got[0].organization.name === 'ZZTEST TeamLink Consultants', [s5, gs.got[0] && { ...gs.got[0], accessToken: '...' }]);

    // ---------------------------------------------------------------- L6 - L8: the job post itself
    const log = { info: async () => {}, warn: async () => {}, error: async () => {} };
    const ad = new LI({ portal: 'linkedinpost', creds: { username: 'urn:li:person:ZZli782bb', password: TOKEN }, log });
    li.seen.length = 0;
    const p1 = await ad.send('ZZTEST We are hiring a (Physics) lecturer #Hiring https://jobs.example.test/j/1?src=linkedinpost&utm_source=linkedinpost');
    const rest = li.seen.find((x) => x.path === '/rest/posts');
    const restBody = rest ? JSON.parse(rest.raw) : {};
    check('L6 job post: /rest/posts with Linkedin-Version 202610 + X-Restli-Protocol-Version 2.0.0, author = the profile, PUBLIC, PUBLISHED; the post id comes back',
      rest && rest.headers['linkedin-version'] === '202610' && rest.headers['x-restli-protocol-version'] === '2.0.0' && restBody.author === 'urn:li:person:ZZli782bb' && restBody.visibility === 'PUBLIC' && restBody.lifecycleState === 'PUBLISHED'
      && /\\\(Physics\\\)/.test(restBody.commentary) && /^urn:li:share:/.test(p1.id) && /linkedin\.com\/feed\/update\//.test(p1.url), [rest && rest.headers['linkedin-version'], restBody, p1]);

    li.rest = 'denied'; li.seen.length = 0;
    const p2 = await ad.send('ZZTEST We are hiring a (Physics) lecturer');
    const ugc = li.seen.filter((x) => x.path === '/v2/ugcPosts');
    const ugcBody = ugc[0] ? JSON.parse(ugc[0].raw) : {};
    const sc = ugcBody.specificContent && ugcBody.specificContent['com.linkedin.ugc.ShareContent'];
    check('L7 /rest/posts refused (403) for the profile -> sent ONCE through /v2/ugcPosts (Share on LinkedIn), plain text, PUBLIC; one post only',
      ugc.length === 1 && li.seen.filter((x) => x.path === '/rest/posts').length === 1 && ugcBody.author === 'urn:li:person:ZZli782bb' && ugcBody.lifecycleState === 'PUBLISHED'
      && sc && sc.shareCommentary.text === 'ZZTEST We are hiring a (Physics) lecturer' && sc.shareMediaCategory === 'NONE' && ugcBody.visibility['com.linkedin.ugc.MemberNetworkVisibility'] === 'PUBLIC'
      && /^urn:li:ugcPost:/.test(p2.id), [ugc.length, ugcBody, p2]);
    const orgAd = new LI({ portal: 'linkedinpost', creds: { username: 'urn:li:organization:12345678', password: TOKEN }, log });
    let orgErr = null; li.seen.length = 0;
    try { await orgAd.send('ZZTEST page post'); } catch (e) { orgErr = e; }
    check('L7b a Company Page refused (403) is NOT retried elsewhere: said as not allowed (needs w_organization_social / Page admin)',
      orgErr && orgErr.code === 'NOT_ADMIN' && /w_organization_social/.test(orgErr.message) && !li.seen.some((x) => x.path === '/v2/ugcPosts'), orgErr && [orgErr.code, orgErr.message]);
    let editErr = null;
    try { await ad.edit(p2.id, 'ZZTEST changed'); } catch (e) { editErr = e; }
    check('L8 changing a post LinkedIn will not let change: said in words (delete it there and post again)', editErr && /not change them/.test(editErr.message) && editErr.retryable === false, editErr && editErr.message);
    li.rest = 'ok';
  } catch (err) {
    fail += 1; console.log('  ERROR', err && err.stack);
  } finally {
    lis.close(); gss.close(); tls.close();
    await prisma.$disconnect().catch(() => {});
    for (const f of [copy, `${copy}-wal`, `${copy}-shm`, `${copy}-journal`]) { try { fs.unlinkSync(f); } catch { /* gone */ } }
    console.log(`\nLinkedIn + job posts + Omni-Channel: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
