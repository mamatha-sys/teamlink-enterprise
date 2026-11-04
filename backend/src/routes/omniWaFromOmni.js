// ---------------------------------------------------------------------------
// POST /api/omni-gs/from-omni/whatsapp-number - Omni-Channel (Green Start, on this same server) hands TeamLink a WhatsApp number an Admin
// connected there (founder 2026-11-04: "whatsapp integration green start lonu cheyali and teamlink lo kuda undali"); utils/omniWaImport.js
// does the work. Server to server only: no browser, no cookie, no CORS. The raw body is signed with the one-click sign-in secret both
// servers share (X-TeamLink-Omni-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">, 5 minutes), so nobody else can add a
// number. Mounted ahead of express.json() (index.js) to read the exact bytes. Never answers with a token.
// ---------------------------------------------------------------------------
const express = require('express');
const IMP = require('../utils/omniWaImport');

const router = express.Router();

router.post('/api/omni-gs/from-omni/whatsapp-number', express.raw({ type: '*/*', limit: '32kb' }), async (req, res) => {
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    if (!IMP.signatureOk(req.get('x-teamlink-omni-signature'), raw)) return res.status(401).json({ error: 'Not signed by Omni-Channel.' });
    let body;
    try { body = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).json({ error: 'Not JSON.' }); }
    const out = await IMP.importFromOmni(body);
    if (out.error) return res.status(out.status || 400).json({ ok: false, error: out.error });
    return res.json(out);
  } catch (err) {
    console.error('[omni-wa-import]', err && err.message); // eslint-disable-line no-console
    return res.status(200).json({ ok: false, error: 'TeamLink could not add the number just now.' });
  }
});

module.exports = router;
