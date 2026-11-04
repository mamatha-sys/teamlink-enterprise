// ---------------------------------------------------------------------------
// AI CALLS FOR OMNI-CHANNEL (GREEN START) CONTACTS (founder 2026-11-04: Voice Calling "Start calling" must use the AI phone line TeamLink already has).
//
// Green Start's campaign engine decides WHO to call and WHEN (calling hours, retries, pacing, the contact's consent). For each due contact it asks
// TeamLink - server to server, signed with the shared one-click-sign-in secret - to make ONE call by the script of the campaign's AI agent:
//
//   POST /api/public/omni-voice/calls        { externalId, toNumber, name, script, scriptLanguage?, scripts?, agentName? }  -> { id } (the call is ringing)
//   GET  /api/public/omni-voice/calls/:id    -> { status, outcome, summary, durationSec, turns[], ended }                    (Green Start waits for ended)
//
// The call is made by the same AI phone line, gateway and script engine as the ATS AI Voice campaigns (voice/sipCall.js dialOmni, scriptDialogue.js),
// but it is not about a candidate: no application, no job, no ATS timeline. The row lives in AiCall with candidateId "omni:<externalId>" and is kept out
// of the ATS lists. Its result is only written on the row; Green Start records it in its own Voice Calling log (so utils/omniVoiceSync.js skips these rows).
// ---------------------------------------------------------------------------
const crypto = require('crypto');
const DB = require('./schema');
const svc = require('./callService');
const S = require('./scripts');
const { parseScript, ScriptDialogue } = require('./scriptDialogue');

const AUD = 'teamlink-voice';
// The ATS agent rules (300 characters, 14 lines, one question, a closing, forbidden words) do not apply to a script from Omni-Channel
const LIMITS = { maxLine: 5000, maxLines: 300, noQuestionOk: true, lenient: true }; // the team's own script, as written (founder 2026-11-04: accept any script, no layout rules)
const seen = new Map(); // jti -> expiry (a signed request is accepted once)

const secret = () => String(process.env.GREENSTART_SSO_SECRET || '');
const configured = () => secret().length >= 32;

// "Authorization: Bearer <HS256 token>" made by Green Start with the shared secret (iss greenstart, aud teamlink-voice, 60 seconds)
function verify(header) {
  if (!configured()) return { ok: false, status: 503, error: 'The shared secret with Omni-Channel is not set up on this server.' };
  const m = /^Bearer\s+([\w-]+)\.([\w-]+)\.([\w-]+)$/.exec(String(header || ''));
  if (!m) return { ok: false, status: 401, error: 'Not signed.' };
  const want = crypto.createHmac('sha256', secret()).update(`${m[1]}.${m[2]}`).digest();
  const got = Buffer.from(m[3], 'base64url');
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return { ok: false, status: 401, error: 'Not signed.' };
  let p; try { p = JSON.parse(Buffer.from(m[2], 'base64url').toString('utf8')); } catch { return { ok: false, status: 401, error: 'Not signed.' }; }
  const now = Math.floor(Date.now() / 1000);
  if (!p || p.aud !== AUD || p.iss !== 'greenstart' || !(p.exp > now) || p.exp - now > 300) return { ok: false, status: 401, error: 'The sign-in has expired.' };
  for (const [k, t] of seen) if (t < now) seen.delete(k); // eslint-disable-line no-restricted-syntax
  if (!p.jti || seen.has(p.jti)) return { ok: false, status: 401, error: 'This request was already used.' };
  seen.set(p.jti, p.exp);
  return { ok: true };
}

const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';

// the script of the agent: checked here the same way as an ATS AI Voice agent's (the lines it may not say, one Opening, a Closing, one question)
function checkScript(text, others) {
  const main = parseScript(text, LIMITS);
  if (!main.ok) return main.error;
  const bad = Object.entries(others || {}).find(([, t]) => t && !parseScript(t, LIMITS).ok);
  return bad ? `The ${bad[0]} version of the script cannot be used: ${parseScript(bad[1], LIMITS).error}` : null;
}

