// ---------------------------------------------------------------------------
// /api/public/omni-voice - Omni-Channel (Green Start) Voice Calling places its AI calls through TeamLink's AI phone line (calling/omniCalls.js).
// Server to server only: every request carries a short-lived token signed with the shared one-click-sign-in secret.
//   POST /calls        make one call by a script       GET /calls/:id   how it is going / how it ended
//   GET  /line         is the phone line ready?        (Green Start shows it as its "carrier")
// ---------------------------------------------------------------------------
const express = require('express');
const omni = require('../calling/omniCalls');

const router = express.Router();
router.use(express.json({ limit: '200kb' }));
router.use((req, res, next) => {
  const v = omni.verify(req.headers.authorization);
  if (!v.ok) return res.status(v.status).json({ ok: false, error: v.error });
  return next();
});

router.get('/line', (req, res) => {
  const r = require('../calling/voice/sipCall').readiness(); // eslint-disable-line global-require
  res.json({ ok: true, ready: r.ready, mode: r.mode, problems: r.problems });
});

// the other-language versions of a script are made now, so the first call can already switch language
router.post('/prepare', async (req, res) => {
  const r = await omni.prepare(String((req.body || {}).script || ''));
  return res.status(r.ok ? 200 : 422).json(r);
});

// Recruiters Tokens in Omni-Channel: the people, who may see them, and their same-month joinings (outreach/creditUseBridge.js). Read only.
router.get('/credit-use', async (req, res) => {
  try {
    const out = await require('../outreach/creditUseBridge').forOmni(req.query.viewer, req.query.month); // eslint-disable-line global-require
    return res.set('Cache-Control', 'no-store').json(out);
  } catch (err) {
    console.error('[omni-credit-use]', err && err.message); // eslint-disable-line no-console
    return res.json({ ok: false, code: 'FAILED', error: 'TeamLink could not read the numbers just now.' }); // 200, never 502/503
  }
});

// AI Marketing in Omni-Channel: who can be ticked, and whether the person asking is the Super Admin (outreach/creditUseBridge.js). Read only.
router.get('/marketing-people', async (req, res) => {
  try {
    return res.set('Cache-Control', 'no-store').json(await require('../outreach/creditUseBridge').marketingPeople(req.query.viewer)); // eslint-disable-line global-require
  } catch (err) {
    console.error('[omni-marketing-people]', err && err.message); // eslint-disable-line no-console
    return res.json({ ok: false, error: 'TeamLink could not read the employees just now.' }); // 200, never 502/503
  }
});

router.post('/calls', async (req, res) => {
  const b = req.body || {};
  const r = await omni.create({ externalId: b.externalId, toNumber: b.toNumber, name: b.name, script: b.script, scriptLanguage: b.scriptLanguage, scripts: b.scripts, agentName: b.agentName });
  // 200 with ok:false (never 502/503): the caller shows the reason and decides about a retry
  if (!r.ok) return res.status(r.status === 400 || r.status === 422 ? r.status : 200).json({ ok: false, code: r.code, error: r.reason });
  return res.json({ ok: true, id: r.id, again: !!r.again });
});

router.get('/calls/:id', async (req, res) => {
  const s = await omni.status(req.params.id);
  if (!s) return res.status(404).json({ ok: false, error: 'No such call.' });
  return res.json({ ok: true, ...s });
});

module.exports = router;
