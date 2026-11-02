#!/usr/bin/env node
// ---------------------------------------------------------------------------
// A DEAD WHATSAPP TOKEN SHOWS ON TEAMLINK'S CARD (founder 2026-11-02: "omni channel lo whatsapp connect avvatledu"). NO SERVER NEEDED.
//   cd backend && node scripts/omni-wa-token-state-test.js
// Runs on its OWN copy of prisma/dev.db (deleted at the end). The Omni-Channel sync failed on this PC because Meta refused TeamLink's
// WhatsApp token ("Error validating access token: the session is invalid because the user logged out") while TeamLink's card still said
// "Connected". Proves: Meta's dead-token words are recognised (and other failures are not), and the card turns "Token rejected by Meta"
// with the reason - the token itself is never changed.
// ---------------------------------------------------------------------------
const fs = require('fs');
const os = require('os');
const path = require('path');

const BACK = path.join(__dirname, '..');
const copy = path.join(os.tmpdir(), `tl-watoken-${Date.now()}.db`);
let pass = 0; let fail = 0;
const check = (name, ok, info) => { if (ok) { pass += 1; console.log(`  PASS ${name}`); } else { fail += 1; console.log(`  FAIL ${name}`, info === undefined ? '' : JSON.stringify(info).slice(0, 400)); } };

(async () => {
  const { DatabaseSync } = require('node:sqlite');
  const src = new DatabaseSync(path.join(BACK, 'prisma', 'dev.db'), { readOnly: true });
  src.exec(`VACUUM INTO '${copy.replace(/\\/g, '/')}'`);
  src.close();
  process.env.DATABASE_URL = `file:${copy.replace(/\\/g, '/')}`;
  process.env.TEST_MODE = '1';
  const prisma = require(path.join(BACK, 'src/db'));
  const GI = require(path.join(BACK, 'src/utils/greenStartIntegrations'));
  try {
    const dead = ['Error validating access token: The session is invalid because the user logged out.', 'WhatsApp HTTP 401 (190): Access token (Error validating access token: has expired)', 'Access token rejected (expired or invalid).'];
    const alive = ['Omni-Channel answered 500', 'Invalid phone number id', 'One WhatsApp number can belong to one workspace only'];
    check('W1 Meta\'s dead-token words are recognised; other failures are not', dead.every((s) => GI.TOKEN_DEAD.test(s)) && alive.every((s) => !GI.TOKEN_DEAD.test(s)));
    await prisma.integration.upsert({ where: { id: 'whatsapp' }, update: { state: 'Connected', error: null }, create: { id: 'whatsapp', enabled: true, connected: true, state: 'Connected' } });
    const before = await prisma.integration.findUnique({ where: { id: 'whatsapp' } });
    await GI.markWhatsappTokenRejected(dead[0]);
    const after = await prisma.integration.findUnique({ where: { id: 'whatsapp' } });
    check('W2 the WhatsApp card turns "Token rejected by Meta" with Meta\'s reason and what to do', after.state === 'Token rejected by Meta' && /logged out/.test(after.error || '') && /new permanent token/.test(after.error || ''), after);
    check('W3 the saved WhatsApp settings (the token) are not touched', after.values === before.values, null);
  } catch (err) {
    fail += 1; console.log('  ERROR', err && err.stack);
  } finally {
    await prisma.$disconnect().catch(() => {});
    for (const f of [copy, `${copy}-wal`, `${copy}-shm`, `${copy}-journal`]) { try { fs.unlinkSync(f); } catch { /* gone */ } }
    console.log(`\nWhatsApp token state: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
