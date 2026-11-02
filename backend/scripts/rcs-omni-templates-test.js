#!/usr/bin/env node
// ---------------------------------------------------------------------------
// RCS TEMPLATES FROM OMNI-CHANNEL (utils/rcsOmniSync.js, routes/rcs.js /templates/omni, routes/rcsWebhook.js hand-off). SANDBOX ONLY.
// Green Start is a small local stub on 127.0.0.1 that answers in its own shapes ({success, data}, the template wire form with
// rcsCarrier). Neither Green Start nor rcssms.in is ever called.
//
// Start the sandbox API with the stub's address:
//   cd backend
//   GREENSTART_API_PORT=47312 GREENSTART_SSO_SECRET=zz-sso-secret-0123456789abcdef0123456789 GREENSTART_SSO_EMAIL=zz-company@example.test \
//   GREENSTART_RCS_WEBHOOK_SECRET=zz-gs-rcs-hook-secret RCS_WEBHOOK_SECRET=zz-hook-secret RCS_OMNI_PULL_DELAY_MS=500 TEST_MOCK_PORTS=47312 \
//   npm run sandbox -- --restart --detach --no-watch
//   TL_API=http://localhost:4011 node scripts/rcs-omni-templates-test.js
// ---------------------------------------------------------------------------
const http = require('http');
const path = require('path');
const Z = require('./lib/zzfix')('RCSOMNI');

const PORT = Number(process.env.RCS_OMNI_STUB_PORT) || 47312;
const HOOK = 'zz-hook-secret'; const GS_HOOK = 'zz-gs-rcs-hook-secret'; const GS_TOKEN = 'zz-gs-access-token-9';
const GOT = [];
let DOWN = false;
const card = (vars, url = 0) => ({ variables: vars, urlButtons: url });
const TPLS = [
  { id: 'gs-1', name: 'ZZTEST RCSOMNI approved', status: 'approved', category: 'marketing', providerTemplateId: 'ZZOMNI1',
    rcsCarrier: { templateId: 'ZZOMNI1', kind: 'basic', source: 'designed', carrierStatus: 'APPROVED', statusAt: '2026-10-31T10:00:00.000Z', shape: { kind: 'basic', cards: [card(['var1', 'var2'])] }, design: { text: 'Hi {#var1#}, job at {#var2#}' } } },
  { id: 'gs-2', name: 'ZZTEST RCSOMNI waiting', status: 'pending', providerTemplateId: 'ZZOMNI2',
    rcsCarrier: { templateId: 'ZZOMNI2', kind: 'rich', source: 'designed', carrierStatus: 'PENDING', shape: { kind: 'rich', dynamicImage: true, cards: [card(['var1'], 1)] }, design: { cards: [{ description: 'Card {#var1#}' }] } } },
  { id: 'gs-3', name: 'ZZTEST RCSOMNI draft', status: 'draft', rcsCarrier: { kind: 'carousel', shape: { kind: 'carousel', cards: [card([]), card([])] } } },
  { id: 'gs-4', name: 'ZZTEST RCSOMNI same id as TeamLink', status: 'approved', providerTemplateId: 'ZZOWN1', rcsCarrier: { templateId: 'ZZOWN1', kind: 'basic', shape: { kind: 'basic', cards: [card([])] } } },
];
const stub = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    GOT.push({ method: req.method, url: req.url, headers: req.headers, raw });
    const json = (o, st = 200) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    const u = new URL(req.url, 'http://x');
    if (u.pathname.startsWith('/api/v1/webhooks/smstake-rcs/')) {
      if (decodeURIComponent(u.pathname.split('/').pop()) !== GS_HOOK) return json({ message: 'Unauthorized' }, 401);
      res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('OK');
    }
    if (DOWN) return json({ success: false, error: { message: 'zz down' } }, 503);
    if (u.pathname === '/api/v1/auth/teamlink' && req.method === 'POST') return /"ticket":"[^"]+"/.test(raw) ? json({ success: true, data: { accessToken: GS_TOKEN } }) : json({ message: 'no ticket' }, 400);
    if (req.headers.authorization !== `Bearer ${GS_TOKEN}`) return json({ message: 'Unauthorized' }, 401);
    if (u.pathname === '/api/v1/workspaces') return json({ success: true, data: [{ id: 'zz-ws-1', name: 'ZZTEST Main' }] });
    if (u.pathname === '/api/v1/templates') {
      if (u.searchParams.get('channel') !== 'rcs' || req.headers['x-workspace-id'] !== 'zz-ws-1') return json({ success: true, data: { items: [] } });
      return json({ success: true, data: { items: Number(u.searchParams.get('page')) > 1 ? [] : TPLS, page: 1, pageSize: 100 } });
    }
    return json({ message: 'not here' }, 404);
  });
});
const until = async (fn, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 200)); } };
const hooks = (from) => GOT.slice(from).filter((g) => g.url.startsWith('/api/v1/webhooks/'));

