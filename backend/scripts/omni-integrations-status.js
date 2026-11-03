#!/usr/bin/env node
// ---------------------------------------------------------------------------
// ARE ALL TEAMLINK INTEGRATIONS IN OMNI-CHANNEL? (founder 2026-11-02: "live lo undali anni accounts and social media integrations").
//   cd backend && node scripts/omni-integrations-status.js            what TeamLink has + the last hand-over to Omni-Channel (read only)
//   cd backend && node scripts/omni-integrations-status.js --sync     ... and hand everything over to Omni-Channel again now, then show it
// Runs on the server it is started on (the live server via .\check-omni-integrations-on-vps.ps1). Never prints a token, key or password:
// only names, states and Omni-Channel's own words. --sync is the same as "Send to Omni-Channel now" in Administration > Integrations.
// ---------------------------------------------------------------------------
const path = require('path');

const BACK = path.join(__dirname, '..');
require(path.join(BACK, 'node_modules/dotenv')).config({ path: path.join(BACK, '.env') });
const prisma = require(path.join(BACK, 'src/db'));
const GI = require(path.join(BACK, 'src/utils/greenStartIntegrations'));
const SA = require(path.join(BACK, 'src/utils/socialAccounts'));

const line = (s = '') => console.log(s);
const when = (t) => (t ? new Date(t).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '-');

(async () => {
  const doSync = process.argv.includes('--sync');
  line('=== TEAMLINK: what is connected here (Administration > Integrations) ===');
  const rows = await prisma.integration.findMany({ where: { id: { in: ['email', 'sms', 'whatsapp', 'social'] } }, select: { id: true, state: true, connected: true, lastTestResult: true } });
  for (const id of ['email', 'sms', 'whatsapp', 'social']) {
    const r = rows.find((x) => x.id === id);
    line(`  ${id.padEnd(9)} ${r ? `${r.state}${r.connected ? '' : ' (not connected)'}` : 'not set up'}${r && r.lastTestResult ? ` | last test: ${String(r.lastTestResult).replace(/EAA[A-Za-z0-9]+/g, '...').slice(0, 110)}` : ''}`);
  }
  const accounts = await SA.list().catch(() => ({}));
  line('  Social Media accounts (* = default, the one Omni-Channel gets):');
  let any = false;
  for (const [platform, list] of Object.entries(accounts)) {
    if (!list || !list.length) continue;
    any = true;
    line(`    ${platform.padEnd(9)} ${list.map((a) => `${a.isDefault ? '*' : ''}${a.name} [${a.status}]`).join(', ')}`);
  }
  if (!any) line('    none connected');
  const want = await GI.teamlinkChannels().catch((e) => ({ error: e.message }));
  line('  Ready to give to Omni-Channel:');
  for (const [ch, w] of Object.entries(want)) line(`    ${ch.padEnd(9)} ${w && w.body ? 'yes' : `no - ${w && w.none ? w.none : String(w)}`}`);

  if (doSync) {
    line('\n... handing everything to Omni-Channel now (same as "Send to Omni-Channel now") ...');
    await GI.sync({ force: true, why: 'check script', by: 'check-omni-integrations script' }).catch((e) => line(`  sync stopped: ${e.message}`));
  }
  const last = await GI.lastResult();
  line('\n=== OMNI-CHANNEL: the last hand-over ===');
  if (!last) line('  never sent yet');
  else {
    line(`  ${when(last.at)} (${last.why || '-'}) to the account ${last.account || '-'}: ${last.ok ? 'OK' : 'NOT everything'}`);
    line(`  ${last.words}`);
    for (const ws of last.workspaces || []) {
      line(`  workspace "${ws.name}"${ws.main ? ' (main)' : ''}:`);
      for (const [ch, c] of Object.entries(ws.channels || {})) line(`    ${ch.padEnd(9)} ${String(c.state).padEnd(8)} ${String(c.words || '').slice(0, 160)}`);
    }
  }
  const fwd = await require(path.join(BACK, 'src/utils/greenStartWaForward')).last(); // eslint-disable-line global-require
  line('\n=== WHATSAPP REPLIES -> OMNI-CHANNEL (the last call TeamLink handed on) ===');
  line(fwd ? `  ${when(fwd.at)}: ${fwd.ok ? `OK (${fwd.status})` : `NOT taken - ${fwd.error || fwd.status}`} | signed with ${fwd.signedBy}` : '  none yet (run .\\link-whatsapp-replies-omni-on-vps.ps1 once)');
  try {
    const conns = await GI.connections();
    line('\n=== OMNI-CHANNEL: what it shows as connected right now ===');
    for (const ws of conns.workspaces || conns || []) {
      line(`  "${ws.name}": ${(ws.items || []).map((i) => `${i.provider}${i.account ? ` (${i.account})` : ''} ${i.status}`).join(' | ') || 'nothing connected'}`);
    }
  } catch (e) { line(`\n(Omni-Channel's own list could not be read: ${e.message})`); }
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e.message); await prisma.$disconnect(); process.exit(1); });
