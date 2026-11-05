// ---------------------------------------------------------------------------
// WHATSAPP AI AGENT: did a campaign sent INSIDE Omni-Channel (Green Start) reach this number? Those sends are not in TeamLink's promotion log, but the replies come here
// (Meta's webhook points at TeamLink), so the agent asks Green Start's GET /campaigns/recent-recipient, workspace by workspace, once for a person it does not know as promoted.
// A campaign there has no TeamLink job: the agent uses the candidate's latest application, or searches the open jobs. Never throws: no answer = not a promotion.
// ---------------------------------------------------------------------------
const GI = require('../utils/greenStartIntegrations');

const TOKEN_MS = 20 * 60000;
const WAIT_MS = 8000;
let login = null; // { token, wss, at }

async function session() {
  if (login && Date.now() - login.at < TOKEN_MS) return login;
  const { token } = await GI.signIn();
  login = { token, wss: await GI.workspacesOf(token), at: Date.now() };
  return login;
}
const inTime = (p) => Promise.race([p, new Promise((_, no) => { setTimeout(() => no(new Error('Omni-Channel did not answer')), WAIT_MS); })]);

// -> { campaignId, campaignName, at } | null
async function recentSend(e164, days) {
  try {
    const { token, wss } = await inTime(session());
    let best = null;
    for (const ws of wss) {
      // eslint-disable-next-line no-await-in-loop
      const r = await inTime(GI.call('GET', `/campaigns/recent-recipient?phone=${encodeURIComponent(e164)}&days=${Number(days) || 7}`, { token, ws: ws.id }));
      const at = r && r.found ? new Date(r.sentAt).getTime() : 0;
      if (at && (!best || at > best.at)) best = { campaignId: `gs:${r.campaignId}`, campaignName: r.campaignName, at };
    }
    return best;
  } catch (err) {
    login = null;
    console.error('[omni-wa] Green Start campaign check:', err && err.message); // eslint-disable-line no-console
    return null;
  }
}

// a reply TeamLink sent goes into the person's open thread in Green Start, so Channels > WhatsApp shows both sides. Nothing is sent again. The first workspace that has the
// thread takes it. Never throws, not awaited: the candidate already has the message.
async function mirror(e164, text, providerMessageId) {
  try {
    const { token, wss } = await inTime(session());
    for (const ws of wss) {
      // eslint-disable-next-line no-await-in-loop
      const r = await inTime(GI.call('POST', '/conversations/import-outbound', { token, ws: ws.id, body: { phone: e164, text: String(text).slice(0, 4000), ...(providerMessageId ? { providerMessageId } : {}) } }));
      if (r && r.stored) return;
    }
  } catch (err) {
    console.error('[omni-wa] Green Start thread:', err && err.message); // eslint-disable-line no-console
  }
}
const reset = () => { login = null; };

module.exports = { recentSend, mirror, reset };
