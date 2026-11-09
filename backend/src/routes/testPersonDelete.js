// /api/admin/full-delete - delete a test person completely (utils/testPersonDelete.js). Super Admin only, never from View as / Act as.
//   GET  /preview?userId= | ?candidateId=      what would go, and what stays
//   POST /  { userId | candidateId, confirm }   delete (confirm = the employee code, or the name)
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const TP = require('../utils/testPersonDelete');

const router = express.Router();
router.use(requireAuth);
router.use((req, res, next) => {
  // the real Super Admin at the keyboard: not an Internal HR login (which only resolves as one), not while viewing or acting as someone
  if (req.viewAs || req.actingAs || !req.user || req.user.role !== 'SUPER_ADMIN' || req.user.hrSuper) {
    return res.status(403).json({ error: 'Only a Super Admin, signed in as themselves, can delete a person completely.' });
  }
  return next();
});
const targetOf = (src) => (src.userId ? { userId: String(src.userId) } : (src.candidateId ? { candidateId: String(src.candidateId) } : null));

router.get('/preview', async (req, res, next) => {
  try {
    const t = targetOf(req.query);
    if (!t) return res.status(400).json({ error: 'Pick a login or a candidate.' });
    const out = await TP.preview(t);
    return res.status(out.status).json(out.body);
  } catch (err) { return next(err); }
});
router.post('/', async (req, res, next) => {
  try {
    const t = targetOf(req.body || {});
    if (!t) return res.status(400).json({ error: 'Pick a login or a candidate.' });
    const out = await TP.run(req.user, t, (req.body || {}).confirm);
    return res.status(out.status).json(out.body);
  } catch (err) { return next(err); }
});

module.exports = router;
