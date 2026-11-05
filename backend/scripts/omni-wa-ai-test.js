#!/usr/bin/env node
// ---------------------------------------------------------------------------
// OMNI-CHANNEL > WHATSAPP WITH THE AI AGENT (founder 2026-11-05). NO REAL META, NO REAL MODEL, NO REAL DATABASE.
//   cd backend && node scripts/omni-wa-ai-test.js [path of a sandbox .db to copy; default prisma/sandbox.db]
// TEST_MODE=1: every WhatsApp send is reported as sent and never transmitted (utils/whatsappCloud.js). The language model is a stub Ollama on 127.0.0.1 that answers a script,
// so what is proved is everything AROUND the model: the rules, the tools, the states. The real model's language and judgement are NOT proved here.
// The copy of the database is deleted at the end.
// ---------------------------------------------------------------------------
/* eslint-disable no-console, no-await-in-loop */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const BACK = path.join(__dirname, '..');
const srcDb = process.argv[2] || path.join(BACK, 'prisma', 'sandbox.db');
const copy = path.join(os.tmpdir(), `tl-omniwa-${Date.now()}.db`);
let pass = 0; let fail = 0;
const check = (name, ok, info) => { if (ok) { pass += 1; console.log(`  PASS ${name}`); } else { fail += 1; console.log(`  FAIL ${name}`, info === undefined ? '' : JSON.stringify(info).slice(0, 500)); } };

