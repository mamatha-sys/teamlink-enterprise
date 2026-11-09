// ---------------------------------------------------------------------------
// CRM > THE AI SALES ASSISTANT (founder 2026-11-09: "mottham automatic ga ai ey matladey laaga chudu. chat conversations, mailings, ai calling").
//
// The automatic follow-through (crm/autopilot.js) reaches a new lead by mail, SMS, WhatsApp and an AI call. When the lead WRITES BACK, this answers
// them in the same channel - a WhatsApp, an SMS or a mail - the way a sales person would: what TeamLink does, what may be said about price, a meeting.
//   respond()   one answer to one message from a lead (autopilot.onReply calls it in the background, so the inbound webhook never waits for the model)
//   handles()   a WhatsApp number of an open lead while this is on: the recruitment WhatsApp agent (omniwa/agent.js) stays quiet on it
//   get/save()  CRM settings > Automatic > AI assistant (Sales manager or Admin)
//
// WHAT IT MAY SAY: only what the managers wrote here (about TeamLink, price, questions and answers) and the lead's own record. The model writes JSON
// {"reply", "action"}; nothing it writes is sent before guard() has checked it: no link but the meeting link, no money figure that is not in the
// text the managers wrote, no promise of a price or a discount. It says it is an AI assistant in its first reply (as every AI call does).
// WHEN A PERSON TAKES OVER: the lead asks for one, haggles, complains, says not interested, the model is unsure or down, or more than maxPerDay
// answers in a day. The lead is told someone will get back, the owner gets a bell and a follow-up, and the AI says nothing more to that lead.
// OFF until a manager switches it on. Every answer is on the lead's timeline, written by "AI assistant".
// ---------------------------------------------------------------------------
const prisma = require('../db');
const DB = require('./schema');
const S = require('./service');
const SALES = require('./sales');
const SETTINGS = require('./settings');

const KEY = 'crm.salesAi';
const AI_NAME = 'AI assistant';
const HANDED = 'AI handed over to a person';
const LIMIT = { WhatsApp: 700, SMS: 320, Email: 1800 };
const WORD = { WhatsApp: 'WhatsApp', SMS: 'SMS', Email: 'mail' };
const KIND = { WhatsApp: 'whatsapp', SMS: 'note', Email: 'email' };
const DEFAULTS = {
  on: false,
  about: 'TeamLink Consultants is a recruitment company. We find and screen candidates for companies in IT, medical, manufacturing and education, and handle the interviews up to joining.',
  pricing: 'Our fee depends on the role and the number of positions; our team shares a proposal after a short call.',
  faq: '',
  maxPerDay: 6,
};
const HOUR = 3600000;

// ---- settings ----------------------------------------------------------------------------------------------------------
const text = (v, n) => String(v == null ? '' : v).replace(/\r/g, '').trim().slice(0, n);
function clean(v = {}) {
  const per = Number(v.maxPerDay);
  return {
    on: !!v.on,
    about: text(v.about == null ? DEFAULTS.about : v.about, 3000),
    pricing: text(v.pricing == null ? DEFAULTS.pricing : v.pricing, 1500),
    faq: text(v.faq, 4000),
    maxPerDay: Number.isFinite(per) && per >= 1 && per <= 30 ? Math.round(per) : DEFAULTS.maxPerDay,
  };
}
async function load() {
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } }).catch(() => null);
  let v = {};
  try { v = row ? JSON.parse(row.value) : {}; } catch { v = {}; }
  return clean(v);
}
const onlyManagers = (user) => (S.mayAssign(S.roleOf(user)) ? null : S.fail(403, 'The AI assistant is set up by a Sales manager or an Admin.'));
async function get(user) {
  const no = onlyManagers(user); if (no) return no;
  return S.okBody({ settings: await load() });
}
async function save(user, body = {}) {
  const no = onlyManagers(user); if (no) return no;
  const cur = await load();
  const next = clean({ ...cur, ...body });
  if (next.on && !next.about) return S.fail(400, 'Write what TeamLink does first: the AI answers only from what is written here.');
  const value = JSON.stringify(next);
  await prisma.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  if (next.on !== cur.on) await S.audit(user, next.on ? 'CRM AI assistant turned on' : 'CRM AI assistant turned off', 'AppSetting', KEY, next.on ? 'Answers leads who write back' : 'Off');
  return S.okBody({ ok: true, settings: next });
}

