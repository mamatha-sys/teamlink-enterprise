// ---------------------------------------------------------------------------
// AI VOICE CAMPAIGNS - the AI Calling feature, run as a campaign from Omni-Channel (founder 2026-11-04: "Add a new AI Voice channel alongside
// WhatsApp, SMS, Email and RCS ... reuse the existing TeamLink AI Calling ... do NOT create a new AI Calling engine").
//
// Nothing here dials, talks or listens. Every call is an ordinary AiCall made by callService.createCalls / dispatch (the same hours,
// consent, DND, daily-limit, dedupe and retry rules as the ATS AI Calling screen), and its outcome, summary, transcript, callback and ATS
// timeline line are written by calling/outcomes.js exactly as before. This file adds only what a campaign needs on top:
//   agents      a saved purpose + language + extra wording to pick ("Screening agent", or one the team made). There was no agent concept.
//   lifecycle   scheduled / running / paused / stopped / completed (AiVoiceCampaign, same id as the bulk run's AiCallCampaign row)
//   pace        at most `concurrency` lines at once: a pass every 30 s dispatches the waiting calls of running campaigns (the 5-minute
//               reminder sweep leaves them alone, reminders.dueCalls)
//   counters    initiated / answered / completed / failed / retrying / callbacks, from the AiCall rows themselves
//   control     pause, resume, stop, retry the ones that gave up, CSV
// TWO WAYS TO RING, the ones AI Calling already has (founder 2026-11-04: "ATS lo ela undho ai calling alagey omnichannel voice lo ravali"):
//   provider   the AI Calling provider is saved and tested (Administration > Integrations > AI Calling): callService.dispatch, with its own queue + retries
//   phone      no provider, but the AI phone line is ready (the "Call with AI (phone)" button of the ATS: our own SIP line / SIM gateway, free voices, the
//              AI_VOICE_* server settings, Off / Test / Live): voice/sipCall.dialQueued. Same rules; in Test only the test numbers are rung.
// A campaign is visible to its creator and to Admins. The roles that may call are the AI Calling roles (accessVerdict), as before.
// ---------------------------------------------------------------------------
const DB = require('./schema');
const SD = require('./scriptDialogue');
const S = require('./scripts');
const svc = require('./callService');
const settingsStore = require('./settings');
const { logAudit } = require('../utils/audit');

