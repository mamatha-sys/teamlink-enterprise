// ---------------------------------------------------------------------------
// RCS TEMPLATES FROM OMNI-CHANNEL (founder 2026-10-31: "omnichannel lo templates approval thisukuna teamlink integration lo kuda
// kanipinchali"). RCS templates are designed and sent for approval in Omni-Channel (Green Start, Templates > RCS); rcssms.in approves them.
// Both apps use the SAME rcssms.in account, so a template id approved there sends from TeamLink too.
//
//   pull()         signs in to Green Start as the company account (the one-click ticket, utils/greenStartSso.js), reads every
//                  workspace's RCS templates that carry an rcssms.in id (GET /templates?channel=rcs) and keeps them in rcs_templates:
//                  same template id = ONE row (never a duplicate), status = Omni-Channel's (only Approved can be sent from TeamLink).
//                  A template made in TeamLink itself (or added by hand) is never overwritten: it is counted as "already here".
//                  rcssms.in cannot edit a template, so "Edit and submit again" in Omni-Channel gives the SAME template a NEW id:
//                  the row TeamLink already has for that Omni-Channel template moves to the new id (module, SMS fallback kept).
//                  A template that disappears from Omni-Channel is NOT deleted here (it may still be approved at rcssms.in), and one an
//                  Admin removed here is not taken in again. A draft (no rcssms.in id yet) stays in Omni-Channel only.
//   forward()      rcssms.in posts template approvals and delivery reports to ONE address: TeamLink's public /api/webhooks/rcs. Green
//                  Start's own webhook sits behind the TeamLink gate (no pass = 401), so TeamLink hands the same payload to Green Start
//                  on this server (127.0.0.1, its /api/v1/webhooks/smstake-rcs/<GREENSTART_RCS_WEBHOOK_SECRET>), then pulls templates.
// Every hour and on "Get templates from Omni-Channel" (Integrations > RCS > Templates). Nothing here can stop TeamLink; failures become
// words in the last result. No token or secret is ever logged, stored or returned.
// ---------------------------------------------------------------------------
const prisma = require('../db');

const STATE_KEY = 'rcs.omniSync';
const FWD_KEY = 'rcs.omniForward';
const GONE_KEY = 'rcs.omniRemoved'; // template ids an Admin removed from TeamLink: not taken in again
const KIND_TO_TYPE = { basic: 'BASIC', rich: 'RICH', carousel: 'RICHCASOUREL' };
const STATUS = { approved: 'APPROVED', rejected: 'REJECTED' };
const enabled = () => String(process.env.GREENSTART_ENABLED || 'true').toLowerCase() !== 'false';
const apiBase = () => `http://127.0.0.1:${parseInt(process.env.GREENSTART_API_PORT, 10) || 4020}/api/v1`;
const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const put = (key, v) => prisma.appSetting.upsert({ where: { key }, create: { key, value: JSON.stringify(v) }, update: { value: JSON.stringify(v) } }).catch(() => {});
async function lastOf(key) { const r = await prisma.appSetting.findUnique({ where: { key } }).catch(() => null); return parse(r && r.value, null); }

// ---- Green Start's API: the same one-click company sign-in as utils/greenStartIntegrations.js (kept here so the two stay independent) ----
async function call(method, path, { token, ws, body } = {}) {
  let res;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(ws ? { 'x-workspace-id': ws } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
    });
  } catch (err) { throw new Error('Omni-Channel (Green Start) is not running on this server.'); }
  const text = await res.text();
  const data = parse(text, { message: text.slice(0, 200) });
  if (!res.ok || (data && data.success === false)) {
    const e = new Error(String((data && ((data.error && data.error.message) || data.message)) || `Omni-Channel answered ${res.status}`).slice(0, 300));
    e.status = res.status; throw e;
  }
  return data && typeof data === 'object' && 'success' in data && 'data' in data ? data.data : data; // Green Start wraps answers as { success, data }
}
async function signIn() {
  const SSO = require('./greenStartSso'); // eslint-disable-line global-require
  if (!SSO.secretSet()) throw new Error('One-click sign-in to Omni-Channel is not set up on this server (GREENSTART_SSO_SECRET).');
  const email = await SSO.ssoEmail();
  if (!SSO.EMAIL_RE.test(email)) throw new Error('The company Omni-Channel account is not picked yet (Omni-Channel > Manage).');
  const ticket = SSO.greenStartTicket({ email, name: 'TeamLink', externalUserId: 'teamlink-rcs-templates' });
  const out = await call('POST', '/auth/teamlink', { body: { ticket } });
  if (!out || !out.accessToken) throw new Error('Omni-Channel asked for a second sign-in step for the company account, so TeamLink cannot sign in by itself.');
  return out.accessToken;
}
async function workspacesOf(token) {
  const list = await call('GET', '/workspaces', { token });
  return (Array.isArray(list) ? list : (list && list.items) || []).map((w) => ({ id: w.id, name: w.name }));
}

