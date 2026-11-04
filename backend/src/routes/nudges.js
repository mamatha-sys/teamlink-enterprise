// ---------------------------------------------------------------------------
// /api/nudges - the reminder POPUPS of utils/dayNudges.js (morning / afternoon / evening, "a course was given to you").
//   GET  /mine        my popups still waiting (the last 24 hours, newest first, at most 3)
//   POST /:id/seen    I closed it (only my own)
// ---------------------------------------------------------------------------
const express = require('express');
const prisma = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/mine', async (req, res, next) => {
  try {
    const rows = await prisma.notification.findMany({
      where: { userId: req.user.id, channel: 'Popup', status: 'Waiting', createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } },
      orderBy: { createdAt: 'desc' }, take: 3, select: { id: true, title: true, message: true, createdAt: true },
    });
    res.json({ popups: rows });
  } catch (err) { next(err); }
});

router.post('/:id/seen', async (req, res, next) => {
  try {
    const r = await prisma.notification.updateMany({ where: { id: req.params.id, userId: req.user.id, channel: 'Popup' }, data: { status: 'Shown' } });
    res.json({ ok: r.count > 0 });
  } catch (err) { next(err); }
});

module.exports = router;
