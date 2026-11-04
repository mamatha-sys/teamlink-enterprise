// ---------------------------------------------------------------------------
// /api/ats - THE SELECTION CONFIRMATION MAIL THE TL SENDS (utils/selectionMail.js, founder 2026-11-04).
//
//   GET  /selection-mails/pending                 the mails waiting for this login's Send (the pop-up)
//   GET  /selection-mails/application/:id         the latest one of a candidate's application (the profile)
//   POST /selection-mails/:id/send  { subject, body }   send it to the candidate (the TL / an Admin)
//   POST /selection-mails/:id/cancel              do not send it
// ---------------------------------------------------------------------------
const express = require('express');
const prisma = require('../db');
const { requireAuth, requireProduct } = require('../middleware/auth');
const { applicationWhere, OUT_OF_SCOPE } = require('../utils/scope');
const SM = require('../utils/selectionMail');

const router = express.Router();
router.use(requireAuth);
router.use(requireProduct('ats'));

const reply = (res, out) => (out.error ? res.status(out.status || 400).json({ error: out.error }) : res.json(out));

router.get('/selection-mails/pending', async (req, res, next) => {
  try { res.json(await SM.pendingFor(req.user)); } catch (err) { next(err); }
});

router.get('/selection-mails/application/:id', async (req, res, next) => {
  try {
    const app = await prisma.application.findFirst({ where: { id: req.params.id, ...applicationWhere(req.user) }, select: { id: true } });
    if (!app) return res.status(403).json(OUT_OF_SCOPE);
    return res.json({ mail: await SM.ofApplication(req.user, app.id) });
  } catch (err) { return next(err); }
});

router.post('/selection-mails/:id/send', async (req, res, next) => {
  try { reply(res, await SM.send(req.user, req.params.id, { subject: req.body && req.body.subject, body: req.body && req.body.body })); } catch (err) { next(err); }
});

router.post('/selection-mails/:id/cancel', async (req, res, next) => {
  try { reply(res, await SM.cancel(req.user, req.params.id)); } catch (err) { next(err); }
});

module.exports = router;
