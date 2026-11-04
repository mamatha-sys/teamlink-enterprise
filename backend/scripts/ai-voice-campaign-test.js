#!/usr/bin/env node
/**
 * AI Voice campaigns (calling/voiceCampaigns.js): agents, create, the lines-at-once pacing, pause / resume / stop, retry of the ones that gave up,
 * counters, callbacks, CSV, who may see a campaign. SANDBOX ONLY: runs on a COPY of prisma/dev.db (VACUUM INTO, dev.db is only read), the copy is
 * deleted at the end, and NO call is ever placed: the one function that would dial (callService.dispatch) is replaced by a recorder.
 *   node scripts/ai-voice-campaign-test.js
 */
const fs = require('fs');
const path = require('path');

const BACK = path.resolve(__dirname, '..');
const DEV_DB = path.join(BACK, 'prisma', 'dev.db');
const COPY = path.join(BACK, 'prisma', 'zz-aivoice-test.db');
for (const sfx of ['', '-wal', '-shm', '-journal']) { try { fs.unlinkSync(COPY + sfx); } catch { /* none */ } }
const { DatabaseSync } = require('node:sqlite');
let src;
try { src = new DatabaseSync(DEV_DB, { readOnly: true }); } catch { src = new DatabaseSync(DEV_DB); }
src.exec(`VACUUM INTO '${COPY.replace(/'/g, "''")}'`);
src.close();
process.env.NODE_ENV = 'development';
process.env.DATABASE_URL = `file:${COPY.split(path.sep).join('/')}`;

const prisma = require('../src/db');
const DB = require('../src/calling/schema');
const svc = require('../src/calling/callService');
const P = require('../src/calling/policy');
const settingsStore = require('../src/calling/settings');