const ATS_PURPOSES = S.PURPOSES.filter((p) => !S.PORTAL_PURPOSES.includes(p));
const AGENT_NAME = {
  Screening: 'Screening agent',
  'Shortlist Notification': 'Shortlist notification agent',
  'Interview Notification': 'Interview notification agent',
  'Interview Reminder': 'Interview reminder agent',
};
const FAILED = ['failed', 'busy', 'no-answer'];
const iso = (d = new Date()) => d.toISOString();
const isAdmin = (u) => !!u && ['SUPER_ADMIN', 'ADMIN'].includes(u.role);
const fail = svc.fail;
const clamp = (n, lo, hi, d) => { const v = Math.round(Number(n)); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
const marks = (list) => list.map(() => '?').join(',');

// ---- which way a campaign rings ------------------------------------------------------------------------------------------------------------
async function effective() {
  const base = await settingsStore.load({ fresh: true });
  if (base.configured) return { path: 'provider', s: base, mode: base.mode, problems: [] };
  const sip = require('./voice/sipCall'); // eslint-disable-line global-require
  const c = sip.config();
  if (c.ready) {
    // the same one-switch rule as the ATS phone button: the Test / Live switch of Integrations > AI Calling decides, and the test numbers saved there are callable too
    const mode = typeof sip.lineMode === 'function' ? sip.lineMode(c, base) : c.mode;
    const testNumbers = [...new Set([...c.testNumbers, ...(base.testNumbers || [])])];
    return { path: 'phone', s: { ...base, configured: true, mode, testNumbers }, mode, testNumbers: testNumbers.length, problems: [] };
  }
  return { path: null, s: base, mode: base.mode, problems: [...(base.problems || []), ...c.problems] };
}
async function readiness() {
  const e = await effective();
  return { ok: true, path: e.path, mode: e.mode, testNumbers: e.testNumbers || 0, maxBulk: e.s.maxBulk, hours: { from: e.s.hoursFrom, to: e.s.hoursTo }, problems: e.problems.slice(0, 6) };
}

// ---- agents --------------------------------------------------------------------------------------------------------------------------
const builtin = () => ATS_PURPOSES.map((p) => ({
  id: `builtin:${p}`, builtin: true, name: AGENT_NAME[p] || `${p} agent`, purpose: p, language: null, instructions: '', script: '', includeSalary: true, includeResponsibilities: true, active: true,
}));
const shapeAgent = (r) => ({
  id: r.id, builtin: false, name: r.name, purpose: r.purpose, language: r.language || null, instructions: r.instructions || '', script: r.script || '', scripts: (() => { try { return JSON.parse(r.scriptsJson || '{}') || {}; } catch { return {}; } })(),
  includeSalary: !!r.includeSalary, includeResponsibilities: !!r.includeResponsibilities, active: !!r.active, createdByName: r.createdByName || null,
});
async function listAgents() {
  const rows = await DB.all('SELECT * FROM "AiVoiceAgent" WHERE "active" = 1 ORDER BY "createdAt" ASC');
  return [...builtin(), ...rows.map(shapeAgent)];
}
async function getAgent(id) {
  const b = builtin().find((x) => x.id === id);
  if (b) return b;
  const r = await DB.one('SELECT * FROM "AiVoiceAgent" WHERE "id" = ? AND "active" = 1', id);
  return r ? shapeAgent(r) : null;
}
async function saveAgent(user, body) {
  const s = await settingsStore.load({ fresh: true });
  const acc = await svc.accessVerdict(user, null, s, { bulk: true });
  if (!acc.ok) return acc;
  const b = body || {};
  const name = S.clean(b.name, 60);
  if (!name || name.length < 2) return fail(400, 'name', 'Give the agent a name.');
  if (!ATS_PURPOSES.includes(b.purpose)) return fail(400, 'purpose', 'Pick what this agent calls for.');
  const language = b.language ? String(b.language) : '';
  if (language && !S.LANGS.includes(language)) return fail(400, 'language', 'Pick English, Telugu or Hindi, or leave it to each candidate\'s own language.');
  const fields = S.cleanFields({ instructions: b.instructions });
  const bad = S.checkFields(fields);
  if (bad) return fail(400, 'script', bad);
  // the team's own script (optional): the AI then talks by it, line by line
  const script = String(b.script || '').trim();
  let extra = {};
  if (script) {
    const p = SD.parseScript(script);
    if (!p.ok) return fail(400, 'script', p.error);
    // the other versions (the call goes on in the language the person speaks): the same lines, the same labels, in the same order
    const own = language || 'English';
    for (const lang of S.LANGS) { // eslint-disable-line no-restricted-syntax
      const t = String((b.scripts || {})[lang] || '').trim();
      if (!t || lang === own) continue; // eslint-disable-line no-continue
      const q = SD.parseScript(t);
      if (!q.ok) return fail(400, 'script', `The ${lang} script: ${q.error}`);
      if (q.steps.length !== p.steps.length || q.steps.some((x, i) => x.kind !== p.steps[i].kind)) return fail(400, 'script', `The ${lang} script must have the same lines (the same labels in the same order) as the main script.`);
      extra[lang] = t;
    }
  } else extra = {};
  const extraJson = Object.keys(extra).length ? JSON.stringify(extra) : null;
  const now = iso();
  if (b.id) {
    const had = await DB.one('SELECT "id" FROM "AiVoiceAgent" WHERE "id" = ? AND "active" = 1', b.id);
    if (!had) return fail(404, 'agent', 'That agent was not found.');
    await DB.run('UPDATE "AiVoiceAgent" SET "name"=?, "purpose"=?, "language"=?, "instructions"=?, "script"=?, "scriptsJson"=?, "includeSalary"=?, "includeResponsibilities"=?, "updatedAt"=? WHERE "id"=?',
      name, b.purpose, language || null, fields.instructions || null, script || null, extraJson, b.includeSalary === false ? 0 : 1, b.includeResponsibilities === false ? 0 : 1, now, b.id);
    return { ok: true, id: b.id };
  }
  const id = svc.newId('aiva');
  await DB.run('INSERT INTO "AiVoiceAgent" ("id","name","purpose","language","instructions","script","scriptsJson","includeSalary","includeResponsibilities","active","createdById","createdByName","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,1,?,?,?,?)',
    id, name, b.purpose, language || null, fields.instructions || null, script || null, extraJson, b.includeSalary === false ? 0 : 1, b.includeResponsibilities === false ? 0 : 1, user.id, user.name, now, now);
  await logAudit({ userId: user.id, action: 'AI Voice agent created', entity: 'AiVoiceAgent', entityId: id, toValue: `${name} (${b.purpose})`.slice(0, 200) });
  return { ok: true, id };
}
async function removeAgent(user, id) {
  const s = await settingsStore.load({ fresh: true });
  const acc = await svc.accessVerdict(user, null, s, { bulk: true });
  if (!acc.ok) return acc;
  const r = await DB.run('UPDATE "AiVoiceAgent" SET "active" = 0, "updatedAt" = ? WHERE "id" = ? AND "active" = 1', iso(), id);
  return Number(r) ? { ok: true } : fail(404, 'agent', 'That agent was not found (the built-in agents cannot be removed).');
}

// ---- counters ------------------------------------------------------------------------------------------------------------------------
async function countersFor(ids) {
  const out = new Map(ids.map((id) => [id, { total: 0, queued: 0, calling: 0, initiated: 0, answered: 0, completed: 0, failed: 0, retrying: 0, cancelled: 0, callbacks: 0 }]));
  if (!ids.length) return out;
  const rows = await DB.all(`SELECT "campaignId" AS id, COUNT(*) AS total,
      SUM(CASE WHEN "status" = 'queued' THEN 1 ELSE 0 END) AS queued,
      SUM(CASE WHEN "status" = 'calling' THEN 1 ELSE 0 END) AS calling,
      SUM(CASE WHEN "attempts" > 0 THEN 1 ELSE 0 END) AS initiated,
      SUM(CASE WHEN "status" = 'completed' THEN 1 ELSE 0 END) AS answered,
      SUM(CASE WHEN "status" = 'completed' AND "outcome" IS NOT NULL THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN "status" IN ('failed','busy','no-answer') AND "nextAttemptAt" IS NULL THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN "status" IN ('failed','busy','no-answer') AND "nextAttemptAt" IS NOT NULL THEN 1 ELSE 0 END) AS retrying,
      SUM(CASE WHEN "status" = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
    FROM "AiCall" WHERE "campaignId" IN (${marks(ids)}) GROUP BY "campaignId"`, ...ids);
  rows.forEach((r) => { const c = out.get(r.id); Object.keys(c).forEach((k) => { if (k !== 'callbacks') c[k] = Number(r[k]) || 0; }); });
  const cbs = await DB.all(`SELECT a."campaignId" AS id, COUNT(*) AS n FROM "AiCallCallback" cb JOIN "AiCall" a ON a."id" = cb."callId"
    WHERE a."campaignId" IN (${marks(ids)}) AND cb."status" = 'pending' GROUP BY a."campaignId"`, ...ids);
  cbs.forEach((r) => { out.get(r.id).callbacks = Number(r.n) || 0; });
  return out;
}

const visibleSql = (user) => (isAdmin(user) ? { where: '', params: [] } : { where: 'AND c."createdById" = ?', params: [user.id] });
async function loadCampaign(user, id) {
  const v = visibleSql(user);
  return DB.one(`SELECT c."id", c."name", c."purpose", c."requirementId", c."createdById", c."createdByName", c."total", c."createdAt", vc."status", vc."agentId", vc."agentName", vc."language", vc."concurrency",
      vc."scheduledAt", vc."startedAt", vc."endedAt", vc."note", r."title" AS jobTitle, r."reqCode" AS jobCode
    FROM "AiCallCampaign" c JOIN "AiVoiceCampaign" vc ON vc."campaignId" = c."id" LEFT JOIN "Requirement" r ON r."id" = c."requirementId"
    WHERE c."id" = ? ${v.where}`, id, ...v.params);
}
const shapeCampaign = (r, ct) => ({
  id: r.id, name: r.name, purpose: r.purpose, status: r.status, agentId: r.agentId, agentName: r.agentName, language: r.language || null, concurrency: r.concurrency,
  job: r.requirementId ? { id: r.requirementId, title: r.jobTitle || null, code: r.jobCode || null } : null, createdByName: r.createdByName || null, createdAt: r.createdAt,
  scheduledAt: r.scheduledAt || null, startedAt: r.startedAt || null, endedAt: r.endedAt || null, counters: ct,
});

async function list(user) {
  const v = visibleSql(user);
  const rows = await DB.all(`SELECT c."id", c."name", c."purpose", c."requirementId", c."createdByName", c."createdAt", vc."status", vc."agentId", vc."agentName", vc."language", vc."concurrency",
      vc."scheduledAt", vc."startedAt", vc."endedAt", r."title" AS jobTitle, r."reqCode" AS jobCode
    FROM "AiCallCampaign" c JOIN "AiVoiceCampaign" vc ON vc."campaignId" = c."id" LEFT JOIN "Requirement" r ON r."id" = c."requirementId"
    WHERE 1 = 1 ${v.where} ORDER BY c."createdAt" DESC LIMIT 100`, ...v.params);
  const ct = await countersFor(rows.map((r) => r.id));
  const items = rows.map((r) => shapeCampaign(r, ct.get(r.id)));
  const sum = (k) => items.reduce((n, c) => n + c.counters[k], 0);
  return {
    ok: true, items,
    totals: { campaigns: items.length, running: items.filter((c) => c.status === 'running').length, initiated: sum('initiated'), answered: sum('answered'), failed: sum('failed'), completed: sum('completed'), callbacks: sum('callbacks'), queued: sum('queued') },
  };
}

async function detail(user, id, { page = 1, pageSize = 25, status = '' } = {}) {
  const c = await loadCampaign(user, id);
  if (!c) return fail(404, 'campaign', 'Campaign not found.');
  const ct = (await countersFor([id])).get(id);
  const size = clamp(pageSize, 5, 100, 25);
  const off = (clamp(page, 1, 10000, 1) - 1) * size;
  const f = { all: '', answered: ` AND a."status" = 'completed'`, failed: ` AND a."status" IN ('failed','busy','no-answer')`, waiting: ` AND a."status" IN ('queued','calling')`, cancelled: ` AND a."status" = 'cancelled'` }[status] || '';
  const total = Number((await DB.one(`SELECT COUNT(*) AS n FROM "AiCall" a WHERE a."campaignId" = ?${f}`, id)).n) || 0;
  const rows = await DB.all(`SELECT a."id", a."applicationId", a."candidateId", a."status", a."attempts", a."maxAttempts", a."outcome", a."interest", a."summary", a."durationSec", a."endedAt",
      a."nextAttemptAt", a."failReason", a."waitReason", a."toMask", a."language", cd."name" AS candidateName
    FROM "AiCall" a LEFT JOIN "Candidate" cd ON cd."id" = a."candidateId" WHERE a."campaignId" = ?${f} ORDER BY a."createdAt" ASC LIMIT ? OFFSET ?`, id, size, off);
  const cbs = await DB.all(`SELECT cb."id", cb."dueAt", cb."whenText", cb."status", cb."applicationId", cb."callId", cd."name" AS candidateName
    FROM "AiCallCallback" cb JOIN "AiCall" a ON a."id" = cb."callId" LEFT JOIN "Candidate" cd ON cd."id" = cb."candidateId"
    WHERE a."campaignId" = ? AND cb."status" = 'pending' ORDER BY cb."dueAt" ASC LIMIT 100`, id);
  return { ok: true, campaign: shapeCampaign(c, ct), page: clamp(page, 1, 10000, 1), pageSize: size, total, rows, callbacks: cbs };
}

// ---- create --------------------------------------------------------------------------------------------------------------------------
// body: { name, agentId, applicationIds[], language?, concurrency?, scheduledAt?, startNow? }
async function create(user, body) {
  const b = body || {};
  const eff = await effective();
  const s = eff.s;
  if (!eff.path) return fail(409, 'not_ready', 'AI calling is not ready yet, so no campaign can start. An Admin finishes the setup in Administration > Integrations > AI Calling (or switches the AI phone line on).', { steps: eff.problems });
  const ids = [...new Set((Array.isArray(b.applicationIds) ? b.applicationIds : []).map(String).filter(Boolean))];
  if (!ids.length) return fail(400, 'items', 'Pick at least one candidate.');
  if (ids.length > s.maxBulk) return fail(400, 'too_many', `A campaign can have at most ${s.maxBulk} candidates.`);
  const agent = await getAgent(String(b.agentId || ''));
  if (!agent) return fail(400, 'agent', 'Pick an AI agent.');
  const acc = await svc.accessVerdict(user, null, s, { bulk: ids.length > 1 });
  if (!acc.ok) return acc;
  const first = await svc.loadContext(ids[0]);
  if (!first) return fail(404, 'scope', 'A picked candidate was not found.');
  const name = S.clean(b.name, 80) || `${agent.name} ${iso().slice(0, 10)}`;
  const language = b.language && S.LANGS.includes(b.language) ? b.language : (agent.language || undefined);
  const concurrency = clamp(b.concurrency, 1, 10, 2);
  const at = b.scheduledAt ? new Date(b.scheduledAt) : null;
  if (b.scheduledAt && (Number.isNaN(at.getTime()) || at.getTime() < Date.now() - 60000)) return fail(400, 'schedule', 'Pick a time that is still to come.');
  const status = b.startNow === false ? 'paused' : (at && at.getTime() > Date.now() ? 'scheduled' : 'running');
  const id = svc.newId('aicamp');
  const now = iso();
  await DB.run('INSERT INTO "AiCallCampaign" ("id","name","purpose","requirementId","createdById","createdByName","total","createdAt") VALUES (?,?,?,?,?,?,?,?)',
    id, name, agent.purpose, first.requirement.id, user.id, user.name, 0, now);
  await DB.run('INSERT INTO "AiVoiceCampaign" ("campaignId","status","agentId","agentName","language","concurrency","scheduledAt","startedAt","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?)',
    id, status, agent.id, agent.name, language || null, concurrency, status === 'scheduled' ? iso(at) : null, status === 'running' ? now : null, now, now);
  const input = {
    items: ids, purpose: agent.purpose, language, confirm: true, campaignId: id, campaignName: name, dispatch: false, via: 'campaign',
    fields: { includeSalary: agent.includeSalary, includeResponsibilities: agent.includeResponsibilities, instructions: agent.instructions },
  };
  let r;
  if (eff.path === 'provider') r = await svc.createCalls(user, input);
  else { // the AI phone line: the same createOne the provider path uses, with the phone line's own switch (Test numbers / Live) as the settings
    const results = [];
    for (const applicationId of ids) { // eslint-disable-line no-restricted-syntax
      // eslint-disable-next-line no-await-in-loop
      const one = await svc.createOne(user, applicationId, { ...input, bulk: ids.length > 1 }, s, id);
      results.push({ applicationId, ok: !!one.ok, callId: one.id || one.callId || null, code: one.code, error: one.error });
    }
    r = { ok: true, campaignId: id, results, started: results.filter((x) => x.ok).length, refused: results.filter((x) => !x.ok).length };
  }
  if (!r.ok || !r.started) {
    await DB.run('DELETE FROM "AiVoiceCampaign" WHERE "campaignId" = ?', id);
    await DB.run('DELETE FROM "AiCallCampaign" WHERE "id" = ?', id);
    if (!r.ok) return r;
    return fail(422, 'none', 'None of the picked candidates can be called now.', { refused: r.results.filter((x) => !x.ok).map((x) => ({ applicationId: x.applicationId, code: x.code, error: x.error })) });
  }
  await DB.run('UPDATE "AiCallCampaign" SET "total" = ? WHERE "id" = ?', r.started, id);
  if (agent.script) {
    // every call of the campaign carries the agent's script: the call talks by it (webTalk.dialogueFor -> scriptDialogue.js)
    for (const x of r.results.filter((y) => y.ok && y.callId)) { // eslint-disable-line no-restricted-syntax
      // eslint-disable-next-line no-await-in-loop
      const row = await svc.getCall(x.callId);
      const json = svc.safeJson(row && row.scriptJson) || {};
      // eslint-disable-next-line no-await-in-loop
      if (row) await svc.setRow(x.callId, { scriptJson: JSON.stringify({ ...json, agentScript: { name: agent.name, text: agent.script, language: agent.language || 'English', texts: agent.scripts || {} } }) });
    }
  }
  await logAudit({ userId: user.id, action: 'AI Voice campaign created', entity: 'AiCallCampaign', entityId: id, toValue: `${name}: ${r.started} candidate(s), agent ${agent.name}, ${status}`.slice(0, 200) });
  return { ok: true, id, status, path: eff.path, mode: eff.mode, started: r.started, refused: r.refused, refusals: r.results.filter((x) => !x.ok).map((x) => ({ applicationId: x.applicationId, code: x.code, error: x.error })) };
}

// ---- control -------------------------------------------------------------------------------------------------------------------------
async function setStatus(id, status, extra = {}) {
  const sets = ['"status" = ?', '"updatedAt" = ?'];
  const params = [status, iso()];
  Object.entries(extra).forEach(([k, v]) => { sets.push(`"${k}" = ?`); params.push(v); });
  await DB.run(`UPDATE "AiVoiceCampaign" SET ${sets.join(', ')} WHERE "campaignId" = ?`, ...params, id);
}
async function control(user, id, action) {
  const c = await loadCampaign(user, id);
  if (!c) return fail(404, 'campaign', 'Campaign not found.');
  const s = await settingsStore.load({ fresh: true });
  const acc = await svc.accessVerdict(user, null, s);
  if (!acc.ok) return acc;
  const st = c.status;
  if (action === 'pause') {
    if (!['running', 'scheduled'].includes(st)) return fail(409, 'state', 'Only a running or scheduled campaign can be paused.');
    await setStatus(id, 'paused');
  } else if (action === 'resume') {
    if (st !== 'paused') return fail(409, 'state', 'Only a paused campaign can be resumed.');
    await setStatus(id, 'running', { startedAt: c.startedAt || iso() });
  } else if (action === 'stop') {
    if (!['running', 'scheduled', 'paused'].includes(st)) return fail(409, 'state', 'This campaign is already finished.');
    const waiting = await DB.all(`SELECT "id" FROM "AiCall" WHERE "campaignId" = ? AND ("status" = 'queued' OR ("status" IN ('failed','busy','no-answer') AND "nextAttemptAt" IS NOT NULL))`, id);
    for (const w of waiting) { // eslint-disable-line no-restricted-syntax
      // eslint-disable-next-line no-await-in-loop
      const row = await svc.getCall(w.id);
      // eslint-disable-next-line no-await-in-loop
      if (row) await svc.cancelWith(row, `Campaign stopped by ${user.name}.`, user);
    }
    await setStatus(id, 'stopped', { endedAt: iso() });
  } else if (action === 'retry-failed') {
    // the ones that gave up (every attempt used): one more attempt each, paced by the campaign like the rest
    const rows = await DB.all(`SELECT "id","attempts" FROM "AiCall" WHERE "campaignId" = ? AND "status" IN ('failed','busy','no-answer') AND "nextAttemptAt" IS NULL`, id);
    if (!rows.length) return fail(409, 'state', 'No call has given up in this campaign.');
    const t = iso();
    for (const r of rows) { // eslint-disable-line no-restricted-syntax
      // eslint-disable-next-line no-await-in-loop
      await svc.setRow(r.id, { status: 'queued', maxAttempts: Number(r.attempts) + 1, nextAttemptAt: t, failReason: null, waitReason: null });
    }
    if (['completed'].includes(st)) await setStatus(id, 'running', { endedAt: null });
    await logAudit({ userId: user.id, action: 'AI Voice campaign: retry failed', entity: 'AiCallCampaign', entityId: id, toValue: `${rows.length} call(s)` });
    return { ok: true, status: st === 'completed' ? 'running' : st, retried: rows.length };
  } else return fail(400, 'action', 'Unknown action.');
  await logAudit({ userId: user.id, action: `AI Voice campaign: ${action}`, entity: 'AiCallCampaign', entityId: id, toValue: c.name.slice(0, 120) });
  return { ok: true, status: (await loadCampaign(user, id)).status };
}

// ---- the pass that paces the running campaigns ---------------------------------------------------------------------------------------
let busy = false;
async function tick() {
  if (busy) return { skipped: true };
  busy = true;
  const out = { started: 0, completed: 0 };
  try {
    const t = iso();
    await DB.run(`UPDATE "AiVoiceCampaign" SET "status" = 'running', "startedAt" = COALESCE("startedAt", ?), "updatedAt" = ? WHERE "status" = 'scheduled' AND "scheduledAt" <= ?`, t, t, t);
    const camps = await DB.all(`SELECT * FROM "AiVoiceCampaign" WHERE "status" = 'running'`);
    const eff = camps.length ? await effective() : null;
    const dial = eff && eff.path === 'phone' ? require('./voice/sipCall').dialQueued : svc.dispatch; // eslint-disable-line global-require
    for (const c of camps) { // eslint-disable-line no-restricted-syntax
      if (eff && eff.path === 'phone') {
        // the phone line has no retry of its own: a call that did not connect, with attempts left, is tried again after the AI Calling gaps (default 30 min, then 2 h)
        // eslint-disable-next-line no-await-in-loop
        const gone = await DB.all(`SELECT "id","attempts","endedAt" FROM "AiCall" WHERE "campaignId" = ? AND "status" IN ('failed','busy','no-answer') AND "nextAttemptAt" IS NULL AND "attempts" < "maxAttempts"`, c.campaignId);
        for (const g of gone) { // eslint-disable-line no-restricted-syntax
          // eslint-disable-next-line no-await-in-loop
          await svc.setRow(g.id, { nextAttemptAt: new Date((g.endedAt ? new Date(g.endedAt).getTime() : Date.now()) + svc.gapFor(eff.s, Number(g.attempts))).toISOString(), waitReason: 'Trying again later.' });
        }
      }
      // eslint-disable-next-line no-await-in-loop
      const inflight = Number((await DB.one(`SELECT COUNT(*) AS n FROM "AiCall" WHERE "campaignId" = ? AND "status" = 'calling'`, c.campaignId)).n) || 0;
      const slots = Math.max(0, c.concurrency - inflight);
      if (slots > 0) {
        // eslint-disable-next-line no-await-in-loop
        const due = await DB.all(`SELECT "id" FROM "AiCall" WHERE "campaignId" = ? AND ("status" = 'queued' OR ("status" IN ('failed','busy','no-answer') AND "nextAttemptAt" IS NOT NULL))
          AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ?) ORDER BY COALESCE("nextAttemptAt", "createdAt") ASC LIMIT ?`, c.campaignId, t, slots);
        for (const d of due) { // eslint-disable-line no-restricted-syntax
          // eslint-disable-next-line no-await-in-loop
          const r = await dial(d.id);
          if (r && r.status === 'calling') out.started += 1;
        }
      }
      // eslint-disable-next-line no-await-in-loop
      const open = Number((await DB.one(`SELECT COUNT(*) AS n FROM "AiCall" WHERE "campaignId" = ? AND ("status" IN ('queued','calling') OR ("status" IN ('failed','busy','no-answer') AND "nextAttemptAt" IS NOT NULL))`, c.campaignId)).n) || 0;
      if (open === 0) { await setStatus(c.campaignId, 'completed', { endedAt: iso() }); out.completed += 1; } // eslint-disable-line no-await-in-loop
    }
  } catch (err) {
    out.error = String((err && err.message) || err).slice(0, 200);
  } finally {
    busy = false;
  }
  return out;
}

// ---- CSV -----------------------------------------------------------------------------------------------------------------------------
const cell = (v) => {
  let t = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`; // a spreadsheet must never read a name or a summary as a formula
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
async function exportCsv(user, id) {
  const c = await loadCampaign(user, id);
  if (!c) return fail(404, 'campaign', 'Campaign not found.');
  const rows = await DB.all(`SELECT a."status", a."attempts", a."outcome", a."interest", a."summary", a."durationSec", a."endedAt", a."toMask", a."language", cd."name" AS candidateName
    FROM "AiCall" a LEFT JOIN "Candidate" cd ON cd."id" = a."candidateId" WHERE a."campaignId" = ? ORDER BY a."createdAt" ASC LIMIT 5000`, id);
  const head = ['Candidate', 'Phone', 'Language', 'Status', 'Attempts', 'Outcome', 'Interest', 'Summary', 'Duration (s)', 'Ended'];
  const lines = [head.join(',')].concat(rows.map((r) => [r.candidateName, r.toMask, r.language, r.status, r.attempts, r.outcome, r.interest, r.summary, r.durationSec, r.endedAt].map(cell).join(',')));
  return { ok: true, filename: `ai-voice-${String(c.name).replace(/[^a-z0-9]+/gi, '-').slice(0, 40).toLowerCase()}.csv`, csv: `${lines.join('\r\n')}\r\n` };
}

// a DRAFT of the script in another language, by the local model; only what the author saves is used
async function draftScript(user, { script, to }) {
  const s = await settingsStore.load({ fresh: true });
  const acc = await svc.accessVerdict(user, null, s, { bulk: true });
  if (!acc.ok) return acc;
  const r = await require('./scriptTranslate').translateScript(String(script || ''), to); // eslint-disable-line global-require
  return r.ok ? { ok: true, text: r.text } : fail(422, 'draft', r.error);
}

let timer = null;
function startSchedule() {
  if (timer || process.env.NODE_ENV === 'test') return;
  setTimeout(() => { tick().catch(() => {}); }, 20 * 1000);
  timer = setInterval(() => { tick().catch(() => {}); }, 30 * 1000);
  if (timer.unref) timer.unref();
}

module.exports = { draftScript, effective, readiness, listAgents, getAgent, saveAgent, removeAgent, list, detail, create, control, tick, exportCsv, startSchedule, countersFor, ATS_PURPOSES, FAILED };
