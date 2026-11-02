#!/usr/bin/env node
// ---------------------------------------------------------------------------
// X (TWITTER) IN TEAMLINK AND OMNI-CHANNEL (founder 2026-11-02: "x kuda automatic cheyyi"). NO REAL X, NO REAL OMNI-CHANNEL.
//   cd backend && node scripts/x-omni-test.js
// Runs on its OWN copy of prisma/dev.db (deleted at the end), with a stub X API and a stub Omni-Channel API on 127.0.0.1. Proves:
//   X1 the key signer matches X's own published example          X2 keys that are not keys are refused before X is asked
//   X3 Connect X: the stub X checks the OAuth 1.0a signature and answers the account; it is saved, is the default, keys encrypted
//   X4 keys X refuses: plain message, nothing saved                X5 the bridge has the default X account's keys for Omni-Channel
//   X6 Omni-Channel gets them (POST /social/twitter/connect-keys); unchanged = "already the same"; Omni's OWN X is never replaced;
//      an Omni-Channel without its X update says so plainly
// ---------------------------------------------------------------------------
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const BACK = path.join(__dirname, '..');
const copy = path.join(os.tmpdir(), `tl-xomni-${Date.now()}.db`);
let pass = 0; let fail = 0;
const check = (name, ok, info) => { if (ok) { pass += 1; console.log(`  PASS ${name}`); } else { fail += 1; console.log(`  FAIL ${name}`, info === undefined ? '' : JSON.stringify(info).slice(0, 500)); } };
const KEYS = { apiKey: 'zzApiKey00001', apiSecret: 'zzApiSecret00001', accessToken: '777-zzAccessToken01', accessSecret: 'zzAccessSecret0001' };
const listen = (handler) => new Promise((resolve) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => resolve(s)); });

