/*
 * THE APPLY LINK FROM WHATSAPP (founder 2026-11-09: "login lekapothey register avamanii ravaliii kanii direct job portal open avkudadhuu").
 *
 * Added to the Job Portal's pages by the TeamLink proxy (backend/src/utils/jobPortalEmbed.js), served by the TeamLink router inside the portal
 * (embed/teamlink-integration.mjs GET /tl-addon/apply-link.js). The portal's own code is NOT changed.
 *
 *   <portal>/?src=whatsapp&tl_apply=1#/job/<id>
 *     signed out   -> straight to the registration form, headed "You're applying for <job>" (with Log in beside it); after they register
 *                     or log in, the portal's own flow (teamlink-apply-auth.js, sessionStorage 'tl_apply_intent_v1') applies for that job
 *     signed in    -> the job page, as before (Apply Now is one click)
 *
 * The flag is used once and taken out of the address, so a refresh or a shared copy opens the job page as usual.
 * The browser decides nothing: the portal's server still checks the session, the job and a second application.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.__tlApplyLink) return;
  window.__tlApplyLink = true;

  var q;
  try { q = new URLSearchParams(location.search); } catch (e) { return; }
  if (q.get('tl_apply') !== '1') return;
  var m = /^#\/job\/([^/?#]+)/.exec(location.hash || '');
  q.delete('tl_apply');
  try {
    var rest = q.toString();
    history.replaceState(history.state, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
  } catch (e) { /* the address keeps the flag; nothing else changes */ }
  if (!m) return;
  var jobId = decodeURIComponent(m[1]);
  if (/^xjob_/.test(jobId)) return; // an outside job keeps its own flow

  function session() { try { return (typeof STATE !== 'undefined' && STATE.session) || null; } catch (e) { return null; } }
  function loaded() { try { return !!(typeof DATA !== 'undefined' && DATA.jobById && DATA.jobById(jobId)); } catch (e) { return false; } }
  function toRegister() {
    try { sessionStorage.setItem('tl_apply_intent_v1', JSON.stringify({ jobId: jobId, at: Date.now() })); } catch (e) { return false; }
    window.navigate('/register/candidate');
    return true;
  }
  /* The portal's job link layer fetches the job and then puts "#/job/<id>" back in the address (index.html tlOpenJobById), so the
     registration form is opened once the job has arrived, and again if that layer brings the job page back in the next seconds. */
  var n = 0;
  (function wait() {
    var ready = window.TL && TL.ready === true && window.TLApplyAuth && typeof window.navigate === 'function';
    if (!ready || (!loaded() && n < 30)) { if (++n < 120) setTimeout(wait, 150); return; }
    if (session()) return;
    setTimeout(function () {
      if (session() || !toRegister()) return;
      var again = 0;
      var until = Date.now() + 5000;
      var back = function () {
        if (Date.now() > until || again >= 3) { window.removeEventListener('hashchange', back); return; }
        if (!session() && location.hash === '#/job/' + jobId) { again += 1; toRegister(); }
      };
      window.addEventListener('hashchange', back);
    }, 400);
  })();
})();
