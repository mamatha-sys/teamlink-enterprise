import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext.jsx';
import './InterviewPopup.css';

// ---------------------------------------------------------------------------
// THE INTERVIEW POP-UP (founder 2026-11-04: "valla dashboard lo ledha, entire application lo ey
// chota vunna, popup avvali, display avvali screen meedha").
//
// From the day before an interview until it starts, the recruiter(s), the TL and the BDE(s) get a
// reminder every hour (utils/interviewHourly.js), and the "1 hour before" one (utils/interviewEngine.js).
// Each one pops up ON SCREEN here, on whatever page they are, until they press OK:
//
//   "⏰ Interview in about 3 hours"
//   Ravi Kumar · Staff Nurse (Apollo) · Round 1 · Wed, 5 Nov, 11:00 am · Online
//   [OK, got it]   [Open Interview Calendar]   [Join]
//
// Where it comes from: GET /api/admin/notifications/interview-popups - the caller's own unread
// interview reminders of the last hour, one per interview still booked. Checked every 30 seconds
// while the tab is open, the moment the tab comes back into view, and after sign-in.
// OK / Open mark THIS person's notes read (POST .../interview-popups/seen); the next hour brings it back.
// Mounted once, in the app shell (components/Shell.jsx).
// ---------------------------------------------------------------------------
const POLL_MS = 30000;
const MIN = 60000;
const HOUR = 3600000;

function leftWords(at, now) {
  const ms = new Date(at).getTime() - now;
  if (ms <= 0) return 'starting now';
  if (ms < 90 * MIN) return `in ${Math.max(1, Math.round(ms / MIN))} minutes`;
  const h = Math.round(ms / HOUR);
  return h >= 20 && h <= 28 ? `tomorrow (in about ${h} hours)` : `in about ${h} hours`;
}

export default function InterviewPopup() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  const check = useCallback(() => {
    if (!user) return;
    api.get('/admin/notifications/interview-popups')
      .then((res) => { if (alive.current) setItems(Array.isArray(res.data) ? res.data : []); })
      .catch(() => { /* offline or signed out: try again at the next check */ });
  }, [user]);

  useEffect(() => {
    alive.current = true;
    if (!user) return undefined;
    check();
    const timer = setInterval(() => { if (!document.hidden) check(); setNow(Date.now()); }, POLL_MS);
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

  if (!user || !items.length) return null;

  async function seen(then) {
    if (busy) return;
    setBusy(true);
    const ids = items.flatMap((i) => i.ids || []);
    try { await api.post('/admin/notifications/interview-popups/seen', { ids }); } catch { /* it comes back at the next check */ }
    setItems([]);
    setBusy(false);
    if (then) then();
  }

  const first = items[0];
  return (
    <div className="overlay show ivp-overlay" role="alertdialog" aria-modal="true" aria-labelledby="ivp-title">
      <div className="modal ivp-box">
        <div className="ivp-head">
          <span className="ivp-ico" aria-hidden="true">⏰</span>
          <h3 id="ivp-title">{items.length === 1 ? `Interview ${leftWords(first.at, now)}` : `${items.length} interviews coming up`}</h3>
        </div>
        <div className="ivp-body">
          {items.map((i) => (
            <div className="ivp-row" key={i.applicationId}>
              <div className="ivp-name">
                {i.candidate}
                <span className="ivp-left">{leftWords(i.at, now)}</span>
              </div>
              <div className="ivp-job">{`${i.job}${i.client ? ` (${i.client})` : ''} · Round ${i.round}`}</div>
              <div className="ivp-when">{`${i.when} · ${i.where}`}</div>
              {i.noLink && <div className="ivp-warn">No meeting link yet - add it in Interview Calendar.</div>}
              {i.link && <a className="btn btn-sm ivp-join" href={i.link} target="_blank" rel="noreferrer">Join</a>}
            </div>
          ))}
        </div>
        <div className="ivp-foot">
          <button type="button" className="btn btn-primary ivp-ok" onClick={() => seen()} disabled={busy} autoFocus>OK, got it</button>
          <button type="button" className="btn ivp-open" onClick={() => seen(() => navigate('/ats/calendar'))} disabled={busy}>Open Interview Calendar</button>
        </div>
      </div>
    </div>
  );
}