(async () => {
  const { DatabaseSync } = require('node:sqlite');
  const src = new DatabaseSync(srcDb, { readOnly: true });
  src.exec(`VACUUM INTO '${copy.replace(/\\/g, '/')}'`);
  src.close();
  process.env.DATABASE_URL = `file:${copy.replace(/\\/g, '/')}`;
  process.env.TEST_MODE = '1';
  process.env.TEST_ALLOW_AI = '1';
  process.env.AI_PROVIDER = 'ollama';

  // stub Ollama: answers the next line of the script; a function may look at the request
  const stub = { script: [], calls: [], down: false };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      stub.calls.push(body);
      if (stub.down) { res.writeHead(500); return res.end('{"error":"down"}'); }
      const next = stub.script.shift();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ message: { content: typeof next === 'string' ? next : JSON.stringify(next || { reply: '' }) } }));
    });
  });
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${server.address().port}`;

  const prisma = require(path.join(BACK, 'src/db'));
  const S = require(path.join(BACK, 'src/outreach/store'));
  const delivery = require(path.join(BACK, 'src/utils/messageDelivery'));
  const Agent = require(path.join(BACK, 'src/omniwa/agent'));
  const Cfg = require(path.join(BACK, 'src/omniwa/config'));
  const Inbox = require(path.join(BACK, 'src/omniwa/inbox'));
  const Promo = require(path.join(BACK, 'src/omniwa/promo'));
  const G = require(path.join(BACK, 'src/omniwa/guard'));
  const Live = require(path.join(BACK, 'src/omniwa/live'));
  const { ensure } = require(path.join(BACK, 'src/omniwa/schema'));

  const SUFFIX = String(Date.now()).slice(-8);
  const phoneOf = (n) => `919${String(n).padStart(2, '0')}${SUFFIX.slice(-7)}`; // 91 + 10 digits, fresh on every run
  let provider = 0;
  const inbound = (from, text, name = 'ZZTEST Sender') => { provider += 1; return delivery.applyInbound({ channel: 'WhatsApp', from, text, id: `wamid.ZZ${SUFFIX}${provider}`, at: new Date(), name }); };
  const run = () => Agent.tick(Date.now(), { force: true });
  const convAt = (e164) => Agent.convOf(e164);
  const aiMsgs = (candidateId) => prisma.candidateMessage.findMany({ where: { candidateId, template: 'AI' }, orderBy: { createdAt: 'asc' } });
  const LINK = /https?:\/\/\S+#\/job\/tl_/;

  try {
    await ensure();
    const admin = await prisma.user.findFirst({ where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } } });
    const other = await prisma.user.findFirst({ where: { role: { notIn: ['ADMIN', 'SUPER_ADMIN', 'CLIENT', 'CANDIDATE'] } } }).catch(() => null);
    const client = await prisma.client.findFirst();
    const job = await prisma.requirement.create({ data: { title: 'ZZTEST Physics Lecturer', clientId: client.id, status: 'OPEN', location: 'Hyderabad', experience: '2-6 years', salary: '8 LPA', skills: 'Physics', description: 'ZZTEST We need a physics lecturer who can teach degree students in Hyderabad, full time.' } });
    const mkCandidate = async (n, name) => {
      const c = await prisma.candidate.create({ data: { name: `ZZTEST ${name}`, phone: `+${phoneOf(n)}` } });
      await prisma.application.create({ data: { candidateId: c.id, requirementId: job.id, ownerRecruiterId: other ? other.id : null } });
      return c;
    };
    const promote = (c, n, campaign = `zzjob${n}${SUFFIX}`) => Promo.logBulk({
      id: campaign, kind: 'bulk', audience: 'candidates', purpose: 'ZZTEST job promotion', requirementId: job.id, templates: { WhatsApp: { name: 'job_update' } }, sender: { senderUserId: other ? other.id : admin.id, senderName: 'ZZTEST Recruiter' },
    }, [{ channel: 'WhatsApp', status: 'sent', address: `+${phoneOf(n)}`, text: 'ZZTEST We have a job', entityId: c.id, providerRef: `zzout${n}${SUFFIX}`, sentAt: new Date() }]);

    // ---- 1. off by default
    console.log('\n-- off until an Admin switches it on');
    const a = await mkCandidate(1, 'Asha');
    await promote(a, 1);
    const off = await Cfg.read();
    await inbound(phoneOf(1), 'Hi');
    stub.calls.length = 0;
    await run();
    check('AI is OFF by default: nothing sent, the model is not asked', off.enabled === false && stub.calls.length === 0 && (await aiMsgs(a.id)).length === 0);

    const saved = await Cfg.save(admin, { enabled: true, systemPrompt: 'You help candidates.', fallbackMessage: 'Our team will contact you soon.' });
    check('settings are saved', saved.ok && saved.config.enabled);
    await Cfg.kbSave(admin, null, { question: 'What are your office timings?', answer: 'Our office is open 9:30 to 6:30, Monday to Saturday.' });

    // ---- 2. the promised test: promotion -> interested -> AI collects, sends the link -> talk to someone -> handoff
    console.log('\n-- promotion, interested, details, apply link, then a person');
    const conv0 = await convAt(phoneOf(1));
    check('the reply is tied to the promotion: job, campaign, owner', conv0.requirementId === job.id && !!conv0.campaignId && !!conv0.promoAt && !!conv0.ownerUserId, conv0);
    await inbound(phoneOf(1), 'I am interested');
    stub.script = [{ tool: 'get_candidate_profile', args: {} }, { tool: 'get_job_details', args: {} }, { tool: 'save_candidate_data', args: { interested: true, location: 'Hyderabad' } }, { reply: 'Great! When can you join, and what is your expected salary?' }];
    await run();
    let sent = await aiMsgs(a.id);
    const sys = stub.calls[stub.calls.length - 1].messages[0].content;
    check('AI answers once through the WhatsApp send, logged on the candidate like any message', sent.length === 1 && /expected salary/.test(sent[0].body) && sent[0].senderName === 'AI assistant' && !!sent[0].providerRef, [sent, (await Inbox.runs({ limit: 2 })).map((r) => [r.outcome, r.error])]);
    check('the model got the rules, the tools and the job, and NOT the client name', /Answer only from the job data/.test(sys) && /get_job_details/.test(sys) && /ZZTEST Physics Lecturer/.test(sys) && !sys.includes(client.name), sys.slice(-300));
    check('the location was saved, and the interest is on the chat', JSON.parse((await convAt(phoneOf(1))).collected).interested === true && (await prisma.candidate.findUnique({ where: { id: a.id } })).location === 'Hyderabad');
    await inbound(phoneOf(1), '30 days notice, expecting 8 LPA');
    stub.script = [{ tool: 'save_candidate_data', args: { notice_period: '30 days', expected_salary: '8 LPA' } }, { tool: 'send_apply_link', args: {} }, { reply: 'Thank you. Please apply here.' }];
    await run();
    sent = await aiMsgs(a.id);
    check('apply link: TeamLink adds the real link to the reply', sent.length === 2 && LINK.test(sent[1].body) && /src=whatsapp/.test(sent[1].body), sent[1] && sent[1].body);
    stub.calls.length = 0;
    await inbound(phoneOf(1), 'I want to talk to someone');
    await run();
    let conv = await convAt(phoneOf(1));
    sent = await aiMsgs(a.id);
    check('talk to someone: a person is called in, the person is told, the model is not even asked', conv.state === 'needs_human' && stub.calls.length === 0 && sent[sent.length - 1].body === 'Our team will contact you soon.', conv);
    const { resolveIdentity } = require(path.join(BACK, 'src/utils/identity'));
    const adminMe = { ...(await resolveIdentity(admin.id)), contact: true };
    const viewAdmin = await Inbox.list(adminMe, { filter: 'human' });
    check('the handoff shows in the inbox under Needs human', viewAdmin.rows.some((r) => r.personId === a.id && r.ai.badge === 'needs_human'), viewAdmin.counts);
    await inbound(phoneOf(1), 'hello?');
    stub.calls.length = 0;
    await run();
    check('after a handoff the AI stays quiet', stub.calls.length === 0 && (await aiMsgs(a.id)).length === sent.length);

    // ---- 3. debounce + idempotent
    console.log('\n-- quick messages and repeats');
    const b = await mkCandidate(2, 'Bala');
    await promote(b, 2);
    await inbound(phoneOf(2), 'Hello');
    await inbound(phoneOf(2), 'is the job open?');
    const waiting = await Agent.tick(Date.now());
    check('inside the debounce time nothing runs', (waiting.ran || []).length === 0);
    stub.script = [{ reply: 'Yes, it is open.' }];
    await run();
    check('two quick messages get ONE reply', (await aiMsgs(b.id)).length === 1);
    const id = `wamid.ZZdup${SUFFIX}`;
    await delivery.applyInbound({ channel: 'WhatsApp', from: phoneOf(2), text: 'same one', id, at: new Date() });
    await delivery.applyInbound({ channel: 'WhatsApp', from: phoneOf(2), text: 'same one', id, at: new Date() });
    const dup = await S.q('SELECT COUNT(*) AS n FROM "OmniWaMessage" WHERE providerMessageId = ?', id);
    stub.script = [{ reply: 'Okay.' }];
    await run();
    check('the same provider message id is handled once', Number(dup[0].n) === 1 && (await aiMsgs(b.id)).length === 2);

    // ---- 4. the guard
    console.log('\n-- what the model may not do');
    await inbound(phoneOf(2), 'how much is the bonus?');
    stub.script = [{ reply: 'You get a salary of 15 LPA with a joining bonus.' }];
    await run();
    conv = await convAt(phoneOf(2));
    const lastB = (await aiMsgs(b.id)).pop();
    check('an invented salary never leaves: the fallback goes, a recruiter is called', conv.state === 'needs_human' && lastB.body === 'Our team will contact you soon.' && !(await aiMsgs(b.id)).some((m) => /15 LPA/.test(m.body)), lastB.body);
    const blocked = (await Inbox.runs({ limit: 20 })).find((r) => r.outcome === 'blocked_by_guard');
    check('the blocked draft is in the run log with the reason', !!blocked && /15 LPA/.test(blocked.output) && !!blocked.error, blocked);
    check('8 LPA from the job is allowed; a benefit that is not in the job is not', G.promiseProblem('The salary is 8 LPA.', '{"salary":"8 LPA"}') === null && !!G.promiseProblem('You also get free insurance.', '{"salary":"8 LPA"}'));
    check('a link typed by the model is taken out, the real one stays', G.stripLinks('See https://evil.example/x and https://ok.example/a', ['https://ok.example/a']) === 'See and https://ok.example/a');
    await Agent.resume(conv);
    const backed = await convAt(phoneOf(2));
    check('Give back to AI: the chat is the AI\'s again', backed.state === 'active' && backed.mode === 'ai');

    const c = await mkCandidate(3, 'Chitra');
    await promote(c, 3);
    await inbound(phoneOf(3), 'not interested, thanks');
    stub.script = [{ tool: 'save_candidate_data', args: { interested: false } }, { reply: 'Thank you for your time.' }];
    await run();
    conv = await convAt(phoneOf(3));
    await inbound(phoneOf(3), 'ok');
    stub.calls.length = 0;
    await run();
    check('not interested: marked, thanked once, no more messages', conv.state === 'not_interested' && (await aiMsgs(c.id)).length === 1 && stub.calls.length === 0);

    stub.down = true;
    const d = await mkCandidate(4, 'Deepa');
    await promote(d, 4);
    await inbound(phoneOf(4), 'tell me about the job');
    await run();
    stub.down = false;
    conv = await convAt(phoneOf(4));
    check('the model is down: the fallback goes and a recruiter is called', conv.state === 'needs_human' && (await aiMsgs(d.id))[0].body === 'Our team will contact you soon.', conv);

    // ---- 5. STOP
    console.log('\n-- stop');
    const e = await mkCandidate(5, 'Esha');
    await promote(e, 5);
    await inbound(phoneOf(5), 'STOP');
    stub.calls.length = 0;
    await run();
    conv = await convAt(phoneOf(5));
    const supp = await S.q('SELECT 1 AS x FROM "OutreachSuppression" WHERE addressHash = ?', S.hashAddress('phone', `+${phoneOf(5)}`));
    check('STOP: blocked at once on every list, no AI, no reply', conv.state === 'stopped' && stub.calls.length === 0 && (await aiMsgs(e.id)).length === 0 && await delivery.optedOut('WhatsApp', phoneOf(5)) && supp.length === 1, [conv.state, supp.length]);
    const tried = await Agent.sendText(conv, 'hello');
    check('nothing can be sent to that number afterwards', tried.ok === false && tried.code === 'OPTED_OUT');
    await inbound(phoneOf(5), 'ఆపండి');
    check('a Telugu stop word counts too', G.isStop('ఆపండి') && G.isStop('please unsubscribe') === false ? true : G.isStop('ఆపండి'));

    // ---- 6. leads
    console.log('\n-- a number we do not know');
    const unknown = phoneOf(77);
    await inbound(unknown, 'Do you have jobs?', 'ZZTEST New Person');
    stub.calls.length = 0;
    await run();
    conv = await convAt(unknown);
    const contact = conv && conv.leadContactId ? (await S.q('SELECT contactType FROM "OutreachContact" WHERE id = ?', conv.leadContactId))[0] : null;
    check('an unknown number becomes a Lead, a person is called, the AI does not answer a stranger', conv && conv.personType === 'LEAD' && conv.state === 'needs_human' && stub.calls.length === 0 && contact && contact.contactType === 'candidate_lead', conv);
    const aList = await Inbox.list(adminMe, {});
    check('Admin sees the lead in the list', aList.rows.some((r) => r.personType === 'LEAD' && r.personId === conv.id));
    if (other) {
      const oList = await Inbox.list(other, {});
      const refused = await Inbox.detail(other, `LEAD:${conv.id}`);
      check('a recruiter who does not own it does not', !oList.rows.some((r) => r.personId === conv.id) && refused.status === 403, refused);
    }
    const leadSend = await Agent.sendText(conv, 'Hello, tell me your skills.', { user: admin, ai: false });
    const leadMsgs = await Inbox.leadMessages(conv.id);
    check('a person can answer a lead inside 24 hours and the chat keeps both messages', leadSend.ok && leadMsgs.length === 2 && leadMsgs[1].by === admin.name, leadSend);

    // ---- 7. human takeover
    console.log('\n-- a person takes over');
    const f = await mkCandidate(6, 'Farah');
    await promote(f, 6);
    await inbound(phoneOf(6), 'Hi');
    stub.script = [{ reply: 'Hello.' }];
    await run();
    await Agent.noteHumanSend('CANDIDATE', f.id, 'ZZTEST Recruiter');
    conv = await convAt(phoneOf(6));
    await inbound(phoneOf(6), 'one more thing');
    stub.calls.length = 0;
    await run();
    check('a recruiter\'s message pauses the AI at once', conv.mode === 'paused' && conv.pausedByName === 'ZZTEST Recruiter' && stub.calls.length === 0);
    await Agent.resume(await convAt(phoneOf(6)));
    await prisma.candidateMessage.create({ data: { candidateId: f.id, channel: 'WhatsApp', template: 'MANUAL', trigger: 'Manual', recipient: `+${phoneOf(6)}`, body: 'ZZTEST from another screen', status: 'SENT', senderUserId: admin.id, senderName: admin.name, createdAt: new Date(Date.now() + 2000) } });
    await inbound(phoneOf(6), 'hello again');
    stub.calls.length = 0;
    await run();
    conv = await convAt(phoneOf(6));
    check('a message sent from any other screen pauses it too, before the next answer', conv.mode === 'paused' && stub.calls.length === 0, conv);

    // ---- 8. limits and settings
    console.log('\n-- limits');
    const g = await mkCandidate(7, 'Gita');
    await promote(g, 7);
    await Cfg.save(admin, { maxTurns: 1 });
    await inbound(phoneOf(7), 'Hi');
    stub.script = [{ reply: 'Hello.' }];
    await run();
    await inbound(phoneOf(7), 'And then?');
    stub.calls.length = 0;
    await run();
    conv = await convAt(phoneOf(7));
    check('after the most AI replies a person takes over', conv.state === 'needs_human' && stub.calls.length === 0 && /limit/.test(conv.handoffReason));
    await Cfg.save(admin, { maxTurns: 12, testNumbers: [phoneOf(9)] });
    const h = await mkCandidate(8, 'Hari');
    await promote(h, 8);
    await inbound(phoneOf(8), 'Hi');
    stub.calls.length = 0;
    await run();
    check('with test numbers only those numbers are answered', stub.calls.length === 0 && (await aiMsgs(h.id)).length === 0);
    await Cfg.save(admin, { testNumbers: [] });
    check('working hours: inside and outside (India time), over midnight too', G.insideHours({ hoursOn: true, hoursFrom: '09:00', hoursTo: '18:00' }, Date.UTC(2026, 10, 5, 6, 0)) === true && G.insideHours({ hoursOn: true, hoursFrom: '09:00', hoursTo: '18:00' }, Date.UTC(2026, 10, 5, 15, 0)) === false && G.insideHours({ hoursOn: true, hoursFrom: '22:00', hoursTo: '06:00' }, Date.UTC(2026, 10, 5, 18, 0)) === true);

    // ---- 8b. a campaign sent inside Omni-Channel (Green Start): not in TeamLink's log, the replies come here
    console.log('\n-- a campaign sent from Green Start');
    const gsSeen = [];
    const gs = { found: null, broken: false };
    const gsServer = http.createServer((req, res) => {
      gsSeen.push({ url: req.url, ws: req.headers['x-workspace-id'], auth: req.headers.authorization });
      res.writeHead(gs.broken ? 500 : 200, { 'Content-Type': 'application/json' });
      if (gs.broken) return res.end('{"message":"down"}');
      const hit = req.headers['x-workspace-id'] === 'ws2' && gs.found;
      return res.end(JSON.stringify({ success: true, data: hit ? { found: true, campaignId: 'c9', campaignName: 'ZZTEST Nurses', sentAt: new Date().toISOString() } : { found: false } }));
    });
    await new Promise((r) => { gsServer.listen(0, '127.0.0.1', r); });
    process.env.GREENSTART_API_PORT = String(gsServer.address().port);
    const GI = require(path.join(BACK, 'src/utils/greenStartIntegrations'));
    const GC = require(path.join(BACK, 'src/omniwa/gsCampaign'));
    GI.signIn = async () => ({ token: 'zz-gs-token' });
    GI.workspacesOf = async () => [{ id: 'ws1', name: 'Medical' }, { id: 'ws2', name: 'Education' }];
    GC.reset();
    const i = await mkCandidate(10, 'Indu');
    await inbound(phoneOf(10), 'Hi');
    stub.calls.length = 0;
    await run();
    check('a candidate no campaign reached: Green Start is asked (every workspace, this number), and the AI stays out', gsSeen.length === 2 && gsSeen.every((x) => x.url.includes(`phone=${phoneOf(10)}`) && x.auth === 'Bearer zz-gs-token') && stub.calls.length === 0, gsSeen);
    gs.found = true;
    await inbound(phoneOf(10), 'I am interested');
    stub.script = [{ reply: 'Thank you, let me help.' }];
    await run();
    conv = await convAt(phoneOf(10));
    check('reply to a Green Start campaign: the AI answers, and the chat shows that campaign', (await aiMsgs(i.id)).length === 1 && conv.campaignName === 'ZZTEST Nurses' && conv.campaignId === 'gs:c9' && !!conv.aiStartedAt, conv);
    gsSeen.length = 0;
    await inbound(phoneOf(10), 'one more');
    stub.script = [{ reply: 'Okay.' }];
    await run();
    check('a running AI chat does not ask Green Start again', gsSeen.length === 0 && (await aiMsgs(i.id)).length === 2);
    const leadNo = phoneOf(78);
    await inbound(leadNo, 'Tell me more', 'ZZTEST Campaign Lead');
    stub.script = [{ reply: 'Sure, what would you like to know?' }];
    await run();
    conv = await convAt(leadNo);
    check('a number with no candidate that answered a Green Start campaign is a Lead AND gets the AI', conv.personType === 'LEAD' && conv.state === 'active' && !!conv.aiStartedAt, conv);
    gs.found = false; gs.broken = true;
    GC.reset();
    const j = await mkCandidate(11, 'Jaya');
    await inbound(phoneOf(11), 'Hi');
    stub.calls.length = 0;
    await run();
    check('Green Start not answering: nothing breaks, nobody gets a wrong AI reply', stub.calls.length === 0 && (await aiMsgs(j.id)).length === 0);
    gsServer.close();

    // ---- 9. promotions, already contacted, the push, the other responders
    console.log('\n-- promotions and the screen');
    await Promo.onStatus({ providerRef: `zzout2${SUFFIX}`, status: 'delivered' });
    await Promo.onStatus({ providerRef: `zzout2${SUFFIX}`, status: 'read' });
    await Promo.onStatus({ providerRef: `zzout2${SUFFIX}`, status: 'delivered' });
    await Promo.onStatus({ providerRef: `zzout3${SUFFIX}`, status: 'failed', error: 'ZZTEST number has no WhatsApp' });
    const log = await Inbox.promotions(adminMe, {});
    const rowB = log.rows.find((r) => r.candidateId === b.id); const rowC = log.rows.find((r) => r.candidateId === c.id);
    check('each promotion keeps candidate, job, campaign, template, recruiter and the true status (never backwards)', rowB && rowB.status === 'read' && rowB.jobTitle === job.title && !!rowB.campaignName && rowB.template === 'job_update' && rowB.senderName === 'ZZTEST Recruiter' && rowC.status === 'failed', rowB);
    await prisma.candidateMessage.create({ data: { candidateId: g.id, channel: 'WhatsApp', template: 'MANUAL', trigger: 'Manual', recipient: `+${phoneOf(7)}`, body: 'ZZTEST', status: 'SENT', senderUserId: admin.id, senderName: 'ZZTEST Other Recruiter' } });
    const seen = await Inbox.recentContact({ id: 'someone-else' }, [g.id]);
    const notMe = await Inbox.recentContact({ id: admin.id }, [g.id]);
    check('already contacted: another recruiter in the last 7 days shows, your own message does not', seen.get(g.id) && seen.get(g.id).byName === 'ZZTEST Other Recruiter' && !notMe.has(g.id));
    let pushed = null;
    const off2 = Live.subscribe((...args) => { pushed = args; });
    await inbound(phoneOf(8), 'push');
    off2();
    check('the inbox is told at once, and the push carries no name and no words', Array.isArray(pushed) && pushed.length === 0);
    await prisma.candidateMessage.updateMany({ where: { candidateId: { in: [b.id] } }, data: {} });
    check('the keyword bot and the campaign auto-reply stay quiet in a chat the AI answers', await Agent.ownsChat({ candidateId: b.id }) === true && await Agent.ownsChat({ candidateId: a.id }) === false);
    const counts = (await S.q('SELECT COUNT(*) AS n FROM "OmniWaAiRun"'))[0];
    check('every run is logged', Number(counts.n) > 5);
    const js = JSON.stringify(await Inbox.runs({ limit: 300 }));
    check('no WhatsApp secret in the log', !/access_token|Bearer /.test(js));
  } catch (err) {
    fail += 1; console.log('  ERROR', err && err.stack);
  } finally {
    server.close();
    await prisma.$disconnect().catch(() => {});
    for (const x of [copy, `${copy}-wal`, `${copy}-shm`, `${copy}-journal`]) { try { fs.unlinkSync(x); } catch { /* gone */ } }
    console.log(`\nOmni-Channel WhatsApp AI: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
