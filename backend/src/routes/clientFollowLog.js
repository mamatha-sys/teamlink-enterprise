// /api/client-followlog — the dated follow-up log of a client (utils/clientFollowLog.js).
//   GET  /?clientId= | ?requirementId=     the log, newest day first (anyone who sees the client or one of its requirements)
//   GET  /?candidateId=                     the candidate's log (+ quick-logged calls and follow-up tasks done)
//   GET  /team?from=&to=&personId=          the team's follow-ups day by day (TL: their team; recruiter: their own)
//   POST /                                  { clientId | requirementId, onDate, note }: a follow-up comment (BDE, TL, recruiter, Admin)
//   POST /import/preview                    the Excel file as the raw body (X-File-Name): colleges, lines, the client each one is
//   POST /import/commit                     { token, mapping: { collegeIndex: clientId } }: imports the lines (BDE team, Admin)
//   GET  /export?candidateId= | clientId= | requirementId= &format=xlsx|csv|pdf   the Follow-ups tab as a file
//   POST /log-import/preview?candidateId= | clientId= | requirementId=   a sheet of dated lines (raw body, X-File-Name)
//   POST /log-import/commit                 { token }: adds those lines to that one log
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
// The follow-up report in bulk (founder 2026-11-04): ?from=&to=&personId=&kind=Candidate|Client&q=&format=xlsx|csv|pdf
router.get('/team/export', async (req, res, next) => {
  try {
    const KIT = require('../utils/exportKit'); // eslint-disable-line global-require
    const format = KIT.formatOf(req.query) || 'xlsx';
    const out = await FL.teamExportRows(req.user, req.query || {});
    if (out.status !== 200) return send(res, out);
    const b = out.body;
    const what = b.kind === 'Candidate' ? 'recruiter' : b.kind === 'Client' ? 'bde' : 'all';
    return KIT.sendTable(req, res, {
      format, name: `follow-ups-${what}-${b.from}-to-${b.to}`, title: `Follow-up report ${b.from} to ${b.to}`, headers: b.headers, rows: b.rows,
      sheet: 'Follow-ups', entity: 'FollowUp', what: 'Follow-up report', scope: b.scope, period: { from: b.from, to: b.to }, screen: 'Team',
    });
  } catch (e) { return next(e); }
});
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

// The Follow-ups tab: Export / Import of that one log (founder 2026-11-04: "ikkada kuda export import button vundali").
router.get('/export', async (req, res, next) => {
  try {
    const KIT = require('../utils/exportKit'); // eslint-disable-line global-require
    const format = KIT.formatOf(req.query) || 'xlsx';
    const out = await FL.exportRows(req.user, req.query || {});
    if (out.status !== 200) return send(res, out);
    const b = out.body;
    return KIT.sendTable(req, res, {
      format, name: `follow-ups-${String(b.name).replace(/[^\w-]+/g, '-').slice(0, 40)}`, title: `Follow-ups - ${b.name}`, headers: b.headers, rows: b.rows,
      sheet: 'Follow-ups', entity: b.entity, what: 'Follow-ups', scope: b.name, screen: 'Follow-ups',
    });
  } catch (e) { return next(e); }
});
router.post('/log-import/preview', express.raw({ type: () => true, limit: '10mb' }), async (req, res, next) => {
  try {
    const name = decodeURIComponent(String(req.get('X-File-Name') || 'sheet.xlsx'));
    return send(res, await FL.simplePreview(req.user, req.query || {}, Buffer.isBuffer(req.body) ? req.body : null, name));
  } catch (e) { return next(e); }
});
router.post('/log-import/commit', async (req, res, next) => {
  try { return send(res, await FL.simpleCommit(req.user, req.body || {})); } catch (e) { return next(e); }
});

module.exports = router;