// One Green Start template (its wire form) -> the rcs_templates fields, or null when it has no rcssms.in id.
function rowOf(t, ws) {
  const c = t && t.rcsCarrier;
  const templateId = String((t && t.providerTemplateId) || (c && c.templateId) || '').trim();
  if (!templateId || !c || !c.shape) return null;
  const cards = Array.isArray(c.shape.cards) ? c.shape.cards : [];
  const rcsType = KIND_TO_TYPE[c.kind || c.shape.kind] || 'BASIC';
  return {
    templateId,
    name: String(t.name || templateId).slice(0, 100),
    rcsType,
    status: STATUS[String(t.status || '').toLowerCase()] || 'PENDING',
    body: {
      source: 'omnichannel', omniTemplateId: t.id, omniWorkspace: ws.name, omniWorkspaceId: ws.id, carrierStatus: c.carrierStatus || null,
      statusAt: c.statusAt || null, cards: Math.max(1, cards.length),
      varCount: cards.reduce((m, k) => Math.max(m, Array.isArray(k.variables) ? k.variables.length : 0), 0),
      buttonLink: cards.some((k) => Number(k.urlButtons || 0) > 0), imageLink: !!c.shape.dynamicImage && rcsType === 'RICH',
      description: (c.design && (c.design.text || (c.design.cards && c.design.cards[0] && c.design.cards[0].description))) || null,
      category: t.category || null,
    },
  };
}

let running = null;
async function pull({ why = 'manual' } = {}) {
  if (running) return running;
  running = (async () => {
    const result = { at: new Date().toISOString(), why, ok: false, words: '', added: 0, updated: 0, alreadyHere: 0, removedHere: 0, seen: 0, workspaces: 0 };
    try {
      if (!enabled()) throw new Error('Omni-Channel is switched off on this server (GREENSTART_ENABLED=false).');
      const gone = new Set((await lastOf(GONE_KEY)) || []);
      const token = await signIn();
      const wss = await workspacesOf(token);
      result.workspaces = wss.length;
      for (const ws of wss) {
        for (let page = 1; page <= 20; page += 1) {
          // eslint-disable-next-line no-await-in-loop
          const res = await call('GET', `/templates?channel=rcs&pageSize=100&page=${page}`, { token, ws: ws.id });
          const items = (res && res.items) || [];
          for (const t of items) {
            const r = rowOf(t, ws);
            if (!r) continue; // eslint-disable-line no-continue
            result.seen += 1;
            // eslint-disable-next-line no-await-in-loop
            let cur = await prisma.rcsTemplate.findUnique({ where: { templateId: r.templateId } });
            if (!cur && gone.has(r.templateId)) { result.removedHere += 1; continue; } // eslint-disable-line no-continue
            if (!cur && r.body.omniTemplateId) {
              // the same Omni-Channel template under an earlier rcssms.in id (submitted again after a rejection)
              // eslint-disable-next-line no-await-in-loop
              const was = (await prisma.rcsTemplate.findMany({ where: { bodyJson: { contains: `"omniTemplateId":${JSON.stringify(r.body.omniTemplateId)}` } } }))
                .find((x) => parse(x.bodyJson, {}).source === 'omnichannel' && parse(x.bodyJson, {}).omniTemplateId === r.body.omniTemplateId);
              if (was) {
                const old = parse(was.bodyJson, {});
                const earlier = [...(Array.isArray(old.earlierIds) ? old.earlierIds : []), was.templateId].slice(-20);
                // eslint-disable-next-line no-await-in-loop
                cur = await prisma.rcsTemplate.update({ where: { id: was.id }, data: { templateId: r.templateId, bodyJson: JSON.stringify({ ...old, earlierIds: earlier }) } });
                result.resubmitted = (result.resubmitted || 0) + 1;
              }
            }
            if (!cur) {
              // eslint-disable-next-line no-await-in-loop
              await prisma.rcsTemplate.create({ data: { templateId: r.templateId, name: r.name, rcsType: r.rcsType, status: r.status, bodyJson: JSON.stringify(r.body), module: null } });
              result.added += 1;
            } else if (parse(cur.bodyJson, {}).source === 'omnichannel') {
              const old = parse(cur.bodyJson, {});
              // keep what an Admin set in TeamLink (module, SMS fallback, promotional) and refresh what Omni-Channel owns
              const body = { ...old, ...r.body, fallback: old.fallback, promotional: old.promotional };
              // eslint-disable-next-line no-await-in-loop
              await prisma.rcsTemplate.update({ where: { id: cur.id }, data: { name: r.name, rcsType: r.rcsType, status: r.status, bodyJson: JSON.stringify(body) } });
              result.updated += 1;
            } else result.alreadyHere += 1; // made / added in TeamLink: never overwritten
          }
          if (items.length < 100) break;
        }
      }
      result.ok = true;
      result.words = `${result.seen} RCS template${result.seen === 1 ? '' : 's'} in Omni-Channel: ${result.added} new here, ${result.updated} updated, ${result.alreadyHere} already in TeamLink${result.resubmitted ? ` (${result.resubmitted} submitted again with a new rcssms.in id)` : ''}${result.removedHere ? `, ${result.removedHere} removed here by an Admin` : ''}.`;
    } catch (err) {
      result.words = String((err && err.message) || err).slice(0, 300);
    }
    await put(STATE_KEY, result);
    return result;
  })().finally(() => { running = null; });
  return running;
}

