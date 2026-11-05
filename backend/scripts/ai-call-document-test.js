#!/usr/bin/env node
/**
 * The founder's "AI Voice Calling Agent" document (2026-11-05), played scenario by scenario against a call built from the facts of a vacancy (calling/vacancyScript.js +
 * calling/scriptDialogue.js). Nothing is dialled and no database is touched: the person's replies are typed in.
 *   node scripts/ai-call-document-test.js          add -v to print every conversation
 */
const path = require('path');

process.env.DATABASE_URL = process.env.DATABASE_URL || `file:${path.resolve(__dirname, '..', 'prisma', 'sandbox.db').split(path.sep).join('/')}`;
const VAC = require('../src/calling/vacancyScript');
const { ScriptDialogue } = require('../src/calling/scriptDialogue');

const VERBOSE = process.argv.includes('-v');
const LIMITS = { maxLine: 5000, maxLines: 300, noQuestionOk: true, lenient: true };
const FACTS = 'Role: HR Executive; Company: TeamLink Consultants; Client: Secret Steels Pvt Ltd; Industry: Manufacturing; Location: Hyderabad; Salary: up to 30,000 per month; Qualification: MBA HR; Experience: 3 to 4 years; Vacancies: 2; Details: recruitment, onboarding and employee coordination; Notice period: 30 to 60 days; Persuasion: manufacturing HR roles cover hiring, compliance and plant operations in one seat, which builds a stronger resume';
let failed = 0;
let total = 0;

function open(language = 'English', factsText = FACTS) {
  const facts = VAC.parseFacts(factsText);
  const built = VAC.build(facts);
  return new ScriptDialogue({
    purpose: 'Screening', language, data: { name: 'Priya', firstName: 'Priya', jobTitle: '', company: '' }, fields: {}, script: built[language], scriptLanguage: language, scripts: built, scriptName: 'vacancy', seed: 'doc', limits: LIMITS, facts,
  });
}
// plays replies; -> { d, said: [every line the AI said], end }
async function play(replies, opts = {}) {
  const d = opts.d || open(opts.language);
  const said = [d.start().say];
  let end = false;
  for (const r of replies) {
    if (end) { said.push(`(call already ended before: ${r})`); break; }
    // eslint-disable-next-line no-await-in-loop
    const o = await d.hear(r, { lang: opts.lang });
    said.push(o.say);
    end = o.done;
  }
  return { d, said, end };
}
function check(name, ok, extra) {
  total += 1;
  if (ok) { console.log(`  ok  ${name}`); return; }
  failed += 1;
  console.log(`FAIL  ${name}${extra ? `\n      ${extra}` : ''}`);
}
const has = (r, re) => re.test(r.said.join(' | '));
const last = (r) => r.said[r.said.length - 1];
const show = (title, r) => { if (VERBOSE) { console.log(`\n--- ${title}`); r.said.forEach((x) => console.log(`  AI: ${x}`)); console.log(`  => ${r.d.st.outcome} · ${r.d.summaryText()}`); } };
const summary = (r) => r.d.summaryText();
const code = (r) => (/Disposition: (\w+)/.exec(summary(r)) || [])[1];
// up to "would this be of interest?"
const TO_INTEREST = ['Yes, speaking.', 'English', 'Yes, go ahead.'];
const MATCH = [...TO_INTEREST, 'Maybe, tell me more.', '3 years', 'Yes, in manufacturing.', 'MBA', 'Yes.', '30 days', 'Current 27k, expecting 30 to 32k', 'Already in Hyderabad', 'No, nothing else.', 'Yes, correct.', "Sure, I'll send it."];

