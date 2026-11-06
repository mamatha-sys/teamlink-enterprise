// ---------------------------------------------------------------------------
// WHATSAPP AI AGENT: did a campaign sent INSIDE Omni-Channel (Green Start) reach this number? Those sends are not in TeamLink's promotion log, but the replies come here
// (Meta's webhook points at TeamLink), so the agent asks Green Start's GET /campaigns/recent-recipient, workspace by workspace, once for a person it does not know as promoted.
// A campaign there has no TeamLink job: the agent uses the candidate's latest application, or searches the open jobs. Never throws: no answer = not a promotion.
// ONE NUMBER, ONE WORKSPACE (founder 2026-11-06: "education 2 lo promotion chestey adhi education 2 lone kanipinchali"): each company number has its workspace
// (omni.gs.waMap), and the campaign check and the AI's replies go there and nowhere else, whatever old threads this person has in other workspaces.
// ---------------------------------------------------------------------------
const GI = require('../utils/greenStartIntegrations');

const TOKEN_MS = 20 * 60000;
const WAIT_MS = 8000;
const RETRY_MS = 6000;
let login = null; // { token, wss, at }

async function session() {
  if (login && Date.now() - login.at < TOKEN_MS) return login;
  const { token } = await GI.signIn();
  login = { token, wss: await GI.workspacesOf(token), at: Date.now() };
  return login;
}
// the workspaces this chat may touch. No map at all = the old one-number company: every workspace. A number the map does not know is not in Omni-Channel: none.
async function workspacesFor(numberId, wss) {
  const map = (await GI.readWaMap()) || {};
  if (!Object.keys(map).length) return wss;
  const home = map[numberId] && map[numberId].workspaceId;
  return wss.filter((w) => w.id === home);
}
const inTime = (p) => Promise.race([p, new Promise((_, no) => { setTimeout(() => no(new Error('Omni-Channel did not answer')), WAIT_MS); })]);

// -> { campaignId, campaignName, at } | null
async function recentSend(e164, days, numberId) {
  try {
    const { token, wss } = await inTime(session());
    let best = null;
    for (const ws of await workspacesFor(numberId, wss)) {
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

// a reply TeamLink sent goes into the person's open thread in Green Start, so Channels > WhatsApp shows both sides. Nothing is sent again. The workspace of the number the
// person wrote to takes it (their reply may still be on its way there: asked once more). Never throws, not awaited: the candidate already has the message.
async function mirror(e164, text, providerMessageId, numberId, again = true) {
  try {
    const { token, wss } = await inTime(session());
    const home = await workspacesFor(numberId, wss);
    for (const ws of home) {
      // eslint-disable-next-line no-await-in-loop
      const r = await inTime(GI.call('POST', '/conversations/import-outbound', { token, ws: ws.id, body: { phone: e164, text: String(text).slice(0, 4000), ...(providerMessageId ? { providerMessageId } : {}) } }));
      if (r && r.stored) return;
    }
    if (again && home.length) setTimeout(() => { mirror(e164, text, providerMessageId, numberId, false); }, RETRY_MS);
  } catch (err) {
    console.error('[omni-wa] Green Start thread:', err && err.message); // eslint-disable-line no-console
  }
}
const reset = () => { login = null; };

module.exports = { recentSend, mirror, reset };
