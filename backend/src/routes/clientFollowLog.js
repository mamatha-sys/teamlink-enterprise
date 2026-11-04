// /api/client-followlog — the dated follow-up log of a client (utils/clientFollowLog.js).
//   GET  /?clientId= | ?requirementId=     the log, newest day first (anyone who sees the client or one of its requirements)
//   GET  /?candidateId=                     the candidate's log (+ quick-logged calls and follow-up tasks done)
//   GET  /team?from=&to=&personId=          the team's follow-ups day by day (TL: their team; recruiter: their own)
//   POST /                                  { clientId | requirementId, onDate, note }: a follow-up comment (BDE, TL, recruiter, Admin)
//   POST /import/preview                    the Excel file as the raw body (X-File-Name): colleges, lines, the client each one is
//   POST /import/commit                     { token, mapping: { collegeIndex: clientId } }: imports the lines (BDE team, Admin)
const express = require('express');
const { requireAuth, requireProduct } = require('../middleware/auth');
const FL = require('../utils/clientFollowLog');

const router = express.Router();
router.use(requireAuth);
router.use(requireProduct('ats'));

const send = (res, out) => res.status(out.status).json(out.body);

router.get('/', async (req, res, next) => {
  try {
    if (req.query.candidateId) return send(res, await FL.candidateList(req.user, { candidateId: req.query.candidateId }));
    return send(res, await FL.list(req.user, { clientId: req.query.clientId, requirementId: req.query.requirementId }));
  } catch (e) { return next(e); }
});
router.post('/', async (req, res, next) => {
  try {
    const b = req.body || {};
    return send(res, b.candidateId ? await FL.candidateAdd(req.user, b) : await FL.add(req.user, b));
  } catch (e) { return next(e); }
});
// The team's follow-ups, day by day (?from=&to=&personId=): a TL's team, the BDE TL's BDEs, a recruiter's own.
router.get('/team', async (req, res, next) => {
  try { return send(res, await FL.teamHistory(req.user, req.query || {})); } catch (e) { return next(e); }
});
// The file comes as raw bytes (not JSON), so the site-wide 100 kB JSON limit does not apply.
router.post('/import/preview', express.raw({ type: () => true, limit: '20mb' }), async (req, res, next) => {
  try {
    const name = decodeURIComponent(String(req.get('X-File-Name') || 'sheet.xlsx'));
    return send(res, await FL.importPreview(req.user, Buffer.isBuffer(req.body) ? req.body : null, name));
  } catch (e) { return next(e); }
});
router.post('/import/commit', async (req, res, next) => {
  try { return send(res, await FL.importCommit(req.user, req.body || {})); } catch (e) { return next(e); }
});

module.exports = router;
