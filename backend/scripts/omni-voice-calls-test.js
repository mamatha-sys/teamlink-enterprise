#!/usr/bin/env node
/**
 * AI calls for Omni-Channel (Green Start) contacts through the AI phone line (calling/omniCalls.js + sipCall.dialOmni + routes/omniVoiceBridge.js).
 * SANDBOX ONLY: a COPY of prisma/dev.db (VACUUM INTO, deleted at the end); the phone line is a stand-in (nothing is dialled).
 *   node scripts/omni-voice-calls-test.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BACK = path.resolve(__dirname, '..');
const DEV_DB = process.env.TEST_SOURCE_DB || path.join(BACK, 'prisma', 'dev.db');
const COPY = path.join(BACK, 'prisma', 'zz-omnicalls-test.db');
for (const sfx of ['', '-wal', '-shm', '-journal']) { try { fs.unlinkSync(COPY + sfx); } catch { /* none */ } }
const { DatabaseSync } = require('node:sqlite');
let src;
try { src = new DatabaseSync(DEV_DB, { readOnly: true }); } catch { src = new DatabaseSync(DEV_DB); }
src.exec(`VACUUM INTO '${COPY.replace(/'/g, "''")}'`);
src.close();
process.env.NODE_ENV = 'development';
process.env.DATABASE_URL = `file:${COPY.split(path.sep).join('/')}`;
process.env.GREENSTART_SSO_SECRET = 'x'.repeat(40);

const prisma = require('../src/db');
const DB = require('../src/calling/schema');
const svc = require('../src/calling/callService');
const omni = require('../src/calling/omniCalls');
const sip = require('../src/calling/voice/sipCall');

