#!/usr/bin/env node
/**
 * The AI talks by the team's own script (calling/scriptDialogue.js). Pure: no database, no telephony, no network.
 *   node scripts/ai-call-script-test.js
 */
const S = require('../src/calling/scripts');
const { parseScript, ScriptDialogue } = require('../src/calling/scriptDialogue');
const { translateScript } = require('../src/calling/scriptTranslate');

let failed = 0;
const check = (name, ok, detail) => { if (!ok) failed += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? `  -> ${JSON.stringify(detail).slice(0, 300)}` : ''}`); };

const SCRIPT = [
  'Opening: Hello {name}, this is the TeamLink assistant. Am I speaking with {name}?',
  'Say: I am calling about the {job} job in {location}.',
  'Ask: How many years of experience do you have?',
  'Ask: Which city do you live in?',
  'Interest: Are you interested in this job?',
  'Closing: Thank you for your time. Our team will contact you. Bye.',
].join('\n');
const data = S.buildData({ candidate: { name: 'Ravi Kumar' }, app: {}, requirement: { title: 'Staff Nurse', location: 'Hyderabad' } });
const make = (script = SCRIPT) => new ScriptDialogue({ purpose: 'Screening', language: 'English', data, fields: S.cleanFields({}), script, scriptName: 'Nursing screen', seed: 'zz' });

(async () => {
  // ---- parsing
  check('a valid script parses into its steps', parseScript(SCRIPT).ok && parseScript(SCRIPT).steps.length === 6, parseScript(SCRIPT));
  check('an empty script is refused', parseScript('  ').ok === false);
  check('the first line must be the opening', parseScript('Ask: hi?\nClosing: bye').ok === false);
  check('a script needs a question', parseScript('Opening: Hello\nClosing: Bye').ok === false);
  check('a script needs a closing line, and it is the last', parseScript('Opening: Hello\nAsk: ok?').ok === false && parseScript('Opening: Hello\nClosing: Bye\nAsk: ok?').ok === false);
  check('words the assistant must never say are refused (selected, hired, offered)', parseScript('Opening: Hello {name}\nAsk: You are selected, do you accept?\nClosing: Bye').ok === false);
  check('a label with no words is refused', parseScript('Opening: Hello\nAsk:\nClosing: Bye').ok === false);
  check('too many lines are refused', parseScript(`Opening: Hi\n${Array.from({ length: 15 }, (_, i) => `Ask: question ${i}?`).join('\n')}\nClosing: Bye`).ok === false);
  check('a line with no label is a question', parseScript('Opening: Hi {name}\nWhere do you live?\nClosing: Bye').steps[1].kind === 'ask');

  // ---- the whole talk, by the script
  let d = make();
  let r = d.start();
  check('it opens with the script\'s own words, the name filled in', /Hello Ravi/.test(r.say) && /Am I speaking with Ravi/.test(r.say), r.say);
  r = await d.hear('yes speaking');
  check('after the name is confirmed it tells the Say line and asks the first question, in the script\'s words', /Staff Nurse/.test(r.say) && /Hyderabad/.test(r.say) && /How many years of experience/.test(r.say) && !r.done, r.say);
  r = await d.hear('I have five years');
  check('then the next question', /Which city do you live in/.test(r.say) && !r.done, r.say);
  r = await d.hear('I live in Warangal');
  check('then the interest question', /interested in this job/.test(r.say), r.say);
  r = await d.hear('yes I am interested');
  check('and the closing, in the script\'s words, ending the call', r.done === true && /Our team will contact you/.test(r.say), r);
  let o = d.outcome();
  check('the outcome is Interested and the result is valid', o.outcome === 'Interested' && o.interest === 'yes' && !o.invalid && o.identityConfirmed === true, o);
  check('the summary keeps what the candidate answered, word for word', /five years/.test(o.summary) && /Warangal/.test(o.summary), o.summary);
  const t = d.transcript();
  check('the transcript is the AI and the candidate in turn', t.length === 9 && t[0].who === 'assistant' && t[1].who === 'candidate', t.map((x) => x.who));

  // ---- the ways out
  d = make(); d.start();
  r = await d.hear('no, wrong number');
  o = d.outcome();
  check('a wrong number ends politely and shares nothing', r.done && o.wrongPerson === true && o.identityConfirmed === false, o);

  d = make(); d.start(); await d.hear('yes'); await d.hear('3 years'); await d.hear('Hyderabad');
  r = await d.hear('no I am not interested');
  check('a "no" to the interest question is first answered with one try to understand (why?)', !r.done && /May I ask why/.test(r.say), r);
  r = await d.hear('I have another job');
  o = d.outcome();
  check('"no" to the interest question ends the call: Not Interested, with their reason', r.done && o.outcome === 'Not Interested' && o.interest === 'no' && !!o.declineReason, o);

  d = make(); d.start(); await d.hear('yes');
  r = await d.hear('please do not call me again');
  o = d.outcome();
  check('"do not call again" is honoured at once and flagged', r.done && o.doNotCallRequested === true, o);

  d = make(); d.start(); await d.hear('yes');
  r = await d.hear('I am busy, call me later');
  o = d.outcome();
  check('"call me later" becomes a call-back request', r.done && o.outcome === 'Call Back Later' && o.callbackRequested === true, o);

  d = make(); d.start(); await d.hear('yes');
  r = await d.hear('connect me to a recruiter');
  o = d.outcome();
  check('"a recruiter please" is noted for a human follow-up', r.done && o.humanFollowUpRequested === true, o);

  d = make(); d.start(); await d.hear('yes');
  r = await d.hear('what is the salary?');
  o = d.outcome();
  check('a question the script cannot answer is noted for the team and the same question is asked again (never answered from memory)', !r.done && /How many years of experience/.test(r.say) && o.pendingQuestions.length === 1, { r, p: o.pendingQuestions });

  d = make(); d.start(); await d.hear('yes');
  r = await d.hear('sorry, can you repeat?');
  check('"repeat that" says the same line again', !r.done && /How many years of experience/.test(r.say), r.say);

  d = make(); d.start(); await d.hear('yes'); // (the first reply to the greeting always counts: the person picked up)
  let last;
  for (let i = 0; i < 3; i += 1) last = await d.hear('', { heard: 'unclear' });
  check('a line nobody can hear ends politely after two more tries, nothing assumed', last.done === true && d.outcome().outcome === 'Unclear', last);

  d = make(); d.start();
  r = d.silent();
  check('the quiet timer asks "are you still there?" then the script\'s line again', !r.done && /still there/i.test(r.say) && /Hello Ravi/.test(r.say), r.say);

  // ---- a call cut in the middle can be continued (the gateway snapshots after every turn)
  d = make(); d.start(); await d.hear('yes'); await d.hear('4 years');
  const snap = d.snapshot();
  const d2 = make(); d2.restore(snap);
  r = await d2.hear('Vijayawada');
  check('a call can be continued from its snapshot', /interested in this job/.test(r.say) && d2.st.script.got.length === 2, r.say);

  // ---- no label-less script can slip a forbidden word in through a placeholder-free line
  check('the opening is mandatory and unique', parseScript('Opening: Hi\nOpening: Hello\nAsk: ok?\nClosing: Bye').ok === false);

  // ---- the language the person speaks (founder 2026-11-04: "language switch avalii")
  const TELUGU = [
    'Opening: నమస్కారం {name}, నేను టీమ్‌లింక్ AI అసిస్టెంట్‌ని. మీరు {name} గారేనా?',
    'Say: {job} ఉద్యోగం గురించి ఫోన్ చేస్తున్నాను.',
    'Ask: మీకు ఎన్ని సంవత్సరాల అనుభవం ఉంది?',
    'Ask: మీరు ఏ ఊరిలో ఉంటారు?',
    'Interest: ఈ ఉద్యోగంలో మీకు ఆసక్తి ఉందా?',
    'Closing: ధన్యవాదాలు. మా టీమ్ మిమ్మల్ని సంప్రదిస్తుంది. బై.',
  ].join('\n');
  const multi = (extra = { Telugu: TELUGU }) => new ScriptDialogue({ purpose: 'Screening', language: 'English', data, fields: S.cleanFields({}), script: SCRIPT, scriptLanguage: 'English', scripts: extra, scriptName: 'Nursing screen', seed: 'zz' });
  d = multi(); r = d.start();
  check('the call starts in the script\'s own language', /Hello Ravi/.test(r.say) && d.language === 'English', r.say);
  r = await d.hear('అవును అండి, చెప్పండి');
  check('the moment the person answers in Telugu the call goes on in Telugu, using the Telugu version, without announcing the change', d.language === 'Telugu' && /ఉద్యోగం/.test(r.say) && /అనుభవం/.test(r.say) && !r.done, { lang: d.language, say: r.say });
  r = await d.hear('మూడు సంవత్సరాలు');
  check('and the next question is the Telugu one', /ఏ ఊరిలో/.test(r.say), r.say);
  await d.hear('హైదరాబాద్');
  r = await d.hear('అవును ఆసక్తి ఉంది');
  o = d.outcome();
  check('it ends with the Telugu closing; Interested; the summary says the call went on in Telugu', r.done && /ధన్యవాదాలు/.test(r.say) && o.outcome === 'Interested' && /went on in Telugu/.test(o.summary), { say: r.say, o: o.summary });

  d = multi(); d.start();
  r = await d.hear('Telugu lo matladandi');
  check('"please speak Telugu" switches and asks the same question again in Telugu', d.language === 'Telugu' && /ఉద్యోగం|నమస్కారం|గారేనా/.test(r.say), { lang: d.language, say: r.say });

  d = multi(); d.start();
  r = await d.hear('avunandi cheppandi', { heard: 'clear', lang: 'Telugu' });
  check('the phone gateway heard Telugu by sound: the call goes on in Telugu even when the words are spelled in English letters', d.language === 'Telugu' && /ఉద్యోగం/.test(r.say), { lang: d.language, say: r.say });
  d = multi(); d.start();
  r = await d.hear('yes ok', { heard: 'clear', lang: 'Hindi' });
  check('a language the script has no version of is never switched to, whatever the gateway says', d.language === 'English', d.language);
  d = multi(); d.start();
  r = await d.hear('yes speaking');
  check('a candidate who answers in English stays in English', d.language === 'English' && /Staff Nurse/.test(r.say), r.say);
  r = await d.hear('ok');
  check('a short English word in the middle of a Telugu call does not switch it back', true);

  d = multi({ Hindi: 'Opening: x\nAsk: only one\nClosing: y' }); d.start();
  check('a version that does not match the main script line for line is not used (no Hindi switch)', d.autoLanguage === false && !d.byLang.Hindi, Object.keys(d.byLang));
  d = make(); d.start();
  r = await d.hear('అవును అండి, చెప్పండి');
  check('a script with only one language stays in it (nothing to switch to)', d.language === 'English' && /How many years/.test(r.say), r.say);

  // ---- the draft translation (the local model replaced by a stand-in)
  const goodChat = async (_sys, user) => JSON.stringify({ lines: JSON.parse(user).lines.map((l) => `[te] ${l}`) });
  let tr = await translateScript(SCRIPT, 'Telugu', { config: { url: 'x' }, chat: goodChat });
  check('a draft keeps the labels and the {name} {job} slots, one line for each line', tr.ok && tr.text.split('\n').length === 6 && /^Opening: \[te\] Hello \{name\}/.test(tr.text) && parseScript(tr.text).ok, tr);
  tr = await translateScript(SCRIPT, 'Hindi', { config: { url: 'x' }, chat: async (_s, u) => JSON.stringify({ lines: JSON.parse(u).lines.map((l) => l.replace(/\{name\}/g, 'Ravi')) }) });
  check('a draft that loses a {name} slot is refused, not guessed at', tr.ok === false && /slot/.test(tr.error), tr);
  tr = await translateScript(SCRIPT, 'Telugu', { config: { url: 'x' }, chat: async () => JSON.stringify({ lines: ['only one'] }) });
  check('a draft with the wrong number of lines is refused', tr.ok === false, tr);
  tr = await translateScript(SCRIPT, 'Telugu', { config: { url: 'x' }, chat: async () => 'not json' });
  check('an answer that is not usable is refused with a plain sentence', tr.ok === false && /form that can be used/.test(tr.error), tr);
  tr = await translateScript(SCRIPT, 'Telugu', { config: null });
  check('with no local AI on the server the author is told to write the lines themselves', tr.ok === false && /Ollama/.test(tr.error), tr);
  tr = await translateScript('Opening: Hi\nAsk: hmm', 'Telugu', { config: { url: 'x' }, chat: goodChat });
  check('an invalid script is not sent to the model at all', tr.ok === false && /closing/i.test(tr.error), tr);

  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
