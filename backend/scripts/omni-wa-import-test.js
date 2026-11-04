#!/usr/bin/env node
// ---------------------------------------------------------------------------
// A WHATSAPP NUMBER CONNECTED IN OMNI-CHANNEL ALSO LANDS IN TEAMLINK (founder 2026-11-04: "whatsapp integration green start lonu cheyali
// and teamlink lo kuda undali") - COPY DATABASE ONLY, FAKE META.
//
//   cd backend
//   node scripts/omni-wa-import-test.js     makes its own VACUUM INTO copy of prisma/dev.db (opened READ-ONLY) and deletes it after
//
// Proves POST /api/omni-gs/from-omni/whatsapp-number (routes/omniWaFromOmni.js + utils/omniWaImport.js) on a throw-away express app:
//   S  only Green Start's signature (shared secret, 5 minutes) is taken: none / wrong / old -> 401, nothing added
//   A  a new number from workspace "Teamlink <Dept>" -> TeamLink's WhatsApp numbers, its own token, that department, pinned to the workspace
//      (a TeamLink number that pointed at that workspace lets go); the answer never holds the token
//   U  the same Phone number ID again (new WhatsApp Business ID) -> the row is updated, not doubled
//   M  the Main number of the WhatsApp Business form -> kept as it is
// ---------------------------------------------------------------------------
const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const BACK = path.resolve(__dirname, '..');
const REAL = path.resolve(BACK, 'prisma', 'dev.db');
const copy = path.join(os.tmpdir(), `omniwaimport-${Date.now().toString(36)}.db`);
{
  const { DatabaseSync } = require('node:sqlite');
  const src = new DatabaseSync(REAL, { readOnly: true });
  src.exec(`VACUUM INTO '${copy.split(path.sep).join('/').replace(/'/g, "''")}'`);
  src.close();
}
const DB_URL = `file:${path.resolve(copy).split(path.sep).join('/')}?socket_timeout=60`;
process.env.DATABASE_URL = DB_URL;
process.env.TEST_MODE = '1';
require(path.join(BACK, 'node_modules/dotenv')).config({ path: path.join(BACK, '.env'), override: false });
process.env.DATABASE_URL = DB_URL;
const SECRET = 'z'.repeat(48);
process.env.GREENSTART_SSO_SECRET = SECRET;
const express = require(path.join(BACK, 'node_modules/express'));
const prisma = require(path.join(BACK, 'src/db'));
const core = require(path.join(BACK, 'src/utils/messagingCore'));
const WN = require(path.join(BACK, 'src/utils/waNumbers'));
const ODL = require(path.join(BACK, 'src/utils/omniDeptLogins'));

let scheduled = 0;
ODL.schedule = () => { scheduled += 1; };
const asked = [];
core.httpJson = async (url) => { // the fake Meta: every number answers, nothing leaves this PC
  asked.push(url);
  const u = new URL(url);
  if (u.pathname.endsWith('/phone_numbers')) return { ok: true, status: 200, json: { data: [] } };
  return { ok: true, status: 200, json: { id: '1', display_phone_number: '+91 0', verified_name: 'ZZ', quality_rating: 'GREEN', code_verification_status: 'VERIFIED' } };
};

