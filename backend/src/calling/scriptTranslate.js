// ---------------------------------------------------------------------------
// A DRAFT TRANSLATION OF A SCRIPT, by the local model (Ollama on this server: free, nothing leaves it). Only an aid for whoever writes the agent's
// script: the draft is shown, they read it and correct it, and only what they save is used on a call. The model is small, so a Telugu or Hindi
// draft can be stiff or wrong in places: that is why a person always reviews it. The labels (Opening: / Say: / Ask: / Interest: / Closing:) and the
// {name} {job} {company} {location} {salary} slots are kept as they are, and a draft that loses one is refused rather than guessed at.
// ---------------------------------------------------------------------------
const SD = require('./scriptDialogue');

const LANGS = { Telugu: 'Telugu (తెలుగు)', Hindi: 'Hindi (हिन्दी)', English: 'English' };

function ollama(env = process.env) {
  const raw = String(env.AI_CALL_OLLAMA_URL || 'http://127.0.0.1:11434').trim().replace(/\/+$/, '');
  let u;
  try { u = new URL(raw); } catch { return null; }
  // only this server or the private network: the text of a script never goes to an outside address
  if (!['127.0.0.1', 'localhost', '::1'].includes(u.hostname) && !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname)) return null;
  return { url: raw, model: String(env.AI_CALL_TRANSLATE_MODEL || '').trim(), timeoutMs: Number(env.AI_CALL_TRANSLATE_TIMEOUT_MS) || 90000 };
}

async function pickModel(c) {
  if (c.model) return c.model;
  const r = await fetch(`${c.url}/api/tags`, { signal: AbortSignal.timeout(4000) });
  const j = r.ok ? await r.json() : null;
  const names = ((j && j.models) || []).map((m) => m.name);
  return names.find((n) => /llama|qwen|gemma|mistral/i.test(n)) || names[0] || '';
}

// text (a valid script) -> { ok, text } | { ok:false, error }
async function translateScript(text, to, deps = {}) {
  const parsed = SD.parseScript(text, deps.limits);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (!LANGS[to]) return { ok: false, error: 'Pick English, Telugu or Hindi.' };
  const c = Object.prototype.hasOwnProperty.call(deps, 'config') ? deps.config : ollama();
  if (!c) return { ok: false, error: 'The local AI (Ollama) is not set up on this server, so no draft can be made. Write the lines yourself.' };
  const ask = deps.chat || (async (system, user) => {
    const model = await pickModel(c);
    if (!model) throw new Error('no model is installed in Ollama');
    const r = await fetch(`${c.url}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, stream: false, format: 'json', options: { temperature: 0.2 }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
      signal: AbortSignal.timeout(c.timeoutMs),
    });
    if (!r.ok) throw new Error(`Ollama answered ${r.status}`);
    const j = await r.json();
    return String((j && j.message && j.message.content) || '');
  });
  const system = `You translate the lines of a phone-call script for a recruitment agency in Hyderabad into ${LANGS[to]}, the way people really speak on the phone: simple everyday words, polite, short. `
    + 'English job words people use anyway (job, interview, salary, experience) may stay in English letters or be written the way they are said. '
    + 'Keep every {name} {job} {company} {location} {salary} slot exactly as it is. Never promise a job, never say selected / hired / offered. '
    + 'Reply with JSON only: {"lines":["...", "..."]} with exactly one translated line for each input line, in the same order.';
  let out;
  try {
    out = await ask(system, JSON.stringify({ lines: parsed.steps.map((s) => s.text) }));
  } catch (e) { return { ok: false, error: `The local AI could not make a draft: ${String((e && e.message) || e).slice(0, 120)}` }; }
  let lines;
  try { lines = JSON.parse(out).lines; } catch { return { ok: false, error: 'The local AI did not answer in a form that can be used. Try again or write the lines yourself.' }; }
  if (!Array.isArray(lines) || lines.length !== parsed.steps.length) return { ok: false, error: 'The draft did not have one line for each line of the script. Try again or write the lines yourself.' };
  const slots = (t) => (String(t).match(/\{(name|job|company|location|salary)\}/gi) || []).map((x) => x.toLowerCase()).sort().join(',');
  for (let i = 0; i < lines.length; i += 1) {
    if (typeof lines[i] !== 'string' || !lines[i].trim()) return { ok: false, error: `Line ${i + 1} of the draft is empty.` };
    if (slots(lines[i]) !== slots(parsed.steps[i].text)) return { ok: false, error: `Line ${i + 1} of the draft lost or changed a {name} / {job} slot. Try again or write the lines yourself.` };
  }
  const label = { opening: 'Opening', say: 'Say', ask: 'Ask', interest: 'Interest', closing: 'Closing', decline: 'Decline' };
  const draft = parsed.steps.map((s, i) => `${label[s.kind]}: ${String(lines[i]).replace(/\s+/g, ' ').trim()}`).join('\n');
  const check = SD.parseScript(draft, deps.limits);
  if (!check.ok) return { ok: false, error: `The draft cannot be used: ${check.error}` };
  return { ok: true, text: draft };
}

module.exports = { translateScript, ollama, LANGS };