(async () => {
  const { DatabaseSync } = require('node:sqlite');
  const src = new DatabaseSync(path.join(BACK, 'prisma', 'dev.db'), { readOnly: true });
  src.exec(`VACUUM INTO '${copy.replace(/\\/g, '/')}'`);
  src.close();
  process.env.DATABASE_URL = `file:${copy.replace(/\\/g, '/')}`;
  process.env.TEST_MODE = '1';
  require(path.join(BACK, 'node_modules/dotenv')).config({ path: path.join(BACK, '.env'), override: false });
  process.env.DATABASE_URL = `file:${copy.replace(/\\/g, '/')}`;
  const XK = require(path.join(BACK, 'src/utils/xKeys'));

  // stub X: verifies the OAuth 1.0a signature with the known keys
  const xSeen = [];
  const xs = await listen((req, res) => {
    const auth = String(req.headers.authorization || '');
    const p = {}; auth.replace(/^OAuth /, '').split(', ').forEach((kv) => { const m = /^([^=]+)="(.*)"$/.exec(kv); if (m) p[decodeURIComponent(m[1])] = decodeURIComponent(m[2]); });
    const url = `http://127.0.0.1:${xs.address().port}${req.url}`;
    const expect = /oauth_signature="([^"]+)"/.exec(XK.oauth1Header(KEYS, req.method, url, {}, { nonce: p.oauth_nonce, timestamp: p.oauth_timestamp }));
    const good = expect && p.oauth_signature === decodeURIComponent(expect[1]) && p.oauth_consumer_key === KEYS.apiKey;
    xSeen.push({ path: req.url, good });
    res.setHeader('content-type', 'application/json');
    if (!good) { res.statusCode = 401; return res.end(JSON.stringify({ title: 'Unauthorized', detail: 'Unauthorized', status: 401 })); }
    return res.end(JSON.stringify({ data: { id: '777', username: 'teamlink_x', name: 'TeamLink X' } }));
  });
  process.env.TL_X_API_BASE = `http://127.0.0.1:${xs.address().port}/2`;

  // stub Omni-Channel (Green Start API)
  const gs = { own: false, noUpdate: false, got: [] };
  const gss = await listen((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.method === 'GET' && req.url.startsWith('/api/v1/integrations')) return res.end(JSON.stringify(gs.own ? [{ id: 'x1', provider: 'twitter', status: 'CONNECTED' }] : []));
      if (req.method === 'POST' && req.url === '/api/v1/social/twitter/connect-keys') {
        if (gs.noUpdate) { res.statusCode = 404; return res.end(JSON.stringify({ message: 'Cannot POST /api/v1/social/twitter/connect-keys', statusCode: 404 })); }
        gs.got.push(JSON.parse(body || '{}')); return res.end(JSON.stringify({ connected: true }));
      }
      res.statusCode = 404; return res.end('{}');
    });
  });
  process.env.GREENSTART_API_PORT = String(gss.address().port);

  const prisma = require(path.join(BACK, 'src/db'));
  const SA = require(path.join(BACK, 'src/utils/socialAccounts'));
  const GI = require(path.join(BACK, 'src/utils/greenStartIntegrations'));
  const user = { id: null, name: 'ZZTEST X' };
  try {
    const h = XK.oauth1Header({ apiKey: 'xvz1evFS4wEEPTGEFPHBog', apiSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw', accessToken: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb', accessSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE' },
      'POST', 'https://api.twitter.com/1.1/statuses/update.json?include_entities=true', { status: 'Hello Ladies + Gentlemen, a signed OAuth request!' }, { nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg', timestamp: '1318622958' });
    check('X1 the key signer matches X\'s own published example', h.includes('oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"'), h);

    const bad = await SA.addX(user, { ...KEYS, apiSecret: 'short' });
    check('X2 a key that is not a key is refused before X is asked', bad.status === 400 && bad.field === 'apiSecret' && xSeen.length === 0, bad);

    const before = await prisma.appSetting.findUnique({ where: { key: 'social.accounts' } });
    const r = await SA.addX(user, KEYS);
    const raw = (await prisma.appSetting.findUnique({ where: { key: 'social.accounts' } })).value;
    const xs1 = (await SA.list()).x;
    check('X3 Connect X: X accepted the signed request; @teamlink_x saved as the default; the keys are not stored in plain text', r.ok && xSeen.at(-1).good && xs1.length === 1 && xs1[0].name === '@teamlink_x' && xs1[0].isDefault && !raw.includes(KEYS.accessSecret) && !raw.includes(KEYS.apiSecret), [r, xSeen.at(-1), xs1]);

    const wrong = await SA.addX(user, { ...KEYS, accessSecret: 'zzWrongSecret000' });
    check('X4 keys X refuses: plain message, no second account', wrong.status === 422 && /X did not accept these keys/.test(wrong.error) && (await SA.list()).x.length === 1, wrong);

    const want = await GI.teamlinkChannels();
    check('X5 the bridge has the default X account\'s four keys for Omni-Channel', want.x && want.x.body && want.x.body.accessSecret === KEYS.accessSecret && want.x.name === '@teamlink_x', want.x && Object.keys(want.x));

    const ws = { id: 'ws-main', name: 'Main' };
    const s1 = await GI.pushOne('tok', ws, 'x', want.x, null, false);
    const s2 = await GI.pushOne('tok', ws, 'x', want.x, s1.fp, false);
    gs.own = true;
    const s3 = await GI.pushOne('tok', ws, 'x', want.x, null, false);
    gs.own = false; gs.noUpdate = true;
    const s4 = await GI.pushOne('tok', ws, 'x', want.x, null, true);
    check('X6 Omni-Channel gets the keys; unchanged = already the same; Omni\'s own X is left alone; no X update there = said plainly',
      s1.state === 'sent' && gs.got.length === 1 && gs.got[0].accessToken === KEYS.accessToken && !('name' in gs.got[0]) && s2.state === 'same' && s3.state === 'skipped' && /own X connection/.test(s3.words) && s4.state === 'failed' && /X update/.test(s4.words), [s1, s2, s3, s4, gs.got.length]);
    if (before) await prisma.appSetting.update({ where: { key: 'social.accounts' }, data: { value: before.value } }); else await prisma.appSetting.delete({ where: { key: 'social.accounts' } }).catch(() => {});
  } catch (err) {
    fail += 1; console.log('  ERROR', err && err.stack);
  } finally {
    xs.close(); gss.close();
    await prisma.$disconnect().catch(() => {});
    for (const f of [copy, `${copy}-wal`, `${copy}-shm`, `${copy}-journal`]) { try { fs.unlinkSync(f); } catch { /* gone */ } }
    console.log(`\nX + Omni-Channel: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
