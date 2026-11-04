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
const check = (name, ok, detail) => { if (!ok) failed += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? `  -> ${JSON.stringify(detail).slice(0, 300)}` : ''}`); };

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
    // ---- who may ask
    check('a request signed with the shared secret is accepted', omni.verify(token()).ok === true);
    check('the same signed request twice is refused (used once)', (() => { const t = token({ jti: 'same-1' }); return omni.verify(t).ok && !omni.verify(t).ok; })());
    check('a wrong signature, a wrong audience and an expired token are refused', !omni.verify(token({}, 'y'.repeat(40))).ok && !omni.verify(token({ aud: 'greenstart' })).ok && !omni.verify(token({ exp: Math.floor(Date.now() / 1000) - 5 })).ok && !omni.verify('Bearer a.b.c').ok && !omni.verify('').ok);

    // ---- a call (12:00 India time, inside the calling hours)
    svc.setClock(() => new Date('2026-11-04T06:30:00Z'));
    const deps = { config: LINE(), ami: AMI, prepare: false };
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
    check('nothing heard after the opening: "hello? can you hear me?", not the whole greeting again', /^Hello\? Can you hear me/.test(c1.say) && !/AI assistant/.test(c1.say), c1);
    check('the question is asked after "hello"; an unheard answer gets a short sorry and the question again', /^Are you looking/.test(c2.say) && /^Sorry, .*Are you looking for a job right now\?$/.test(c3.say), { c2, c3 });
    check('an answer is acknowledged with a short word before the next line, and a "no" with an understanding one', /^(Okay|Alright|Sure|Right)[^.]*\. We have teaching vacancies\. Shall our team call you\?$/.test(c4.say) && /^(Alright, no problem|Okay, understood|Sure, that is fine)\./.test(c5.say) && c5.done === true, { c4, c5 });
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
    check('every call that was accepted was dialled once, the refused ones never', originated.length === before + 7, { before, now: originated.length });
    check('Asterisk refusing the call fails it in words (and leaves a failed row)', await (async () => { const x = await refuse({ toNumber: '9333333333' }, { ...deps, ami: { action: async () => ({ Response: 'Error', Message: 'no trunk' }) } }); return !x.ok && x.code === 'not_dialled'; })());
  } finally {
    await prisma.$disconnect().catch(() => {});
    for (const sfx of ['', '-wal', '-shm', '-journal']) { try { fs.unlinkSync(COPY + sfx); } catch { /* none */ } }
  }
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); try { fs.unlinkSync(COPY); } catch { /* */ } process.exit(2); });