let pass = 0; let fail = 0;
const check = (n, ok, d) => { if (ok) pass += 1; else fail += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${!ok && d != null ? `  -> ${JSON.stringify(d).slice(0, 500)}` : ''}`); };
const sign = (body, t = Math.floor(Date.now() / 1000), key = SECRET) => `t=${t},v1=${crypto.createHmac('sha256', key).update(`${t}.${body}`).digest('hex')}`;

(async () => {
  const RUN = Date.now().toString(36);
  const phone = `9${String(Date.now()).slice(-11)}`;
  const made = [];
  const app = express();
  app.use(require(path.join(BACK, 'src/routes/omniWaFromOmni')));
  const server = http.createServer(app).listen(0);
  const port = server.address().port;
  const post = (obj, sig) => new Promise((resolve) => {
    const body = JSON.stringify(obj);
    const req = http.request({ host: '127.0.0.1', port, path: '/api/omni-gs/from-omni/whatsapp-number', method: 'POST', headers: { 'content-type': 'application/json', ...(sig === null ? {} : { 'x-teamlink-omni-signature': sig || sign(body) }) } }, (res) => {
      let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => resolve({ status: res.statusCode, body: d ? JSON.parse(d) : null, text: d }));
    });
    req.end(body);
  });
  try {
    await WN.ensure();
    const master = (await WN.departmentCounts()).map((d) => d.name);
    const dept = master.find((m) => /medical/i.test(m)) || master[0];
    const wsId = `zz-ws-${RUN}`;
    const otherNum = `wan_zzother${RUN}`;
    await prisma.appSetting.upsert({ where: { key: 'omni.gs.waMap' }, create: { key: 'omni.gs.waMap', value: JSON.stringify({ [otherNum]: { workspaceId: wsId, auto: true, dept } }) }, update: { value: JSON.stringify({ ...JSON.parse(((await prisma.appSetting.findUnique({ where: { key: 'omni.gs.waMap' } })) || { value: '{}' }).value), [otherNum]: { workspaceId: wsId, auto: true, dept } }) } });
    const body = { workspaceId: wsId, workspaceName: `Teamlink ${dept}`, phoneNumberId: phone, wabaId: '700000000001', displayNumber: `+91 ${phone.slice(-10)}`, verifiedName: `ZZTEST Omni ${RUN}`, accessToken: 'EAAGzztestTOKENvalue1234567890' };

    const n0 = (await WN.listRows()).length;
    const r0 = await post(body, null);
    const r1 = await post(body, sign(JSON.stringify(body), undefined, 'y'.repeat(48)));
    const r2 = await post(body, sign(JSON.stringify(body), Math.floor(Date.now() / 1000) - 3600));
    check('S no / wrong / an hour-old signature -> 401, nothing added', r0.status === 401 && r1.status === 401 && r2.status === 401 && (await WN.listRows()).length === n0, [r0.status, r1.status, r2.status]);

    const a = await post(body);
    const row = (await WN.listRows()).find((r) => String(r.phoneNumberId) === phone);
    if (row) made.push(row.id);
    check('A1 a number connected in Omni-Channel is added to TeamLink\'s WhatsApp numbers', a.status === 200 && a.body.ok && a.body.state === 'added' && !!row, a.body);
    check('A2 ... with its own token (saved, never in the answer)', row && row.tokenMode === 'own' && !a.text.includes(body.accessToken), row && row.tokenMode);
    const access = row ? await WN.accessOf(row.id) : [];
    check(`A3 ... for the workspace's department (${dept})`, a.body.department === dept && access.some((x) => x.kind === 'DEPARTMENT' && x.refId === dept), access);
    const map = JSON.parse((await prisma.appSetting.findUnique({ where: { key: 'omni.gs.waMap' } })).value);
    check('A4 ... pinned to the workspace it was connected in (a choice, not automatic)', row && map[row.id] && map[row.id].workspaceId === wsId && map[row.id].auto === false, row && map[row.id]);
    check('A5 ... the TeamLink number that pointed at that workspace let go of it', !map[otherNum], map[otherNum]);
    check('A6 ... the department logins run again', scheduled >= 1, scheduled);
    check('A7 ... plain words', /Added to TeamLink's WhatsApp numbers/.test(a.body.words), a.body.words);

    const u = await post({ ...body, wabaId: '700000000002' });
    const rows = (await WN.listRows()).filter((r) => String(r.phoneNumberId) === phone);
    check('U the same Phone number ID again: updated (new WhatsApp Business ID), not added twice', u.body.state === 'updated' && rows.length === 1 && rows[0].wabaId === '700000000002', [u.body, rows.length]);

    const main = (await WN.listRows()).find((r) => r.credSource === 'legacy');
    if (main) {
      const m = await post({ ...body, phoneNumberId: String(main.phoneNumberId), wabaId: '700000000003' });
      const after = await WN.getRowFresh(main.id);
      check('M the Main number of the WhatsApp Business form is kept as it is', m.body.state === 'kept' && String(after.wabaId || '') === String(main.wabaId || ''), m.body);
    } else console.log('SKIP  M (this copy has no Main number in the list)');

    const bad = await post({ ...body, phoneNumberId: 'abc' });
    check('V a broken body -> 400 in plain words', bad.status === 400 && /Phone number ID/.test(bad.body.error), bad.body);
  } catch (err) {
    check('no crash', false, String(err && err.stack));
  } finally {
    server.close();
    await prisma.$disconnect().catch(() => {});
    try { fs.unlinkSync(copy); } catch { /* temp */ }
    console.log(`\n${pass} passed, ${fail} failed (the copy database is deleted; prisma/dev.db was only read)`);
    process.exit(fail ? 1 : 0);
  }
})();