// the call's talk, in the shape Green Start shows
function turnsOf(row) {
  const t = svc.safeJson(row.transcript);
  return (Array.isArray(t) ? t : []).map((x) => ({ who: x.who === 'assistant' ? 'assistant' : 'candidate', text: String(x.text || '').slice(0, 600) })).filter((x) => x.text);
}

/** Make the call. Returns { ok:true, id } or { ok:false, code, reason } (nothing was dialled). */
async function create(input, deps = {}) {
  const externalId = String(input.externalId || '').slice(0, 120);
  if (!externalId) return { ok: false, status: 400, code: 'externalId', reason: 'externalId is needed.' };
  const text = String(input.script || '');
  const err = checkScript(text, input.scripts);
  if (err) return { ok: false, status: 422, code: 'script', reason: err };
  const dup = await DB.one('SELECT "id" FROM "AiCall" WHERE "dedupeKey" = ? AND "status" <> \'cancelled\'', `omni:${externalId}`);
  if (dup) return { ok: true, id: dup.id, again: true };
  const scriptJson = {
    omni: { name: String(input.name || '').slice(0, 80), externalId },
    fields: {},
    agentScript: { text, language: S.LANGS.includes(input.scriptLanguage) ? input.scriptLanguage : 'English', texts: input.scripts || {}, name: String(input.agentName || 'AI agent').slice(0, 60) },
  };
  const r = await require('./voice/sipCall').dialOmni({ externalId, toNumber: input.toNumber, language: scriptJson.agentScript.language, scriptJson }, deps); // eslint-disable-line global-require
  return r.ok ? { ok: true, id: r.id } : { ok: false, status: r.code === 'not_ready' || r.code === 'not_dialled' ? 503 : 409, code: r.code, reason: r.reason };
}

/** The call as Green Start needs it. */
async function status(id) {
  const row = await DB.one('SELECT * FROM "AiCall" WHERE "id" = ? AND "candidateId" LIKE \'omni:%\'', String(id));
  if (!row) return null;
  const ended = ['completed', 'failed', 'busy', 'no-answer', 'cancelled'].includes(row.status);
  return {
    id: row.id, status: row.status, ended, outcome: row.outcome || null, summary: row.summary || null, interest: row.interest || null, language: row.language || null,
    durationSec: Number(row.durationSec) || null, failReason: row.failReason || null, humanFollowUp: !!row.humanFollowUp, turns: ended ? turnsOf(row) : [],
    optOut: row.nextAction === 'do-not-call', callBack: row.nextAction === 'call-back',
  };
}

/** The dialogue of a call to an Omni contact (webTalk.dialogueFor). */
function dialogueFor(row, s) {
  const j = svc.safeJson(row.scriptJson) || {};
  const a = j.agentScript || {};
  const name = (j.omni && j.omni.name) || '';
  const d = new ScriptDialogue({
    purpose: row.purpose, language: row.language || 'English', data: { name, firstName: firstName(name), jobTitle: '', company: '' }, fields: {},
    recordingNotice: !!(s && (s.recording || s.keepTranscripts)), script: a.text, scriptLanguage: a.language, scripts: a.texts, scriptName: a.name, seed: row.id, limits: LIMITS,
  });
  const snap = svc.safeJson(row.botStateJson);
  if (snap && snap.step) d.restore(snap);
  return d;
}

/** The end of the call: the result is only written on the row (no ATS candidate to tell). */
async function applyResult(rowId, result, turns) {
  const history = (turns || []).slice(0, 80).map((x) => ({ who: x.who === 'assistant' ? 'assistant' : 'candidate', text: String(x.text || '').slice(0, 400) }));
  await svc.setRow(rowId, {
    outcome: result.outcome || 'Unclear', summary: String(result.summary || '').slice(0, 600), interest: result.interest || null,
    answersJson: JSON.stringify(result.answers || {}), transcript: JSON.stringify(history), humanFollowUp: result.humanFollowUpRequested ? 1 : 0, outcomePending: 0,
    nextAction: result.doNotCallRequested ? 'do-not-call' : (result.callbackRequested ? 'call-back' : null),
  });
}

module.exports = { configured, verify, create, status, dialogueFor, applyResult, checkScript };
