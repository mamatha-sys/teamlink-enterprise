// ---------------------------------------------------------------------------
// THE JOB PORTAL USES TEAMLINK'S INTEGRATIONS, BY ITSELF (founder 2026-11-02: "job portal loo kudaa ee social media accounts and whtsapp anii
// same undalii integrations loo unnaa anii social media platforms undalii ... intergrate avalii job portal loo ki automatic gaa ... even ai calling").
//
//   WhatsApp      TeamLink's default WhatsApp number (Administration -> Integrations -> WhatsApp) is handed to the portal as ITS primary
//                 number (bridge POST .../whatsapp/primary), so what the portal sends (candidate logins, interview invitations, status
//                 messages) leaves from the same company number. The token goes to the portal's memory only, never to a screen, and is sent
//                 again after every portal restart and whenever the number changes (a check every 2 minutes compares a fingerprint).
//   Social media  the accounts of Integrations -> Social Media (Facebook Pages, Instagram, Threads, LinkedIn, YouTube, X). The portal has no social
//                 posting of its own: TeamLink publishes a portal job to them (jobPublish, ticked in the Post step). The portal settings screen
//                 shows the SAME list, read-only, so nothing is entered twice (snapshot()).
//   AI calling    TeamLink's self-hosted AI calling (Ollama + Asterisk / Synway). The portal's recruiters use it through TeamLink's own routes
//                 (routes/aiCalling.js /portal door), so its status is shown beside the others (snapshot()).
// Nothing secret is ever in snapshot().
// ---------------------------------------------------------------------------
const crypto = require('crypto');

const PORTAL = '/integrations/teamlink/whatsapp/primary';
const bridge = () => require('./jobPortalBridge'); // eslint-disable-line global-require
const isSandbox = () => require('./sandbox').isSandbox(); // eslint-disable-line global-require

let last = { fingerprint: '', pid: null, at: null, ok: null, error: null };

// The number TeamLink itself sends from: the list's default number, else the single old connection.
async function whatsappSource() {
  const WN = require('./waNumbers'); // eslint-disable-line global-require
  const wa = require('./whatsappCloud'); // eslint-disable-line global-require
  let cfg = null;
  try { if (await WN.hasNumbers()) cfg = await WN.defaultConfig(); } catch { cfg = null; }
  if (!cfg) cfg = await wa.legacyConfig();
  return cfg;
}

const fingerprintOf = (cfg) => crypto.createHash('sha256').update(`${cfg.phoneId}|${cfg.token}|${cfg.wabaId || ''}`).digest('hex').slice(0, 16);

// Hands the number to the portal when it has changed, or when the portal has started again (its pid changed). Never throws.
async function pushWhatsapp({ force = false } = {}) {
  if (isSandbox()) return { skipped: 'sandbox' };
  try {
    const cfg = await whatsappSource();
    if (!cfg || !cfg.configured || !cfg.token || !cfg.phoneId) return { skipped: 'TeamLink has no working WhatsApp number', configured: false };
    const fp = fingerprintOf(cfg);
    const now = await bridge().portalFetch(PORTAL, { timeoutMs: 8000 });
    if (!force && last.fingerprint === fp && now && now.pid === last.pid && now.configured) return { unchanged: true, configured: true };
    const out = await bridge().portalFetch(PORTAL, { method: 'POST', body: { accessToken: cfg.token, phoneNumberId: cfg.phoneId, businessId: cfg.wabaId || undefined }, timeoutMs: 10000 });
    last = { fingerprint: fp, pid: out.pid, at: new Date().toISOString(), ok: true, error: null };
    return { pushed: true, configured: !!out.configured, phoneNumberId: out.phoneNumberId };
  } catch (err) {
    last = { ...last, ok: false, error: String((err && err.message) || err).slice(0, 200), at: new Date().toISOString() };
    return { error: last.error };
  }
}

// What the portal settings screen shows. No secret.
async function snapshot() {
  const out = { whatsapp: { numbers: [], portal: null }, social: [], aiCalling: null };
  try {
    const WN = require('./waNumbers'); // eslint-disable-line global-require
    const rows = (await WN.hasNumbers()) ? await WN.listRows() : [];
    out.whatsapp.numbers = rows.filter((r) => !r.removedAt).map((r) => ({ label: r.label, number: r.displayNumber || null, isDefault: !!r.isDefault, active: !!r.active }));
  } catch { /* none */ }
  try {
    const cfg = await whatsappSource();
    out.whatsapp.sendsFrom = cfg && cfg.configured ? { number: cfg.display || null, phoneNumberId: cfg.phoneId ? `…${String(cfg.phoneId).slice(-4)}` : null } : null;
    out.whatsapp.problem = cfg && !cfg.configured ? cfg.reason : null;
  } catch { /* none */ }
  try { out.whatsapp.portal = await bridge().portalFetch(PORTAL, { timeoutMs: 6000 }); } catch (e) { out.whatsapp.portal = { error: String((e && e.message) || e).slice(0, 160) }; }
  out.whatsapp.lastPush = { at: last.at, ok: last.ok, error: last.error };
  try {
    const SA = require('./socialAccounts'); // eslint-disable-line global-require
    const all = await SA.list(); // { facebook: [...], instagram: [...], ... }
    out.social = SA.PLATFORMS.map((p) => ({
      platform: p,
      accounts: (all[p] || []).map((x) => ({ name: x.name, username: x.username || null, status: x.status, isDefault: !!x.isDefault })),
    }));
  } catch { out.social = []; }
  try {
    const st = await require('../calling/settings').status(); // eslint-disable-line global-require
    out.aiCalling = { state: st.state, detail: st.detail || null };
  } catch { out.aiCalling = null; }
  return out;
}

let timer = null;
function startSchedule() {
  if (timer || process.env.NODE_ENV === 'test') return;
  const tick = () => { pushWhatsapp().catch(() => {}); };
  setTimeout(tick, 45 * 1000); // after the portal is up
  timer = setInterval(tick, 2 * 60 * 1000);
  if (timer.unref) timer.unref();
}

module.exports = { pushWhatsapp, snapshot, startSchedule, fingerprintOf };
