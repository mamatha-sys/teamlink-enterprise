// ---------------------------------------------------------------------------
// TALK BY THE TEAM'S OWN SCRIPT (founder 2026-11-04: "ai calling kii script estey aa script kii thaginatuu matladaliii").
//
// An AI Voice agent can carry a script written by the team. The call then follows it line by line, in the words written, instead of the built-in
// questions of its purpose. It is still the existing AI Calling: the same Dialogue class (so the gateway, the web link, the transcript, the outcome
// check, the call-back, the do-not-call and the ATS timeline write-back all work unchanged), with the lines coming from the script.
//
// The script is plain text, one line per step. A line starts with what it is:
//   Opening:  what the AI says first (the person's name is asked for in it, so a wrong number is noticed)        - the first line
//   Say:      something told without a question; it is spoken together with the next line
//   Ask:      a question; the answer is kept word for word on the call (a line with no label is an Ask)
//   Interest: a yes / no question about the job: yes = interested, no = not interested (the call ends politely)
//   Closing:  the last sentence (required)
// {name} {job} {company} {location} {salary} are filled from the candidate and the vacancy (verified data only).
//
// LANGUAGE (founder 2026-11-04: "language switch avalii"): the same script can be saved in English, Telugu and Hindi (same lines, same labels). The call
// starts in the agent's language and, the moment the person speaks another one, goes on in THAT language - without announcing it, like a person who speaks
// both would - using that language's version of the script. A language with no saved version cannot be switched to: the call stays in the language it has.
//
// What it does NOT do: it never answers a question from its own knowledge (a question is noted for the recruiter and the script goes on), never
// says selected / hired / offered (a script with such words is refused when it is saved), and it understands the same stop / call-me-later / wrong
// person / recruiter words as every AI call. It does not choose the language: the call speaks the language of the agent, and the script is written in it.
// ---------------------------------------------------------------------------
const S = require('./scripts');
const D = require('./dialogue');

const KINDS = { opening: 'opening', say: 'say', ask: 'ask', interest: 'interest', closing: 'closing' };
const MAX_STEPS = 14;
const MAX_LINE = 300;

// text -> { ok, steps:[{ kind, text }], error }
// lim: { maxLines, maxLine } - a script from Omni-Channel (Green Start) may have longer lines and more steps than an ATS agent script
function parseScript(raw, lim = {}) {
  const maxSteps = lim.maxLines || MAX_STEPS;
  const maxLine = lim.maxLine || MAX_LINE;
  const lines = String(raw == null ? '' : raw).replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { ok: false, steps: [], error: 'The script is empty.' };
  if (lines.length > maxSteps) return { ok: false, steps: [], error: `A script can have at most ${maxSteps} lines.` };
  const steps = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(opening|say|ask|interest|closing)\s*[:\-–]\s*(.*)$/i.exec(lines[i]);
    const kind = m ? KINDS[m[1].toLowerCase()] : (i === 0 ? 'opening' : 'ask');
    const text = (m ? m[2] : lines[i]).trim();
    if (!text) return { ok: false, steps: [], error: `Line ${i + 1} has a label but no words.` };
    if (text.length > maxLine) return { ok: false, steps: [], error: `Line ${i + 1} is too long (at most ${maxLine} characters).` };
    if (S.hasForbidden(text.replace(/\{[a-z]+\}/gi, ''))) return { ok: false, steps: [], error: `Line ${i + 1} uses words the assistant must never say (selected, hired, offered, congratulations, a promise of a job).` };
    steps.push({ kind, text });
  }
  if (steps[0].kind !== 'opening') return { ok: false, steps: [], error: 'The first line must be the opening ("Opening: Hello {name}, ...").' };
  if (steps.slice(1).some((s) => s.kind === 'opening')) return { ok: false, steps: [], error: 'There can be only one Opening line, and it is the first.' };
  const ci = steps.findIndex((s) => s.kind === 'closing');
  if (ci < 0) return { ok: false, steps: [], error: 'The last line must be the closing ("Closing: Thank you for your time...").' };
  if (ci !== steps.length - 1) return { ok: false, steps: [], error: 'The Closing line must be the last line.' };
  if (!steps.some((s) => s.kind === 'ask' || s.kind === 'interest')) return { ok: false, steps: [], error: 'Add at least one question (a line starting with "Ask:" or "Interest:").' };
  return { ok: true, steps, error: null };
}

const fillWith = (text, data) => String(text).replace(/\{(name|job|company|location|salary)\}/gi, (_, k) => {
  const key = k.toLowerCase();
  const map = { name: data.firstName || data.name, job: data.jobTitle, company: data.company || data.clientName, location: data.location || data.jobLocation, salary: data.salary };
  return S.clean(map[key] == null ? '' : map[key], 80);
}).replace(/\s{2,}/g, ' ').trim();

