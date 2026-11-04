#!/usr/bin/env node
/**
 * The AI talks by the team's own script (calling/scriptDialogue.js). Pure: no database, no telephony, no network.
 *   node scripts/ai-call-script-test.js
 */
const S = require('../src/calling/scripts');
const { parseScript, ScriptDialogue } = require('../src/calling/scriptDialogue');

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

  d = make(); d.start();
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

  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
