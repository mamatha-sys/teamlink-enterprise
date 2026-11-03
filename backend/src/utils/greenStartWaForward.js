// ---------------------------------------------------------------------------
// WHATSAPP REPLIES -> OMNI-CHANNEL (founder 2026-11-03: "avarikii send chesinaa avarikii ayina reply echinaa ... channels loo
// kanipinchali"). Meta sends every WhatsApp call of the company's numbers to ONE address: TeamLink's /api/webhooks/whatsapp.
// Omni-Channel (Green Start) cannot be reached from outside (the TeamLink gate), so, once TeamLink has checked Meta's signature,
// it hands the same raw bytes to Green Start's own webhook on this server (127.0.0.1, /api/v1/webhooks/whatsapp). Green Start
// files the replies (and the delivered / read ticks) under the workspace that holds that number, in Channels > WhatsApp.
//
// Green Start checks X-Hub-Signature-256 against ITS META_APP_SECRET. GREENSTART_META_APP_SECRET (set by
// link-whatsapp-replies-omni-on-vps.ps1, copied from Green Start's .env) re-signs the bytes with it; without it Meta's own
// header goes through, which works only when both use the same Meta app. Never throws, never delays Meta's answer; the last
// result is kept (AppSetting omni.gs.waForward) for check-omni-integrations-on-vps.ps1. Nothing secret is stored or logged.
// ---------------------------------------------------------------------------
const crypto = require('crypto');
const prisma = require('../db');

const KEY = 'omni.gs.waForward';
const enabled = () => String(process.env.GREENSTART_ENABLED || 'true').toLowerCase() !== 'false';
const apiBase = () => `http://127.0.0.1:${parseInt(process.env.GREENSTART_API_PORT, 10) || 4020}/api/v1`;

async function forward(raw, metaSignature) {
  if (!enabled() || String(process.env.GREENSTART_WA_FORWARD || 'true').toLowerCase() === 'false') return { ok: false, skipped: true };
  const body = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw || ''));
  const secret = String(process.env.GREENSTART_META_APP_SECRET || '').trim();
  const signature = secret ? `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}` : String(metaSignature || '');
  let out;
  try {
    const res = await fetch(`${apiBase()}/webhooks/whatsapp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(signature ? { 'x-hub-signature-256': signature } : {}) },
      body,
      signal: AbortSignal.timeout(10000),
    });
    out = {
      ok: res.ok,
      status: res.status,
      ...(res.ok ? {} : {
        error: res.status === 401 || res.status === 403
          ? `Omni-Channel refused it (signature): ${secret ? 'GREENSTART_META_APP_SECRET is not the same as its META_APP_SECRET' : 'run .\\link-whatsapp-replies-omni-on-vps.ps1 once'}`
          : `Omni-Channel answered ${res.status}`,
      }),
    };
  } catch {
    out = { ok: false, error: 'Omni-Channel (Green Start) is not running on this server.' };
  }
  out.signedBy = secret ? 'GREENSTART_META_APP_SECRET' : 'Meta header as received';
  const value = JSON.stringify({ at: new Date().toISOString(), ...out });
  await prisma.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } }).catch(() => {});
  return out;
}

/** After TeamLink answered Meta: hand the call on in the background. */
function forwardSoon(raw, metaSignature) {
  setImmediate(() => { forward(raw, metaSignature).catch(() => {}); });
}

async function last() {
  try { const row = await prisma.appSetting.findUnique({ where: { key: KEY } }); return row ? JSON.parse(row.value) : null; } catch { return null; }
}

module.exports = { forward, forwardSoon, last, KEY };
