#!/usr/bin/env node
/**
 * The CRM's AI sales assistant (crm/salesAgent.js) answering leads who write back. SANDBOX ONLY: a COPY of the sandbox database, in this
 * process. The model and every send are stand-ins: nothing real is mailed, texted or asked of a model.
 *   node scripts/crm-sales-ai-test.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const SOURCE = process.env.TEST_SOURCE_DB || path.resolve(__dirname, '..', 'prisma', 'sandbox.db');
const COPY = path.join(os.tmpdir(), `zz-crm-sa-${process.pid}.db`).split(path.sep).join('/');
const src = new DatabaseSync(SOURCE, { readOnly: true });
src.exec(`VACUUM INTO '${COPY}'`);
src.close();
Object.assign(process.env, { TEAMLINK_SANDBOX: '1', TEST_MODE: '1', DATABASE_URL: `file:${COPY}` });
const prisma = require('../src/db');
const DB = require('../src/crm/schema');
const S = require('../src/crm/service');
const AP = require('../src/crm/autopilot');
const SA = require('../src/crm/salesAgent');
const { resolveIdentity } = require('../src/utils/identity');

let failed = 0; let total = 0;
const check = (name, ok, extra) => { total += 1; if (ok) console.log(`  ok  ${name}`); else { failed += 1; console.log(`FAIL  ${name}${extra !== undefined ? `\n      ${JSON.stringify(extra).slice(0, 600)}` : ''}`); } };
const sent = [];
let answer = { reply: 'We find and screen candidates for IT and medical roles. Shall we set up a short call with our team?', action: 'none' };
const deps = {
  chat: async () => { if (answer instanceof Error) throw answer; return answer; },
  sendMail: async (m) => { sent.push({ ch: 'mail', ...m }); return { ok: true }; },
  sendSms: async (to, text) => { sent.push({ ch: 'sms', to, text }); return { ok: true }; },
  sendWa: async (to, text) => { sent.push({ ch: 'wa', to, text }); return { ok: true }; },
};
const lastTo = (who) => [...sent].reverse().find((x) => x.to === who.phone || x.to === who.email);

(async () => {
  await DB.ensure();
  const row = (await prisma.user.findMany({ where: { status: 'Active', role: 'SUPER_ADMIN' }, take: 5 })).find((u) => !/zztest|example\.test/i.test(`${u.name}${u.email}`));
  const admin = await resolveIdentity(row.id);
  const R = String(Date.now()).slice(-5);
  let n = 0;
  const lead = async (company) => { n += 1; return (await S.create(admin, 'lead', { company: `${company} ${R}`, contactName: 'Ravi', phone: `97${R}${String(n).padStart(3, '0')}`, email: `zz-sa-${R}-${n}@example.test`, ownerId: row.id, ownerName: row.name })).body.lead || (await DB.one('SELECT * FROM "CrmLead" WHERE "company" = ?', `${company} ${R}`)); };
  const reply = (l, text, channel = 'WhatsApp', subject = null) => AP.onReply({ channel, phone: channel === 'Email' ? null : `+91${l.phone}`, email: channel === 'Email' ? l.email : null, subject, text }, { wait: true, deps });
  const acts = async (id) => (await DB.all('SELECT "subject", "byName", "note" FROM "CrmActivity" WHERE "leadId" = ? ORDER BY "at"', id));
  const tasks = (id, like) => DB.all('SELECT "title" FROM "CrmTask" WHERE "leadId" = ? AND "title" LIKE ?', id, like);

  console.log('Off');
  await SA.save(admin, { on: false });
  const l0 = await lead('Off Ltd');
  await reply(l0, 'What do you charge?');
  check('off: a person answers (an Answer follow-up), the AI says nothing', (await tasks(l0.id, 'Answer %')).length === 1 && !lastTo(l0));
  check('off: the recruitment WhatsApp agent is not told to stay quiet', (await SA.handles(`91${l0.phone}`)) === false);

  console.log('On');
  const saved = await SA.save(admin, { on: true, pricing: 'Our fee is 8.33% of the annual CTC per position.', maxPerDay: 4 });
  check('a manager turns it on', saved.status === 200 && saved.body.settings.on === true, saved.body);
  const l1 = await lead('Acme Steels');
  check('a WhatsApp number of an open lead: the recruitment agent stays quiet on it', (await SA.handles(`91${l1.phone}`)) === true);
  await reply(l1, 'Hi, what services do you offer?');
  const w1 = lastTo(l1);
  check('a WhatsApp reply gets an AI answer on WhatsApp, saying it is the AI assistant', w1 && w1.ch === 'wa' && /^TeamLink's AI assistant: We find and screen/.test(w1.text), w1);
  check('no Answer follow-up for a person while the AI talks', (await tasks(l1.id, 'Answer %')).length === 0);
  check('the answer is on the timeline, by "AI assistant"', (await acts(l1.id)).some((a) => a.subject === 'AI answered on WhatsApp' && a.byName === 'AI assistant'));
  await reply(l1, 'OK and how much is your fee?');
  const w2 = lastTo(l1);
  check('the second answer does not repeat the AI introduction', w2 && w2.text.startsWith('We find'), w2);

  console.log('What it may not say');
  answer = { reply: 'Our fee is just ₹50,000 per hire, best price.', action: 'none' };
  const l2 = await lead('Price Ltd');
  await reply(l2, 'Give me your price');
  const w3 = lastTo(l2);
  const a2 = await acts(l2.id);
  check('a money figure that is not in the settings is never sent: a person takes over', w3 && /will get back to you shortly/.test(w3.text) && !/50,000/.test(w3.text) && a2.some((a) => a.subject === SA.HANDED), { w3, a2 });
  check('the owner gets a bell and a "Take over" follow-up', (await tasks(l2.id, 'Take over%')).length === 1 && !!(await prisma.notification.findFirst({ where: { title: { contains: 'passed the talk to you' }, message: { contains: l2.id } } })));
  const before = sent.length;
  answer = { reply: 'We find and screen candidates.', action: 'none' };
  await reply(l2, 'hello?');
  check('after a hand-over the AI stays quiet on that lead', sent.length === before && (await SA.handles(`91${l2.phone}`)) === false);
  answer = { reply: 'Our fee is 8.33% of the annual CTC per position.', action: 'none' };
  const l3 = await lead('Fee Ltd');
  await reply(l3, 'fee?');
  check('a figure that IS in the settings may be said', /8\.33%/.test((lastTo(l3) || {}).text || ''), lastTo(l3));
  answer = { reply: 'See our rates at https://cheap-rates.example.com', action: 'none' };
  const l4 = await lead('Link Ltd');
  await reply(l4, 'website?');
  check('a link that is not the meeting link is never sent', !/cheap-rates/.test((lastTo(l4) || {}).text || '') && (await acts(l4.id)).some((a) => a.subject === SA.HANDED));

  console.log('Meetings, hand-overs, failures');
  answer = { reply: 'Happy to set up a call with our team.', action: 'meeting' };
  const l5 = await lead('Meet Ltd');
  await reply(l5, 'Yes, let us talk next week', 'Email', 'Re: TeamLink for your hiring');
  const m5 = lastTo(l5);
  check('a mail reply is answered by mail, as a reply ("Re:")', m5 && m5.ch === 'mail' && /^Re: TeamLink for your hiring/.test(m5.subject), m5 && { to: m5.to, subject: m5.subject });
  check('agreeing to a call books one and the answer says when', /I have booked a call for/.test((m5 || {}).text || '') && !!(await DB.one('SELECT "id" FROM "CrmTask" WHERE "leadId" = ? AND "type" = \'Meeting\'', l5.id)), m5 && m5.text);
  answer = { reply: 'Sure.', action: 'handoff' };
  const l6 = await lead('Human Ltd');
  await reply(l6, 'I want to talk to a real person', 'SMS');
  const s6 = lastTo(l6);
  check('asking for a person: told someone will get back (by SMS), owner takes over', s6 && s6.ch === 'sms' && /will get back/.test(s6.text) && (await tasks(l6.id, 'Take over%')).length === 1, s6);
  answer = new Error('model offline');
  const l7 = await lead('Down Ltd');
  await reply(l7, 'hello');
  check('the model is down: a person takes over, nothing made up is sent', (await acts(l7.id)).some((a) => a.subject === SA.HANDED && /could not answer/.test(a.note || '')));
  answer = { reply: 'Okay, thank you for letting us know.', action: 'not_interested' };
  const l8 = await lead('NoThanks Ltd');
  await reply(l8, 'Not interested right now');
  const w8 = lastTo(l8);
  check('"not interested": a polite answer, then the owner decides (no "someone will get back")', w8 && /thank you for letting us know/.test(w8.text) && !/will get back/.test(w8.text) && (await acts(l8.id)).some((a) => a.subject === SA.HANDED), w8);
  answer = { reply: 'We find and screen candidates.', action: 'none' };
  const l9 = await lead('Chatty Ltd');
  for (let i = 0; i < 5; i += 1) await reply(l9, `question ${i}`); // eslint-disable-line no-await-in-loop
  const aiCount = (await acts(l9.id)).filter((a) => a.subject === 'AI answered on WhatsApp').length;
  check('more answers in a day than allowed: a person takes over', aiCount === 4 && (await acts(l9.id)).some((a) => a.subject === SA.HANDED && /More than 4/.test(a.note || '')), aiCount);
  const l10 = await lead('Stop Ltd');
  const b10 = sent.length;
  await AP.onReply({ channel: 'SMS', phone: `+91${l10.phone}`, text: 'STOP', stop: true }, { wait: true, deps });
  check('"STOP" is never answered by the AI', sent.length === b10);

  console.log('Settings');
  const g = SA.guard('Call us, fee is 8.33%.', await SA.load(), 'SMS', '');
  check('the price check passes a figure written in the settings', g.ok === true, g);
  const bad = await SA.save(admin, { on: true, about: '' });
  check('it cannot be switched on with nothing written about TeamLink', bad.status === 400, bad.body);

  console.log(failed ? `\n${failed} of ${total} checks FAILED` : `\nAll ${total} checks passed`);
  await prisma.$disconnect().catch(() => {});
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(COPY + s); } catch { /* none */ } }
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