(async () => {
  const { prisma } = Z;
  const START = new Date();
  await new Promise((r) => stub.listen(PORT, '127.0.0.1', r));
  const realFetch = globalThis.fetch;
  globalThis.fetch = (u, o) => { const h = new URL(String(u)).hostname; if (!['127.0.0.1', 'localhost'].includes(h)) throw new Error(`blocked ${h}`); return realFetch(u, o); };
  const KEYS = ['rcs.omniSync', 'rcs.omniForward', 'rcs.omniRemoved', 'rcs.webhook.raw'];
  const saved = await prisma.appSetting.findMany({ where: { key: { in: KEYS } } });
  await prisma.appSetting.deleteMany({ where: { key: { in: KEYS } } });
  const IDS = ['ZZOMNI1', 'ZZOMNI1B', 'ZZOMNI2', 'ZZOWN1'];
  try {
    await Z.preclean();
    await prisma.rcsTemplate.deleteMany({ where: { templateId: { in: IDS } } });
    // ======================= C. in this process =======================
    const O = require(path.join(Z.BACK, 'src/utils/rcsOmniSync'));
    const ws = { id: 'zz-ws-1', name: 'ZZTEST Main' };
    const r1 = O.rowOf(TPLS[0], ws); const r2 = O.rowOf(TPLS[1], ws);
    Z.check('C1 an Omni-Channel template -> TeamLink fields: id, type, status, blanks, button / image given at sending; a draft (no rcssms.in id) is left out',
      r1.templateId === 'ZZOMNI1' && r1.rcsType === 'BASIC' && r1.status === 'APPROVED' && r1.body.varCount === 2 && r1.body.source === 'omnichannel' && r1.body.description === 'Hi {#var1#}, job at {#var2#}'
      && r2.rcsType === 'RICH' && r2.status === 'PENDING' && r2.body.buttonLink && r2.body.imageLink && O.rowOf(TPLS[2], ws) === null
      && O.rowOf({ ...TPLS[0], status: 'in_review' }, ws).status === 'PENDING' && O.rowOf({ ...TPLS[0], status: 'rejected' }, ws).status === 'REJECTED', [r1, r2]);
    Object.assign(process.env, { GREENSTART_API_PORT: String(PORT), GREENSTART_ENABLED: 'true', GREENSTART_RCS_WEBHOOK_SECRET: 'zz-wrong-secret' });
    let g0 = GOT.length;
    const fw = await O.forward({ method: 'POST', raw: '{"templateid":"x","status":"APPROVED"}', contentType: 'application/json' });
    Z.check('C2 hand-off with a secret Omni-Channel does not know: refused, and the words say which setting is wrong', !fw.ok && fw.status === 401 && /GREENSTART_RCS_WEBHOOK_SECRET/.test(fw.error) && hooks(g0).length === 1, fw);
    process.env.GREENSTART_RCS_WEBHOOK_SECRET = '';
    g0 = GOT.length;
    const fw2 = await O.forward({ method: 'POST', raw: '{}' });
    Z.check('C3 no GREENSTART_RCS_WEBHOOK_SECRET: nothing is sent, the reason is given', !fw2.ok && fw2.skipped && hooks(g0).length === 0, fw2);

    // ======================= D. the API on the sandbox server =======================
    const sup = await Z.mkUser('sup', { role: 'SUPER_ADMIN', hrmsRole: 'SUPER_ADMIN', atsRole: 'SUPER_ADMIN', accountsRole: 'SUPER_ADMIN', hrmsAccess: true, atsAccess: true, accountsAccess: true });
    const rec = await Z.mkUser('rec', { role: 'EMPLOYEE', atsRole: 'RECRUITER', atsDepartment: 'Medical', atsScopeDepartments: 'Medical' }, { designation: 'Recruiter' });
    const sTok = await Z.mint(sup); const rTok = await Z.mint(rec);
    const own = await prisma.rcsTemplate.create({ data: { templateId: 'ZZOWN1', name: 'ZZTEST RCSOMNI made in TeamLink', rcsType: 'BASIC', status: 'PENDING', bodyJson: JSON.stringify({ source: 'teamlink', varCount: 0 }) } });
    const st = await Z.call('GET', '/api/rcs/templates/omni', sTok);
    if (!st.body || st.body.forwardSet !== true) { Z.check('D0 the sandbox API runs with the Green Start stub settings (start it as the header says)', false, st.body); throw new Error('sandbox not started with the stub settings'); }
    const p1 = await Z.call('POST', '/api/rcs/templates/omni/pull', sTok);
    const rows = await prisma.rcsTemplate.findMany({ where: { templateId: { in: IDS } } });
    const a = rows.find((x) => x.templateId === 'ZZOMNI1'); const b = rows.find((x) => x.templateId === 'ZZOMNI2');
    Z.check('D1 "Get from Omni-Channel": 2 new (approved + waiting), the draft not taken, the TeamLink-made one counted "already here"',
      p1.status === 200 && p1.body.ok && p1.body.added === 2 && p1.body.alreadyHere === 1 && p1.body.seen === 3 && a && a.status === 'APPROVED' && b && b.status === 'PENDING' && rows.length === 3, p1.body);
    const ownAfter = await prisma.rcsTemplate.findUnique({ where: { id: own.id } });
    Z.check('D2 a template made in TeamLink with the same id is NOT overwritten', ownAfter.name === own.name && ownAfter.status === 'PENDING' && JSON.parse(ownAfter.bodyJson).source === 'teamlink', ownAfter);
    const p2 = await Z.call('POST', '/api/rcs/templates/omni/pull', sTok);
    Z.check('D3 again: no duplicates (one row per template id), 2 updated', p2.body.ok && p2.body.added === 0 && p2.body.updated === 2 && (await prisma.rcsTemplate.count({ where: { templateId: { in: IDS } } })) === 3, p2.body);
    const ap = await Z.call('GET', '/api/rcs/templates?approved=1', sTok);
    const shown = (ap.body || []).find((x) => x.templateId === 'ZZOMNI1');
    Z.check('D4 the approved one is in the send list, marked from Omni-Channel (workspace); the waiting one is not', shown && shown.source === 'omnichannel' && shown.omni.workspace === 'ZZTEST Main' && shown.varCount === 2 && !(ap.body || []).some((x) => x.templateId === 'ZZOMNI2'), shown);
    const fake = await Z.call('PATCH', `/api/rcs/templates/${b.id}`, sTok, { status: 'APPROVED' });
    const keep = await Z.call('PATCH', `/api/rcs/templates/${a.id}`, sTok, { module: 'ATS', status: 'APPROVED', fallback: { text: 'Hi {var1} - TeamLink', dltTemplateId: '1107000000000000009' } });
    Z.check('D5 an Omni-Channel template cannot be marked Approved by hand; module and SMS fallback can be set', fake.status === 400 && /Omni-Channel/.test(fake.body.error) && keep.status === 200 && keep.body.module === 'ATS' && keep.body.fallback, [fake.body, keep.body]);
    TPLS[1].status = 'approved'; TPLS[1].rcsCarrier.carrierStatus = 'APPROVED'; TPLS[0].name = 'ZZTEST RCSOMNI approved v2';
    const p3 = await Z.call('POST', '/api/rcs/templates/omni/pull', sTok);
    const a3 = await prisma.rcsTemplate.findUnique({ where: { id: a.id } }); const b3 = await prisma.rcsTemplate.findUnique({ where: { id: b.id } });
    Z.check('D6 approved in Omni-Channel -> Approved here; the name follows; module and SMS fallback set in TeamLink stay', p3.body.ok && b3.status === 'APPROVED' && a3.name === 'ZZTEST RCSOMNI approved v2' && a3.module === 'ATS' && JSON.parse(a3.bodyJson).fallback.dltTemplateId === '1107000000000000009', [b3.status, a3.name, a3.module]);
    // rejected in Omni-Channel, edited and submitted again: rcssms.in gives a NEW id to the same Omni-Channel template
    TPLS[0].providerTemplateId = 'ZZOMNI1B'; TPLS[0].rcsCarrier.templateId = 'ZZOMNI1B'; TPLS[0].status = 'pending';
    const p3b = await Z.call('POST', '/api/rcs/templates/omni/pull', sTok);
    const moved = await prisma.rcsTemplate.findMany({ where: { bodyJson: { contains: '"omniTemplateId":"gs-1"' } } });
    Z.check('D6b submitted again with a new rcssms.in id: the SAME TeamLink row moves to it (no duplicate), module and SMS fallback kept, back to waiting',
      p3b.body.ok && moved.length === 1 && moved[0].id === a.id && moved[0].templateId === 'ZZOMNI1B' && moved[0].status === 'PENDING' && moved[0].module === 'ATS'
      && JSON.parse(moved[0].bodyJson).fallback && JSON.stringify(JSON.parse(moved[0].bodyJson).earlierIds) === '["ZZOMNI1"]' && /submitted again/.test(p3b.body.words), [p3b.body, moved.map((x) => [x.templateId, x.status])]);
    TPLS[0].status = 'approved';
    await Z.call('POST', '/api/rcs/templates/omni/pull', sTok);
    const rp = await Z.call('POST', '/api/rcs/templates/omni/pull', rTok);
    Z.check('D7 only an Admin can get templates from Omni-Channel', rp.status === 403, rp.status);

    // webhook hand-off
    g0 = GOT.length;
    const body = { templateid: 'ZZOMNI1', status: 'APPROVED' };
    const w1 = await Z.call('POST', `/api/webhooks/rcs?token=${HOOK}`, null, body, { 'x-smstake-signature': 'sha256=zzsig' });
    const h1 = await until(() => hooks(g0)[0], 5000);
    Z.check('D8 rcssms.in calls TeamLink -> the same body goes to Omni-Channel on this server (its secret in the path, the signature header kept, TeamLink token not passed on)',
      w1.status === 200 && h1 && h1.method === 'POST' && h1.url === `/api/v1/webhooks/smstake-rcs/${GS_HOOK}` && h1.raw === JSON.stringify(body) && h1.headers['x-smstake-signature'] === 'sha256=zzsig' && !h1.url.includes(HOOK), h1 && { url: h1.url, raw: h1.raw });
    const after = await until(async () => { const s = await prisma.appSetting.findUnique({ where: { key: 'rcs.omniSync' } }); const v = s && JSON.parse(s.value); return v && v.why === 'approval' ? v : null; }, 10000);
    Z.check('D9 a template answer -> Omni-Channel templates are pulled in again by themselves', after && after.ok, after);
    g0 = GOT.length;
    await Z.call('GET', `/api/webhooks/rcs?token=${HOOK}&msgid=ZZNOPE1&status=DELIVERED`, null);
    const h2 = await until(() => hooks(g0)[0], 5000);
    Z.check('D10 a GET report is handed on as GET with its fields (without the TeamLink token)', h2 && h2.method === 'GET' && /msgid=ZZNOPE1/.test(h2.url) && /status=DELIVERED/.test(h2.url) && !h2.url.includes('token='), h2 && h2.url);
    g0 = GOT.length;
    await Z.call('POST', '/api/webhooks/rcs?token=wrong', null, body);
    await new Promise((r) => setTimeout(r, 800));
    Z.check('D11 a call with a wrong TeamLink token is not handed on', hooks(g0).length === 0, hooks(g0).length);
    const fwd = await Z.call('GET', '/api/rcs/templates/omni', sTok);
    Z.check('D12 the last hand-off result is shown (ok, HTTP 200)', fwd.body.forward && fwd.body.forward.ok && fwd.body.forward.status === 200, fwd.body.forward);

    // remove + Green Start down
    const del = await Z.call('DELETE', `/api/rcs/templates/${b.id}`, sTok);
    const p4 = await Z.call('POST', '/api/rcs/templates/omni/pull', sTok);
    Z.check('D13 removed here by an Admin -> not taken in again', del.status === 200 && p4.body.ok && p4.body.added === 0 && p4.body.removedHere === 1 && !(await prisma.rcsTemplate.findUnique({ where: { templateId: 'ZZOMNI2' } })), p4.body);
    DOWN = true;
    const p5 = await Z.call('POST', '/api/rcs/templates/omni/pull', sTok);
    DOWN = false;
    Z.check('D14 Omni-Channel not answering: a clear failure (HTTP 200, ok false: no retry loop), the templates already here stay', p5.status === 200 && !p5.body.ok && p5.body.words && (await prisma.rcsTemplate.count({ where: { templateId: { in: IDS } } })) === 2, p5.body);
    const all = JSON.stringify([st.body, p1.body, p2.body, p3.body, p5.body, ap.body, fwd.body]);
    Z.check('D15 no token or secret in any answer', !all.includes(GS_TOKEN) && !all.includes(GS_HOOK) && !all.includes(HOOK) && !all.includes('zz-sso-secret'));
  } catch (e) { Z.fail += 1; console.log('FAIL  crashed', e && e.stack ? e.stack.slice(0, 900) : e); } finally {
    try {
      stub.close();
      await prisma.rcsTemplate.deleteMany({ where: { OR: [{ templateId: { in: IDS } }, { name: { contains: 'ZZTEST RCSOMNI' } }] } });
      await prisma.auditLog.deleteMany({ where: { OR: [{ actorName: { contains: 'ZZTEST RCSOMNI' } }, { entity: { in: ['Rcs', 'RcsTemplate'] }, createdAt: { gte: START } }] } });
      await prisma.appSetting.deleteMany({ where: { key: { in: KEYS } } });
      for (const s of saved) await prisma.appSetting.create({ data: { key: s.key, value: s.value } }); // eslint-disable-line no-await-in-loop
    } catch (e) { console.log('cleanup problem', String(e.message).slice(0, 200)); }
    const left = await Z.cleanup().catch((e) => { console.log('cleanup problem', String(e.message).slice(0, 160)); return null; });
    const tplLeft = await prisma.rcsTemplate.count({ where: { OR: [{ templateId: { in: IDS } }, { name: { contains: 'ZZTEST' } }] } });
    Z.check('Z1 every ZZTEST row is gone (people, templates)', left && Object.values(left).every((v) => v === 0) && tplLeft === 0, [left, tplLeft]);
    console.log(`\n${Z.pass} passed, ${Z.fail} failed`);
    await prisma.$disconnect();
    process.exit(Z.fail ? 1 : 0);
  }
})();
