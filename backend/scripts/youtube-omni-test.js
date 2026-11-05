#!/usr/bin/env node
// ---------------------------------------------------------------------------
// YOUTUBE IN TEAMLINK AND OMNI-CHANNEL (founder 2026-11-05: "youtube kuda connect cheyyi ... greenstart ki"). NO REAL GOOGLE, NO REAL OMNI-CHANNEL.
//   cd backend && node scripts/youtube-omni-test.js
// Runs on its OWN copy of prisma/dev.db (deleted at the end), with a stub Omni-Channel API on 127.0.0.1. Proves:
//   Y1 nothing connected: the bridge says so                          Y2 the default channel + TeamLink's Google app reach the bridge
//   Y3 a one-hour sign-in is not handed over, in plain words          Y4 Omni-Channel gets refresh token + app; unchanged = already the same;
//      Omni's OWN YouTube is never replaced; an Omni-Channel without its YouTube update says so plainly
// ---------------------------------------------------------------------------
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const BACK = path.join(__dirname, '..');
const copy = path.join(os.tmpdir(), `tl-ytomni-${Date.now()}.db`);
let pass = 0; let fail = 0;
const check = (name, ok, info) => { if (ok) { pass += 1; console.log(`  PASS ${name}`); } else { fail += 1; console.log(`  FAIL ${name}`, info === undefined ? '' : JSON.stringify(info)); } };
const listen = (handler) => new Promise((resolve) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => resolve(s)); });

(async () => {
  const { DatabaseSync } = require('node:sqlite');
  const src = new DatabaseSync(process.env.TL_TEST_DB || path.join(BACK, 'prisma', 'dev.db'), { readOnly: true });
  src.exec(`VACUUM INTO '${copy.replace(/\\/g, '/')}'`);
  src.close();
  process.env.DATABASE_URL = `file:${copy.replace(/\\/g, '/')}`;
  process.env.TEST_MODE = '1';
  require(path.join(BACK, 'node_modules/dotenv')).config({ path: path.join(BACK, '.env'), override: false });
  process.env.DATABASE_URL = `file:${copy.replace(/\\/g, '/')}`;
  process.env.YOUTUBE_CLIENT_ID = 'zz-google-client.apps.googleusercontent.com';
  process.env.YOUTUBE_CLIENT_SECRET = 'zz-google-secret-0001';

  // stub Omni-Channel (Green Start API)
  const gs = { own: false, noUpdate: false, got: [] };
  const gss = await listen((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.method === 'GET' && req.url.startsWith('/api/v1/integrations')) return res.end(JSON.stringify(gs.own ? [{ id: 'y1', provider: 'youtube', status: 'CONNECTED' }] : []));
      if (req.method === 'POST' && req.url === '/api/v1/social/youtube/connect-token') {
        if (gs.noUpdate) { res.statusCode = 404; return res.end(JSON.stringify({ message: 'Cannot POST /api/v1/social/youtube/connect-token', statusCode: 404 })); }
        gs.got.push(JSON.parse(body || '{}')); return res.end(JSON.stringify({ connected: true }));
      }
      res.statusCode = 404; return res.end('{}');
    });
  });
  process.env.GREENSTART_API_PORT = String(gss.address().port);

  const prisma = require(path.join(BACK, 'src/db'));
  const SA = require(path.join(BACK, 'src/utils/socialAccounts'));
  const GI = require(path.join(BACK, 'src/utils/greenStartIntegrations'));
  const user = { id: null, name: 'ZZTEST YouTube' };
  try {
    await prisma.appSetting.deleteMany({ where: { key: { in: ['social.accounts', 'social.youtube.app'] } } });
    const none = await GI.teamlinkChannels();
    check('Y1 nothing connected: the bridge says so', /not connected in TeamLink/.test((none.youtube || {}).none || ''), none.youtube);

    await SA.addYoutube(user, [{ id: 'UCzzshort', title: 'ZZTEST Short', handle: '@zzshort' }], { accessToken: 'zz-access-only', expiresIn: 3600 });
    const short = await GI.teamlinkChannels();
    check('Y3 a one-hour sign-in is not handed over, in plain words', /one-hour sign-in/.test((short.youtube || {}).none || '') && !short.youtube.body, short.youtube);

    await prisma.appSetting.deleteMany({ where: { key: 'social.accounts' } });
    await SA.addYoutube(user, [{ id: 'UCzzlast', title: 'ZZTEST Channel', handle: '@zzchannel' }], { refreshToken: 'zz-refresh-token-0001' });
    const want = await GI.teamlinkChannels();
    const b = (want.youtube || {}).body || {};
    check('Y2 the default channel + TeamLink\'s Google app reach the bridge', b.refreshToken === 'zz-refresh-token-0001' && b.clientId === process.env.YOUTUBE_CLIENT_ID && b.clientSecret === process.env.YOUTUBE_CLIENT_SECRET && want.youtube.name === 'ZZTEST Channel', want.youtube && Object.keys(want.youtube));

    const ws = { id: 'ws-main', name: 'Main' };
    const s1 = await GI.pushOne('tok', ws, 'youtube', want.youtube, null, false);
    const s2 = await GI.pushOne('tok', ws, 'youtube', want.youtube, s1.fp, false);
    gs.own = true;
    const s3 = await GI.pushOne('tok', ws, 'youtube', want.youtube, null, false);
    gs.own = false; gs.noUpdate = true;
    const s4 = await GI.pushOne('tok', ws, 'youtube', want.youtube, null, true);
    check('Y4 Omni-Channel gets it; unchanged = already the same; Omni\'s own YouTube is left alone; no update there = said plainly',
      s1.state === 'sent' && gs.got.length === 1 && gs.got[0].refreshToken === b.refreshToken && Object.keys(gs.got[0]).sort().join() === 'clientId,clientSecret,refreshToken'
      && s2.state === 'same' && s3.state === 'skipped' && /own YouTube connection/.test(s3.words) && s4.state === 'failed' && /YouTube update is not installed/.test(s4.words), { s1, s2, s3, s4 });
  } catch (err) {
    fail += 1; console.log('  ERROR', err && err.stack);
  } finally {
    gss.close();
    await prisma.$disconnect().catch(() => {});
    for (const f of [copy, `${copy}-wal`, `${copy}-shm`, `${copy}-journal`]) { try { fs.unlinkSync(f); } catch { /* gone */ } }
    console.log(`\nYouTube + Omni-Channel: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
