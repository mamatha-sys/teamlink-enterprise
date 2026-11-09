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
//   Language: "which language are you comfortable with?": the call goes on in the one the person names (a call built from the facts of a vacancy)
//   IfYes / IfNo: a question asked only after a yes / a no to the question before it
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
const vacancy = require('./vacancyScript');
const D = require('./dialogue');

const KINDS = { opening: 'opening', say: 'say', ask: 'ask', interest: 'interest', closing: 'closing', decline: 'decline', convince: 'convince', language: 'language', ifyes: 'ifyes', ifno: 'ifno' };
// the lines the person answers. IfYes / IfNo: asked only after a yes / a no to the question before them; Language: which language the person wants
const ASKS = ['ask', 'interest', 'ifyes', 'ifno', 'language'];
const isAsk = (kind) => ASKS.includes(kind);
const OWN_ACK = /^(that is|thank|perfect|great|no problem|పర్వాలేదు|థాంక్యూ|ధన్యవాదాలు|మీ సమయానికి|చాలా బాగుంది|कोई बात नहीं|धन्यवाद|आपके समय|बहुत अच्छा)/i;
const MAX_STEPS = 14;
// PACE (founder 2026-11-09: "AI matladuthuney undi, pause raavatledhu, script lo em undho adhey continuous ga chepthundi"): a run of Say lines is never spoken in one go;
// after about this many characters the call stops and waits for the person ("okay", "yes", a question), then goes on with the next part
const CHUNK = 260;
const REFUSE = /\b(not going to|don'?t want|do not want|no interest|not interested|not required|not looking|leave me|stop talking)\b|వద్దు|ఇష్టం లేదు|నాకు అక్కర్లేదు|नहीं चाहिए|मुझे नहीं/i;
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
    const m = /^(opening|say|ask|interest|closing|decline|convince|language|ifyes|ifno)\s*[:\-–]\s*(.*)$/i.exec(lines[i]);
    const kind = m ? KINDS[m[1].toLowerCase()] : (i === 0 ? 'opening' : 'ask');
    const text = (m ? m[2] : lines[i]).trim();
    if (!text) return { ok: false, steps: [], error: `Line ${i + 1} has a label but no words.` };
    if (text.length > maxLine) return { ok: false, steps: [], error: `Line ${i + 1} is too long (at most ${maxLine} characters).` };
    if (!lim.lenient && S.hasForbidden(text.replace(/\{[a-z]+\}/gi, ''))) return { ok: false, steps: [], error: `Line ${i + 1} uses words the assistant must never say (selected, hired, offered, congratulations, a promise of a job).` };
    steps.push({ kind, text });
  }
  if (lim.lenient) { // the team's own script, as written: the first line opens the call, a closing is not needed, and a label in the wrong place is only a plain line
    steps[0].kind = 'opening';
    const lastClosing = steps.map((s) => s.kind).lastIndexOf('closing');
    steps.forEach((s, i) => { if (i > 0 && s.kind === 'opening') s.kind = 'say'; if (s.kind === 'closing' && i !== lastClosing) s.kind = 'say'; });
    return { ok: true, steps, error: null };
  }
  if (steps[0].kind !== 'opening') return { ok: false, steps: [], error: 'The first line must be the opening ("Opening: Hello {name}, ...").' };
  if (steps.slice(1).some((s) => s.kind === 'opening')) return { ok: false, steps: [], error: 'There can be only one Opening line, and it is the first.' };
  const ci = steps.findIndex((s) => s.kind === 'closing');
  if (ci < 0) return { ok: false, steps: [], error: 'The last line must be the closing ("Closing: Thank you for your time...").' };
  if (ci !== steps.length - 1) return { ok: false, steps: [], error: 'The Closing line must be the last line.' };
  if (!lim.noQuestionOk && !steps.some((s) => s.kind === 'ask' || s.kind === 'interest')) return { ok: false, steps: [], error: 'Add at least one question (a line starting with "Ask:" or "Interest:").' };
  return { ok: true, steps, error: null };
}

