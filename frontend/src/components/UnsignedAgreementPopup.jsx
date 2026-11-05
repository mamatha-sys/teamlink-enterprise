import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext.jsx';
import './JobRequestPopup.css';

// ---------------------------------------------------------------------------
// OPENING A REQUIREMENT ON AN UNSIGNED AGREEMENT (founder 2026-11-05; backend: utils/unsignedOpen.js). Mounted once, in components/Shell.jsx.
//   The question   any button that tries to open such a job gets code UNSIGNED_AGREEMENT back; api.js raises 'tl-unsigned-ask' and it
//                  shows here, so every button asks the same way. Add requirement asks too, after saving.
//   The BDE TL     what waits for approval comes up on screen wherever they are: Approve / Do not approve / Later
//                  (GET /requirements/unsigned-requests/pending, every 30 s). [Later] hides it for 30 minutes on this computer.
// ---------------------------------------------------------------------------
const POLL_MS = 30000;
const SNOOZE_MS = 30 * 60 * 1000;
const SNOOZE_KEY = 'tl_unsigned_later';
const readSnooze = () => { try { return JSON.parse(localStorage.getItem(SNOOZE_KEY) || '{}') || {}; } catch { return {}; } };
const writeSnooze = (m) => { try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(m)); } catch { /* it simply comes back */ } };
const errText = (e, d) => (e && e.response && e.response.data && e.response.data.error) || d;

export default function UnsignedAgreementPopup() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [ask, setAsk] = useState(null);
  const [items, setItems] = useState([]);
  const [later, setLater] = useState(() => readSnooze());
  const [saying, setSaying] = useState(false); // the box for why it is not approved
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const alive = useRef(true);
  const approver = useRef(true);

  const check = useCallback(() => {
    if (!user || !approver.current) return;
    api.get('/requirements/unsigned-requests/pending')
      .then((r) => { if (!alive.current) return; approver.current = !!r.data.canApprove; setItems(r.data.rows || []); })
      .catch(() => { /* offline: try again later */ });
  }, [user]);

  useEffect(() => {
    alive.current = true;
    approver.current = true;
    if (!user) return undefined;
    check();
    const timer = setInterval(() => { if (!document.hidden) check(); }, POLL_MS);
    const onAsk = (e) => { setError(''); setAsk(e.detail); };
    window.addEventListener('tl-unsigned-ask', onAsk);
    return () => { alive.current = false; clearInterval(timer); window.removeEventListener('tl-unsigned-ask', onAsk); };
  }, [user && user.id, check]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!flash) return undefined; const t = setTimeout(() => setFlash(''), 5000); return () => clearTimeout(t); }, [flash]);

  async function yes() {
    setBusy(true); setError('');
    try {
      const r = await api.post(`/requirements/${ask.requirementId}/unsigned-request`);
      setAsk(null);
      setFlash(r.data.message || 'Sent.');
      if (r.data.opened) window.location.reload();
    } catch (e) { setError(errText(e, 'Could not send. Try again.')); } finally { setBusy(false); }
  }
  async function decide(cur, approve) {
    setBusy(true); setError('');
    try {
      const r = await api.post(`/requirements/unsigned-requests/${cur.id}/decide`, { approve, note: why });
      setItems((list) => list.filter((i) => i.id !== cur.id));
      setSaying(false); setWhy('');
      setFlash(r.data.message || 'Saved.');
      check();
    } catch (e) { setError(errText(e, 'Could not save. Try again.')); } finally { setBusy(false); }
  }

  if (!user) return null;
  if (ask) {
    return (
      <div className="overlay show jrp-overlay" role="alertdialog" aria-modal="true" aria-labelledby="uap-ask">
        <div className="modal jrp-box" style={{ width: 520, borderTopColor: '#b54708' }}>
          <div className="jrp-head"><span className="jrp-ico" aria-hidden="true">🔏</span><h3 id="uap-ask">The agreement is not signed</h3></div>
          <div className="jrp-body">
            <p className="jrp-line">{ask.question}</p>
            <p className="jrp-line small-muted">{ask.note}</p>
            {error && <div className="notice red">{error}</div>}
          </div>
          <div className="jrp-foot">
            <button type="button" className="btn btn-primary jrp-open" onClick={yes} disabled={busy} autoFocus>{busy ? 'Please wait…' : (ask.approver ? 'Yes, open it' : 'Yes, send to the BDE TL')}</button>
            <button type="button" className="btn" onClick={() => setAsk(null)} disabled={busy}>No</button>
          </div>
        </div>
      </div>
    );
  }
  const now = Date.now();
  const waiting = items.filter((i) => !(later[i.id] && later[i.id] > now));
  const cur = waiting[0];
  if (!cur) return flash ? <div className="toast show" role="status" style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 1300 }}>{flash}</div> : null;
  function snooze() {
    const map = { ...readSnooze() };
    Object.keys(map).forEach((k) => { if (map[k] <= Date.now()) delete map[k]; });
    map[cur.id] = Date.now() + SNOOZE_MS;
    writeSnooze(map);
    setLater(map);
  }
  const more = waiting.length - 1;
  return (
    <div className="overlay show jrp-overlay" role="alertdialog" aria-modal="true" aria-labelledby="uap-title">
      <div className="modal jrp-box" style={{ width: 540, borderTopColor: '#b54708' }}>
        <div className="jrp-head">
          <span className="jrp-ico" aria-hidden="true">🔏</span>
          <h3 id="uap-title">Approve opening this requirement?</h3>
          {more > 0 && <span className="jrp-more">{`+${more} more waiting`}</span>}
        </div>
        <div className="jrp-body">
          <p className="jrp-line">
            <b>{cur.askedBy || 'Someone'}</b>
            {` wants to ${cur.reopening ? 'reopen' : 'open'} `}
            <b>{`${cur.code ? `${cur.code} · ` : ''}${cur.title}`}</b>
            {cur.client ? ` for ${cur.client}` : ''}.
          </p>
          <p className="jrp-line">The agreement is not signed ({cur.statusWord}).</p>
          {saying && <textarea className="input" rows={2} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why not? (they will see this; you can leave it empty)" aria-label="Why it is not approved" style={{ width: '100%' }} autoFocus />}
          {error && <div className="notice red" style={{ marginTop: 6 }}>{error}</div>}
        </div>
        <div className="jrp-foot" style={{ flexWrap: 'wrap' }}>
          {saying ? (
            <>
              <button type="button" className="btn btn-primary jrp-open" onClick={() => decide(cur, false)} disabled={busy}>{busy ? 'Saving…' : 'Do not approve'}</button>
              <button type="button" className="btn" onClick={() => { setSaying(false); setWhy(''); }} disabled={busy}>Back</button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-primary jrp-open" onClick={() => decide(cur, true)} disabled={busy} autoFocus>{busy ? 'Saving…' : 'Approve and open'}</button>
              <button type="button" className="btn" onClick={() => setSaying(true)} disabled={busy}>Do not approve</button>
              <button type="button" className="btn" onClick={() => { snooze(); navigate(`/requirements/${cur.requirementId}`); }} disabled={busy}>Look at it</button>
              <button type="button" className="btn btn-ghost" onClick={snooze} disabled={busy}>Later</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
