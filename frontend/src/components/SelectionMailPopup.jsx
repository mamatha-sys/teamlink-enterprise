import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext.jsx';
import './JobRequestPopup.css';

// ---------------------------------------------------------------------------
// THE SELECTION MAIL POP-UP FOR THE TL (founder 2026-11-04: "tl ki, ee recruiter yokka candidate ki, mail
// confirmation ayiindhi, send cheyyandi ... tl send ani click chestey, send avali, candidate ki").
//
// A candidate moved to Selected -> the confirmation mail is ready (utils/selectionMail.js). The job's TL
// sees it on screen wherever they are in TeamLink:
//   "<Recruiter>'s candidate <Name> is Selected for <Job>. Check the mail and press Send."
//   [Send to the candidate]  [Change the words]  [Later]  [Do not send]
// Data: GET /api/ats/selection-mails/pending (polled every 30 s and when the tab comes back).
// [Later] hides it for 30 minutes on this computer. Mounted once, in the app shell (components/Shell.jsx).
// The same mail can be sent from the candidate's profile (SelectionMailBox below).
// ---------------------------------------------------------------------------
const POLL_MS = 30000;
const SNOOZE_MS = 30 * 60 * 1000;
const SNOOZE_KEY = 'tl_selmail_later';
const readSnooze = () => { try { return JSON.parse(localStorage.getItem(SNOOZE_KEY) || '{}') || {}; } catch { return {}; } };
const writeSnooze = (m) => { try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(m)); } catch { /* it simply comes back */ } };
const errText = (e, d) => (e && e.response && e.response.data && e.response.data.error) || d;

// The mail itself, with Send / Do not send - used by the pop-up and by the profile box.
export function SelectionMailEditor({ mail, onDone, extra = null }) {
  const [edit, setEdit] = useState(false);
  const [subject, setSubject] = useState(mail.subject);
  const [body, setBody] = useState(mail.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setSubject(mail.subject); setBody(mail.body); setEdit(false); setError(''); }, [mail.id]); // eslint-disable-line react-hooks/exhaustive-deps
  async function send() {
    setBusy(true); setError('');
    try {
      const r = await api.post(`/ats/selection-mails/${mail.id}/send`, { subject, body });
      onDone(r.data.message || 'Sent.');
    } catch (e) { setError(errText(e, 'Could not send. Try again.')); } finally { setBusy(false); }
  }
  async function cancel() {
    if (!window.confirm(`Do not send the selection mail to ${mail.candidate}?`)) return;
    setBusy(true); setError('');
    try {
      const r = await api.post(`/ats/selection-mails/${mail.id}/cancel`);
      onDone(r.data.message || 'Not sent.');
    } catch (e) { setError(errText(e, 'Could not save. Try again.')); } finally { setBusy(false); }
  }
  return (
    <>
      <div style={{ fontSize: 13, margin: '4px 0' }}>
        To: <b>{mail.candidate}</b>{mail.email ? ` <${mail.email}>` : <span style={{ color: '#b42318' }}> (no email on the profile)</span>}
      </div>
      {edit ? (
        <>
          <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" style={{ width: '100%', marginBottom: 6 }} />
          <textarea className="input" value={body} onChange={(e) => setBody(e.target.value)} aria-label="The mail" rows={9} style={{ width: '100%' }} />
        </>
      ) : (
        <div style={{ border: '1px solid var(--line, #e4e7ec)', borderRadius: 8, padding: '8px 10px', background: 'var(--bg-soft, #f9fafb)', maxHeight: 220, overflow: 'auto' }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{subject}</div>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 13.5 }}>{body}</div>
        </div>
      )}
      {mail.result && mail.status === 'WAITING' && <div className="notice red" style={{ marginTop: 6 }}>{`Last try: ${mail.result}`}</div>}
      {error && <div className="notice red" style={{ marginTop: 6 }}>{error}</div>}
      <div className="jrp-foot" style={{ padding: '12px 0 0', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary jrp-open" onClick={send} disabled={busy || !mail.email} autoFocus>{busy ? 'Sending…' : 'Send to the candidate'}</button>
        <button type="button" className="btn" onClick={() => setEdit(!edit)} disabled={busy}>{edit ? 'Done changing' : 'Change the words'}</button>
        {extra}
        <button type="button" className="btn btn-ghost" onClick={cancel} disabled={busy}>Do not send</button>
      </div>
    </>
  );
}

