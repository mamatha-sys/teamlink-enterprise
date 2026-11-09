// ---------------------------------------------------------------------------
// THE WHATSAPP AI CHATBOT IN GREEN START'S BOT BUILDER (founder 2026-11-09: "ee chatbot niii mana greenstart loo unna bot builder loo set chesyuuuu").
// The chatbot keeps running here, in TeamLink (omniwa/agent.js); Bot Builder shows it as a card and edits its settings through
// GET/POST /api/public/omni-voice/wa-ai (routes/omniVoiceBridge.js, server to server, signed with the shared one-click-sign-in secret).
//   company-wide   AI on/off, instructions, the questions after a YES and the closing line, the fallback, working hours, reply limit
//                  -> only Green Start's company login (organisation admin) may change them: they act on every number
//   this workspace the WhatsApp numbers whose chats go to that workspace (omni.gs.waMap): AI on/off and their own instructions / fallback
// Nothing secret leaves: no token, no model key, no test numbers' list (only how many).
// ---------------------------------------------------------------------------
const Cfg = require('./config');

const COMPANY_FIELDS = ['enabled', 'systemPrompt', 'fallbackMessage', 'hoursOn', 'hoursFrom', 'hoursTo', 'maxTurns'];
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);

// the TeamLink numbers whose chats go to this Green Start workspace
async function numbersOf(workspaceId) {
  const GI = require('../utils/greenStartIntegrations'); // eslint-disable-line global-require
  const WN = require('../utils/waNumbers'); // eslint-disable-line global-require
  const map = await GI.readWaMap();
  const rows = (await WN.listRows().catch(() => [])).filter((r) => !r.removedAt);
  const ws = String(workspaceId || '');
  return rows.filter((r) => ws && map[r.id] && map[r.id].workspaceId === ws);
}

async function view(workspaceId) {
  const [c, q, nums, profiles] = await Promise.all([Cfg.read(), Cfg.questions(), numbersOf(workspaceId), Cfg.profiles()]);
  const byNumber = new Map(profiles.map((p) => [p.numberId, p]));
  return {
    ok: true,
    company: {
      ...Object.fromEntries(COMPANY_FIELDS.map((k) => [k, c[k]])),
      questions: q.list,
      closing: q.closing,
      testOnly: Array.isArray(c.testNumbers) ? c.testNumbers.length : 0,
      updatedByName: c.updatedByName || null,
      updatedAt: c.updatedAt ? Number(c.updatedAt) : null,
    },
    numbers: nums.map((r) => {
      const p = byNumber.get(r.id);
      return { id: r.id, label: r.label, display: r.displayNumber || '', aiOn: !p || p.enabled !== false, systemPrompt: (p && p.systemPrompt) || '', fallbackMessage: (p && p.fallbackMessage) || '' };
    }),
  };
}

// body: { by, company?: {...COMPANY_FIELDS, questions?: string[], closing?}, numbers?: [{ id, aiOn, systemPrompt, fallbackMessage }] }
// companyAllowed: Green Start says the person is the company login (organisation admin)
async function save(workspaceId, body = {}, companyAllowed = false) {
  const by = { name: clip(body.by, 80) || 'Omni-Channel Bot Builder' };
  if (body.company && typeof body.company === 'object') {
    if (!companyAllowed) return { ok: false, status: 403, error: 'Only the company login can change the settings every number uses.' };
    const b = body.company;
    const pick = Object.fromEntries(COMPANY_FIELDS.filter((k) => b[k] !== undefined).map((k) => [k, b[k]]));
    if (Object.keys(pick).length) {
      const r = await Cfg.save(by, pick);
      if (r.error) return { ok: false, status: r.status || 400, error: r.error };
    }
    if (b.questions !== undefined || b.closing !== undefined) {
      const cur = await Cfg.questions();
      const r = await Cfg.saveQuestions({ list: b.questions !== undefined ? b.questions : cur.list, closing: b.closing !== undefined ? b.closing : cur.closing });
      if (r.error) return { ok: false, status: r.status || 400, error: r.error };
    }
  }
  if (Array.isArray(body.numbers) && body.numbers.length) {
    const mine = new Set((await numbersOf(workspaceId)).map((r) => r.id));
    const saved = new Map((await Cfg.profiles()).map((p) => [p.numberId, p]));
    for (const n of body.numbers) {
      if (!n || !mine.has(String(n.id))) return { ok: false, status: 403, error: 'That WhatsApp number does not belong to this workspace.' };
      // only what was changed is sent: the rest stays as saved (founder 2026-11-09: switching AI off was refused over an old long fallback)
      const p = saved.get(String(n.id));
      const r = await Cfg.saveProfile(by, String(n.id), { // eslint-disable-line no-await-in-loop
        enabled: n.aiOn !== undefined ? n.aiOn !== false : !(p && p.enabled === false),
        systemPrompt: n.systemPrompt !== undefined ? n.systemPrompt : (p && p.systemPrompt) || '',
        fallbackMessage: n.fallbackMessage !== undefined ? n.fallbackMessage : (p && p.fallbackMessage) || '',
      });
      if (r.error) return { ok: false, status: r.status || 400, error: r.error };
    }
  }
  return view(workspaceId);
}

// A BOT BUILDER BOT HANDS THE CHAT TO THE AI (founder 2026-11-09: "kotha chatbot create chesaa kanii andhuloo nunchii ai chat kavlii").
// The bot's "Handover" step set to "WhatsApp AI": from here the AI answers this person, even on a number whose AI is off (the bot owned the
// first part), for a day. The person's last message is answered at once. Only a chat on one of this workspace's numbers.
const BY_BOT_MS = 24 * 3600 * 1000;
async function take(workspaceId, body = {}, now = Date.now()) {
  const S = require('../outreach/store'); // eslint-disable-line global-require
  const e164 = String(body.phone || '').replace(/\D/g, '');
  if (e164.length < 10) return { ok: false, status: 400, error: 'No phone number for this chat.' };
  const conv = (await S.q('SELECT * FROM "OmniWaConv" WHERE e164 = ?', e164))[0];
  if (!conv) return { ok: false, status: 404, error: 'TeamLink has no WhatsApp chat with this number yet.' };
  const mine = new Set((await numbersOf(workspaceId)).map((r) => r.id));
  if (!conv.numberId || !mine.has(conv.numberId)) return { ok: false, status: 403, error: "This chat is not on one of this workspace's WhatsApp numbers." };
  if (conv.state === 'stopped') return { ok: false, status: 409, error: 'This person asked for no more messages.' };
  const collected = { ...JSON.parse(conv.collected || '{}'), aiByBotUntil: now + BY_BOT_MS, aiByBot: clip(body.bot, 80) || 'Bot Builder' };
  await S.run(`UPDATE "OmniWaConv" SET collected = ?, mode = 'ai', state = 'active', handoffReason = NULL, pausedByName = NULL, aiTurns = 0, pendingAt = ?, updatedAt = ? WHERE id = ?`, JSON.stringify(collected), now, now, conv.id);
  // the message that reached the bot's last step is answered by the AI (the AI skipped it while the number was off)
  await S.run(`UPDATE "OmniWaMessage" SET consumedAt = NULL WHERE id = (SELECT id FROM "OmniWaMessage" WHERE convId = ? AND direction = 'IN' ORDER BY at DESC LIMIT 1)`, conv.id);
  return { ok: true, until: collected.aiByBotUntil };
}

module.exports = { view, save, take, numbersOf, COMPANY_FIELDS };