// rcssms.in's call (as received: same method, same raw bytes, its X-SMSTAKE-Signature if any) -> Green Start's own webhook on this
// server. -> { ok, status } | { ok: false, skipped | error }
async function forward({ method = 'POST', raw = '', contentType, query, signature } = {}) {
  const secret = String(process.env.GREENSTART_RCS_WEBHOOK_SECRET || '').trim();
  if (!enabled() || !secret) return { ok: false, skipped: true, error: secret ? 'Omni-Channel is switched off on this server' : 'GREENSTART_RCS_WEBHOOK_SECRET is not set: Omni-Channel does not get rcssms.in answers' };
  const q = { ...(query || {}) }; delete q.token;
  const qs = new URLSearchParams(Object.entries(q).map(([k, v]) => [k, Array.isArray(v) ? String(v[0]) : String(v)])).toString();
  const get = String(method).toUpperCase() === 'GET';
  let out;
  try {
    const res = await fetch(`${apiBase()}/webhooks/smstake-rcs/${encodeURIComponent(secret)}${qs ? `?${qs}` : ''}`, {
      method: get ? 'GET' : 'POST',
      headers: { ...(get ? {} : { 'content-type': contentType || 'application/json' }), ...(signature ? { 'x-smstake-signature': String(signature) } : {}) },
      body: get ? undefined : raw,
      signal: AbortSignal.timeout(10000),
    });
    out = { ok: res.ok, status: res.status, ...(res.ok ? {} : { error: res.status === 401 || res.status === 403 ? 'Omni-Channel refused it: GREENSTART_RCS_WEBHOOK_SECRET is not the same as its SMSTAKE_RCS_WEBHOOK_SECRET' : `Omni-Channel answered ${res.status}` }) };
  } catch (err) {
    out = { ok: false, error: 'Omni-Channel (Green Start) is not running on this server.' };
  }
  await put(FWD_KEY, { at: new Date().toISOString(), ...out });
  return out;
}

let pullSoon = null;
function pullAfterApproval() {
  clearTimeout(pullSoon);
  pullSoon = setTimeout(() => { pull({ why: 'approval' }).catch(() => {}); }, Number(process.env.RCS_OMNI_PULL_DELAY_MS) || 15000); // Green Start applies the verdict first
  if (pullSoon.unref) pullSoon.unref();
}

let timer = null;
function start() {
  if (require('./sandbox').isSandbox() || timer) return; // eslint-disable-line global-require
  timer = setInterval(() => { pull({ why: 'hourly' }).catch(() => {}); }, 60 * 60 * 1000);
  if (timer.unref) timer.unref();
  const first = setTimeout(() => { pull({ why: 'start' }).catch(() => {}); }, 90 * 1000);
  if (first.unref) first.unref();
}

async function forget(templateId) {
  const list = new Set((await lastOf(GONE_KEY)) || []);
  list.add(String(templateId));
  await put(GONE_KEY, [...list].slice(-500));
}

const lastPull = () => lastOf(STATE_KEY);
const lastForward = () => lastOf(FWD_KEY);
module.exports = { pull, forward, pullAfterApproval, forget, start, lastPull, lastForward, rowOf, STATE_KEY, FWD_KEY, GONE_KEY };