(async () => {
  console.log('The call itself');
  const r0 = await play(MATCH);
  show('worked example', r0);
  check('it asks for the person by name first, with the greeting of the time of day', /^Good (morning|afternoon|evening), am I speaking with Priya\?$/.test(r0.said[0]), r0.said[0]);
  check('then which language', /which language are you most comfortable/.test(r0.said[1]), r0.said[1]);
  check('then who is calling (it says it is an AI assistant) and two minutes?', /This is Bhavana, an AI assistant calling from TeamLink Consultants/.test(r0.said[2]) && /two minutes\?$/.test(r0.said[2]), r0.said[2]);
  check('the vacancy: role, industry, place, duties, qualification, experience, salary, vacancies', /HR Executive with a manufacturing company, based in Hyderabad/.test(r0.said[3]) && /recruitment, onboarding/.test(r0.said[3]) && /MBA HR/.test(r0.said[3]) && /3 to 4 years/.test(r0.said[3]) && /30,000/.test(r0.said[3]) && /2 positions/.test(r0.said[3]) && /of interest to you\?$/.test(r0.said[3]), r0.said[3]);
  check('the client\'s name is never said', !has(r0, /Secret Steels/));
  check('one question at a time: working, then the notice period on its own', r0.said.some((x) => /Are you currently working\?$/.test(x)) && r0.said.some((x) => /What is your notice period\?$/.test(x)) && !r0.said.some((x) => /working\?.*notice/.test(x)));
  check('"That fits the range", as in the worked example', has(r0, /That fits the range/));
  check('Hyderabad is fine', has(r0, /Excellent, Hyderabad suits you/));
  check('what was noted is read back and confirmed before the resume', has(r0, /Let me confirm what I noted/) && r0.said.findIndex((x) => /Let me confirm/.test(x)) < r0.said.findIndex((x) => /updated resume/.test(x)), r0.said.join(' | '));
  const r0x = await play([...MATCH.slice(0, -2), 'No, the notice period is 45 days', 'Sure']);
  check('a correction goes to the team, and the call goes on', has(r0x, /note the correction/) && /Correction to the details: No, the notice period is 45 days/.test(summary(r0x)), summary(r0x));
  check('the resume is asked for on WhatsApp, then thanks', has(r0, /updated resume on WhatsApp\?/) && /We will be in touch soon/.test(last(r0)));
  check('the call ends: Interested, INT', r0.end && r0.d.st.outcome === 'Interested' && code(r0) === 'INT', summary(r0));

  const r0b = await play([...TO_INTEREST, 'Yes', '3 years', "No, I didn't have experience in manufacturing.", 'Healthcare', 'Recruitment and onboarding', 'MBA', 'Yes', '30 days', '3.5 lakhs, expecting 5 lakhs']);
  show('no manufacturing experience', r0b);
  check('no manufacturing experience: which industry, then the work, and the call goes on', has(r0b, /perfectly fine\. Which industry/) && has(r0b, /briefly tell me about your work/) && has(r0b, /highest qualification/), r0b.said.join(' | '));
  const r0c = await play([...TO_INTEREST, 'Yes', '3 years', 'Yes', 'MBA', 'No', 'Current 25k expecting 28k']);
  check('not working: no notice period question', !has(r0c, /notice period\?/) && has(r0c, /current and expected salary/), r0c.said.join(' | '));

  console.log('Not interested');
  const r1 = await play([...TO_INTEREST, "No, I'm not interested.", "I'm looking for a work-from-home role.", "Yes, that's fine."]);
  show('not interested, wants WFH', r1);
  check('no reason given: asks for one (location, salary, role, career plans)', has(r1, /specific reason, such as location, salary, role, or career plans/), r1.said.join(' | '));
  check('work from home: asks to keep the profile, wishes well, NI', has(r1, /suitable work from home roles/) && /very best in your career/.test(last(r1)) && code(r1) === 'NI' && r1.end, summary(r1));
  const r1b = await play([...TO_INTEREST, 'No', 'No reason', 'Okay']);
  show('plain no', r1b);
  check('a plain no: "may I reach out again?", then a kind close', has(r1b, /may I reach out again\?/) && r1b.end && /May be contacted/.test(summary(r1b)), r1b.said.join(' | '));

  console.log('Salary and location');
  const r2 = await play([...TO_INTEREST, "The salary is fine, but Hyderabad is too far for me.", 'Vijayawada', 'No']);
  show('location', r2);
  check('too far: preferred location, open to relocating?, noted, profile kept', has(r2, /preferred work location/) && has(r2, /open to relocating/) && has(r2, /note your location preference/) && r2.end, r2.said.join(' | '));
  check('the place wanted is on the record', /Vijayawada/.test(summary(r2)), summary(r2));
  const r3 = await play([...TO_INTEREST, "The location is fine, but I'm expecting 40000.", 'Yes']);
  show('salary', r3);
  check('expects more: the budget, flexibility is for the team, still proceed?', has(r3, /current budget for this role is up to/) && has(r3, /flexibility from the company side/) && has(r3, /still like to proceed/), r3.said.join(' | '));
  check('a yes goes on with the call, the expectation noted', has(r3, /note your salary expectation/) && has(r3, /years of relevant experience/) && !r3.end, r3.said.join(' | '));
  check('no promise of an increase, ever', !has(r3, /increase|hike/i));
  const r3b = await play([...TO_INTEREST, '30k feels low for my experience.']);
  check('the persuasion hook is used on the salary', has(r3b, /builds a stronger resume/), last(r3b));
  const r4 = await play([...TO_INTEREST, 'The salary is low, and Hyderabad is not my preferred location.', "I'm expecting 40000 and looking for Vijayawada.", 'Okay']);
  show('both', r4);
  check('salary and location: both asked, noted, database with permission, a kind close', has(r4, /expected salary and preferred location/) && has(r4, /keep your profile in our database/) && r4.end && code(r4) === 'NI', r4.said.join(' | '));

  console.log('The other scenarios of the document');
  const b = await play(['Yes.', 'English', "I'm busy right now.", 'Tomorrow at 11 AM.']);
  show('busy', b);
  check('busy: asks when, keeps the time, CB', has(b, /better time to call you back/) && has(b, /schedule a call back/) && code(b) === 'CB' && /Tomorrow at 11/.test(summary(b)), summary(b));
  const b2 = await play(['Yes.', 'English', 'No', 'Evening']);
  check('no time now: asks when, it does not push', has(b2, /better time to call you back/) && code(b2) === 'CB', b2.said.join(' | '));
  const c = await play([...TO_INTEREST, 'Which company is this for?', 'Okay.']);
  show('company', c);
  check('which company: one of our manufacturing clients, the name is kept back, and the call goes on', has(c, /one of our manufacturing clients/) && !has(c, /Secret Steels/) && has(c, /complete company details/), c.said.join(' | '));
  const n = await play([...TO_INTEREST, "I'm not looking for a job change right now.", 'You can send the details.']);
  show('not looking', n);
  check('not looking: many explore, the exposure, decide later; details by WhatsApp', has(n, /explore opportunities even when/) && has(n, /deciding later/) && has(n, /job details on WhatsApp/) && /send the job details/.test(summary(n)), n.said.join(' | '));
  const lo = await play([...TO_INTEREST, 'Yes', '3 years', 'Yes', 'MBA', 'Yes', '90 days']);
  show('long notice', lo);
  check('90 days: prefers 30 to 60 days, noted, and the call goes on', has(lo, /join within 30 to 60 days/) && has(lo, /current and expected salary/), last(lo));
  const w = await play([...TO_INTEREST, 'Is this work-from-home?'], { d: open('English', `${FACTS}; Work mode: This is a work from office role based in Hyderabad`) });
  check('work from home?: answered from the facts, then the question', has(w, /work from office role based in Hyderabad/) && /of interest to you\?$/.test(last(w)), last(w));
  const f = await play([...TO_INTEREST, 'I need to discuss this with my family first.', 'Yes', 'Sure']);
  show('family', f);
  check('family: WhatsApp details, follow up in two days, CB', has(f, /important decision/) && has(f, /in two days\?/) && has(f, /connect with you again in two days/) && code(f) === 'CB', summary(f));
  const s = await play([...TO_INTEREST, "No, I'm preparing for higher studies."]);
  show('studies', s);
  check('higher studies: wishes well and ends', has(s, /success in your studies/) && s.end, last(s));
  const be = await play([...TO_INTEREST, 'What benefits does the company provide?', 'Okay.']);
  check('benefits: not in the facts, so not made up; the team will tell', has(be, /complete benefits information/) && !be.end, be.said.join(' | '));
  const t = await play([...TO_INTEREST, 'Is this a genuine opportunity?', 'Okay']);
  show('genuine', t);
  check('genuine?: a confirmed requirement of one of our clients', has(t, /confirmed requirement from one of our manufacturing clients/), t.said.join(' | '));
  const wr = await play(["No, you've reached the wrong number."]);
  check('wrong number: apologises, says nothing about the job, WN', /apologize/.test(last(wr)) && !has(wr, /HR Executive/) && code(wr) === 'WN' && wr.end, wr.said.join(' | '));
  const dn = await play([...TO_INTEREST, 'Do not call me again.']);
  check('do not call: ends at once, DNC', dn.end && code(dn) === 'DNC' && !has(dn, /reach out again/), dn.said.join(' | '));

  console.log('Interview questions');
  const i1 = await play([...TO_INTEREST, 'Yes', '3 years', 'Yes', 'MBA', 'Yes', '30 days', '27k, 30k', 'Yes in Hyderabad', 'Is the interview online or offline?', 'I prefer online interviews.', 'No']);
  show('interview', i1);
  check('online or offline: decided by the hiring team', has(i1, /decided by the hiring team/), i1.said.join(' | '));
  check('a preference is noted for the team', has(i1, /final interview mode will be confirmed by the company/) && /Interview preference/.test(summary(i1)), summary(i1));
  const i2 = await play([...TO_INTEREST, "I won't be able to travel for an offline interview."]);
  check('cannot travel: the team checks for an online interview', has(i2, /check whether an online interview option/), i2.said.join(' | '));
  const i3 = await play([...TO_INTEREST, 'Yes, is the interview online?']);
  check('a yes with a question: answered, and the call goes on', has(i3, /decided by the hiring team/) && /years of relevant experience do you have\?$/.test(last(i3)), last(i3));

  console.log('Fit');
  const oq = await play([...TO_INTEREST, 'Yes', '1 year']);
  check('too little experience: a kind close, OQ', oq.end && code(oq) === 'OQ' && has(oq, /closer match to your current level/), summary(oq));
  const un = await play([...TO_INTEREST, 'Yes', '3 years', 'Yes', 'MBA', 'Yes', '30 days', 'Current 27k expecting 40k']);
  check('expected pay above the budget: said, noted, the call goes on', has(un, /current budget for this role is up to/) && !un.end, last(un));
  const ai = await play([...TO_INTEREST, 'Are you a robot?']);
  check('are you a robot?: yes, an AI assistant', has(ai, /Yes, I am an AI assistant/), last(ai));
  const up = await play([...TO_INTEREST, 'You idiot, stop wasting my time']);
  check('upset: stays polite and ends', up.end, last(up));

  console.log('Languages');
  const te = await play(['Yes.', 'Telugu + English', 'Yes', 'చెప్పండి']);
  show('Telugu', te);
  check('"Telugu + English": the call goes on in Telugu', te.d.language === 'Telugu' && has(te, /తెలుగులో మాట్లాడుతాను/) && has(te, /రెండు నిమిషాలు/), te.said.join(' | '));
  check('the Telugu call has the vacancy, without the client', has(te, /HR Executive/) && has(te, /ఓపెనింగ్ ఉంది/) && !has(te, /Secret/), te.said.join(' | '));
  const hi = await play(['Yes.', 'Hindi', 'हाँ', 'हाँ', 'नहीं', 'नहीं']);
  show('Hindi', hi);
  check('"Hindi": the call goes on in Hindi', hi.d.language === 'Hindi' && has(hi, /दो मिनट/) && has(hi, /ओपनिंग है/), hi.said.join(' | '));
  const te2 = await play(['Yes.', 'Telugu', 'Yes', 'జీతం తక్కువ', 'వద్దు']);
  show('Telugu salary', te2);
  check('Telugu: pay too low gets the budget line', has(te2, /బడ్జెట్/), te2.said.join(' | '));
  const nofacts = await play(['Yes', 'English', 'Yes', 'Yes'], { d: open('English', 'Role: Staff Nurse; Location: Hyderabad; Salary: 25k; Company: TeamLink') });
  check('a vacancy with few facts still reads well', /We have an opening for Staff Nurse, based in Hyderabad\. The salary is 25 thousand\./.test(nofacts.said[3]) && !has(nofacts, /undefined/), nofacts.said[3]);
  const all = [r0, r1, r2, r3, r4, b, c, n, f, s, te, hi].flatMap((x) => x.said).join(' ');
  check('nothing unfilled is ever said', !/undefined|\{name\}|\{greet\}|null/.test(all));

  console.log(failed ? `\n${failed} of ${total} checks FAILED` : `\nAll ${total} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