// HOW A PERSON SOUNDS (founder 2026-11-04: "human laga matladali, ai laga kakunda"): a short "okay" before the next line, a short "sorry, once more" (not the whole greeting again),
// and a "hello? can you hear me?" when the first answer is not heard. The words of the script itself are never changed.
const HUMAN = {
  English: {
    ack: ['Okay.', 'Alright.', 'Sure.', 'Okay, thanks.', 'Right.'], no: ['Alright, no problem.', 'Okay, understood.', 'Sure, that is fine.'],
    noted: 'That is a good question. I do not have that detail in front of me, but our recruiter will confirm it with you directly.',
    reason: 'I understand. May I ask why? If something about the role is the concern, I will note it for our team.',
    sorry: ['Sorry, could you say that once more?', 'Sorry, I missed that. Could you repeat?', 'Sorry, the line is not clear. One more time please?'], hear: 'Hello? Can you hear me okay?',
  },
  Telugu: {
    ack: ['సరే.', 'అర్థమైంది.', 'బాగుంది.', 'ఓకే.'], no: ['సరే, పర్వాలేదు.', 'సరే, అర్థమైంది.'],
    noted: 'మంచి ప్రశ్న. ఆ వివరం ఇప్పుడు నా దగ్గర లేదు, కానీ మా రిక్రూటర్ మీకు డైరెక్ట్‌గా కన్ఫర్మ్ చేస్తారు.',
    reason: 'అర్థమైంది. కారణం చెప్పగలరా? ఏదైనా సమస్య ఉంటే మా టీమ్ కి తెలియజేస్తాను.',
    sorry: ['క్షమించండి, ఇంకోసారి చెప్తారా?', 'సారీ, సరిగ్గా వినపడలేదు. మళ్ళీ చెప్తారా?', 'క్షమించండి, లైన్ సరిగా లేదు. ఇంకోసారి చెప్పండి.'], hear: 'హలో? నేను చెప్పేది వినపడుతోందా?',
  },
  Hindi: {
    ack: ['ठीक है।', 'जी, ठीक है।', 'अच्छा।', 'जी।'], no: ['ठीक है, कोई बात नहीं।', 'जी, समझ गया।'],
    noted: 'अच्छा सवाल है। यह जानकारी अभी मेरे पास नहीं है, लेकिन हमारे रिक्रूटर आपको सीधे कन्फर्म कर देंगे।',
    reason: 'समझ गया। क्या मैं कारण जान सकता हूँ? अगर भूमिका में कोई समस्या है तो मैं अपनी टीम को बता दूँगा।',
    sorry: ['माफ़ कीजिए, एक बार फिर से बोलेंगे?', 'सॉरी, ठीक से सुनाई नहीं दिया। दोबारा बोलिए।', 'माफ़ कीजिए, आवाज़ साफ़ नहीं आ रही। एक बार और बोलिए।'], hear: 'हैलो? आपको मेरी आवाज़ आ रही है?',
  },
};

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
    // a "Decline:" line is what is said when the person is not interested (instead of the Closing); it is not one of the steps
    const split = (steps) => ({ steps: steps.filter((s) => s.kind !== 'decline' && s.kind !== 'convince'), decline: (steps.find((s) => s.kind === 'decline') || {}).text || null, convince: steps.filter((s) => s.kind === 'convince').map((s) => s.text) });
    const mainSplit = split(main.steps);
    this.byLang = { [first]: mainSplit.steps };
    this.declines = { [first]: mainSplit.decline };
    this.convinces = { [first]: mainSplit.convince };
    const sameShape = (a, b) => a.length === b.length && a.every((x, i) => x.kind === b[i].kind);
    Object.entries(opts.scripts || {}).forEach(([lang, text]) => {
      if (!S.LANGS.includes(lang) || lang === first || !text) return;
      const p = parseScript(text, opts.limits);
      const ps = p.ok ? split(p.steps) : null;
      if (ps && sameShape(ps.steps, mainSplit.steps)) { this.byLang[lang] = ps.steps; this.declines[lang] = ps.decline; this.convinces[lang] = ps.convince; } // a version that does not match line for line is not used
    });
    this.scriptLanguage = first;
    this.contactNumber = opts.contactNumber || null; // the recruiter's number: told to a candidate who asks where to send the resume
    this.facts = opts.facts || null; // the facts of a vacancy: a person's questions about the pay, the place ... are answered from them
    // no question in the script (only what the AI says): the call says all of it and ends
    this.noQuestion = !mainSplit.steps.some((s) => isAsk(s.kind));
    this.longMessage = this.noQuestion && mainSplit.steps.reduce((n, s) => n + s.text.length, 0) > CHUNK + 60; // told in parts, not all at once
    this.autoLanguage = Object.keys(this.byLang).length > 1; // follow the person's language only when there is another version to speak
    // the language the call starts in: the call's own if the script has it, else the script's
    if (!this.byLang[this.language]) this.setLanguage(first);
    this.scriptName = String(opts.scriptName || 'script');
    this.st.script = { idx: 0, got: [], silent: 0 };
  }

  // what is said when the person is not interested (the script's own "Decline" line, in the language of the call)
  get declineLine() { const t = this.declines[this.language] || this.declines[this.scriptLanguage]; return t ? fillWith(t, this.data) : null; }

  // when the person says no: the script's own "Convince" lines, one at a time; with none, one question - why? - so the reason is heard and noted for the team
  nextPitch() {
    const list = this.convinces[this.language] || this.convinces[this.scriptLanguage] || [];
    const own = list.map((t) => fillWith(t, this.data));
    const pitches = own.length ? own.slice(0, 2) : [(HUMAN[this.language] || HUMAN.English).reason];
    const n = this.st.pitchCount || 0;
    if (n >= pitches.length) return null;
    this.st.pitchCount = n + 1;
    return pitches[n];
  }

  get steps() { return this.byLang[this.language] || this.byLang[this.scriptLanguage]; }

  line(i) { return fillWith(this.steps[i].text, this.data).replace('{greet}', this.facts ? vacancy.greeting(this.language) : ''); }

  // what is spoken from step i on: Say lines first, up to and including the next question (or the closing)
  upTo(i) {
    const parts = [];
    let j = i;
    while (j < this.steps.length) {
      const s = this.steps[j];
      if (s.kind === 'closing') return { parts, closing: this.line(j), stopAt: j };
      const branchNo = !!this.st.script.branchNo;
      if ((s.kind === 'ifyes' && branchNo) || (s.kind === 'ifno' && !branchNo)) { j += 1; continue; } // eslint-disable-line no-continue
      parts.push(this.line(j));
      if (isAsk(s.kind)) return { parts, stopAt: j };
      if (parts.join(' ').length >= CHUNK && this.steps[j + 1] && this.steps[j + 1].kind === 'say') return { parts, stopAt: j, checkpoint: true }; // a pause: the person answers, then the next part
      j += 1;
    }
    return { parts, stopAt: j }; // only Say lines left: the call ends after them
  }

  start() {
    if (this.noQuestion && !this.longMessage) { // nothing to ask: Opening, the Say lines and the Closing are said together, then the call ends
      this.st.step = 'script';
      this.st.messageOnly = true; // the message was delivered: not an unanswered call (Omni-Channel must not ring this person again)
      return this.endWith('Unclear', 'the message was said (the script has no question)', this.steps.map((_, i) => this.line(i)).join(' '));
    }
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
    // a person who said no is asked once whether we may reach out again; then the call ends kindly
    if (this.facts && outcome === 'Not Interested' && !this.st.stop && !this.st.keepDone) {
      this.st.keepDone = true; this.st.keepWhy = why; this.st.sub = 'keep';
      return { say: this.speak(vacancy.words(this.facts, this.language).keep()), done: false };
    }
    const line = sentence || (this.steps[this.steps.length - 1].kind === 'closing' ? this.line(this.steps.length - 1) : this.P.closeUnclear);
    this.st.outcome = outcome;
    return this.finish(this.speak(line), why);
  }

  async hear(textIn, meta = {}) {
    if (this.st.done) return { say: '', done: true };
    const st = this.st;
    const sc = st.script;
    const text = String(textIn == null ? '' : textIn).slice(0, 600);
    const atOpening = sc.idx === 0 && this.steps[0] && this.steps[0].kind === 'opening' && !st.identity;
    let heardAs = meta.heard === 'unclear' ? (atOpening ? 'clear' : 'unclear') : (text.trim() ? 'clear' : 'none');
    // an OPEN question (where are you, how many years, what qualification, notice period, salary): whatever was written for the answer is kept as the answer, it is not asked again (founder 2026-11-05:
    // the call was closed with "your network is not good" while the person was answering "graduation" - the words came out garbled three times)
    const stepHere = this.steps[sc.idx];
    const openQ = this.facts && stepHere && (st.sub || stepHere.kind === 'language' || ((stepHere.kind === 'ask' || stepHere.kind === 'ifyes' || stepHere.kind === 'ifno') && sc.idx !== this.steps.findIndex((x) => x.kind === 'ask' || x.kind === 'interest')));
    if (heardAs === 'unclear' && openQ && text.trim().length >= 2) heardAs = 'clear';
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
      if (sc.silent > (this.facts ? 4 : 2)) return this.endWith('Unclear', 'could not hear the person clearly', this.P.audioClose);
      const h = HUMAN[this.language] || HUMAN.English;
      const kind = this.steps[sc.idx].kind;
      if (kind === 'opening') return { say: this.speak(h.hear), done: false };
      return { say: this.speak(h.sorry[(sc.silent - 1) % h.sorry.length], isAsk(kind) && !st.sub ? this.line(sc.idx) : this.again()), done: false };
    }
    sc.silent = 0;
    // the person's language: from this sentence on, the script goes on in it (not announced). A language the script has no version of is not switched to.
    if (this.autoLanguage && this.steps[sc.idx].kind !== 'language') {
      const byWords = D.detectLanguage(text);
      // the phone gateway also judges the language by SOUND (and checks real Telugu / Hindi words); when it moved the call, that outranks the spelling of the words
      const bySound = meta.lang && meta.lang !== this.language && S.LANGS.includes(meta.lang) ? { lang: meta.lang, only: !!(byWords && byWords.only) } : null;
      const lg = bySound || byWords;
      const shortEnglish = lg && lg.lang === 'English' && this.language !== 'English' && !lg.only && text.trim().split(/\s+/).length < 4;
      if (lg && lg.lang !== this.language && !shortEnglish && this.byLang[lg.lang] && (!st.langPicked || lg.only)) { // the language the person picked stays, unless they ask for another
        this.setLanguage(lg.lang);
        st.switched = (st.switched || 0) + 1;
        if (lg.only) { turn.understood = 'language'; return { say: this.speak(this.line(sc.idx)), done: false }; } // "Telugu lo matladandi": the same question, now in Telugu
      }
    }
    let k = D.classify(text);
    if (k.intent === 'unclear' && /\b(not going to|don'?t want|do not want|no interest|not required|not looking|leave me|stop talking)\b|వద్దు|ఇష్టం లేదు|నాకు అక్కర్లేదు|नहीं चाहिए|मुझे नहीं/i.test(text)) k = { ...k, intent: 'no' };
    const stepNow = this.steps[sc.idx];
    if (k.intent === 'unclear' && stepNow && (stepNow.kind === 'ask' || stepNow.kind === 'interest') && /ఉంది|ఉన్నాను|ఉన్నాం|చెప్పండి|చెప్పు\b|అలాగే|ఓకే|సరే|हाँ|हां|ठीक है|रुचि है|दिलचस्पी है|बताइए|बताओ/.test(text) && !/లేదు|వద్దు|కాదు|नहीं/.test(text)) k = { ...k, intent: 'yes' };
    turn.understood = k.intent;
    st.lastHeard = text;
    if (k.human) st.human = true;
    const cur = this.steps[sc.idx];

    // the same safety words as every AI call
    if (cur.kind === 'say' && k.intent === 'no' && REFUSE.test(text)) { st.interest = 'no'; st.declineReason = S.clean(text, 120); return this.endWith('Not Interested', 'not interested', this.declineLine || (this.ackText(k, cur) + (this.steps[this.steps.length - 1].kind === 'closing' ? ` ${this.line(this.steps.length - 1)}` : ''))); }
    if (k.intent === 'stop') { st.stop = true; st.sub = null; return this.endWith('Not Interested', 'asked not to be called again', this.P.closeNotInterested); }
    if (k.intent === 'cant_hear') return { say: this.speak(this.again()), done: false };
    if (k.intent === 'repeat') return { say: this.speak(this.again()), done: false };
    // a call back time that was asked for: the answer is the time
    if (st.cbAsked && !st.cbDone) {
      st.cbDone = true;
      if (k.intent === 'no') { st.interest = 'no'; st.declineReason = S.clean(text, 120); return this.endWith('Not Interested', 'did not want a call back'); }
      st.callback = true; st.callbackWhen = S.clean(text, 120);
      return this.endWith('Call Back Later', 'gave a time for a call back', vacancy.callbackOk(this.language));
    }
    // (when the script itself asks what time suits the person, "tomorrow at five" is the answer to that, not a request to be called later)
    const asksTime = cur.kind === 'ask' && /\b(time|when|convenient|available|slot|which day|what day)\b|సమయం|समय|कब/i.test(cur.text);
    if (k.intent === 'later' && !asksTime && this.facts && !st.cbAsked) { st.cbAsked = true; return { say: this.speak(vacancy.callbackQuestion(this.language)), done: false }; }
    if (k.intent === 'later' && !asksTime) { st.callback = true; st.callbackWhen = S.clean(text, 120); return this.endWith('Call Back Later', 'asked for a call back', this.P.laterClose); }
    if (k.human || k.intent === 'human') return this.endWith('Call Back Later', 'asked for a recruiter', this.P.humanNoted);

    // the opening: the person's name is confirmed (or it is a wrong number)
    let lead = ''; // said before the next line
    if (cur.kind === 'opening') {
      if (k.intent === 'no') { st.wrong = true; return this.endWith('Unclear', 'wrong person', this.facts ? vacancy.words(this.facts, this.language).wrong() : this.P.closeUnclear); }
      st.identity = true;
    } else if (cur.kind === 'language') {
      // the language the person names; a person who just answers is answered in the language they spoke
      const byWords = D.detectLanguage(text);
      const pick = vacancy.languageChoice(text) || (meta.lang && S.LANGS.includes(meta.lang) ? meta.lang : (byWords && byWords.lang));
      if (pick && this.byLang[pick] && pick !== this.language) { this.setLanguage(pick); st.switched = (st.switched || 0) + 1; }
      st.langPicked = true;
      lead = vacancy.words(this.facts, this.language).langOk();
    } else {
      if (this.facts) {
        const v = this.vacancyTurn(text, k, cur, turn);
        if (v && v.result) return v.result;
        if (v && v.k) { k = v.k; lead = v.lead || ''; }
      }
      // "which number?" in a script that is not a vacancy: the recruiter's number given with the campaign is told, then the question again
      if (!this.facts && this.contactNumber && vacancy.asksWhere(text) && (cur.kind === 'ask' || cur.kind === 'interest' || cur.kind === 'say')) {
        turn.understood = 'question_noted';
        const tell = { English: `Please send it to ${this.contactNumber}.`, Telugu: `దయచేసి ${this.contactNumber} కి పంపండి.`, Hindi: `कृपया ${this.contactNumber} पर भेजिए।` }[this.language] || `Please send it to ${this.contactNumber}.`;
        return { say: this.speak(tell, cur.kind === 'ask' || cur.kind === 'interest' ? this.line(sc.idx) : this.again()), done: false };
      }
      // a question the script cannot answer from verified facts is noted for the recruiter, never answered from memory
      if (this.facts && st.pitchAt !== sc.idx && (k.intent === 'info_q' || k.intent === 'salary_q' || k.intent === 'other_cand' || (k.intent === 'unclear' && vacancy.answer(this.facts, text, this.language, true))) && vacancy.answer(this.facts, text, this.language)) {
        turn.understood = 'question_noted';
        return { say: this.speak(vacancy.answer(this.facts, text, this.language), cur.kind === 'ask' || cur.kind === 'interest' ? this.line(sc.idx) : this.again()), done: false }; // answered from the facts, then the question again
      }
      if (cur.kind === 'say' && (k.intent === 'info_q' || k.intent === 'salary_q' || k.intent === 'ai_q' || k.intent === 'other_cand')) { // a question at a pause: kept for the team, and the message goes on
        const q = S.clean(text, 200);
        if (q && !st.pending.includes(q) && st.pending.length < 5) st.pending.push(q);
        turn.understood = 'question_noted';
      } else if (!st.pitchCount && (k.intent === 'info_q' || k.intent === 'salary_q' || k.intent === 'ai_q' || k.intent === 'other_cand')) { // (after a try to convince, what is said is the reason, kept below)
        const q = S.clean(text, 200);
        if (q && !st.pending.includes(q) && st.pending.length < 5) st.pending.push(q);
        turn.understood = 'question_noted';
        const h = HUMAN[this.language] || HUMAN.English;
        return { say: this.speak(this.facts ? h.noted : '', cur.kind === 'ask' || cur.kind === 'interest' ? this.line(sc.idx) : this.again()), done: false }; // the question again; the person's own question is for the team
      }
      // "do you have a minute / can we talk?" answered with a no: one try to convince, then a kind close
      const permissionAsk = cur.kind === 'ask' && sc.idx === this.steps.findIndex((x) => x.kind === 'ask' || x.kind === 'interest') && (!!this.facts || /minute|moment|spare|convenient|talk|time/i.test(cur.text));
      if (permissionAsk && k.intent === 'no' && this.facts) { st.cbAsked = true; return { say: this.speak(vacancy.callbackQuestion(this.language)), done: false }; } // no time now: when?
      if (permissionAsk && k.intent === 'no') {
        if (st.pitchAt === sc.idx) { st.declineReason = S.clean(text, 120); st.interest = 'no'; return this.endWith('Not Interested', 'did not want to talk', this.declineLine || (this.ackText(k, cur) + (this.steps[this.steps.length - 1].kind === 'closing' ? ` ${this.line(this.steps.length - 1)}` : ''))); }
        const pitch = this.nextPitch();
        if (pitch) { st.pitchAt = sc.idx; st.declineReason = S.clean(text, 120); return { say: this.speak(pitch), done: false }; }
      }
      if (cur.kind === 'interest') {
        // after a try to convince: a yes goes on; a no, or the reason, gets the next try, and when there is none left the call is closed kindly
        if (st.pitchAt === sc.idx && k.intent === 'unclear' && !st.pitchRetry && S.clean(text, 200).split(/\s+/).length < 3) {
          st.pitchRetry = 1;
          return { say: this.speak((HUMAN[this.language] || HUMAN.English).sorry[0], this.again()), done: false };
        }
        if (st.pitchAt === sc.idx && k.intent !== 'yes' && k.intent !== 'maybe') {
          st.declineReason = S.clean(text, 120);
          const more = this.nextPitch();
          if (more) return { say: this.speak(more), done: false };
          st.interest = 'no'; sc.got.push({ q: this.line(sc.idx), a: S.clean(text, 160) });
          return this.endWith('Not Interested', 'not interested', this.declineLine || (this.ackText(k, cur) + (this.steps[this.steps.length - 1].kind === 'closing' ? ` ${this.line(this.steps.length - 1)}` : '')));
        }
        if (k.intent === 'no') {
          const pitch = this.nextPitch();
          if (pitch) { st.pitchAt = sc.idx; st.declineReason = S.clean(text, 120); return { say: this.speak(pitch), done: false }; } st.interest = 'no'; st.declineReason = S.clean(text, 120); sc.got.push({ q: this.line(sc.idx), a: S.clean(text, 160) }); return this.endWith('Not Interested', 'not interested', this.declineLine || (this.ackText(k, cur) + (this.steps[this.steps.length - 1].kind === 'closing' ? ` ${this.line(this.steps.length - 1)}` : ''))); }
        if (k.intent === 'yes') st.interest = 'yes';
        else if (k.intent === 'maybe') st.interest = 'unsure';
        else { // not a plain yes / no: asked once more, then taken as unsure
          sc.silent += 1;
          if (sc.silent <= 1) return { say: this.speak(this.line(sc.idx)), done: false };
          st.interest = 'unsure';
        }
      }
      sc.got.push({ q: this.line(sc.idx), a: S.clean(text, 160) });
      if (this.facts) {
        const role = { exp: 'exp', edu: 'edu', work: 'work', notice: 'work', sal: 'sal', loc: 'loc' }[vacancy.stepOf(this.facts, this.language, cur.text)];
        if (role) st.ans = { ...(st.ans || {}), [role]: S.clean(text, 50) };
      }
      if (cur.kind === 'ask' || cur.kind === 'interest') sc.branchNo = k.intent === 'no' || /\b(no|not|never|didn'?t|haven'?t)\b|లేదు|కాదు|नहीं/i.test(text);
      if (this.facts) {
        const after = this.afterAnswer(cur, text, k);
        if (after && after.result) return after.result;
        if (after) lead = after.lead;
      }
    }
    // on to the next question (Say lines are spoken with it); no more questions: the closing
    const nxt = this.upTo(sc.idx + 1);
    if (nxt.closing !== undefined || nxt.stopAt >= this.steps.length) {
      if (this.longMessage) st.messageOnly = true; // the whole message was told: not an unanswered call
      const outcome = st.interest === 'no' ? 'Not Interested' : (st.interest === 'yes' ? 'Interested' : 'Unclear');
      return this.endWith(outcome, 'script finished', S.clean([this.leadFor(lead, k, cur, nxt.parts[0] || nxt.closing), ...nxt.parts, nxt.closing].filter(Boolean).join(' '), 3000) || undefined);
    }
    // READ BACK (the "Professional AI" document): before the resume, what was noted is confirmed with the person
    if (this.facts && !st.summed && vacancy.stepOf(this.facts, this.language, this.steps[nxt.stopAt].text) === 'next' && Object.keys(st.ans || {}).length >= 2) {
      st.summed = true; st.sub = 'readback';
      return { say: this.speak(lead || this.ackText(k, cur), vacancy.words(this.facts, this.language).sum(st.ans)), done: false };
    }
    sc.idx = nxt.stopAt;
    sc.silent = 0;
    return { say: this.speak(this.leadFor(lead, k, cur, nxt.parts[0]), ...nxt.parts), done: false };
  }

  // ---- A CALL BUILT FROM THE FACTS OF A VACANCY: what the founder's document says to do with what a person brings up --------------------------------------
  // -> { result } this is the turn | { k, lead } a yes: the call goes on, with this said first | null: nothing special
  vacancyTurn(text, kIn, cur, turn) {
    const st = this.st;
    const sc = st.script;
    const W = vacancy.words(this.facts, this.language);
    const reply = (...say) => ({ result: { say: this.speak(...say), done: false } });
    const follow = (line, sub) => { st.sub = sub; return reply(line); };
    const note = (t) => { st.notes = [...(st.notes || []), S.clean(t, 120)].slice(-8); };
    const again = (...say) => { // what was said, then the question again - but never the same question a third time (founder 2026-11-09: it asked the relocation question four times)
      st.againN = { ...(st.againN || {}) }; st.againN[sc.idx] = (st.againN[sc.idx] || 0) + 1;
      if (st.againN[sc.idx] > 2) return { k: YES, lead: say.join(' ') };
      return reply(...say, this.line(sc.idx));
    };
    const YES = { intent: 'yes', human: false };
    // the answer was a yes to the question: on with the call; otherwise the question again
    const goOn = (line, yes = true) => {
      if (yes && (cur.kind === 'interest' || kIn.intent === 'yes')) { st.pitchAt = null; return { k: YES, lead: line }; }
      return again(line);
    };
    const end = (outcome, why, line) => { st.keepDone = true; st.sub = null; return { result: this.endWith(outcome, why, line) }; };
    const no = kIn.intent === 'no';
    const heard = S.clean(text, 120);

    // what was just asked
    const sub = st.sub;
    if (sub) {
      st.sub = null;
      if (sub === 'resumeNum') { if (no) note('Did not agree to send the resume now'); return { k: no ? kIn : YES, lead: '' }; }
      if (sub === 'readback') {
        if (no) st.corrections = [...(st.corrections || []), heard];
        const nxt = this.upTo(sc.idx + 1);
        sc.idx = nxt.stopAt;
        return reply(no ? W.sumFix() : '', ...nxt.parts);
      }
      if (sub === 'keep') {
        st.keepOk = !no;
        return end('Not Interested', st.keepWhy || 'not interested', W.bye());
      }
      if (sub === 'prefloc') {
        st.prefLoc = heard; note(`Preferred location: ${heard}`);
        if (vacancy.near(this.facts, text) || st.relocAsked) return { k: YES, lead: '' };
        st.relocAsked = true;
        return follow(W.reloc(), 'reloc');
      }
      if (sub === 'reloc') {
        if (no) { st.interest = 'no'; st.declineReason = st.prefLoc ? `location: prefers ${st.prefLoc}` : 'location'; return end('Not Interested', 'location does not suit', `${W.locKeep()} ${W.bye()}`); }
        note('Open to relocating');
        return { k: YES, lead: '' }; // anything that is not a no: on with the call (never the same question again)
      }
      if (sub === 'budget') {
        if (no) { st.interest = 'no'; st.declineReason = st.declineReason || 'salary'; return { result: this.endWith('Not Interested', 'salary does not suit') }; }
        return goOn(W.budgetYes());
      }
      if (sub === 'both') {
        note(`Wants: ${heard}`); st.interest = 'no'; st.declineReason = `salary and location: ${heard}`; st.keepDone = true; st.keepWhy = 'salary and location do not suit';
        return follow(W.bothKeep(), 'keep');
      }
      if (sub === 'details') {
        if (no) { st.interest = 'no'; st.declineReason = st.declineReason || 'wanted time, no details'; return { result: this.endWith('Not Interested', 'did not want the details') }; }
        st.sendDetails = true;
        return follow(W.followup(), 'followup');
      }
      if (sub === 'followup') {
        if (!no) { st.callback = true; st.callbackWhen = 'in two days'; }
        return end('Call Back Later', 'wanted time; details to be sent', W.followupOk());
      }
      if (sub === 'explore') {
        if (no) { st.interest = 'no'; return { result: this.endWith('Not Interested', 'not looking for a change') }; }
        st.sendDetails = true; st.callback = true; st.callbackWhen = 'after the details on WhatsApp';
        return end('Call Back Later', 'not looking; details to be sent', W.detailsOk());
      }
    }

    const step = vacancy.stepOf(this.facts, this.language, cur.text);
    if (step === 'next' && vacancy.asksWhere(text)) { // "which number?": the number is told, or the team sends it; then the call goes on to its close
      if (!/\d/.test(this.facts.channel || '')) { st.sendDetails = true; if (st.pending.length < 5) st.pending.push('Asked which number to send the resume to (send our WhatsApp number)'); }
      return follow(W.numWhere(), 'resumeNum');
    }
    if (step === 'next') return null; // "yes, I will send it": the answer to the resume, nothing to look for
    if (vacancy.hostile(text)) return end('Not Interested', 'the person was upset', W.calm());
    if (kIn.intent === 'ai_q') return again(W.aiYes());
    const reason = st.pitchAt === sc.idx;
    const t = vacancy.topic(text, { step, reason });
    if (t) turn.understood = t;
    if (t === 'studies') { st.interest = 'no'; st.declineReason = 'higher studies'; return end('Not Interested', 'preparing for higher studies', W.studies()); }
    if (t === 'wfh') {
      const only = /\b(only|looking|need|want|prefer)\b|మాత్రమే|కావాలి|सिर्फ|चाहिए/i.test(text);
      const mode = this.facts.workmode;
      if (mode && /home|remote/i.test(mode)) return goOn(`${this.facts.workmode}.`);
      if (!only) { if (mode) return again(`${mode}.`); return again((HUMAN[this.language] || HUMAN.English).noted); }
      st.interest = 'no'; st.declineReason = 'wants work from home'; note('Wants work from home or hybrid roles'); st.keepDone = true; st.keepWhy = 'wants work from home';
      return follow(`${mode ? `${mode}. ` : ''}${W.wfhKeep()}`, 'keep');
    }
    if (t === 'family') { st.declineReason = heard; return follow(W.family(), 'details'); }
    if (t === 'company') return goOn(W.company(), kIn.intent === 'yes');
    if (t === 'benefits') return goOn(this.facts.benefits ? `${this.facts.benefits}.` : W.benefits(), kIn.intent === 'yes');
    if (t === 'interview') { if (st.pending.length < 5) st.pending.push(heard); return goOn(this.facts.interview ? `${this.facts.interview}.` : W.interview(), kIn.intent === 'yes'); }
    if (t === 'ivPref') { note(`Interview preference: ${heard}`); return goOn(W.ivPref(), kIn.intent === 'yes'); }
    if (t === 'ivTravel') { note('Cannot travel for an offline interview: check for an online round'); return goOn(W.ivTravel(), kIn.intent === 'yes'); }
    if (t === 'trust') { st.pitchAt = null; return again(W.objTrust()); }
    if (t === 'details') { st.sendDetails = true; st.callback = true; st.callbackWhen = 'after the details on WhatsApp'; return end('Call Back Later', 'asked for the details', W.detailsOk()); }
    if (t === 'both') { st.declineReason = heard; return follow(W.both(), 'both'); }
    if (t === 'location' && this.facts.location) { st.declineReason = heard; return follow(W.prefloc(), 'prefloc'); }
    if (t === 'salary' && this.facts.salary) { note(`Salary: ${heard}`); st.declineReason = heard; return follow(W.budget(), 'budget'); }
    if (t === 'notLooking') { st.declineReason = heard; return follow(W.objJob(), 'explore'); }
    if (t === 'experience') { st.interest = 'no'; st.oq = true; st.declineReason = heard; return end('Not Interested', 'experience does not match', W.objExp()); }
    if (step !== 'interest' && step !== 'perm' && vacancy.notInterested(text)) { st.interest = 'no'; st.declineReason = heard; return { result: this.endWith('Not Interested', 'not interested') }; }
    return null;
  }

  // what is said after an answer, read against the facts of the vacancy: { lead } | { result } | null
  afterAnswer(cur, text, k) {
    const st = this.st;
    const W = vacancy.words(this.facts, this.language);
    const step = vacancy.stepOf(this.facts, this.language, cur.text);
    if (step === 'next' && k.intent !== 'no') st.interest = 'yes'; // the resume is on its way
    if (step === 'exp') {
      const need = vacancy.needsYears(this.facts);
      const y = D.readYears(text);
      if (need != null && y != null && y < need - 1) { st.interest = 'no'; st.oq = true; st.keepDone = true; st.declineReason = `${y} years, the job asks for ${this.facts.experience}`; return { result: this.endWith('Not Interested', 'experience does not match', W.objExp()) }; }
    }
    if (step === 'notice') {
      const most = vacancy.maxNotice(this.facts);
      const { days } = D.readNotice(text);
      if (most != null && days != null && days > most) return { lead: W.noticeLong() };
    }
    if (step === 'sal') {
      const r = vacancy.overBudget(this.facts, text);
      if (r === 'over') return { lead: W.budgetNote() };
      if (r === 'fits') return { lead: W.fits() };
    }
    if (step === 'loc' && this.facts.location) {
      if (vacancy.near(this.facts, text) && !st.script.branchNo) return { lead: W.near() };
      if (!st.relocAsked && !/\b(yes|ok|okay|fine|sure|relocat\w*)\b|అవును|సరే|రెడీ|हाँ|ठीक/i.test(text)) { st.prefLoc = S.clean(text, 80); st.sub = 'reloc'; st.relocAsked = true; return { result: { say: this.speak(W.reloc()), done: false } }; }
    }
    return null;
  }

  // what is said before the next line: nothing extra when that line starts with its own thanks ("Okay, thanks. Thank you for your time")
  leadFor(lead, k, cur, nextLine) {
    if (lead) return lead;
    return this.facts && OWN_ACK.test(String(nextLine || '').trim()) ? '' : this.ackText(k, cur);
  }

  // the short word a person says before going on (nothing after the opening: they only said hello)
  ackText(k, cur) {
    if (!cur || cur.kind === 'opening') return '';
    const h = HUMAN[this.language] || HUMAN.English;
    const list = k && k.intent === 'no' ? h.no : h.ack;
    return list[this.st.turns % list.length];
  }

  summaryText() {
    const st = this.st;
    const code = st.stop ? 'DNC' : (st.wrong ? 'WN' : (st.callback ? 'CB' : (st.oq ? 'OQ' : (st.interest === 'yes' ? 'INT' : (st.interest === 'no' ? 'NI' : 'NR')))));
    const bits = [`Disposition: ${code}${st.interest === 'no' && st.declineReason ? ` (reason: ${S.clean(st.declineReason, 60)})` : ''}.`, `AI call by the team's script "${this.scriptName}" (${this.language}).`];
    if (st.wrong) bits.push('Wrong person on the line. No details were shared.');
    else bits.push(st.identity ? 'Name confirmed.' : 'The person did not confirm their name.');
    if (st.interest === 'yes') bits.push('Interested.'); else if (st.interest === 'no') bits.push('Not interested.'); else if (st.interest === 'unsure') bits.push('Not sure about the job.');
    (st.script.got || []).forEach((g) => bits.push(`${S.clean(g.q, 70)} → "${S.clean(g.a, 70)}".`));
    if (st.callback) bits.push(`Asked for a call back${st.callbackWhen ? `: ${st.callbackWhen}` : ''}.`);
    if (st.human) bits.push('Asked to speak to a recruiter.');
    if (st.stop) bits.push('Asked not to be called again.');
    if (st.pending && st.pending.length) bits.push(`Asked (the team must answer): ${st.pending.join(' | ')}.`);
    if (st.notes && st.notes.length) bits.push(`To note: ${st.notes.join(' | ')}.`);
    if (st.corrections && st.corrections.length) bits.push(`Correction to the details: ${st.corrections.join(' | ')}.`);
    if (st.sendDetails) bits.push('The team must send the job details on WhatsApp.');
    if (st.keepOk !== undefined) bits.push(st.keepOk ? 'May be contacted about other openings.' : 'Do not contact about other openings.');
    if (st.switched) bits.push(`The person spoke ${this.language}, so the call went on in ${this.language}.`);
    return bits.filter(Boolean).join(' ');
  }
}

module.exports = { parseScript, ScriptDialogue, fillWith, MAX_STEPS };