class ScriptDialogue extends D.Dialogue {
  // opts: Dialogue's, plus script (the text, in scriptLanguage), scripts ({ Telugu: text, Hindi: text, English: text }: the other versions) and scriptName
  constructor(opts) {
    super({ ...opts, autoLanguage: false, brain: null });
    const main = parseScript(opts.script, opts.limits);
    if (!main.ok) throw new Error(`The agent's script cannot be used: ${main.error}`);
    const first = S.LANGS.includes(opts.scriptLanguage) ? opts.scriptLanguage : (S.LANGS.includes(opts.language) ? opts.language : 'English');
    this.byLang = { [first]: main.steps };
    const sameShape = (a, b) => a.length === b.length && a.every((x, i) => x.kind === b[i].kind);
    Object.entries(opts.scripts || {}).forEach(([lang, text]) => {
      if (!S.LANGS.includes(lang) || lang === first || !text) return;
      const p = parseScript(text, opts.limits);
      if (p.ok && sameShape(p.steps, main.steps)) this.byLang[lang] = p.steps; // a version that does not match line for line is not used
    });
    this.scriptLanguage = first;
    this.autoLanguage = Object.keys(this.byLang).length > 1; // follow the person's language only when there is another version to speak
    // the language the call starts in: the call's own if the script has it, else the script's
    if (!this.byLang[this.language]) this.setLanguage(first);
    this.scriptName = String(opts.scriptName || 'script');
    this.st.script = { idx: 0, got: [], silent: 0 };
  }

  get steps() { return this.byLang[this.language] || this.byLang[this.scriptLanguage]; }

  line(i) { return fillWith(this.steps[i].text, this.data); }

  // what is spoken from step i on: Say lines first, up to and including the next question (or the closing)
  upTo(i) {
    const parts = [];
    let j = i;
    while (j < this.steps.length) {
      const s = this.steps[j];
      if (s.kind === 'closing') return { parts, closing: this.line(j), stopAt: j };
      parts.push(this.line(j));
      if (s.kind === 'ask' || s.kind === 'interest') return { parts, stopAt: j };
      j += 1;
    }
    return { parts, stopAt: j }; // only Say lines left: the call ends after them
  }

  start() {
    const text = this.speak(this.line(0));
    this.st.step = 'script';
    this.st.script.idx = 0;
    return { say: text, done: false };
  }

  again() { return this.st.lastAsk || this.line(this.st.script.idx); }

  // no reply at all (the gateway's quiet timer): "are you still there?" twice, then a polite end - then the script's line again
  silent() {
    const s = this.st;
    s.silent += 1;
    if (s.silent >= 3) return this.endWith('Unclear', 'no answer heard', this.P.noAnswerClose);
    return { say: this.speak(s.silent === 1 ? this.P.stillThere : this.P.stillThere2, this.again()), done: false };
  }

  endWith(outcome, why, sentence) {
    const line = sentence || (this.steps[this.steps.length - 1].kind === 'closing' ? this.line(this.steps.length - 1) : this.P.closeUnclear);
    this.st.outcome = outcome;
    return this.finish(this.speak(line), why);
  }