let failed = 0;
const check = (name, ok, detail) => { if (!ok) failed += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? `  -> ${JSON.stringify(detail).slice(0, Number(process.env.DETAIL) || 300)}` : ''}`); };

const token = (over = {}, secret = process.env.GREENSTART_SSO_SECRET) => {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const p = b64({ iss: 'greenstart', aud: 'teamlink-voice', iat: now, exp: now + 60, jti: crypto.randomUUID(), ...over });
  return `Bearer ${h}.${p}.${crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`;
};

const SCRIPT = ['Opening: Hello {name}, this is an automated call from Teamlink.', 'Say: We have a teaching vacancy near you.', 'Ask: Are you looking for a job now?', 'Interest: Shall our team call you with details?', 'Closing: Thank you for your time. Goodbye.'].join('\n');
const TELUGU = ['Opening: నమస్కారం {name} గారు, ఇది టీమ్‌లింక్ నుండి ఆటోమేటెడ్ కాల్.', 'Say: మీ దగ్గర ఒక టీచింగ్ ఉద్యోగం ఉంది.', 'Ask: మీరు ఇప్పుడు ఉద్యోగం వెతుకుతున్నారా?', 'Interest: మా బృందం వివరాలతో కాల్ చేయాలా?', 'Closing: ధన్యవాదాలు. నమస్కారం.'].join('\n');
const LINE = (over = {}) => ({ ready: true, problems: [], mode: 'Live', testNumbers: [], format: '10', via: 'ami', trunk: 'trunk', ami: {}, port: 9092, callerId: '', ...over });
const originated = [];
const AMI = { action: async (a) => { originated.push(a); return { Response: 'Success' }; } };

(async () => {
  try {
    await DB.ensure();
    await require('../src/calling/settings').save({ [require('../src/calling/exotelConfig').F.mode]: 'Off' }, null).catch(() => {}); // (a copy of the data) the switch of the copied data must not decide: each check gives the line its own mode
    // ---- who may ask
    check('a request signed with the shared secret is accepted', omni.verify(token()).ok === true);
    check('the same signed request twice is refused (used once)', (() => { const t = token({ jti: 'same-1' }); return omni.verify(t).ok && !omni.verify(t).ok; })());
    check('a wrong signature, a wrong audience and an expired token are refused', !omni.verify(token({}, 'y'.repeat(40))).ok && !omni.verify(token({ aud: 'greenstart' })).ok && !omni.verify(token({ exp: Math.floor(Date.now() / 1000) - 5 })).ok && !omni.verify('Bearer a.b.c').ok && !omni.verify('').ok);

    // ---- a call (12:00 India time, inside the calling hours)
    svc.setClock(() => new Date('2026-11-04T06:30:00Z'));
    const deps = { config: LINE(), ami: AMI, prepare: false, translate: { config: null } };
    const args = { externalId: 'tgt1:1', toNumber: '90300 48228', name: 'Mrudula Rao', script: SCRIPT, scriptLanguage: 'English', scripts: { Telugu: TELUGU }, agentName: 'Vacancy intro' };
    let r = await omni.create(args, deps);
    check('a call to a plain phone number is dialled through the AI phone line', r.ok && originated.length === 1 && /^PJSIP\/9030048228@trunk$/.test(originated[0].Channel) && originated[0].Application === 'AudioSocket', { r, originated });
    const row = await svc.getCall(r.id);
    check('its row is a calling AI phone call with no application and no job, kept apart as an Omni contact', row.status === 'calling' && row.initiatedVia === require('../src/calling/voice/gateway').VIA && !row.applicationId && !row.requirementId && /^omni:tgt1:1$/.test(row.candidateId) && !!row.toMask, row);
    check('the number is not stored in the clear (only the masked form)', !JSON.stringify(row).includes('9030048228'), row.toMask);
    const again = await omni.create(args, deps);
    check('asking again for the same call does not ring a second time', again.ok && again.id === r.id && again.again === true && originated.length === 1, again);

    // ---- the talk: the team's script, with the contact's name, switching to Telugu
    const d = await require('../src/calling/webTalk').dialogueFor(row);
    const first = d.start();
    check('the call opens with the script and the contact\'s first name', /Hello Mrudula, this is an automated call/.test(first.say), first.say);
    let h = await d.hear('అవును చెప్పండి', { heard: 'clear', lang: 'Telugu' });
    check('and goes on in Telugu when the person speaks Telugu (the script has a Telugu version)', d.language === 'Telugu' && /ఉద్యోగం/.test(h.say), { lang: d.language, say: h.say });
    h = await d.hear('అవును');
    h = await d.hear('అవును కాల్ చేయండి');
    check('it ends with the closing', h.done === true, h);
    const result = d.outcome();
    await omni.applyResult(row.id, result, d.transcript());
    await svc.setRow(row.id, { status: 'completed', endedAt: new Date().toISOString(), durationSec: 61 });
    const st = await omni.status(row.id);
    check('the result is on the row for Green Start: ended, the outcome, the summary and what was said', st.ended && st.status === 'completed' && st.outcome === 'Interested' && /Telugu/.test(st.summary) && st.turns.length >= 4 && st.turns[0].who === 'assistant', st);
    check('a call still ringing says it is not ended, with no talk yet', await (async () => { const x = await omni.create({ ...args, externalId: 'tgt2:1', toNumber: '9000000001' }, { ...deps, ami: AMI }); const s2 = await omni.status(x.id); return x.ok && !s2.ended && s2.turns.length === 0; })());

    // ---- kept out of the ATS lists and the history sync
    const sync = require('../src/utils/omniVoiceSync');
    const pend = await sync.pending();
    check('the ATS call list and the Omni history sync do not take these calls (Green Start keeps its own record)', !pend.some((p) => String(p.item.externalId) === row.id) && (await DB.all('SELECT "id" FROM "AiCall" WHERE "candidateId" NOT LIKE \'omni:%\'')).every((x) => x.id !== row.id));

    // ---- refusals: nothing is dialled
    const before = originated.length;
    const refuse = async (over, d2 = deps) => omni.create({ ...args, externalId: `r${Math.random()}`, ...over }, d2);
    check('a number that cannot be called is refused', (await refuse({ toNumber: '123' })).ok === false);
    check('any script is accepted: words the ATS agents may not say, no closing, no question (the team\'s own script, as written)', await (async () => { const a = await refuse({ script: SCRIPT.replace('vacancy near you', 'vacancy, you are selected and hired'), toNumber: '9666666661' }); const b = await refuse({ script: 'Hello, good morning. This is the AI assistant of Teamlink.', toNumber: '9666666662' }); return a.ok === true && b.ok === true; })());
    check('an empty script is refused', (await refuse({ script: '   ' })).ok === false);
    // Green Start steps can be 600 characters and a script 30 steps (the live campaign was refused "Line 2 is too long (at most 300 characters)")
    const longText = 'We have a teaching vacancy near you with a good salary and a hostel. '.repeat(8).trim();
    const many = ['Opening: Hello {name}, this is an automated call from Teamlink.', ...Array.from({ length: 24 }, (_, i) => `Say: Point number ${i + 1} about the job.`), `Ask: ${longText}`, 'Closing: Thank you. Goodbye.'].join('\n');
    check('a long step (over 300 characters) and a long script (over 14 lines) from Omni-Channel are accepted', await (async () => { const x = await refuse({ script: many, scripts: {}, toNumber: '9444444444' }); return x.ok === true; })(), longText.length);
    check('a very long line (over 5000 characters) is refused, 1000 is fine', await (async () => { const a = await refuse({ script: `Opening: Hi\nAsk: ${'x '.repeat(3000)}\nClosing: Bye`, toNumber: '9666666663' }); const b = await refuse({ script: `Opening: Hi\nAsk: ${'word '.repeat(200)}\nClosing: Bye`, toNumber: '9666666664' }); return !a.ok && /too long/.test(a.reason) && b.ok === true; })());
    const sd = require('../src/calling/scriptDialogue');
    check('the ATS agent limits are unchanged (300 characters, 14 lines)', !sd.parseScript(`Opening: Hi\nAsk: ${longText}\nClosing: Bye`).ok && !sd.parseScript(many).ok);
    // a message with nothing to ask: said in one go, then the call ends (the founder's "hello, good morning, this is AI from Teamlink")
    const hello = 'Opening: Hello {name}, good morning. This is an automated AI call from Teamlink Consultants.\nSay: Have a nice day.\nClosing: Thank you. Goodbye.';
    check('an ATS agent script still needs a question', !sd.parseScript(hello).ok);
    const hr = await omni.create({ externalId: 'hello1', toNumber: '9555555555', name: 'Sravanthi Rao', script: hello, agentName: 'Greeting' }, { ...deps, ami: AMI });
    check('a script with nothing to ask is accepted for an Omni-Channel call', hr.ok === true, hr);
    const hrow = await svc.getCall(hr.id);
    const hd = await require('../src/calling/webTalk').dialogueFor(hrow);
    const hs = hd.start();
    check('it is said in one go (opening, the line, the closing) and the call ends', hs.done === true && /Hello Sravanthi, good morning/.test(hs.say) && /Have a nice day/.test(hs.say) && /Thank you\. Goodbye/.test(hs.say), hs);
    await svc.setRow(hr.id, { botStateJson: JSON.stringify({ ...hd.snapshot(), done: true }), status: 'completed', endedAt: new Date().toISOString() });
    check('Green Start is told the message was said in full (so the contact is not rung again as "unanswered")', (await omni.status(hr.id)).messageSaid === true);
    const ho = hd.outcome();
    check('the result is written for Green Start: a finished call, not "could not hear you"', !!ho.outcome && !/could not hear|not clear/i.test(ho.summary || ''), ho);
    // talks like a person: an "okay" before the next line, a short "sorry" (not the whole greeting again), "hello, can you hear me?" when nothing was heard at first
    const conv = await omni.create({ externalId: 'conv1', toNumber: '9777777771', name: 'Sravanthi', script: 'Opening: Hello {name}, this is the AI assistant of Teamlink.\nAsk: Are you looking for a job right now?\nSay: We have teaching vacancies.\nInterest: Shall our team call you?\nClosing: Thank you. Goodbye.' }, { ...deps, ami: AMI });
    const cd = await require('../src/calling/webTalk').dialogueFor(await svc.getCall(conv.id));
    cd.start();
    const c1 = await cd.hear('', { heard: 'none' });
    const c2 = await cd.hear('hello');
    const c3 = await cd.hear('...', { heard: 'unclear' });
    const c4 = await cd.hear('yes I am looking');
    const c5 = await cd.hear('no');
    const c6 = await cd.hear('not really');
    check('nothing heard after the opening: "hello? can you hear me?", not the whole greeting again', /^Hello\? Can you hear me/.test(c1.say) && !/AI assistant/.test(c1.say), c1);
    check('the question is asked after "hello"; an unheard answer gets a short sorry and the question again', /^Are you looking/.test(c2.say) && /^Sorry, .*Are you looking for a job right now\?$/.test(c3.say), { c2, c3 });
    check('an answer is acknowledged with a short word; a "no" is first asked why (one try to understand), then closed kindly', /^(Okay|Alright|Sure|Right)[^.]*\. We have teaching vacancies\. Shall our team call you\?$/.test(c4.say) && /^I understand\. May I ask why\?/.test(c5.say) && c5.done === false && /^(Alright, no problem|Okay, understood|Sure, that is fine)\./.test(c6.say) && c6.done === true, { c4, c5, c6 });

    // THE PERSON'S LANGUAGE: the other versions are made by the local model once and kept; a call with them switches to the language that is spoken
    const SW = 'Opening: Hello {name}, this is the AI assistant of Teamlink.\nAsk: Are you looking for a job right now?\nClosing: Thank you. Goodbye.';
    const SW_TE = 'Opening: నమస్కారం {name} గారు, నేను టీమ్‌లింక్ AI అసిస్టెంట్.\nAsk: మీరు ఇప్పుడు ఉద్యోగం వెతుకుతున్నారా?\nClosing: ధన్యవాదాలు. నమస్కారం.';
    check('the language of a script is read from its letters', omni.detectLang(SW) === 'English' && omni.detectLang(SW_TE) === 'Telugu' && omni.detectLang('नमस्ते {name}') === 'Hindi');
    const before1 = await omni.versionsFor(SW, 'English', {}, { config: null });
    check('with no translation made yet the call has no other language (and the missing ones are only asked for)', Object.keys(before1).length === 0, before1);
    // a translation made earlier (here written into the store, as the translator does)
    const val = JSON.stringify({ text: SW_TE, at: new Date().toISOString(), by: 'test' });
    await prisma.appSetting.upsert({ where: { key: omni.trKey(SW, 'Telugu') }, create: { key: omni.trKey(SW, 'Telugu'), value: val }, update: { value: val } });
    const sw = await omni.create({ externalId: 'sw1', toNumber: '9888888881', name: 'Sravanthi', script: SW }, { ...deps, ami: AMI });
    const swd = await require('../src/calling/webTalk').dialogueFor(await svc.getCall(sw.id));
    swd.start();
    const s1 = await swd.hear('అవును చెప్పండి', { heard: 'clear', lang: 'Telugu' });
    check('a person who answers in Telugu gets the rest of the call in Telugu', swd.language === 'Telugu' && /ఉద్యోగం/.test(s1.say), { lang: swd.language, say: s1.say });
    const sw2 = await omni.create({ externalId: 'sw2', toNumber: '9888888882', name: 'Ravi', script: SW }, { ...deps, ami: AMI });
    const swd2 = await require('../src/calling/webTalk').dialogueFor(await svc.getCall(sw2.id));
    swd2.start();
    const s2 = await swd2.hear('నేను హిందీ లో మాట్లాడతా', { heard: 'clear', lang: 'Hindi' });
    check('a language with no version made (Hindi here) is never switched to: the call stays as it is', swd2.language === 'English', swd2.language);
    check('a translation that is asked for in the background never stops the call', sw.ok && sw2.ok);
    // CONVINCE: the script's own lines are tried one by one when the person says no (founder 2026-11-05: "not interested ante convince cheyyali")
    const CV = 'Opening: Hello {name}, this is the AI assistant of Teamlink.\nInterest: Are you interested in a job?\nConvince: This opening has a good salary and the office is near you. Would you like to hear more?\nConvince: Our team can also look at other roles for you. Shall we try?\nDecline: No problem. Have a nice day.\nClosing: Thank you. Goodbye.';
    const cvr = await omni.create({ externalId: 'cv1', toNumber: '9444444441', name: 'Sravanthi', script: CV }, { ...deps, ami: AMI });
    const cvd = await require('../src/calling/webTalk').dialogueFor(await svc.getCall(cvr.id));
    cvd.start(); await cvd.hear('hello');
    const v1 = await cvd.hear('no');
    const v2 = await cvd.hear('no I am not interested');
    const v3 = await cvd.hear('no');
    check('a "no" is answered with the script\'s own Convince lines, one at a time (two tries), then the Decline message', /good salary/.test(v1.say) && !v1.done && /other roles/.test(v2.say) && !v2.done && v3.done === true && /^No problem\. Have a nice day/.test(v3.say), { v1, v2, v3 });
    const cvr2 = await omni.create({ externalId: 'cv2', toNumber: '9444444442', name: 'Ravi', script: CV }, { ...deps, ami: AMI });
    const cvd2 = await require('../src/calling/webTalk').dialogueFor(await svc.getCall(cvr2.id));
    cvd2.start(); await cvd2.hear('hello'); await cvd2.hear('no');
    const y = await cvd2.hear('yes ok tell me');
    check('if the person says yes after the try, the call goes on (interested)', !/Have a nice day/.test(y.say) && cvd2.st.interest === 'yes', y);
    check('"do not call me" is never argued with', await (async () => { const cvr3 = await omni.create({ externalId: 'cv3', toNumber: '9444444443', name: 'Asha', script: CV }, { ...deps, ami: AMI }); const d3 = await require('../src/calling/webTalk').dialogueFor(await svc.getCall(cvr3.id)); d3.start(); await d3.hear('hello'); const z = await d3.hear('do not call me again'); return z.done === true && !/good salary/.test(z.say); })());

    // A SCRIPT PASTED AS ONE BLOCK (the founder's HR Recruiter script): laid out as a conversation, not said in one breath
    const BLOB = 'Opening: Hello {name}, this is an automated call from Teamlink.\nInterest: “Hello, am I speaking with [Candidate Name]? Do you have one minute to talk about a job opportunity?” If yes: Vacancy details “We currently have an opening for HR Recruiter. Location: Kukatpally. Salary: 10K per month.” Interest check “Are you interested in this opportunity?” If interested “Great. Can you confirm a good time for the call?” If not interested / busy “No problem. If you know any graduate who is looking for a job, please share this opportunity.” Closing “Thank you, [Candidate Name]. Have a nice day.”\nClosing: Thank you. Goodbye.';
    const norm = omni.normalizeScript(BLOB).split('\n');
    check('the block is laid out as lines: opening, ask, say, interest, ask, decline, and the pasted closing (not the generic one)', norm.map((l) => l.split(':')[0]).join(',') === 'Opening,Ask,Say,Interest,Ask,Decline,Closing' && /Thank you, \{name\}\. Have a nice day/.test(norm[6]), norm);
    check('a script that is already lines is not touched', omni.normalizeScript(SCRIPT) === SCRIPT);
    const b1 = await omni.create({ externalId: 'blob1', toNumber: '9999999991', name: 'Sravanthi Rao', script: BLOB }, { ...deps, ami: AMI });
    const bd = await require('../src/calling/webTalk').dialogueFor(await svc.getCall(b1.id));
    const bs0 = bd.start().say;
    const bs1 = (await bd.hear('hello')).say;
    const bs2 = (await bd.hear('yes tell me')).say;
    const bs3 = (await bd.hear('yes interested')).say;
    const bs4 = await bd.hear('tomorrow at five');
    check('the call goes step by step: it waits for an answer between the parts', /^Hello Sravanthi, this is an automated call/.test(bs0) && /^Hello, am I speaking with Sravanthi\?/.test(bs1) && /We currently have an opening/.test(bs2) && /Are you interested in this opportunity\?$/.test(bs2) && /^(Okay|Alright|Sure|Right)[^.]*\. Great\. Can you confirm a good time/.test(bs3), { bs0, bs1, bs2, bs3 });
    check('it ends with the pasted closing after the last answer', bs4.done === true && /Thank you, Sravanthi\. Have a nice day/.test(bs4.say) && !/Goodbye/.test(bs4.say), bs4);
    const b2 = await omni.create({ externalId: 'blob2', toNumber: '9999999992', name: 'Ravi Kumar', script: BLOB }, { ...deps, ami: AMI });
    const bd2 = await require('../src/calling/webTalk').dialogueFor(await svc.getCall(b2.id));
    bd2.start(); await bd2.hear('hello'); await bd2.hear('yes');
    const try1 = await bd2.hear('no');
    const no = await bd2.hear('the salary is low');
    check('"not interested": first one try (why?), then the script\'s own message for it, not the pasted closing', /^I understand\. May I ask why/.test(try1.say) && try1.done === false && no.done === true && /^No problem\. If you know any graduate/.test(no.say) && !/Have a nice day/.test(no.say), no);
    check('a version in another language is taken as written too', (await refuse({ scripts: { Telugu: 'నమస్కారం' }, toNumber: '9666666665' })).ok === true);
    check('the line not being ready is said in words', await (async () => { const x = await refuse({}, { ...deps, config: LINE({ ready: false, problems: ['The Asterisk manager login is missing.'] }) }); return !x.ok && /not ready/.test(x.reason); })());
    check('in Test mode only the saved test numbers are called', await (async () => { const x = await refuse({ toNumber: '9111111111' }, { ...deps, config: LINE({ mode: 'Test', testNumbers: ['+919030048228'] }) }); return !x.ok && x.code === 'test_number'; })());
    check('with AI calling switched Off nothing is called', (await refuse({}, { ...deps, config: LINE({ mode: 'Off' }) })).ok === false);
    check('a number that asked not to be called is refused', await (async () => {
      await DB.run('INSERT OR IGNORE INTO "AiCallSuppression" ("id","phone","kind","source","note","createdByName","createdAt") VALUES (?,?,?,?,?,?,?)', 'zzsup1', '9222222222', 'optout', 'test', 'x', 'test', new Date().toISOString());
      const x = await refuse({ toNumber: '9222222222' }); return !x.ok && x.code === 'opted_out';
    })());
    svc.setClock(() => new Date('2026-11-04T20:30:00Z')); // 02:00 India time
    check('outside the calling hours nothing is dialled', await (async () => { const x = await refuse({}); return !x.ok && x.code === 'outside_hours'; })());
    svc.setClock(() => new Date('2026-11-04T06:30:00Z'));
    // a refusal to the very first question ("do you have a minute to talk?") is also met with one try, in words the general reader does not know
    const PM = 'Opening: Hello {name}, this is the AI assistant of Teamlink.\nAsk: Do you have one minute to talk about a job opportunity?\nSay: We have an HR Recruiter opening.\nInterest: Are you interested?\nConvince: It will only take a minute and the salary is good. Shall I continue?\nDecline: No problem. Have a nice day.\nClosing: Thank you. Goodbye.';
    const pm1 = await omni.create({ externalId: 'pm1', toNumber: '9333333331', name: 'Sravanthi', script: PM }, { ...deps, ami: AMI });
    const pd1 = await require('../src/calling/webTalk').dialogueFor(await svc.getCall(pm1.id)); pd1.start(); await pd1.hear('hello');
    const p1 = await pd1.hear('I am not going to talk about it');
    const p2 = await pd1.hear('no');
    check('a no to "do you have a minute?" gets one try, then a kind close (the script Decline)', /only take a minute/.test(p1.say) && !p1.done && p2.done === true && /^No problem\. Have a nice day/.test(p2.say), { p1, p2 });
    const pm2 = await omni.create({ externalId: 'pm2', toNumber: '9333333332', name: 'Ravi', script: PM }, { ...deps, ami: AMI });
    const pd2 = await require('../src/calling/webTalk').dialogueFor(await svc.getCall(pm2.id)); pd2.start(); await pd2.hear('hello'); await pd2.hear('I am not going to talk about it');
    const p3 = await pd2.hear('okay go ahead');
    check('if the person then agrees, the call goes on to the vacancy and the interest question', /HR Recruiter opening/.test(p3.say) && /Are you interested\?$/.test(p3.say), p3);
    // THE FACTS OF A VACANCY (founder 2026-11-05): the call is built from them in English, Telugu and Hindi
    const FACTS = 'Opening: This is an automated AI call. Role: HR Recruiter; Company: Teamlink Consultants; Location: Kukatpally; Salary: 10K per month; Qualification: Any graduate; Details: sourcing candidates and screening resumes; Contact: Anil Ravali';
    const VAC = require('../src/calling/vacancyScript');
    const vf = VAC.parseFacts(FACTS);
    check('the facts of a vacancy are read (role, company, location, salary, qualification, details, contact)', vf && vf.role === 'HR Recruiter' && vf.salary === '10K per month' && vf.contact === 'Anil Ravali' && vf.location === 'Kukatpally', vf);
    check('a script that is not facts is not taken for facts', VAC.parseFacts(SCRIPT) === null && VAC.parseFacts('Role: nurse; Location: x') === null);
    const vp = await omni.prepare(FACTS);
    check('nothing is translated for a vacancy: all three languages are ready at once', vp.ok && vp.ready.length === 3 && vp.pending.length === 0, vp);
    // THE WORDS OF THE CALL, scenario by scenario, are in scripts/ai-call-document-test.js: here, that such a call runs through omni.create and the web talk
    const talk = async (ext, num, steps, script = FACTS) => {
      const r0 = await omni.create({ externalId: ext, toNumber: num, name: 'Kiran Rao', script }, { ...deps, ami: AMI });
      const dd = await require('../src/calling/webTalk').dialogueFor(await svc.getCall(r0.id));
      const first = dd.start().say;
      const outs = []; for (const t of steps) outs.push(await dd.hear(...[].concat(t))); return { dd, outs, first };
    };
    const fc1 = await talk('vac1', '9222333301', ['yes speaking', 'English', 'yes tell me', 'what is the salary?', 'yes interested', '3 years', 'B.Com', 'yes', 'one month', 'current ten thousand, expected twelve thousand', 'I stay in Kukatpally', 'no doubts', 'yes correct', 'yes I will send it']);
    check('the call is built from the facts: the name, the language, who is calling, two minutes?, the vacancy', /^Good (morning|afternoon|evening), am I speaking with Kiran\?$/.test(fc1.first) && /which language/.test(fc1.outs[0].say) && /AI assistant calling from Teamlink Consultants/.test(fc1.outs[1].say) && /two minutes/.test(fc1.outs[1].say) && /We have an opening for HR Recruiter, based in Kukatpally/.test(fc1.outs[2].say) && /The salary is 10 thousand per month/.test(fc1.outs[2].say), fc1.outs.slice(0, 3).map((x) => x.say));
    check('a question about the salary is answered from the facts, then the question is asked again', /^The salary is 10 thousand per month\. Would this be of interest/.test(fc1.outs[3].say), fc1.outs[3]);
    check('one question at a time to the resume, then the close; the summary says INT', /relevant experience/.test(fc1.outs[4].say) && /highest qualification/.test(fc1.outs[5].say) && /currently working\?$/.test(fc1.outs[6].say) && /notice period\?$/.test(fc1.outs[7].say) && /current and expected salary/.test(fc1.outs[8].say) && /Kukatpally/.test(fc1.outs[9].say) && /any questions/.test(fc1.outs[10].say) && /confirm what I noted/.test(fc1.outs[11].say) && /resume/.test(fc1.outs[12].say) && fc1.outs[13].done === true && /^Disposition: INT/.test(fc1.dd.outcome().summary), fc1.outs.map((x) => x.say));
    const fc2 = await talk('vac2', '9222333302', ['అవును', 'తెలుగు', ['అవును చెప్పండి', { heard: 'clear' }]]);
    check('the language the person picks: the rest of the call is in Telugu, built from the same facts', fc2.dd.language === 'Telugu' && /రెండు నిమిషాలు/.test(fc2.outs[1].say) && /HR Recruiter/.test(fc2.outs[2].say) && /Kukatpally/.test(fc2.outs[2].say) && /10 వేలు/.test(fc2.outs[2].say), fc2.outs.map((x) => x.say));
    const fc3 = await talk('vac3', '9222333303', [], FACTS.replace('Contact:', 'Language: Hindi; Contact:'));
    check('"Language: Hindi" starts the call in Hindi', /क्या मेरी बात Kiran जी से/.test(fc3.first), fc3.first);
    const fc4 = await talk('vac4', '9222333304', ['yes', 'English', 'yes', 'no', 'the salary is low', 'no', 'okay']);
    check('"not interested": asks for the reason; pay: the budget, never a promise; then may we reach out again, a kind close', /specific reason/.test(fc4.outs[3].say) && /current budget/.test(fc4.outs[4].say) && !/increase/.test(fc4.outs[4].say) && /reach out again/.test(fc4.outs[5].say) && fc4.outs[6].done === true && fc4.dd.outcome().outcome === 'Not Interested', fc4.outs.map((x) => x.say));
    const fc5 = await talk('vac5', '9222333305', ['yes', 'English', 'yes', 'సచ్చే']);
    check('a half heard reply to the vacancy does not close the call', !fc5.outs[3].done, fc5.outs[3]);
    const fc6 = await talk('vac6', '9222333306', [['', { heard: 'unclear' }]]);
    check('the first reply, even when its words were not caught, goes on to the language (no "can you hear me?")', /which language/.test(fc6.outs[0].say) && !/Can you hear me/.test(fc6.outs[0].say), fc6.outs[0]);
    const fc7 = await talk('vac7', '9222333307', ['yes', 'English', 'call me later I am busy', 'tomorrow at five in the evening']);
    check('busy: asked for a better time, the answer is kept and the call ends (Call Back Later)', /better time to call you back/.test(fc7.outs[2].say) && fc7.outs[3].done === true && fc7.dd.outcome().outcome === 'Call Back Later' && /^Disposition: CB/.test(fc7.dd.outcome().summary), fc7.outs.map((x) => x.say));
    const gq = await talk('gq1', '9111222208', ['yes', 'English', 'yes', 'yes interested', ['mm graduation ante B Com', { heard: 'unclear' }], ['ఇ లేదు నాంత', { heard: 'unclear' }]]);
    check('a half-heard answer to "how many years / qualification" is taken as the answer and the call goes on', gq.outs.slice(4).every((x) => !x.done) && /qualification/.test(gq.outs[4].say) && /working/.test(gq.outs[5].say), gq.outs.map((x) => x.say));
    const gh = await talk('gq2', '9111222209', ['yes', 'English', 'yes', 'yes interested']);
    const gh1 = await gh.dd.hear('', { heard: 'unclear' }); const gh2 = await gh.dd.hear('', { heard: 'unclear' }); const gh3 = await gh.dd.hear('', { heard: 'unclear' }); const gh4 = await gh.dd.hear('', { heard: 'unclear' });
    check('nothing at all heard: asked again up to four times before the line is called not clear', !gh1.done && !gh2.done && !gh3.done && !gh4.done, [gh1.say, gh4.say]);
    // PACE (founder 2026-11-09): a long script is told in parts, the person is heard between the parts
    const LONGSAY = ['Opening: Hello {name}, this is the AI assistant of Teamlink Consultants.', 'Say: We are hiring for the HR Recruiter position in Kukatpally with a good salary and a friendly team that you will enjoy working with every day.', 'Say: The work is sourcing candidates, screening resumes and scheduling interviews, and you will get training from our senior recruiters in the first month.', 'Say: The office is open from nine thirty to six thirty, Monday to Saturday, and there is a monthly incentive on every successful joining.', 'Say: Freshers are welcome, and the company also gives a hostel facility for candidates who come from other districts.', 'Closing: Thank you for your time. Goodbye.'].join('\n');
    const pc = await omni.create({ externalId: 'pace1', toNumber: '9111222241', name: 'Kiran', script: LONGSAY }, { ...deps, ami: AMI });
    const pcd = await require('../src/calling/webTalk').dialogueFor(await svc.getCall(pc.id));
    const pc0 = pcd.start(); const pc1 = await pcd.hear('hello'); const pc2 = await pcd.hear('okay');
    check('a long statement-only script is not said in one go: the opening, then parts, each followed by a wait for the person; the call ends after the last part', !pc0.done && /Hello Kiran/.test(pc0.say) && !/HR Recruiter position/.test(pc0.say) && !pc1.done && /HR Recruiter position/.test(pc1.say) && !/hostel/.test(pc1.say) && !/Thank you for your time/.test(pc1.say) && pc2.done === true && /hostel/.test(pc2.say) && /Thank you for your time/.test(pc2.say), { pc0, pc1, pc2 });
    const pcs = pcd.outcome();
    const pc5 = await omni.create({ externalId: 'pace2', toNumber: '9111222242', name: 'Kiran', script: LONGSAY }, { ...deps, ami: AMI });
    const pcd2 = await require('../src/calling/webTalk').dialogueFor(await svc.getCall(pc5.id)); pcd2.start(); await pcd2.hear('hello');
    const pq = await pcd2.hear('what is the salary?');
    check('at a pause a question is kept for the team and the message goes on to its end', pq.done === true && /hostel/.test(pq.say) && /what is the salary/.test(pcd2.outcome().summary), { pq, o: pcd2.outcome() });
    const pn0 = await omni.create({ externalId: 'pace2b', toNumber: '9111222245', name: 'Kiran', script: LONGSAY }, { ...deps, ami: AMI });
    const pnd = await require('../src/calling/webTalk').dialogueFor(await svc.getCall(pn0.id)); pnd.start(); await pnd.hear('hello');
    const pn = await pnd.hear('I am not interested');
    check('at a pause a clear no ends politely (Not Interested)', pn.done === true && !/hostel/.test(pn.say) && pnd.outcome().outcome === 'Not Interested', { pn, o: pnd.outcome().outcome });
    const sh = await omni.create({ externalId: 'pace3', toNumber: '9111222243', name: 'Kiran', script: 'Opening: Hello {name}, good morning. This is the AI assistant of Teamlink.\nSay: We will send you the job details on WhatsApp.\nClosing: Thank you.' }, { ...deps, ami: AMI });
    const shd = await require('../src/calling/webTalk').dialogueFor(await svc.getCall(sh.id)); const sh0 = shd.start();
    check('a short message (only a few lines) is still said whole and the call ends', sh0.done === true && /WhatsApp/.test(sh0.say) && /Thank you/.test(sh0.say), sh0);
    const SAYQ = ['Opening: Hello {name}, this is Teamlink.', 'Say: We are hiring for the HR Recruiter position in Kukatpally with a good salary and a friendly team that you will enjoy working with every day.', 'Say: The work is sourcing candidates, screening resumes and scheduling interviews, and you will get training from our senior recruiters in the first month.', 'Say: The office is open from nine thirty to six thirty, Monday to Saturday, and there is a monthly incentive on every successful joining.', 'Interest: Are you interested?', 'Closing: Thank you.'].join('\n');
    const sq = await omni.create({ externalId: 'pace4', toNumber: '9111222244', name: 'Kiran', script: SAYQ }, { ...deps, ami: AMI });
    const sqd = await require('../src/calling/webTalk').dialogueFor(await svc.getCall(sq.id)); sqd.start();
    const sq1 = await sqd.hear('hello'); const sq2 = await sqd.hear('okay');
    check('Say lines before a question are also told in parts, then the question', !/Are you interested/.test(sq1.say) && /Are you interested\?$/.test(sq2.say), { sq1, sq2 });
    // a call that was CUT before its conversation ended is marked dropped (Omni-Channel rings again); a finished one is not
    const dr = await omni.create({ externalId: 'drop1', toNumber: '9111222210', name: 'Kiran', script: FACTS }, { ...deps, ami: AMI });
    const ddr = await require('../src/calling/webTalk').dialogueFor(await svc.getCall(dr.id)); ddr.start(); await ddr.hear('hello');
    const cutResult = ddr.hangup('the person hung up');
    await omni.applyResult(dr.id, cutResult, ddr.transcript(), { dropped: true });
    await svc.setRow(dr.id, { status: 'completed', endedAt: new Date().toISOString() });
    const ds1 = await omni.status(dr.id);
    check('a call cut before its conversation ended is reported as dropped (so it is rung again)', ds1.dropped === true && ds1.ended === true && ds1.optOut === false, ds1);
    const dr2 = await omni.create({ externalId: 'drop2', toNumber: '9111222211', name: 'Kiran', script: FACTS }, { ...deps, ami: AMI });
    const ddr2 = await require('../src/calling/webTalk').dialogueFor(await svc.getCall(dr2.id)); ddr2.start();
    await omni.applyResult(dr2.id, ddr2.outcome(), ddr2.transcript(), {});
    await svc.setRow(dr2.id, { status: 'completed', endedAt: new Date().toISOString() });
    check('a call that finished by itself is not dropped', (await omni.status(dr2.id)).dropped === false);
    // a call that was going on when the server restarted is reported as dropped (rung again), one that never answered is just not answered
    const rs1 = await omni.create({ externalId: 'restart1', toNumber: '9111222212', name: 'Kiran', script: FACTS }, { ...deps, ami: AMI });
    await svc.setRow(rs1.id, { providerStatus: 'answered' });
    const rs2 = await omni.create({ externalId: 'restart2', toNumber: '9111222213', name: 'Kiran', script: FACTS }, { ...deps, ami: AMI });
    await sip.sweep(Date.now() + 3 * 3600000);
    const rt1 = await omni.status(rs1.id); const rt2 = await omni.status(rs2.id);
    check('a call cut off by a server restart is dropped (rung again); one that never answered is not', rt1.ended && rt1.dropped === true && rt1.status === 'failed' && rt2.status === 'no-answer' && rt2.dropped === false, { rt1: rt1.status + '/' + rt1.dropped, rt2: rt2.status + '/' + rt2.dropped });
    check('every call that was accepted was dialled once, the refused ones never', originated.length === before + 34, { before, now: originated.length });
    check('Asterisk refusing the call fails it in words (and leaves a failed row)', await (async () => { const x = await refuse({ toNumber: '9333333333' }, { ...deps, ami: { action: async () => ({ Response: 'Error', Message: 'no trunk' }) } }); return !x.ok && x.code === 'not_dialled'; })());
  } finally {
    await prisma.$disconnect().catch(() => {});
    for (const sfx of ['', '-wal', '-shm', '-journal']) { try { fs.unlinkSync(COPY + sfx); } catch { /* none */ } }
  }
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); try { fs.unlinkSync(COPY); } catch { /* */ } process.exit(2); });
