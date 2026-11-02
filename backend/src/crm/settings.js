// ---------------------------------------------------------------------------
// CRM SETTINGS (2026-11-02, the full CRM): the pick lists and numbers the BDE TL / Admin may change - lead sources, lost
// reasons, the probability of each stage, after how many days without a call / meeting a deal counts as "going cold", and
// the proposal defaults. Kept as one JSON row in AppSetting (key crm.settings); read with a 15 s cache.
// The stages themselves stay fixed (every report and the board are built on them).
// THE SALES TEAM (founder 2026-11-02: "oka sales team kosam design chesinattu design cheyyu" - a CRM for the sales team, not
// for one job title): salesTeam = [{ userId, name, role: 'rep' | 'manager' }]. The BDEs and the BDE TLs are on the team
// without being listed; an Admin / Sales manager adds anybody else here (a sales executive, a key-account manager ...).
// ---------------------------------------------------------------------------
const prisma = require('../db');

const KEY = 'crm.settings';
const STAGES = ['Prospecting', 'Contacted', 'Meeting', 'Requirement discussed', 'Proposal sent', 'Negotiation', 'Won', 'Lost'];
const DEFAULTS = {
  sources: ['LinkedIn', 'Referral', 'Cold call', 'Website', 'Job post signal', 'Email campaign', 'WhatsApp', 'Event', 'Existing client', 'Other'],
  lostReasons: ['Price / fee too high', 'Chose another vendor', 'Hiring on hold', 'No response', 'Hiring in-house', 'Not a fit', 'Other'],
  stageProbability: { Prospecting: 10, Contacted: 20, Meeting: 40, 'Requirement discussed': 50, 'Proposal sent': 60, Negotiation: 80, Won: 100, Lost: 0 },
  staleDays: 14,
  proposalValidityDays: 30,
  salesTeam: [],
};

let cached = null; let cachedAt = 0;
const cleanList = (v, fallback) => {
  const out = [...new Set((Array.isArray(v) ? v : String(v || '').split(/\n|,/)).map((x) => String(x || '').trim().slice(0, 60)).filter(Boolean))].slice(0, 40);
  return out.length ? out : fallback;
};
function normalize(raw = {}) {
  const prob = {};
  STAGES.forEach((s) => {
    const n = Math.round(Number((raw.stageProbability || {})[s]));
    prob[s] = s === 'Won' ? 100 : s === 'Lost' ? 0 : (Number.isFinite(n) && n >= 0 && n <= 100 ? n : DEFAULTS.stageProbability[s]);
  });
  const sources = cleanList(raw.sources, DEFAULTS.sources);
  if (!sources.includes('Other')) sources.push('Other');
  const lostReasons = cleanList(raw.lostReasons, DEFAULTS.lostReasons);
  if (!lostReasons.includes('Other')) lostReasons.push('Other');
  const stale = Math.round(Number(raw.staleDays));
  const valid = Math.round(Number(raw.proposalValidityDays));
  const seen = new Set();
  const salesTeam = (Array.isArray(raw.salesTeam) ? raw.salesTeam : []).map((m) => ({ userId: String((m && m.userId) || '').slice(0, 60), name: String((m && m.name) || '').slice(0, 120), role: m && m.role === 'manager' ? 'manager' : 'rep' }))
    .filter((m) => m.userId && !seen.has(m.userId) && seen.add(m.userId)).slice(0, 300);
  return {
    sources, lostReasons, stageProbability: prob, salesTeam,
    staleDays: Number.isFinite(stale) && stale >= 1 && stale <= 365 ? stale : DEFAULTS.staleDays,
    proposalValidityDays: Number.isFinite(valid) && valid >= 1 && valid <= 365 ? valid : DEFAULTS.proposalValidityDays,
  };
}

async function load({ fresh = false } = {}) {
  if (!fresh && cached && Date.now() - cachedAt < 15000) return cached;
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } }).catch(() => null);
  let raw = {};
  try { raw = row ? JSON.parse(row.value) : {}; } catch { raw = {}; }
  cached = normalize(raw); cachedAt = Date.now();
  return cached;
}

async function save(body) {
  const next = normalize({ ...(await load({ fresh: true })), ...(body || {}) });
  await prisma.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: JSON.stringify(next) }, update: { value: JSON.stringify(next) } });
  cached = next; cachedAt = Date.now();
  return next;
}

// The team role of a login from the last read settings (sync, for the access checks; the CRM routes read the settings
// first, so this is never older than 15 s there): 'manager' | 'rep' | null.
function teamRole(userId) {
  const m = cached && cached.salesTeam.find((x) => x.userId === userId);
  return m ? m.role : null;
}

module.exports = { load, save, teamRole, STAGES, DEFAULTS };