  async hear(textIn, meta = {}) {
    if (this.st.done) return { say: '', done: true };
    const st = this.st;
    const sc = st.script;
    const text = String(textIn == null ? '' : textIn).slice(0, 600);
    const heardAs = meta.heard === 'unclear' ? 'unclear' : (text.trim() ? 'clear' : 'none');
    st.turns += 1;
    const turn = { who: 'candidate', text: S.clean(text, 300), heard: heardAs, at: new Date().toISOString() };
    if (meta.lang) turn.lang = meta.lang;
    if (meta.conf) turn.conf = meta.conf;
    st.transcript.push(turn);
    if (st.turns > Math.max(this.maxTurns, this.steps.length * 3 + 6)) return this.endWith('Unclear', 'too many turns');
    // not heard reliably: asked again (twice), then a polite end; nothing is guessed
    if (heardAs === 'unclear' || heardAs === 'none') {
      turn.understood = 'not_clear';
      sc.silent += 1;
      if (sc.silent > 2) return this.endWith('Unclear', 'could not hear the person clearly', this.P.audioClose);
      return { say: this.speak(this.P.notClear, this.again()), done: false };
    }
    sc.silent = 0;
    // the person's language: from this sentence on, the script goes on in it (not announced). A language the script has no version of is not switched to.
    if (this.autoLanguage) {
      const byWords = D.detectLanguage(text);
      // the phone gateway also judges the language by SOUND (and checks real Telugu / Hindi words); when it moved the call, that outranks the spelling of the words
      const bySound = meta.lang && meta.lang !== this.language && S.LANGS.includes(meta.lang) ? { lang: meta.lang, only: !!(byWords && byWords.only) } : null;
      const lg = bySound || byWords;
      const shortEnglish = lg && lg.lang === 'English' && this.language !== 'English' && !lg.only && text.trim().split(/\s+/).length < 4;
      if (lg && lg.lang !== this.language && !shortEnglish && this.byLang[lg.lang]) {
        this.setLanguage(lg.lang);
        st.switched = (st.switched || 0) + 1;
        if (lg.only) { turn.understood = 'language'; return { say: this.speak(this.line(sc.idx)), done: false }; } // "Telugu lo matladandi": the same question, now in Telugu
      }
    }
    const k = D.classify(text);
    turn.understood = k.intent;
    st.lastHeard = text;
    if (k.human) st.human = true;
    const cur = this.steps[sc.idx];

    // the same safety words as every AI call
    if (k.intent === 'stop') { st.stop = true; return this.endWith('Not Interested', 'asked not to be called again', this.P.closeNotInterested); }
    if (k.intent === 'cant_hear') return { say: this.speak(this.again()), done: false };
    if (k.intent === 'repeat') return { say: this.speak(this.again()), done: false };
    if (k.intent === 'later') { st.callback = true; st.callbackWhen = S.clean(text, 120); return this.endWith('Call Back Later', 'asked for a call back', this.P.laterClose); }
    if (k.human || k.intent === 'human') return this.endWith('Call Back Later', 'asked for a recruiter', this.P.humanNoted);

    // the opening: the person's name is confirmed (or it is a wrong number)
    if (cur.kind === 'opening') {
      if (k.intent === 'no') { st.wrong = true; return this.endWith('Unclear', 'wrong person', this.P.closeUnclear); }
      st.identity = true;
    } else {
      // a question the script cannot answer from verified facts is noted for the recruiter, never answered from memory
      if (k.intent === 'info_q' || k.intent === 'salary_q' || k.intent === 'ai_q' || k.intent === 'other_cand') {
        const q = S.clean(text, 200);
        if (q && !st.pending.includes(q) && st.pending.length < 5) st.pending.push(q);
        turn.understood = 'question_noted';
        return { say: this.speak(this.again()), done: false }; // the question again; the person's own question is for the team
      }
      if (cur.kind === 'interest') {
        if (k.intent === 'no') { st.interest = 'no'; st.declineReason = S.clean(text, 120); sc.got.push({ q: this.line(sc.idx), a: S.clean(text, 160) }); return this.endWith('Not Interested', 'not interested'); }
        if (k.intent === 'yes') st.interest = 'yes';
        else if (k.intent === 'maybe') st.interest = 'unsure';
        else { // not a plain yes / no: asked once more, then taken as unsure
          sc.silent += 1;
          if (sc.silent <= 1) return { say: this.speak(this.again()), done: false };
          st.interest = 'unsure';
        }
      }
      sc.got.push({ q: this.line(sc.idx), a: S.clean(text, 160) });
    }
    // on to the next question (Say lines are spoken with it); no more questions: the closing
    const nxt = this.upTo(sc.idx + 1);
    if (nxt.closing !== undefined || nxt.stopAt >= this.steps.length) {
      const outcome = st.interest === 'no' ? 'Not Interested' : (st.interest === 'yes' ? 'Interested' : 'Unclear');
      return this.endWith(outcome, 'script finished', S.clean([...nxt.parts, nxt.closing].filter(Boolean).join(' '), 600) || undefined);
    }
    sc.idx = nxt.stopAt;
    sc.silent = 0;
    return { say: this.speak(...nxt.parts), done: false };
  }

  summaryText() {
    const st = this.st;
    const bits = [`AI call by the team's script "${this.scriptName}" (${this.language}).`];
    if (st.wrong) bits.push('Wrong person on the line. No details were shared.');
    else bits.push(st.identity ? 'Name confirmed.' : 'The person did not confirm their name.');
    if (st.interest === 'yes') bits.push('Interested.'); else if (st.interest === 'no') bits.push('Not interested.'); else if (st.interest === 'unsure') bits.push('Not sure about the job.');
    (st.script.got || []).forEach((g) => bits.push(`${S.clean(g.q, 70)} → "${S.clean(g.a, 70)}".`));
    if (st.callback) bits.push(`Asked for a call back${st.callbackWhen ? `: ${st.callbackWhen}` : ''}.`);
    if (st.human) bits.push('Asked to speak to a recruiter.');
    if (st.stop) bits.push('Asked not to be called again.');
    if (st.pending && st.pending.length) bits.push(`Asked (the team must answer): ${st.pending.join(' | ')}.`);
    if (st.switched) bits.push(`The person spoke ${this.language}, so the call went on in ${this.language}.`);
    return bits.filter(Boolean).join(' ');
  }
}

module.exports = { parseScript, ScriptDialogue, fillWith, MAX_STEPS };
