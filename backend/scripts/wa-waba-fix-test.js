#!/usr/bin/env node
// ---------------------------------------------------------------------------
// WRONG WHATSAPP BUSINESS ID ON A NUMBER (founder 2026-11-03: Education - 2 sends failed with "#10 Messaging account X is not
// linked to phone number Y" while the chip said "Verification Required") - COPY DATABASE ONLY, FAKE META.
//
//   cd backend
//   node scripts/wa-waba-fix-test.js     makes its own VACUUM INTO copy of prisma/dev.db (opened READ-ONLY) and deletes it after
//
// Meta is a stub of messagingCore.httpJson: nothing leaves this PC. Proves waNumbers.wabaFix:
//   A the typed id is the number's account -> nothing changes
//   B a wrong id, the token reaches the right account -> the number's row is corrected (and logged)
//   C a wrong id, no account of the token has the number -> plain words, nothing saved
//   D the Main number from the WhatsApp Business form -> the right id is named, the form is not changed behind its back
//   E Meta does not answer -> no guess
// ---------------------------------------------------------------------------
const os = require('os');
const fs = require('fs');
const path = require('path');

const BACK = path.resolve(__dirname, '..');
const REAL = path.resolve(BACK, 'prisma', 'dev.db');
const copy = path.join(os.tmpdir(), `wabafix-${Date.now().toString(36)}.db`);
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
const prisma = require(path.join(BACK, 'src/db'));
const core = require(path.join(BACK, 'src/utils/messagingCore'));
const WN = require(path.join(BACK, 'src/utils/waNumbers'));

let pass = 0; let fail = 0;
const check = (n, ok, d) => { if (ok) pass += 1; else fail += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${!ok && d != null ? `  -> ${JSON.stringify(d).slice(0, 500)}` : ''}`); };

// the fake Meta: which account holds which phone ids, which accounts the token reaches
let accounts = {}; let reach = []; let down = false; const asked = [];
core.httpJson = async (url) => {
  asked.push(url);
  if (down) return { ok: false, status: 0, json: null };
  const u = new URL(url);
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts[1] === 'debug_token') {
    return { ok: true, status: 200, json: { data: { is_valid: true, granular_scopes: [{ scope: 'business_management', target_ids: ['B1'] }, { scope: 'whatsapp_business_messaging', target_ids: reach }, { scope: 'whatsapp_business_management', target_ids: reach }] } } };
  }
  if (parts[2] === 'phone_numbers') {
    const phones = accounts[parts[1]];
    if (!phones) return { ok: false, status: 400, json: { error: { code: 100, message: 'Unsupported get request.' } } };
    return { ok: true, status: 200, json: { data: phones.map((id) => ({ id, display_phone_number: '+91 0' })) } };
  }
  return { ok: false, status: 404, json: { error: { code: 803, message: 'unknown' } } };
};

(async () => {
  const RUN = Date.now().toString(36);
  const id = `wan_zztest${RUN}`;
  try {
    await WN.ensure();
    const t = new Date().toISOString();
    await prisma.$executeRawUnsafe('INSERT INTO "WaNumber" ("id","label","displayNumber","displayDigits","phoneNumberId","wabaId","credSource","tokenMode","active","isDefault","statusCode","createdById","createdByName","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id, 'ZZTEST Education - 2', '+919000000000', '919000000000', `P${RUN}`, 'WRONG', 'own', 'own', 1, 0, 'unchecked', null, 'ZZTEST', t, t);
    const wabaNow = async () => (await prisma.$queryRawUnsafe('SELECT "wabaId" FROM "WaNumber" WHERE "id" = ?', id))[0].wabaId;
    const cfg = (waba) => ({ base: 'https://graph.fake', token: 'tok', phoneId: `P${RUN}`, wabaId: waba });
    const row = async () => WN.getRowFresh(id);

    accounts = { RIGHT: [`P${RUN}`, 'OTHER'], WRONG: ['OTHER'], EMPTY: [] }; reach = ['WRONG', 'EMPTY', 'RIGHT'];
    const a = await WN.wabaFix(await row(), cfg('RIGHT'), null);
    check('A the typed id is the account of the number: nothing to say', a === null, a);

    const b = await WN.wabaFix(await row(), cfg('WRONG'), { id: null, name: 'ZZTEST Admin' });
    check('B a wrong id: the right account is found among the token\'s accounts', b && b.fixedTo === 'RIGHT', b);
    check('B2 ... and saved on the number', (await wabaNow()) === 'RIGHT', await wabaNow());
    check('B3 ... in plain words', b && /corrected/.test(b.text) && b.text.includes('RIGHT') && b.text.includes('WRONG'), b && b.text);
    const audit = await prisma.$queryRawUnsafe('SELECT COUNT(*) AS n FROM "AuditLog" WHERE "entityId" = ?', id).catch(() => [{ n: -1 }]);
    check('B4 ... and logged', Number(audit[0].n) >= 1, audit);

    await prisma.$executeRawUnsafe('UPDATE "WaNumber" SET "wabaId" = ? WHERE "id" = ?', 'WRONG', id); WN.bust();
    reach = ['WRONG', 'EMPTY'];
    const c = await WN.wabaFix(await row(), cfg('WRONG'), null);
    check('C no account of the token has the number: says what to do, saves nothing', c && !c.fixedTo && /WhatsApp Manager/.test(c.text) && (await wabaNow()) === 'WRONG', c);

    reach = ['RIGHT'];
    const d = await WN.wabaFix({ ...(await row()), credSource: 'legacy' }, cfg('WRONG'), null);
    check('D the Main number of the WhatsApp Business form: names the right id, changes nothing', d && !d.fixedTo && d.text.includes('RIGHT') && /Connections tab/.test(d.text) && (await wabaNow()) === 'WRONG', d);

    down = true;
    const e = await WN.wabaFix(await row(), cfg('WRONG'), null);
    check('E Meta does not answer: no guess', e === null, e);
    check('Z no request went anywhere but the fake', asked.every((x) => x.startsWith('https://graph.fake/')), asked.slice(0, 3));
  } catch (err) {
    check('no crash', false, String(err && err.stack));
  } finally {
    await prisma.$disconnect().catch(() => {});
    try { fs.unlinkSync(copy); } catch { /* temp */ }
    console.log(`\n${pass} passed, ${fail} failed (the copy database is deleted; prisma/dev.db was only read)`);
    process.exit(fail ? 1 : 0);
  }
})();