// ---- the lead and the talk so far ----------------------------------------------------------------------------------------
async function open(l) {
  if (!l || ['Junk', 'Converted'].includes(l.status)) return false;
  return !['Won', 'Lost'].includes(SALES.stageOf(l, SALES.stageNames(await SETTINGS.load())));
}
async function handedOver(leadId) {
  return !!(await DB.one('SELECT "id" FROM "CrmActivity" WHERE "leadId" = ? AND "subject" = ?', leadId, HANDED));
}
// the open lead behind a WhatsApp number, for the recruitment agent to stay out of a sales talk
async function handles(e164) {
  const st = await load();
  if (!st.on) return false;
  const ph = S.phone10(e164);
  if (ph.length !== 10) return false;
  const rows = (await DB.all('SELECT * FROM "CrmLead" WHERE "phone" LIKE ?', `%${ph.slice(-4)}%`)).filter((l) => S.phone10(l.phone) === ph);
  for (const l of rows) if (await open(l) && !(await handedOver(l.id))) return true; // eslint-disable-line no-await-in-loop
  return false;
}
const istDayStart = (now) => new Date(Date.parse(`${new Date(now + 5.5 * HOUR).toISOString().slice(0, 10)}T00:00:00+05:30`)).toISOString();
async function history(leadId) {
  const rows = await DB.all('SELECT "subject", "note", "byName", "at" FROM "CrmActivity" WHERE "leadId" = ? ORDER BY "at" DESC LIMIT 14', leadId);
  // what the lead wrote is written by autopilot.onReply as "Replied on ..." / "Asked us to stop ..."; everything else is ours
  return rows.reverse().filter((r) => r.note).map((r) => (/^(Replied on|Asked us to stop)/.test(r.subject || '')
    ? { role: 'user', content: S.clip(r.note, 900) }
    : { role: 'assistant', content: S.clip(`${r.subject ? `[${r.subject}] ` : ''}${r.note}`, 900) }));
}
async function note(leadId, subject, body, kind) {
  const now = DB.nowIso();
  await S.insert('CrmActivity', { id: S.newId('act'), kind, subject, note: S.clip(body, 2000), at: now, leadId, byName: AI_NAME, createdAt: now }).catch(() => null);
}

