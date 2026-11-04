import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext.jsx';
import './JobRequestPopup.css';

// ---------------------------------------------------------------------------
// THE CALL-BACK POP-UP (founder 2026-11-04, on a follow-up "she said that, call on 7th november": "ilaanti vaatiki kuda recruiter
// ki popup avvali. screen meedha"). On the day a follow-up asked to call back, the candidate's recruiter (and whoever wrote it)
// sees it on screen wherever they are in TeamLink:
//   "Call back today: <Candidate> - 'she said that, call on 7th november' (written 4 Nov by ...)"
//   [Open the profile]  [Done]  [Tomorrow]
// Data: GET /api/client-followlog/reminders (utils/followUpReminders.js), polled every minute and when the tab comes back.
// Done / Tomorrow are this person's own; nobody else's pop-up is touched. Mounted once, in the app shell (components/Shell.jsx).
// ---------------------------------------------------------------------------
const POLL_MS = 60000;
const fmt = (d) => { const [y, m, dd] = String(d || '').split('-'); return y ? `${Number(dd)} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1]}` : ''; };

export default function FollowUpReminderPopup() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const check = useCallback(() => {
    if (!user) return;
    api.get('/client-followlog/reminders')
      .then((r) => { if (alive.current) setItems((r.data && r.data.rows) || []); })
      .catch(() => { /* offline or no access: try again at the next check */ });
  }, [user]);
  useEffect(() => {
    alive.current = true;
    if (!user) return undefined;
    check();
    const timer = setInterval(() => { if (!document.hidden) check(); }, POLL_MS);
    const onShow = () => { if (!document.hidden) check(); };
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('focus', onShow);
    return () => { alive.current = false; clearInterval(timer); document.removeEventListener('visibilitychange', onShow); window.removeEventListener('focus', onShow); };
  }, [user && user.id, check]); // eslint-disable-line react-hooks/exhaustive-deps

  const cur = items[0];
  if (!user || !cur) return null;
  async function act(what, then) {
    if (busy) return;
    setBusy(true);
    try { await api.post(`/client-followlog/reminders/${cur.id}/${what}`); } catch { /* it comes back at the next check */ }
    setItems((l) => l.filter((x) => x.id !== cur.id));
    setBusy(false);
    if (then) then();
  }
  const more = items.length - 1;
  return (
    <div className="overlay show jrp-overlay" role="alertdialog" aria-modal="true" aria-labelledby="fur-title">
      <div className="modal jrp-box" style={{ borderTopColor: '#e59a1a' }}>
        <div className="jrp-head">
          <span className="jrp-ico" aria-hidden="true">📞</span>
          <h3 id="fur-title">{cur.late ? `Call back (was due ${fmt(cur.remindOn)})` : 'Call back today'}</h3>
          {more > 0 && <span className="jrp-more">{`+${more} more`}</span>}
        </div>
        <div className="jrp-body">
          <p className="jrp-job">{cur.who}</p>
          <p className="jrp-line">{`“${cur.note}”`}</p>
          <p className="jrp-sub">{[cur.kind === 'Client' ? 'Client follow-up' : 'Candidate follow-up', cur.writtenOn && `written ${fmt(cur.writtenOn)}`, cur.byName && `by ${cur.byName}`].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="jrp-foot">
          {cur.link && <button type="button" className="btn btn-primary jrp-open" disabled={busy} autoFocus onClick={() => act('done', () => navigate(cur.link))}>Open and call</button>}
          <button type="button" className="btn jrp-later" disabled={busy} onClick={() => act('done')}>Done</button>
          <button type="button" className="btn jrp-later" disabled={busy} onClick={() => act('tomorrow')}>Tomorrow</button>
        </div>
      </div>
    </div>
  );
}
