// ---------------------------------------------------------------------------
// CANDIDATE LOGINS (Administration -> Integrations -> Job Portal settings -> Candidate logins). The rules and the reasons are in
// utils/candidateLogins.js. Everything here is for Administrators of Integrations: the switch, the numbers, the backlog run.
//   GET  /api/candidate-logins            the switch, the backlog (a dry run) and the portal's own waiting list
//   PUT  /api/candidate-logins/auto       { on }
//   POST /api/candidate-logins/send       { confirm: true, expected: { teamlink, portal } }  start the backlog, only with the counts shown
//   GET  /api/candidate-logins/progress   how far the run is
// ---------------------------------------------------------------------------
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requirePerm } = require('../utils/permissions');
const { logAudit } = require('../utils/audit');
const L = require('../utils/candidateLogins');
const { portalFetch } = require('../utils/jobPortalBridge');

const router = express.Router();
router.use(requireAuth);
const view = requirePerm(null, 'administration', 'Integrations', 'view');
const change = requirePerm(null, 'administration', 'Integrations', 'configure');
const PORTAL = '/integrations/teamlink/mailboxes/intake/send-logins';

const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  const message = err && err.notConfigured ? `The Job Portal is not linked to TeamLink on this server (${err.message}).` : `The Job Portal could not be reached: ${(err && err.message) || 'no answer'}.`;
  return res.status(err && err.notConfigured ? 503 : 502).json({ error: message });
});

router.get('/', view, wrap(async (_req, res) => {
  const [s, backlog, portal] = await Promise.all([
    L.settings(),
    L.backlogCount().catch((e) => ({ ready: false, error: e.message, total: 0, wouldInvite: 0, counts: {} })),
    portalFetch(`${PORTAL}/pending`).catch((e) => ({ error: e.message, mail: 0, sourced: 0, total: 0 })),
  ]);
  res.json({
    auto: s.auto, since: s.since, lastRunAt: s.lastRunAt, last: s.last, waitingRetry: s.retry.length,
    backlog, portal: { mail: portal.mail || 0, sourced: portal.sourced || 0, total: portal.total || 0, error: portal.error, progress: portal.progress || null },
    run: L.progress(),
  });
}));

router.put('/auto', change, wrap(async (req, res) => {
  if (!req.body || typeof req.body.on !== 'boolean') return res.status(422).json({ error: 'on must be true or false' });
  const out = await L.setAuto(req.body.on, req.user.id);
  await logAudit({ userId: req.user.id, action: `Candidate logins: automatic sending switched ${req.body.on ? 'ON' : 'OFF'}`, entity: 'Integration', entityId: L.STORE_ID, toValue: req.body.on ? 'ON' : 'OFF' });
  return res.json({ auto: out.settings.auto, portalUpdated: out.portal });
}));

router.post('/send', change, wrap(async (req, res) => {
  const b = req.body || {};
  const exp = b.expected || {};
  if (b.confirm !== true || !Number.isFinite(Number(exp.teamlink)) || !Number.isFinite(Number(exp.portal))) {
    return res.status(422).json({ error: 'Look at the numbers first, then confirm: send { confirm: true, expected: { teamlink, portal } }.' });
  }
  const out = { teamlink: { started: false, total: 0 }, portal: { started: false, total: 0 } };
  if (Number(exp.teamlink) > 0) out.teamlink = await L.sendBacklog({ expected: Number(exp.teamlink), by: req.user.id });
  if (Number(exp.portal) > 0) {
    out.portal = await portalFetch(PORTAL, { method: 'POST', body: { confirm: true, expected: Number(exp.portal) }, timeoutMs: 30000 })
      .catch((e) => ({ started: false, reason: (e && e.message) || 'the portal did not start it' }));
  }
  await logAudit({ userId: req.user.id, action: 'Candidate logins: backlog sending started', entity: 'Integration', entityId: L.STORE_ID, toValue: `TeamLink ${exp.teamlink}, portal ${exp.portal}` });
  const refused = (!out.teamlink.started && Number(exp.teamlink) > 0) || (!out.portal.started && Number(exp.portal) > 0);
  return res.status(refused ? 409 : 200).json(out);
}));

router.get('/progress', view, wrap(async (_req, res) => {
  const portal = await portalFetch(`${PORTAL}/pending`).catch(() => ({ progress: null }));
  res.json({ teamlink: L.progress(), portal: portal.progress || null });
}));

module.exports = router;