// ---- what the model is told, and what it may send -----------------------------------------------------------------------
function prompt(st, lead, channel, owner) {
  return [
    `You are the AI sales assistant of TeamLink Consultants, answering a business lead who wrote back on ${WORD[channel]}. You are an AI; say so if asked.`,
    'Use ONLY the facts below. Never invent a price, a discount, a client name, a date or a promise. If the answer is not below, say our team will confirm it.',
    'Goal: answer their question briefly and politely, then move towards a short call with our team. Plain words, no markdown.',
    `Keep it short: ${channel === 'Email' ? 'a few short paragraphs' : 'two or three sentences'}. Write in the language the lead wrote in (English, Telugu or Hindi).`,
    'Reply with JSON only: {"reply": "...", "action": "none" | "meeting" | "handoff" | "not_interested"}.',
    '- "meeting": they agree to a call or ask for one (a time is booked and sent to them; do not name a time yourself).',
    '- "handoff": they ask for a person, negotiate the price, complain, or you are not sure.',
    '- "not_interested": they say no or not now.',
    '',
    `ABOUT TEAMLINK:\n${st.about}`,
    `WHAT MAY BE SAID ABOUT PRICE:\n${st.pricing || 'Nothing: our team shares a proposal.'}`,
    st.faq ? `QUESTIONS AND ANSWERS:\n${st.faq}` : '',
    `THE LEAD: ${lead.contactName || ''} of ${lead.company || 'their company'}${lead.city ? `, ${lead.city}` : ''}${lead.notes ? `. Notes: ${S.clip(lead.notes, 300)}` : ''}. Their contact at TeamLink: ${owner || 'our sales team'}.`,
  ].filter(Boolean).join('\n');
}
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s]+/gi;
const MONEY_RE = /(?:₹|rs\.?|inr|rupees?)\s*[\d,.]+|[\d,.]+\s*(?:lakhs?|lacs?|k\b|thousand|crores?|%|percent|rupees?)/gi;
const PROMISE_RE = /\b(guarantee|guaranteed|free of cost|discount|100\s*%)/i;
const digits = (s) => String(s).replace(/[^\d]/g, '');
// -> { ok, reply } or { ok: false, why }
function guard(reply, st, channel, meetingLink) {
  let t = String(reply || '').replace(/\*\*|__|`/g, '').trim();
  if (!t) return { ok: false, why: 'the model wrote nothing' };
  const known = `${st.about}\n${st.pricing}\n${st.faq}`;
  for (const u of t.match(URL_RE) || []) if (!meetingLink || !u.startsWith(meetingLink)) return { ok: false, why: `a link that is not the meeting link (${u})` };
  for (const m of t.match(MONEY_RE) || []) if (!digits(m) || !digits(known).includes(digits(m))) return { ok: false, why: `a money figure that is not in the settings (${m})` };
  if (PROMISE_RE.test(t) && !PROMISE_RE.test(known)) return { ok: false, why: 'a promise the settings do not make' };
  if (t.length > LIMIT[channel]) t = `${t.slice(0, LIMIT[channel] - 1).replace(/\s+\S*$/, '')}…`;
  return { ok: true, reply: t };
}

// ---- sending -----------------------------------------------------------------------------------------------------------------
async function send(channel, lead, body, subject, deps) {
  if (channel === 'Email') {
    if (!lead.email) return { ok: false, error: 'no email on the lead' };
    const mail = deps.sendMail || ((m) => require('../utils/mailer').sendMail({ useEmployeeFrom: false, fromName: 'TeamLink', ...m })); // eslint-disable-line global-require
    const subj = /^re:/i.test(String(subject || '')) ? subject : `Re: ${subject || 'Your message to TeamLink'}`;
    return mail({ to: lead.email, subject: S.clip(subj, 180), text: body });
  }
  if (channel === 'SMS') {
    if (deps.sendSms) return deps.sendSms(lead.phone, body);
    const messaging = require('../utils/messaging'); // eslint-disable-line global-require
    const m = require('../utils/messagingCore').normalizeMobile(lead.phone); // eslint-disable-line global-require
    if (!m.ok) return { ok: false, error: 'the phone number is not usable' };
    return messaging.send('SMS', { to: m.e164, kind: 'text', text: body, vars: [body] });
  }
  if (deps.sendWa) return deps.sendWa(lead.phone, body);
  // the WhatsApp inbox's own sender: the 24-hour window, opt-outs and the chat screen are all kept (omniwa/agent.js)
  const WA = require('../omniwa/agent'); // eslint-disable-line global-require
  const m = require('../utils/messagingCore').normalizeMobile(lead.phone); // eslint-disable-line global-require
  const conv = m.ok ? await WA.convOf(m.e164.replace(/^\+/, '')) : null;
  if (!conv) return { ok: false, error: 'no WhatsApp chat with this number yet' };
  return WA.sendText(conv, body);
}

// a person takes over: the lead is told, the owner gets a bell and a follow-up, and the AI stays quiet on this lead from now on
async function handoff(lead, channel, why, subject, deps, { tell = true } = {}) {
  const owner = lead.ownerName ? lead.ownerName.split(' ')[0] : 'our team';
  if (tell) {
    const msg = channel === 'Email'
      ? `Hello ${lead.contactName || ''},\n\nThank you for your message. ${owner} from TeamLink will get back to you shortly.\n\nTeamLink Consultants`
      : `Thank you. ${owner} from TeamLink will get back to you shortly.`;
    await send(channel, lead, msg, subject, deps).catch(() => null);
  }
  await note(lead.id, HANDED, why, 'note');
  const to = lead.ownerId ? [lead.ownerId] : (await S.ownerOptions()).filter((o) => o.tl).map((o) => o.id);
  for (const userId of to) {
    // eslint-disable-next-line no-await-in-loop
    await prisma.notification.create({ data: { userId, title: `${lead.company}: the AI passed the talk to you`, message: `${why}\nOpen: /crm/leads?open=lead:${lead.id}`, channel: 'In-App', recipient: `crm-reply|${lead.id}|${Date.now()}`, status: 'Sent' } }).catch(() => {});
  }
  if (lead.ownerId) {
    const iso = new Date(Date.now() + 5.5 * HOUR).toISOString();
    const now = DB.nowIso();
    await S.insert('CrmTask', {
      id: S.newId('task'), title: `Take over from the AI: ${lead.contactName || lead.company}`, dueDate: iso.slice(0, 10), dueTime: iso.slice(11, 16), status: 'Open', type: 'Other',
      notifyApp: 0, notifyWhatsapp: 0, notifySms: 0, notifyLead: 0, remindBefore: 0, reminderSentAt: now, leadId: lead.id, ownerId: lead.ownerId, ownerName: lead.ownerName, createdAt: now, updatedAt: now,
    }).catch(() => null);
  }
  return { handedOver: why };
}

// ---- one answer ----------------------------------------------------------------------------------------------------------
// channel: 'WhatsApp' | 'SMS' | 'Email'; lead: the CrmLead row; message: what they wrote. -> what was done
async function respond({ channel, lead, message, subject }, { deps = {}, now = Date.now() } = {}) {
  const st = await load();
  if (!st.on) return { skipped: 'off' };
  if (!(await open(lead))) return { skipped: 'the lead is not open' };
  if (await handedOver(lead.id)) return { skipped: 'a person has this lead' };
  const today = await DB.one('SELECT COUNT(*) AS n FROM "CrmActivity" WHERE "leadId" = ? AND "byName" = ? AND "at" >= ?', lead.id, AI_NAME, istDayStart(now));
  if (Number(today && today.n) >= st.maxPerDay) return handoff(lead, channel, `More than ${st.maxPerDay} AI answers today: a person should talk now.`, subject, deps);
  const AUTO = require('./autopilot'); // eslint-disable-line global-require
  const auto = await AUTO.load();
  const meetingLink = (auto.meeting && auto.meeting.link) || '';
  const first = !(await DB.one('SELECT "id" FROM "CrmActivity" WHERE "leadId" = ? AND "byName" = ?', lead.id, AI_NAME));
  let out;
  try {
    const chat = deps.chat || ((sys, msgs) => require('../utils/ai').chatJson(sys, msgs)); // eslint-disable-line global-require
    const msgs = await history(lead.id);
    if (!msgs.length || msgs[msgs.length - 1].role !== 'user') msgs.push({ role: 'user', content: S.clip(message, 1500) });
    out = await chat(prompt(st, lead, channel, lead.ownerName), msgs);
  } catch (e) {
    return handoff(lead, channel, `The AI could not answer (${S.clip(e.message, 120)}).`, subject, deps);
  }
  const action = ['meeting', 'handoff', 'not_interested'].includes(out && out.action) ? out.action : 'none';
  if (action === 'handoff') return handoff(lead, channel, `They need a person: "${S.clip(message, 200)}"`, subject, deps);
  if (action === 'not_interested') {
    const g0 = guard(out && out.reply, st, channel, meetingLink);
    if (g0.ok) { await send(channel, lead, g0.reply, subject, deps).catch(() => null); await note(lead.id, `AI answered on ${WORD[channel]}`, g0.reply, KIND[channel]); }
    return handoff(lead, channel, `They said they are not interested: "${S.clip(message, 200)}"`, subject, deps, { tell: false });
  }
  const g = guard(out && out.reply, st, channel, meetingLink);
  if (!g.ok) return handoff(lead, channel, `The AI answer was not sent: ${g.why}.`, subject, deps);
  let body = g.reply;
  if (first) body = channel === 'Email' ? `${body}\n\n(This reply is from TeamLink's AI assistant. A person from our team is copied on everything.)` : `TeamLink's AI assistant: ${body}`;
  if (action === 'meeting') {
    const task = await AUTO.bookMeeting({ leadId: lead.id, name: lead.contactName || lead.company, email: lead.email, ownerId: lead.ownerId, ownerName: lead.ownerName, title: `TeamLink call: ${lead.company}` }, auto, now, deps).catch(() => null);
    if (task) {
      const at = new Date(Date.parse(`${task.dueDate}T${task.dueTime}:00+05:30`)).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
      body += channel === 'Email' ? `\n\nI have booked a call for ${at}${lead.email ? '; the invite is in your mail' : ''}. If another time suits you better, just reply.` : ` I have booked a call for ${at}. Reply if another time suits you better.`;
    }
  }
  if (channel === 'Email') body = `Hello ${lead.contactName || ''},\n\n${body}\n\nTeamLink Consultants`;
  const sent = await send(channel, lead, body, subject, deps).catch((e) => ({ ok: false, error: e.message }));
  if (!sent || !sent.ok) return handoff(lead, channel, `The AI answer could not be sent: ${(sent && sent.error) || 'unknown'}.`, subject, deps, { tell: false });
  await note(lead.id, `AI answered on ${WORD[channel]}`, body, KIND[channel]);
  return { answered: true, action, body };
}

module.exports = { DEFAULTS, AI_NAME, HANDED, load, get, save, handles, respond, guard, clean };
