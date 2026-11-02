// ---------------------------------------------------------------------------
// CRM - PUBLIC PAGES (no login, 2026-11-02). Only the unsubscribe link at the foot of a CRM campaign email:
//   GET /api/crm-public/unsubscribe?t=<signed token>   adds the address to CrmOptOut (no more campaign emails) and says so.
// The token is the email signed with the server secret (crm/campaigns.js), so a link cannot be made for somebody else.
// ---------------------------------------------------------------------------
const express = require('express');
const CMP = require('../crm/campaigns');

const router = express.Router();
const page = (title, text) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f5f7fb;color:#1b2a4a;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:16px}
.card{background:#fff;border:1px solid #e3e8f0;border-radius:14px;padding:28px 24px;max-width:440px;text-align:center;box-shadow:0 4px 18px rgba(20,40,80,.06)}h1{font-size:20px;margin:0 0 8px}p{color:#5b6474;line-height:1.5;margin:0}</style></head>
<body><div class="card"><h1>${title}</h1><p>${text}</p></div></body></html>`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

router.get('/unsubscribe', async (req, res) => {
  const email = CMP.emailOfToken(req.query.t);
  res.set('Content-Type', 'text/html; charset=utf-8');
  if (!email) return res.status(400).send(page('This link is not valid', 'Please use the unsubscribe link from the email exactly as it came, or simply reply to the email and ask us to stop.'));
  try {
    await CMP.optOut('email', email, { reason: 'unsubscribe link' });
    return res.send(page('You are unsubscribed', `${esc(email)} will not receive TeamLink Consultants campaign emails any more. Replies to your own messages still reach us.`));
  } catch (e) {
    return res.status(500).send(page('Something went wrong', 'Please try the link again in a minute, or reply to the email and ask us to stop.'));
  }
});

module.exports = router;