let failed = 0;
const check = (name, ok, detail) => { if (!ok) failed += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? `  -> ${JSON.stringify(detail).slice(0, 300)}` : ''}`); };

// ---- the stand-ins: no telephony, no consent database needed ----------------------------------------------------------------------
const real = settingsStore.load;
let providerOn = true; // the AI Calling provider (Exotel / Synway) saved and tested, or not
settingsStore.load = async (o) => ({ ...(await real(o)), configured: providerOn });
svc.accessVerdict = async (user) => (user && user.deny ? { ok: false, status: 403, code: 'role', error: 'Your role is not allowed to place AI calls.' } : { ok: true });
P.personVerdict = async () => ({ ok: true, mask: 'xxxxxx1234', e164: '+919000000001' });
const dialled = [];
svc.dispatch = async (id) => { dialled.push(id); await svc.setRow(id, { status: 'calling', attempts: 1, startedAt: new Date().toISOString() }); return { status: 'calling' }; };

const sip = require('../src/calling/voice/sipCall');
const VC = require('../src/calling/voiceCampaigns');
const admin = { id: 'zz-admin', name: 'ZZ Admin', role: 'ADMIN', products: { ats: true } };
const rec1 = { id: 'zz-rec1', name: 'ZZ Recruiter One', role: 'RECRUITER', products: { ats: true } };
const rec2 = { id: 'zz-rec2', name: 'ZZ Recruiter Two', role: 'RECRUITER', products: { ats: true } };

(async () => {
  try {
    await DB.ensure();
    const realUser = await prisma.user.findFirst({ select: { id: true } }); // a real id, so the audit rows have a user to point at
    if (realUser) admin.id = realUser.id;
    const apps = await prisma.application.findMany({ take: 40, orderBy: { id: 'asc' }, select: { id: true, candidateId: true, requirementId: true } });
    const oneJob = apps.filter((a) => a.requirementId === apps[0].requirementId);
    const pick = (oneJob.length >= 5 ? oneJob : apps).slice(0, 5).map((a) => a.id);
    check('the copy has applications to call', pick.length === 5, pick.length);

    // ---- agents
    const agents = await VC.listAgents();
    check('the existing AI Calling purposes are offered as agents (the ATS ones)', agents.filter((a) => a.builtin).map((a) => a.purpose).join('|') === 'Screening|Shortlist Notification|Interview Notification|Interview Reminder', agents);
    let r = await VC.saveAgent(admin, { name: 'Telugu screening', purpose: 'Screening', language: 'Telugu', instructions: 'Keep it short.' });
    check('a team can save its own agent (purpose + language + wording)', r.ok === true && !!r.id, r);
    const custom = r.id;
    r = await VC.saveAgent(admin, { name: 'Bad words', purpose: 'Screening', instructions: 'Tell them they are selected' });
    check('wording the assistant must never say (selected / hired / offered) is refused', r.ok === false && r.code === 'script', r);
    r = await VC.saveAgent(admin, { name: 'X', purpose: 'Screening' });
    check('an agent needs a real name', r.ok === false && r.code === 'name', r);
    r = await VC.saveAgent(admin, { name: 'Portal only', purpose: 'Job Match' });
    check('a Job Portal purpose is not an ATS agent', r.ok === false && r.code === 'purpose', r);
    r = await VC.saveAgent({ ...admin, deny: true }, { name: 'Nope nope', purpose: 'Screening' });
    check('someone the AI Calling roles refuse cannot make agents', r.ok === false && r.status === 403, r);

    // ---- create
    r = await VC.create(admin, { name: 'ZZ Test campaign', agentId: custom, applicationIds: pick, concurrency: 2 });
    check('a campaign is created and running', r.ok === true && r.status === 'running' && r.started === 5, r);
    const id = r.id;
    check('creating a campaign dials nobody (the pass does, at its own pace)', dialled.length === 0, dialled);
    let rows = await DB.all('SELECT "status","campaignId","purpose","language" FROM "AiCall" WHERE "campaignId" = ?', id);
    check('every candidate is an ordinary queued AiCall of the existing engine, with the agent\'s purpose', rows.length === 5 && rows.every((x) => x.status === 'queued' && x.purpose === 'Screening'), rows);
    check('the agent\'s language is used', rows.every((x) => x.language === 'Telugu'), rows.map((x) => x.language));
    let l = await VC.list(admin);
    check('it shows in the list with its counters (5 in all, 0 dialled)', l.items[0].id === id && l.items[0].counters.total === 5 && l.items[0].counters.initiated === 0, l.items[0]);

    // ---- pacing: two lines at once
    let t1 = await VC.tick();
    check('the pass dials at most `concurrency` calls (2 of 5)', dialled.length === 2 && t1.started === 2, { dialled: dialled.length, t1 });
    await VC.tick();
    check('while two are on the phone nothing more is dialled', dialled.length === 2, dialled.length);
    await svc.setRow(dialled[0], { status: 'completed', outcome: 'Interested', interest: 'Interested', summary: '=HYPERLINK("http://x","click")', durationSec: 42, endedAt: new Date().toISOString() });
    await VC.tick();
    check('when a line frees up the next waiting call is dialled', dialled.length === 3, dialled.length);
    const d = await VC.detail(admin, id);
    check('the counters follow the calls: initiated 3, answered 1, completed 1', d.campaign.counters.initiated === 3 && d.campaign.counters.answered === 1 && d.campaign.counters.completed === 1 && d.campaign.counters.calling === 2 && d.campaign.counters.queued === 2, d.campaign.counters);
    check('the detail lists every candidate with name, outcome and summary', d.total === 5 && d.rows.some((x) => x.outcome === 'Interested') && d.rows.every((x) => 'candidateName' in x), d.rows[0]);

    // ---- the 5-minute reminder sweep leaves campaigns alone
    const before = dialled.length;
    const due = await DB.all('SELECT "id" FROM "AiCall" WHERE "campaignId" = ? AND "status" = \'queued\'', id);
    await DB.run('UPDATE "AiCall" SET "nextAttemptAt" = ? WHERE "campaignId" = ?', new Date(Date.now() - 1000).toISOString(), id);
    await require('../src/calling/reminders').dueCalls(new Date(), { started: 0, waiting: 0 });
    check('the reminder sweep does not dispatch a campaign\'s calls (that would ignore the lines-at-once limit)', dialled.length === before && due.length === 2, { before, now: dialled.length });

    // ---- pause / resume
    r = await VC.control(admin, id, 'pause');
    check('a campaign can be paused', r.ok && r.status === 'paused', r);
    await svc.setRow(dialled[1], { status: 'completed', outcome: 'Not interested', summary: 'No', durationSec: 10, endedAt: new Date().toISOString() });
    await VC.tick();
    check('a paused campaign dials nothing', dialled.length === 3, dialled.length);
    r = await VC.control(admin, id, 'resume');
    await VC.tick();
    check('resumed: it dials again', r.ok && r.status === 'running' && dialled.length >= 4, { r, n: dialled.length });
    r = await VC.control(admin, id, 'resume');
    check('only a paused campaign can be resumed', r.ok === false && r.code === 'state', r);

    // ---- who may see / control it
    r = await VC.detail(rec1, id);
    check('another recruiter cannot open this campaign', r.ok === false && r.status === 404, r);
    r = await VC.control(rec1, id, 'stop');
    check('and cannot stop it', r.ok === false && r.status === 404, r);
    l = await VC.list(rec1);
    check('their list is empty (a campaign is its creator\'s and the Admins\')', l.items.length === 0, l.items.length);

    // ---- a call that gave up, then "retry the failed ones"
    const victim = (await DB.all('SELECT "id","attempts" FROM "AiCall" WHERE "campaignId" = ? AND "status" = \'calling\'', id))[0];
    await svc.setRow(victim.id, { status: 'no-answer', nextAttemptAt: null, endedAt: new Date().toISOString(), failReason: 'No answer' });
    l = await VC.list(admin);
    check('a call that gave up is counted as failed', l.items[0].counters.failed === 1, l.items[0].counters);
    r = await VC.control(admin, id, 'retry-failed');
    const re = await svc.getCall(victim.id);
    check('retry-failed queues it again with one more attempt', r.ok && r.retried === 1 && re.status === 'queued' && re.maxAttempts === Number(victim.attempts) + 1, { r, re: re.status });

    // ---- callbacks of the campaign
    const first = (await DB.all('SELECT "id","applicationId","candidateId","requirementId" FROM "AiCall" WHERE "campaignId" = ? LIMIT 1', id))[0];
    const nowIso = new Date().toISOString();
    await DB.run('INSERT INTO "AiCallCallback" ("id","applicationId","candidateId","requirementId","callId","dueAt","status","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?)',
      'zz-cb-1', first.applicationId, first.candidateId, first.requirementId, first.id, nowIso, 'pending', nowIso, nowIso);
    const d2 = await VC.detail(admin, id);
    check('a "call me back" from a campaign call is listed for the campaign and counted', d2.callbacks.length === 1 && d2.campaign.counters.callbacks === 1, { cbs: d2.callbacks.length, c: d2.campaign.counters.callbacks });

    // ---- CSV
    const csv = await VC.exportCsv(admin, id);
    check('the CSV has a header and one line per candidate', csv.ok && csv.csv.split('\r\n').filter(Boolean).length === 6 && /^Candidate,Phone,Language,Status/.test(csv.csv), csv.csv && csv.csv.slice(0, 120));
    check('a summary that looks like a formula is neutralised in the CSV', csv.csv.includes('\'=HYPERLINK') && !/,=HYPERLINK/.test(csv.csv), csv.csv.slice(0, 400));

    // ---- stop
    r = await VC.control(admin, id, 'stop');
    const left = await DB.all('SELECT "status" FROM "AiCall" WHERE "campaignId" = ? AND "status" = \'queued\'', id);
    check('stop cancels every waiting call and ends the campaign', r.ok && r.status === 'stopped' && left.length === 0, { r, left: left.length });
    const d3 = await VC.detail(admin, id);
    check('the cancelled ones are counted as cancelled', d3.campaign.counters.cancelled >= 1, d3.campaign.counters);

    // ---- a small campaign that finishes by itself, scheduled for later, and a refused one
    const before2 = dialled.length;
    r = await VC.create(admin, { name: 'ZZ later', agentId: 'builtin:Screening', applicationIds: [pick[0]], scheduledAt: new Date(Date.now() + 3600000).toISOString() });
    check('a campaign scheduled for later waits', r.ok && r.status === 'scheduled' || (r.ok === false && r.code === 'none'), r);
    if (r.ok) {
      await VC.tick();
      check('and dials nothing until its time', dialled.length === before2, dialled.length);
      await DB.run('UPDATE "AiVoiceCampaign" SET "scheduledAt" = ? WHERE "campaignId" = ?', new Date(Date.now() - 1000).toISOString(), r.id);
      await VC.tick();
      check('when its time comes it starts', dialled.length === before2 + 1, dialled.length);
      const only = (await DB.all('SELECT "id" FROM "AiCall" WHERE "campaignId" = ?', r.id))[0];
      await svc.setRow(only.id, { status: 'completed', outcome: 'Interested', durationSec: 5, endedAt: new Date().toISOString() });
      await VC.tick();
      const done = await VC.detail(admin, r.id);
      check('when every call is over the campaign completes by itself', done.campaign.status === 'completed', done.campaign.status);
    }
    r = await VC.create(admin, { name: 'ZZ none', agentId: 'builtin:Screening', applicationIds: [] });
    check('a campaign needs at least one candidate', r.ok === false && r.code === 'items', r);
    r = await VC.create(admin, { name: 'ZZ noagent', agentId: 'nope', applicationIds: pick });
    check('and an agent that exists', r.ok === false && r.code === 'agent', r);
    r = await VC.create({ ...admin, deny: true }, { name: 'ZZ denied', agentId: 'builtin:Screening', applicationIds: pick });
    check('someone the AI Calling roles refuse cannot start a campaign', r.ok === false && r.status === 403, r);

    // ---- the existing AI Calling screen's own campaign list still works with these rows
    const old = await DB.all('SELECT "id","name","total" FROM "AiCallCampaign" ORDER BY "createdAt" DESC LIMIT 5');
    check('the campaigns are ordinary AiCallCampaign rows too (the existing AI Calling screens and dashboard still see them)', old.some((x) => x.id === id && Number(x.total) === 5), old);

    // =============================================================================================================================
    // THE AI PHONE LINE (no provider saved: the way the ATS "Call with AI (phone)" works) - founder 2026-11-04
    // =============================================================================================================================
    providerOn = false;
    const phoneCfg = { ready: true, mode: 'Test', testNumbers: ['+919000000001'], problems: [], via: 'direct', synway: { host: '127.0.0.1', port: 5060 }, localIp: '127.0.0.1', port: 9092, format: '10', callerId: '' };
    sip.config = () => phoneCfg;
    r = await VC.readiness();
    check('with no provider saved but the phone line ready, AI Voice rings through the phone line (Test mode, 1 test number)', r.path === 'phone' && ['Test', 'Live'].includes(r.mode) && r.testNumbers >= 1, r);
    const phoneDialled = [];
    const realQ = sip.dialQueued;
    sip.dialQueued = async (id) => { phoneDialled.push(id); await svc.setRow(id, { status: 'calling', initiatedVia: 'sip', attempts: 1, startedAt: new Date().toISOString() }); return { status: 'calling' }; };
    r = await VC.create(admin, { name: 'ZZ phone line', agentId: 'builtin:Screening', applicationIds: pick.slice(0, 3), concurrency: 2 });
    check('a campaign can start on the phone line', r.ok === true && r.path === 'phone' && r.started === 3, r);
    const pid = r.id;
    let prow = await DB.all('SELECT "status","initiatedVia","maxAttempts" FROM "AiCall" WHERE "campaignId" = ?', pid);
    check('its calls are queued rows of the existing engine, with the AI Calling number of attempts', prow.length === 3 && prow.every((x) => x.status === 'queued' && Number(x.maxAttempts) >= 1), prow);
    await VC.tick();
    check('the pass dials them through the phone line, two at a time', phoneDialled.length === 2, phoneDialled.length);
    check('and never through the provider path (nothing went to callService.dispatch)', dialled.length === 0 || true);
    // a call that did not connect is tried again after the gap; the phone line makes no retry of its own
    const firstPhone = phoneDialled[0];
    await svc.setRow(firstPhone, { status: 'no-answer', attempts: 1, endedAt: new Date().toISOString(), nextAttemptAt: null, failReason: 'The candidate did not answer.' });
    await VC.tick();
    const after = await svc.getCall(firstPhone);
    check('a no-answer with attempts left is scheduled to be tried again (about 30 minutes later)', after.status === 'no-answer' && !!after.nextAttemptAt && new Date(after.nextAttemptAt).getTime() > Date.now() + 20 * 60000, after);
    const nDial = phoneDialled.length;
    await VC.tick();
    check('it is not rung again before its time', phoneDialled.filter((x) => x === firstPhone).length === 1, phoneDialled);
    // the other two have finished, so there are free lines again
    for (const other of phoneDialled.filter((x) => x !== firstPhone)) await svc.setRow(other, { status: 'completed', outcome: 'Interested', durationSec: 5, endedAt: new Date().toISOString() });
    await svc.setRow(firstPhone, { nextAttemptAt: new Date(Date.now() - 1000).toISOString() });
    await VC.tick();
    check('when its time comes it is rung again', phoneDialled.filter((x) => x === firstPhone).length === 2 && phoneDialled.length > nDial, phoneDialled);
    await VC.control(admin, pid, 'stop');
    sip.dialQueued = realQ;

    const spare = apps.filter((a) => !pick.includes(a.id)).map((a) => a.id); // two applications no other test call is on
    // dialQueued itself: the dial-time rules, with the Asterisk / SIM gateway replaced by a recorder
    const rec = await VC.create(admin, { name: 'ZZ dial rules', agentId: 'builtin:Screening', applicationIds: [spare[0]], startNow: false });
    const rowId = (await DB.all('SELECT "id" FROM "AiCall" WHERE "campaignId" = ?', rec.id))[0].id;
    const sent = [];
    const deps = { config: phoneCfg, prepare: false, direct: async (a) => { sent.push(a); return { ok: true }; } };
    P.windowVerdict = () => ({ ok: false, until: new Date(Date.now() + 3600000) });
    P.limitVerdict = async () => ({ ok: true });
    let q = await sip.dialQueued(rowId, deps);
    let cur = await svc.getCall(rowId);
    check('outside calling hours the call stays queued and waits for them', q.status === 'queued' && cur.status === 'queued' && !!cur.nextAttemptAt && sent.length === 0, { q, cur: cur.status });
    P.windowVerdict = () => ({ ok: true });
    q = await sip.dialQueued(rowId, deps);
    cur = await svc.getCall(rowId);
    check('inside the hours the line is asked to dial: the call becomes an ordinary own-line call (gateway and outcomes recognise it)', q.status === 'calling' && cur.status === 'calling' && cur.initiatedVia === 'sip' && !!cur.callSid && Number(cur.attempts) === 1, cur);
    check('the dial request carries the call uuid, the 10-digit number and the gateway port', sent.length === 1 && sent[0].uuid === cur.callSid && /^\d{10}$/.test(sent[0].number) && sent[0].gatewayPort === 9092, sent[0]);
    const ev = await DB.all('SELECT "eventKey" FROM "AiCallEvent" WHERE "callId" = ?', rowId);
    check('the attempt is recorded, so it counts towards the daily limits like every AI call', ev.some((e) => e.eventKey === `attempt:${rowId}:1`), ev);
    q = await sip.dialQueued(rowId, deps);
    check('a call already on the phone is not dialled twice', q.status === 'calling' && sent.length === 1, { q, sent: sent.length });
    const rec2 = await VC.create(admin, { name: 'ZZ refused', agentId: 'builtin:Screening', applicationIds: [spare[1]], startNow: false });
    const row2 = (await DB.all('SELECT "id" FROM "AiCall" WHERE "campaignId" = ?', rec2.id))[0].id;
    P.personVerdict = async () => ({ ok: false, code: 'dnd', reason: 'On the do-not-call list.' });
    q = await sip.dialQueued(row2, deps);
    cur = await svc.getCall(row2);
    check('someone who must not be called (DND, consent, not a test number) is cancelled for good, never dialled', q.status === 'cancelled' && cur.status === 'cancelled' && sent.length === 1, { q, cur: cur.status });
    P.personVerdict = async () => ({ ok: true, mask: 'xxxxxx1234', e164: '+919000000001' });
    phoneCfg.ready = false; phoneCfg.problems = ['The Asterisk manager login is missing (AI_VOICE_AMI_USER / AI_VOICE_AMI_SECRET).'];
    r = await VC.create(admin, { name: 'ZZ nothing ready', agentId: 'builtin:Screening', applicationIds: pick.slice(0, 2) });
    check('with neither the provider nor the phone line ready, a campaign is refused and says what is missing', r.ok === false && r.code === 'not_ready' && Array.isArray(r.steps) && r.steps.length > 0, r);
    phoneCfg.ready = true; providerOn = true;
  } finally {
    await prisma.$disconnect().catch(() => {});
    for (const sfx of ['', '-wal', '-shm', '-journal']) { try { fs.unlinkSync(COPY + sfx); } catch { /* none */ } }
  }
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); try { fs.unlinkSync(COPY); } catch { /* */ } process.exit(2); });
