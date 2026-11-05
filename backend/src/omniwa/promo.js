// ---------------------------------------------------------------------------
// OMNI-CHANNEL WHATSAPP PROMOTIONS: every bulk WhatsApp send from the candidate list is logged here with its job, campaign, template, recruiter and status, so that a
// reply can be tied to the promotion it answers (agent.js) and the send shows inside Omni-Channel. utils/bulkMessaging.js logHistory calls logBulk once per batch.
// ---------------------------------------------------------------------------
const S = require('../outreach/store');
const { ensure } = require('./schema');
const Live = require('./live');
const { digitsOf } = require('../utils/messageDelivery');

const RANK = { received: 0, queued: 0, sent: 1, delivered: 2, read: 3 };

// job: the bulk job; rows: its recipients that have just finished. Never throws: the send already happened.
async function logBulk(job, rows) {
  try {
    if (job.kind === 'individual' || job.audience !== 'candidates') return;
    const wa = (rows || []).filter((r) => r.channel === 'WhatsApp' && ['sent', 'failed'].includes(r.status));
    if (!wa.length) return;
    await ensure();
    const now = Date.now();
    const sender = job.sender || {};
    const template = job.templates && job.templates.WhatsApp ? job.templates.WhatsApp.name : job.purpose;
    await S.run('INSERT OR IGNORE INTO "OmniWaCampaign" (id, name, requirementId, template, senderUserId, senderName, numberId, createdAt) VALUES (?,?,?,?,?,?,?,?)', job.id, S.clip(job.purpose, 120) || 'WhatsApp promotion', job.requirementId || null, S.clip(template, 120) || null, sender.senderUserId || null, sender.senderName || null, job.waNumberId || null, now);
    for (const r of wa) {
      const e164 = digitsOf(r.address);
      if (!e164) continue; // eslint-disable-line no-continue
      const at = r.sentAt ? new Date(r.sentAt).getTime() : now;
      // eslint-disable-next-line no-await-in-loop
      await S.run('INSERT OR IGNORE INTO "OmniWaMessage" (id, e164, direction, body, template, status, statusDetail, providerMessageId, candidateId, requirementId, campaignId, senderUserId, senderName, numberId, at, createdAt) VALUES (?,?,\'OUT\',?,?,?,?,?,?,?,?,?,?,?,?,?)',
        S.newId('wam'), e164, S.clip(r.text, 4000), S.clip(template, 120) || null, r.status, r.status === 'failed' ? S.clip(r.reason, 300) : null, r.providerRef || null, r.entityId, job.requirementId || null, job.id, sender.senderUserId || null, sender.senderName || null, job.waNumberId || null, at, now);
    }
    Live.changed();
  } catch (err) {
    console.error('[omni-wa] promotion log:', err && err.message); // eslint-disable-line no-console
  }
}

// Meta's delivery report: sent -> delivered -> read, failed always wins. Never throws.
async function onStatus({ providerRef, status, error }) {
  try {
    if (!providerRef) return;
    await ensure();
    const word = String(status || '').toLowerCase();
    const row = (await S.q('SELECT id, status FROM "OmniWaMessage" WHERE providerMessageId = ?', String(providerRef)))[0];
    if (!row) return;
    if (word === 'failed') await S.run('UPDATE "OmniWaMessage" SET status = \'failed\', statusDetail = ? WHERE id = ?', S.clip(error, 300) || null, row.id);
    else if (word in RANK && (RANK[word] > (RANK[row.status] ?? -1)) && row.status !== 'failed') await S.run('UPDATE "OmniWaMessage" SET status = ? WHERE id = ?', word, row.id);
    else return;
    Live.changed();
  } catch { /* the report is a courtesy here: CandidateMessage has it too */ }
}

module.exports = { logBulk, onStatus };