export default function SelectionMailPopup() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [later, setLater] = useState(() => readSnooze());
  const [flash, setFlash] = useState('');
  const alive = useRef(true);

  const check = useCallback(() => {
    if (!user) return;
    api.get('/ats/selection-mails/pending')
      .then((r) => { if (alive.current) setItems(Array.isArray(r.data) ? r.data : []); })
      .catch(() => { /* offline or no access: try again later */ });
  }, [user]);

  useEffect(() => {
    alive.current = true;
    if (!user) return undefined;
    check();
    const timer = setInterval(() => { if (!document.hidden) check(); }, POLL_MS);
    const onShow = () => { if (!document.hidden) check(); };
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('focus', onShow);
    return () => {
      alive.current = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('focus', onShow);
    };
  }, [user && user.id, check]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setInterval(() => setLater(readSnooze()), 30000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { if (!flash) return undefined; const t = setTimeout(() => setFlash(''), 4000); return () => clearTimeout(t); }, [flash]);

  const now = Date.now();
  const waiting = items.filter((i) => !(later[i.id] && later[i.id] > now));
  const cur = waiting[0];
  if (!user) return null;
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
    <div className="overlay show jrp-overlay" role="alertdialog" aria-modal="true" aria-labelledby="smp-title">
      <div className="modal jrp-box" style={{ width: 560, borderTopColor: '#067647' }}>
        <div className="jrp-head">
          <span className="jrp-ico" aria-hidden="true">✉️</span>
          <h3 id="smp-title">Selection mail to send</h3>
          {more > 0 && <span className="jrp-more">{`+${more} more waiting`}</span>}
        </div>
        <div className="jrp-body">
          <p className="jrp-line">
            <b>{cur.recruiter || 'The recruiter'}</b>
            {"'s candidate "}
            <b>{cur.candidate}</b>
            {' is Selected for '}
            <b>{cur.job}</b>
            {cur.client ? ` (${cur.client})` : ''}
            . The confirmation mail is ready: check it and press Send.
          </p>
          <SelectionMailEditor
            mail={cur}
            onDone={(msg) => { setFlash(msg); setItems((l) => l.filter((i) => i.id !== cur.id)); }}
            extra={(
              <>
                <button type="button" className="btn" onClick={() => navigate(`/candidates/${cur.candidateId}`)}>Open the profile</button>
                <button type="button" className="btn jrp-later" onClick={snooze}>Later</button>
              </>
            )}
          />
        </div>
        <div style={{ height: 14 }} />
      </div>
    </div>
  );
}

// On the candidate's profile (Candidate360 actions), at Selected: the mail's state, and Send for the TL.
export function SelectionMailBox({ applicationId, onFlash }) {
  const [mail, setMail] = useState(null);
  const load = useCallback(() => {
    api.get(`/ats/selection-mails/application/${applicationId}`).then((r) => setMail(r.data.mail || null)).catch(() => setMail(null));
  }, [applicationId]);
  useEffect(() => { load(); }, [load]);
  if (!mail) return null;
  if (mail.status === 'SENT') return <div className="notice green" style={{ marginTop: 8 }}>{`Selection mail sent to the candidate${mail.sentByName ? ` by ${mail.sentByName}` : ''}${mail.sentAt ? ` on ${new Date(mail.sentAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}.`}</div>;
  if (mail.status === 'CANCELLED') return <div className="small-muted" style={{ marginTop: 8 }}>{mail.result || 'The selection mail was not sent.'}</div>;
  if (!mail.maySend) return <div className="notice" style={{ marginTop: 8 }}>The selection mail is ready and waits for the team lead to press Send.</div>;
  return (
    <div className="cdw-card" style={{ marginTop: 8 }}>
      <div className="cdw-label">Selection mail: waiting for your Send</div>
      <SelectionMailEditor mail={mail} onDone={(msg) => { if (onFlash) onFlash(msg); load(); }} />
    </div>
  );
}
